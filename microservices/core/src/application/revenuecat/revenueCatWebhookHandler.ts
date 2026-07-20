import { timingSafeEqual } from "node:crypto";
import {
  LIVE_SUBSCRIPTION_STATUSES,
  SubscriptionRepository,
} from "../repositories/subscriptionRepository";
import { RevenueCatWebhookEventsRepository } from "../repositories/revenuecatWebhookEventsRepository";
import {
  fetchActiveEntitlements,
  getRevenueCatWebhookSecret,
} from "./revenueCatClient";
import { pickDesiredSubscription } from "./entitlements";

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

const LIVE: readonly string[] = LIVE_SUBSCRIPTION_STATUSES;

/**
 * Re-fetch one customer's active entitlements and upsert their
 * `user_subscriptions` mirror row (keyed by the synthetic
 * `external_subscription_id = rc_<appUserId>`). Active → upsert the derived
 * tier/expiry; none → cancel the mirror row (revert to free).
 */
/**
 * RevenueCat assigns an anonymous App User ID (`$RCAnonymousID:<uuid>`) before
 * the client binds identity via `Purchases.logIn(<supabaseUserId>)`. It is NOT
 * our Supabase user id, which is the `uuid` FK on `user_subscriptions.user_id`
 * — writing it would throw on the uuid cast and wedge the event in a
 * 500/retry loop. Skip it: the purchase reconciles when RevenueCat fires a
 * TRANSFER event aliasing the anon id to the Supabase id at login.
 */
export function isRevenueCatAnonymousId(appUserId: string): boolean {
  return appUserId.startsWith("$RCAnonymousID:");
}

async function syncCustomer(appUserId: string): Promise<void> {
  if (isRevenueCatAnonymousId(appUserId)) {
    console.warn(
      `[revenuecat:webhook] skipping anonymous app_user_id (no identity bind yet): ${appUserId}`,
    );
    return;
  }

  const repo = new SubscriptionRepository();

  // Shared-RevenueCat-project guard: one RC project behind both staging and
  // production fans every event out to every webhook, so this backend may be
  // pinged for a user that only exists in the OTHER environment's database.
  // `user_subscriptions.user_id` FKs to `profiles.id`, so writing a foreign id
  // would throw and 500-loop on RevenueCat's retries forever. Skip it (the
  // event is a no-op success) — only this environment's own users get a row.
  if (!(await repo.userExists(appUserId))) {
    console.warn(
      `[revenuecat:webhook] skipping app_user_id with no matching profile (likely a different environment on a shared RevenueCat project): ${appUserId}`,
    );
    return;
  }

  const entitlements = await fetchActiveEntitlements(appUserId);
  const desired = pickDesiredSubscription(entitlements);

  const rcExternalId = `rc_${appUserId}`;

  if (desired !== null) {
    const values = {
      tierName: desired.tier,
      paymentStatus: "active",
      expiresAt: desired.expiresAt,
      billingCycle: desired.billingCycle,
      externalSubscriptionId: rcExternalId,
      metadata: {
        source: "revenuecat",
        store: desired.store,
        product_id: desired.productId,
      } as Record<string, unknown>,
    };

    // Supersede ANY other live row for this user before the active write so we
    // never leave two live rows (the `user_subscriptions_active_unique` partial
    // index allows one). This MUST run even though the upsert below re-activates
    // the rc_ mirror: the mirror may be `cancelled` while a sibling row (e.g. a
    // Stripe-created mirror) is still live — re-activating the mirror without
    // first cancelling the sibling would trip that index → 500 → RevenueCat
    // retries forever. RevenueCat is the unifying source of truth across both
    // rails, so a prior live row is safely superseded. Cancelling then
    // re-activating the rc_ row itself (when it was already live) is a harmless
    // extra write reconciled by the upsert's DO UPDATE.
    await repo.cancelLiveSubscriptions(appUserId);

    // Single ATOMIC upsert on external_subscription_id (spec-12.13). Replaces
    // the former non-atomic findByExternalId→insert-or-update: under
    // RevenueCat's at-least-once + unordered delivery, two concurrent FIRST
    // deliveries for the same new customer both saw `existing === null` and both
    // inserted, tripping the active-unique index (loser 500'd → retry). The
    // partial unique index now makes the second writer take DO UPDATE instead.
    await repo.upsertByExternalId({
      userId: appUserId,
      startsAt: new Date(),
      ...values,
    });
    return;
  }

  // No active entitlement → revert to free by cancelling the live mirror. This
  // branch still needs the row lookup (nothing to cancel if there's no mirror,
  // or the mirror is already terminal).
  const existing = await repo.findByExternalId(rcExternalId);
  if (existing !== null && LIVE.includes(existing.paymentStatus ?? "")) {
    await repo.updateById(existing.id, { paymentStatus: "cancelled" });
  }
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
    for (const appUserId of appUserIds) {
      await syncCustomer(appUserId);
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
