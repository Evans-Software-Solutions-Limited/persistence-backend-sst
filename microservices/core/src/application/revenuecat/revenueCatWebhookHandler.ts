import { timingSafeEqual } from "node:crypto";
import { RevenueCatWebhookEventsRepository } from "../repositories/revenuecatWebhookEventsRepository";
import { getRevenueCatWebhookSecret } from "./revenueCatClient";
import { syncRevenueCatCustomer } from "./revenueCatSync";
import { notifySubscriptionTransferred } from "./notifySubscriptionTransferred";

// The customer-reconcile logic now lives in `revenueCatSync` (shared with
// `POST /subscriptions/sync`). Re-exported so existing importers/tests that
// reference `isRevenueCatAnonymousId` from this module keep resolving.
export { isRevenueCatAnonymousId } from "./revenueCatSync";

/**
 * RevenueCat webhook handler (M12 — RevenueCat fronts both Apple IAP + Stripe).
 *
 * RevenueCat is the entitlement source of truth across both rails; this
 * handler keeps `user_subscriptions` (and therefore `assertEntitlement`) in
 * sync. It does NOT trust the event body's per-type fields — on ANY event it
 * RE-FETCHES the customer's active entitlements via the REST API and rebuilds
 * the row from that snapshot. This sidesteps RevenueCat's at-least-once,
 * UNORDERED delivery: whatever order events arrive, the final state always
 * reflects the authoritative `active_entitlements` read.
 *
 * Mounted on the Hono parent (see api.ts) rather than inside Elysia: webhook
 * auth reads the raw `Authorization` header and there's no JWT.
 *
 * Auth: RevenueCat signs webhooks with a STATIC bearer secret in the
 * `Authorization` header (no HMAC / payload signature). Constant-time compared
 * against the `REVENUECAT_WEBHOOK_SECRET` SST Secret.
 *
 * Spec: specs/milestones/M12-app-store-iap/BACKEND_BRIEF.md
 */

/** Shape of the RevenueCat webhook envelope (fields parsed defensively). */
interface RevenueCatEvent {
  id?: unknown;
  type?: unknown;
  app_user_id?: unknown;
  transferred_to?: unknown;
  transferred_from?: unknown;
}
interface RevenueCatWebhookBody {
  event?: RevenueCatEvent;
}

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Constant-time string compare; length-guarded (unequal lengths → false). */
export function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Collect every app_user_id implicated by an event. Normally just
 * `app_user_id`; TRANSFER events instead carry `transferred_to` /
 * `transferred_from` arrays (entitlements moved between users) — both sides
 * need re-syncing. De-duplicated; non-string entries dropped.
 */
/**
 * The `transferred_from` App User IDs on a TRANSFER event — the accounts that LOST
 * the subscription. Separate from `resolveAppUserIds` (which unions both sides,
 * because both need re-syncing) because only this side gets notified.
 */
export function transferredFromIds(event: RevenueCatEvent): string[] {
  const value = event.transferred_from;
  if (!Array.isArray(value)) return [];
  // De-duplicated, matching `resolveAppUserIds`. Without it a repeated entry
  // (`["A","A"]`) syncs once but notifies twice — the sync collapses via its own
  // Set while this loop would iterate both.
  return [
    ...new Set(
      value.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.length > 0,
      ),
    ),
  ];
}

export function resolveAppUserIds(event: RevenueCatEvent): string[] {
  const ids = new Set<string>();
  if (typeof event.app_user_id === "string" && event.app_user_id.length > 0) {
    ids.add(event.app_user_id);
  }
  for (const key of ["transferred_to", "transferred_from"] as const) {
    const value = event[key];
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string" && entry.length > 0) ids.add(entry);
      }
    }
  }
  return [...ids];
}

export async function handleRevenueCatWebhook(req: Request): Promise<Response> {
  // 1. Auth — static bearer secret (no HMAC), constant-time compared.
  const authorization = req.headers.get("authorization");
  if (
    authorization === null ||
    !secretsMatch(authorization, getRevenueCatWebhookSecret())
  ) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  // 2. Parse.
  const rawBody = await req.text();
  let body: RevenueCatWebhookBody;
  try {
    body = JSON.parse(rawBody) as RevenueCatWebhookBody;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  const event = body.event;
  if (
    event === undefined ||
    typeof event.id !== "string" ||
    typeof event.type !== "string"
  ) {
    return jsonResponse({ error: "missing_event" }, 400);
  }
  const eventId = event.id;
  const eventType = event.type;

  // 3. Claim (dedupe — at-least-once, unordered delivery).
  const events = new RevenueCatWebhookEventsRepository();
  const claimed = await events.claim(
    eventId,
    eventType,
    event as unknown as Record<string, unknown>,
  );
  if (!claimed) {
    return jsonResponse({ received: true, duplicate: true }, 200);
  }

  // 4. Re-fetch + upsert for every implicated user.
  try {
    const appUserIds = resolveAppUserIds(event);

    // Who is eligible for the "your subscription moved" notice. Scoped tightly:
    //
    //  - TRANSFER events only. The revocation branch in `syncRevenueCatCustomer`
    //    also fires for ordinary expiry and cancellation, and "moved to another
    //    account" would be wrong and alarming for someone whose sub just lapsed.
    //  - `transferred_from` only — `transferred_to` GAINED it.
    //  - outcome `revoked` only, so a user who was already free stays silent. That
    //    also filters anonymous and foreign-environment ids, which sync reports as
    //    `skipped`.
    const notifyEligible =
      eventType === "TRANSFER"
        ? new Set(transferredFromIds(event))
        : new Set<string>();

    // ⚠ Per-user isolation, and notify INSIDE the loop.
    //
    // Two reasons, both about not losing an earned notification:
    //
    // 1. `revoked` is an EDGE, not a state — a re-run returns `already_inactive`,
    //    so the signal exists exactly once. Notifying after the loop meant any
    //    later failure discarded it permanently: the loser's revocation had
    //    already committed, the retry sees `already_inactive`, the event goes
    //    `done`, and they are never told. Precisely the silent loss this exists
    //    to remove.
    // 2. One user's failure must not skip the others. A TRANSFER syncs
    //    `transferred_to` BEFORE `transferred_from` (see `resolveAppUserIds`), so
    //    an RC 503 on the winner used to abort before the loser was reached at
    //    all — the in-loop notify alone would not have saved it. Isolating each
    //    user removes the order dependency instead of relying on it.
    //
    // Failures are collected and rethrown after the loop so the event still marks
    // `failed` and RevenueCat still retries. That retry is safe: every user that
    // succeeded is now `already_inactive`/`activated`, so no notice repeats.
    const syncErrors: string[] = [];
    for (const appUserId of appUserIds) {
      try {
        const outcome = await syncRevenueCatCustomer(appUserId);
        if (outcome === "revoked" && notifyEligible.has(appUserId)) {
          await notifySubscriptionTransferred(appUserId);
        }
      } catch (err) {
        syncErrors.push(
          `${appUserId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (syncErrors.length > 0) {
      throw new Error(`sync failed for ${syncErrors.join("; ")}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Mark failed (not done) so RevenueCat's retry re-claims + re-runs.
    await events.markFailed(eventId, message).catch((markErr) => {
      console.error(
        `[revenuecat:webhook] failed to mark ${eventId} failed: ${
          markErr instanceof Error ? markErr.message : String(markErr)
        }`,
      );
    });
    return jsonResponse({ error: "sync_failed", message }, 500);
  }

  // 5. Done — future deliveries of this id dedupe.
  await events.markDone(eventId).catch((markErr) => {
    console.error(
      `[revenuecat:webhook] handler succeeded but mark-done failed for ${eventId}: ${
        markErr instanceof Error ? markErr.message : String(markErr)
      }`,
    );
  });

  return jsonResponse({ received: true }, 200);
}
