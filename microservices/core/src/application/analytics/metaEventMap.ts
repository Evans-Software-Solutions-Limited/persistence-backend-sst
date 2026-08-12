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
  | "Lead";

/**
 * The analytics `event_name`s that map to at least one Meta event — the filter
 * `listPendingMetaForward` uses so the drainer only pulls forwardable rows.
 * `cancellation`/`expiration` have no Meta standard event and are excluded.
 */
export const META_FORWARDED_EVENT_NAMES = [
  "subscription_purchased",
  "renewal",
  "trial_started",
  "registration_completed",
  "lead_captured",
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
    default:
      return [];
  }
}

/**
 * Build the fully-formed Meta server events for one pending outbox row —
 * including hashed `user_data` (email/external_id) and the pass-through
 * `fbc`/`fbp` from `properties`. `action_source` is `website` for web-origin
 * events (source==='web'), else `app`.
 */
export function mapPendingToMetaEvents(
  pending: PendingMetaEvent,
): MetaServerEvent[] {
  const skeletons = skeletonsFor(pending.eventName, pending.properties);
  if (skeletons.length === 0) return [];

  const props = pending.properties;
  const userData = buildUserData({
    email: pending.email,
    userId: pending.userId,
    fbc: typeof props.fbc === "string" ? props.fbc : null,
    fbp: typeof props.fbp === "string" ? props.fbp : null,
  });
  const actionSource: "website" | "app" =
    pending.source === "web" ? "website" : "app";
  const eventTime = Math.floor(pending.occurredAt.getTime() / 1000);

  return skeletons.map((s) => ({
    event_name: s.eventName,
    event_time: eventTime,
    ...(pending.eventId != null ? { event_id: pending.eventId } : {}),
    action_source: actionSource,
    user_data: userData,
    ...(s.customData !== undefined ? { custom_data: s.customData } : {}),
  }));
}
