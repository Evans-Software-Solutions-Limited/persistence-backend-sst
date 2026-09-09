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
  | "InitiateCheckout"
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
  "checkout_started",
  "purchase",
] as const;

/**
 * The four founding terms as ONE canonical product id, shared with the browser
 * pixel (`packages/web/src/marketing/foundingOffer.ts`, held in step by
 * `foundingPlanContentIdParity.test.ts`).
 *
 * Meta needs the plan on the purchase signal so a Sales campaign can learn and
 * report which term converts, and so value optimisation has something to
 * segment on. It has to ride on Meta's STANDARD commerce parameters —
 * `content_name` / `content_ids` / `content_type` / `num_items` — and never on
 * a custom key like `tier`: this dataset is self-declared Health & wellness, a
 * category under which Meta restricts custom parameters.
 *
 * Keyed `"<tier>:<months>"` and FLAT on purpose. The web mirror is compared
 * against this literal by reading this file as text (the core package is
 * outside the web TypeScript project, so it cannot be imported), so the table
 * has to stay trivially parseable: keep it a flat object of string -> string.
 */
export const FOUNDING_PLAN_CONTENT_IDS: Record<string, string> = {
  "premium:6": "premium_6m",
  "premium:12": "premium_12m",
  "premium_plus:6": "plus_6m",
  "premium_plus:12": "plus_12m",
};

/**
 * The canonical plan id for a `tier` x `months` pair, or `undefined` for
 * anything not sold on the website: the admin/enquiry-only
 * `start_up_coach_plus`, a term nobody offers, or a row that predates these
 * properties. `undefined` means "send value/currency alone" — never a guessed
 * id, which would teach Meta that a plan converted which nobody bought.
 */
export function foundingPlanContentId(
  tier: unknown,
  months: unknown,
): string | undefined {
  if (typeof tier !== "string") return undefined;
  if (typeof months !== "number" || !Number.isInteger(months)) return undefined;
  return FOUNDING_PLAN_CONTENT_IDS[`${tier}:${months}`];
}

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
  const money = {
    ...(value !== undefined ? { value } : {}),
    ...(currency !== undefined ? { currency } : {}),
  };
  const customData = Object.keys(money).length > 0 ? money : undefined;

  /**
   * `custom_data` for the two WEB founding events: the money, plus Meta's
   * standard commerce parameters naming which plan it was.
   *
   * Only these two. The RevenueCat rail (`subscription_purchased`/`renewal`)
   * deliberately does not get them — those are different products on a
   * different store, and labelling an App Store subscription with one of the
   * four founding terms would merge two rails into one unreadable report.
   *
   * Falls back to money alone when the pair names no web plan, rather than
   * omitting the value too.
   */
  const commerceData = (): Record<string, unknown> | undefined => {
    const planId = foundingPlanContentId(properties.tier, properties.months);
    if (planId === undefined) return customData;
    return {
      ...money,
      content_name: planId,
      content_ids: [planId],
      content_type: "product",
      num_items: 1,
    };
  };

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
    // Founding web checkout. `InitiateCheckout` is the intent signal Meta
    // optimises towards until enough `Purchase` volume exists to optimise on
    // the conversion itself.
    case "checkout_started":
      return [{ eventName: "InitiateCheckout", customData: commerceData() }];
    // A one-off fixed-term purchase. Purchase ONLY — no `Subscribe`, unlike
    // `subscription_purchased`: nothing here renews, and telling Meta a
    // subscription began would make the two rails indistinguishable in
    // reporting and teach the model the wrong lifetime value.
    case "purchase":
      return [{ eventName: "Purchase", customData: commerceData() }];
    case "store_click":
      return [
        {
          eventName: "AppStoreClick",
          customData:
            properties.store === "ios" || properties.store === "android"
              ? { store: properties.store }
              : undefined,
        },
      ];
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
