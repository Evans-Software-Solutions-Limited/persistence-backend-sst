import type { PendingMetaEvent } from "../repositories/analyticsEventRepository";
import { buildUserData, type MetaServerEvent } from "./metaCapiClient";

/**
 * Pure mapping from first-party analytics events → Meta standard events
 * (spec-30 R2.3). No hashing, no HTTP — the client owns those. Kept separate so
 * a sibling sink (e.g. a TikTok Events API adapter, R2.5) can map the SAME
 * `analytics_events` stream without touching call-sites.
 */

export type MetaStandardEventName =
  | "Purchase"
  | "Subscribe"
  | "StartTrial"
  | "CompleteRegistration"
  | "Lead"
  // Custom (not a Meta standard event) — the optimisable web install signal
  // (spec-30 R3.8). Sent via `fbq('trackCustom', …)` on the browser side.
  | "AppStoreClick";

/**
 * The analytics `event_name`s the drainer pulls (the `listPendingMetaForward`
 * filter). Kept broad — the app-origin subscription/registration names stay so
 * those rows are pulled and stamped forwarded rather than re-scanned — but
 * `mapPendingToMetaEvents` then drops everything that isn't a consented,
 * web-origin event (R2.7/R2.8). `cancellation`/`expiration` map to nothing.
 */
export const META_FORWARDED_EVENT_NAMES = [
  "subscription_purchased",
  "renewal",
  "trial_started",
  "registration_completed",
  "lead_captured",
  "store_click",
] as const;

interface MetaEventSkeleton {
  eventName: MetaStandardEventName;
  customData?: Record<string, unknown>;
}

/** Which Meta standard event(s) a given analytics event becomes (0, 1 or 2). */
function skeletonsFor(
  eventName: string,
  properties: Record<string, unknown>,
): MetaEventSkeleton[] {
  const value =
    typeof properties.value === "number" ? properties.value : undefined;
  const currency =
    typeof properties.currency === "string" ? properties.currency : undefined;
  const customData =
    value !== undefined || currency !== undefined
      ? {
          ...(value !== undefined ? { value } : {}),
          ...(currency !== undefined ? { currency } : {}),
        }
      : undefined;

  switch (eventName) {
    case "subscription_purchased":
      // An initial purchase is both a Purchase (for value optimisation) and a
      // Subscribe. Same event_id on both is fine — Meta dedups per (name,id).
      return [
        { eventName: "Purchase", customData },
        { eventName: "Subscribe", customData },
      ];
    case "renewal":
      return [{ eventName: "Purchase", customData }];
    case "trial_started":
      return [{ eventName: "StartTrial", customData }];
    case "registration_completed":
      return [{ eventName: "CompleteRegistration" }];
    case "lead_captured":
      return [{ eventName: "Lead" }];
    case "store_click":
      return [{ eventName: "AppStoreClick" }];
    default:
      return [];
  }
}

/**
 * Does this row have affirmative marketing consent (spec-30 R2.7)? A
 * user-attributed row reads `profiles.marketing_consent` (joined onto the row);
 * an anonymous row (leads, store clicks) reads `properties.marketing_consent`.
 * NULL / absent / false all mean "no". Fail closed.
 */
function hasConsent(pending: PendingMetaEvent): boolean {
  if (pending.userId != null) return pending.marketingConsent === true;
  return pending.properties.marketing_consent === true;
}

/**
 * Build the fully-formed Meta server events for one pending outbox row —
 * including hashed `user_data` (email/external_id) and the pass-through
 * `fbc`/`fbp` from `properties`.
 *
 * Two gates return `[]` (nothing forwarded) up front:
 *  - **Web-only (R2.8):** `source !== 'web'` → skip. App/server events can't be
 *    attributed by Meta without an in-app SDK (`extinfo`/
 *    `advertiser_tracking_enabled`), so forwarding them is unusable data with a
 *    live compliance cost. `action_source` is therefore always `website`.
 *  - **Consent (R2.7):** no affirmative marketing consent → skip the WHOLE row.
 *    Never strip identifiers and send the rest — an unmatched event still tells
 *    Meta a conversion happened.
 */
export function mapPendingToMetaEvents(
  pending: PendingMetaEvent,
): MetaServerEvent[] {
  if (pending.source !== "web") return [];
  if (!hasConsent(pending)) return [];

  const skeletons = skeletonsFor(pending.eventName, pending.properties);
  if (skeletons.length === 0) return [];

  const props = pending.properties;
  const userData = buildUserData({
    email: pending.email,
    userId: pending.userId,
    fbc: typeof props.fbc === "string" ? props.fbc : null,
    fbp: typeof props.fbp === "string" ? props.fbp : null,
  });

  // Meta rejects an event with NO matching identifier, and one rejected event
  // fails the whole batch POST — the drainer then re-sends that batch every tick
  // until the row ages out (7 days). A consented anonymous row whose visitor has
  // no `_fbp`/`_fbc` (pixel blocked but consent stored) yields empty `user_data`;
  // skip it rather than poison the batch. It could never be matched anyway.
  if (
    userData.em === undefined &&
    userData.external_id === undefined &&
    userData.fbc === undefined &&
    userData.fbp === undefined
  ) {
    return [];
  }

  const eventTime = Math.floor(pending.occurredAt.getTime() / 1000);

  return skeletons.map((s) => ({
    event_name: s.eventName,
    event_time: eventTime,
    ...(pending.eventId != null ? { event_id: pending.eventId } : {}),
    action_source: "website" as const,
    user_data: userData,
    ...(s.customData !== undefined ? { custom_data: s.customData } : {}),
  }));
}
