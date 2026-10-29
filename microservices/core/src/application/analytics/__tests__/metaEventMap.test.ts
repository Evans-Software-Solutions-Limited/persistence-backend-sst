import { describe, it, expect, vi } from "vitest";
import {
  FOUNDING_PLAN_CONTENT_IDS,
  META_FORWARDED_EVENT_NAMES,
  foundingPlanContentId,
  mapPendingToMetaEvents,
} from "../metaEventMap";
import { hashEmail, hashExternalId } from "../metaCapiClient";
import type { PendingMetaEvent } from "../../repositories/analyticsEventRepository";

// Default: a CONSENTED, anonymous, WEB-origin event WITH an identifier (`fbp`) —
// the shape that actually forwards after the R2.7/R2.8 gates + the empty-
// user_data guard. Gate-specific tests override source/consent/identifiers.
function pending(over: Partial<PendingMetaEvent>): PendingMetaEvent {
  return {
    id: "row-1",
    userId: null,
    email: null,
    marketingConsent: null,
    eventName: "lead_captured",
    occurredAt: new Date("2026-08-12T00:00:00.000Z"),
    properties: { marketing_consent: true, fbp: "fb.1.1.default" },
    source: "web",
    eventId: "evt-1",
    ...over,
  };
}

describe("META_FORWARDED_EVENT_NAMES", () => {
  it("includes lead_captured + store_click; excludes cancellation/expiration", () => {
    expect(META_FORWARDED_EVENT_NAMES).toContain("lead_captured");
    expect(META_FORWARDED_EVENT_NAMES).toContain("store_click");
    // The founding web rail (2026-09-05 amendment).
    expect(META_FORWARDED_EVENT_NAMES).toContain("checkout_started");
    expect(META_FORWARDED_EVENT_NAMES).toContain("purchase");
    expect(META_FORWARDED_EVENT_NAMES).not.toContain("cancellation");
    expect(META_FORWARDED_EVENT_NAMES).not.toContain("expiration");
  });
});

describe("mapPendingToMetaEvents — web-only sink (R2.8)", () => {
  it("forwards nothing for app-origin events", () => {
    expect(
      mapPendingToMetaEvents(
        pending({ source: "app", eventName: "subscription_purchased" }),
      ),
    ).toEqual([]);
  });

  it("forwards nothing for server-origin events", () => {
    expect(mapPendingToMetaEvents(pending({ source: "server" }))).toEqual([]);
  });

  it("action_source is always website for a forwarded event", () => {
    const [ev] = mapPendingToMetaEvents(pending({}));
    expect(ev!.action_source).toBe("website");
  });
});

describe("mapPendingToMetaEvents — consent gate, fail closed (R2.7)", () => {
  it("anonymous row forwards ONLY when properties.marketing_consent === true", () => {
    expect(
      mapPendingToMetaEvents(
        pending({ properties: { marketing_consent: true, fbp: "fb.1.1.z" } }),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      mapPendingToMetaEvents(
        pending({ properties: { marketing_consent: false } }),
      ),
    ).toEqual([]);
    // absent → fail closed
    expect(mapPendingToMetaEvents(pending({ properties: {} }))).toEqual([]);
  });

  it("user-attributed row forwards ONLY when profiles.marketing_consent === true", () => {
    const base = {
      userId: "user-1",
      email: "a@b.com",
      properties: {} as Record<string, unknown>,
    };
    expect(
      mapPendingToMetaEvents(pending({ ...base, marketingConsent: true }))
        .length,
    ).toBeGreaterThan(0);
    expect(
      mapPendingToMetaEvents(pending({ ...base, marketingConsent: false })),
    ).toEqual([]);
    // NULL = never asked → fail closed
    expect(
      mapPendingToMetaEvents(pending({ ...base, marketingConsent: null })),
    ).toEqual([]);
  });
});

describe("mapPendingToMetaEvents — event mapping", () => {
  it("lead_captured → Lead, deduped on event_id, passes fbc/fbp, no em when anonymous", () => {
    const [ev] = mapPendingToMetaEvents(
      pending({
        properties: {
          marketing_consent: true,
          fbc: "fb.1.1.x",
          fbp: "fb.1.1.y",
        },
      }),
    );
    expect(ev!.event_name).toBe("Lead");
    expect(ev!.event_id).toBe("evt-1");
    expect(ev!.user_data.fbc).toBe("fb.1.1.x");
    expect(ev!.user_data.fbp).toBe("fb.1.1.y");
    expect(ev!.user_data.em).toBeUndefined();
    expect(ev!.event_time).toBe(
      Math.floor(new Date("2026-08-12T00:00:00.000Z").getTime() / 1000),
    );
  });

  it("store_click → AppStoreClick with the destination platform", () => {
    const [event] = mapPendingToMetaEvents(
      pending({
        eventName: "store_click",
        properties: {
          marketing_consent: true,
          fbp: "fb.1.1.default",
          store: "android",
          ref: "UON2026",
        },
      }),
    );
    expect(event!.event_name).toBe("AppStoreClick");
    // Referral attribution is first-party analytics only and is not consented
    // advertising data. The mapper must never copy it into Meta custom_data.
    expect(event!.custom_data).toEqual({ store: "android" });
  });

  it("never forwards the campaign slug to Meta", () => {
    // MARKETING-PLANS WP2. `properties.campaign` exists so OUR admin panel can
    // group first-party store clicks by channel. Meta attributes on its own
    // click ids and has no use for it, and every field added to custom_data is
    // another thing shipped to a third party — so it stays first-party only.
    const [event] = mapPendingToMetaEvents(
      pending({
        eventName: "store_click",
        properties: {
          marketing_consent: true,
          fbp: "fb.1.1.campaign",
          store: "ios",
          campaign: "meta",
        },
      }),
    );
    expect(event!.custom_data).toEqual({ store: "ios" });
    expect(JSON.stringify(event)).not.toContain("meta");
  });

  it("checkout_started → InitiateCheckout with the value and the plan", () => {
    // The intent signal Meta optimises towards until there is enough Purchase
    // volume to optimise on the conversion itself.
    const events = mapPendingToMetaEvents(
      pending({
        eventName: "checkout_started",
        properties: {
          marketing_consent: true,
          fbp: "fb.1.1.checkout",
          value: 30,
          currency: "GBP",
          tier: "premium",
          months: 6,
        },
      }),
    );
    expect(events.map((e) => e.event_name)).toEqual(["InitiateCheckout"]);
    expect(events[0]!.custom_data).toEqual({
      value: 30,
      currency: "GBP",
      content_name: "premium_6m",
      content_ids: ["premium_6m"],
      content_type: "product",
      num_items: 1,
    });
  });

  it("sends the money alone when the tier/term names no web plan", () => {
    // A tier nobody sells on the website (the admin-only coach tier), or a row
    // written before `months` existed. Better an unsegmentable conversion than
    // a guessed plan id reporting a sale nobody made.
    const events = mapPendingToMetaEvents(
      pending({
        eventName: "checkout_started",
        properties: {
          marketing_consent: true,
          fbp: "fb.1.1.checkout",
          value: 30,
          currency: "GBP",
          tier: "start_up_coach_plus",
          months: 6,
        },
      }),
    );
    expect(events[0]!.custom_data).toEqual({ value: 30, currency: "GBP" });
  });

  it("purchase → Purchase ALONE, never Subscribe", () => {
    // A founding purchase is one fixed term that does not renew. Telling Meta
    // a subscription began would make the two rails indistinguishable in
    // reporting and teach the model the wrong lifetime value.
    const events = mapPendingToMetaEvents(
      pending({
        eventName: "purchase",
        properties: {
          marketing_consent: true,
          fbp: "fb.1.1.purchase",
          value: 30,
          currency: "GBP",
        },
      }),
    );
    expect(events.map((e) => e.event_name)).toEqual(["Purchase"]);
  });

  it("forwards the plan on a purchase, but never the referral code or campaign", () => {
    // The tier/term DO go now (2026-09-09) — a Sales campaign cannot learn
    // which plan converts without them — but only as the plan id, on Meta's
    // standard commerce parameters. `ref` and `campaign` are our own
    // attribution and stay ours.
    const [event] = mapPendingToMetaEvents(
      pending({
        eventName: "purchase",
        properties: {
          marketing_consent: true,
          fbp: "fb.1.1.purchase",
          value: 60,
          currency: "GBP",
          tier: "premium_plus",
          months: 12,
          ref: "METAFOUND",
          campaign: "meta",
        },
      }),
    );
    expect(event!.custom_data).toEqual({
      value: 60,
      currency: "GBP",
      content_name: "plus_12m",
      content_ids: ["plus_12m"],
      content_type: "product",
      num_items: 1,
    });
    // Neither the raw tier nor our attribution reaches Meta under any key.
    expect(JSON.stringify(event)).not.toContain("premium_plus");
    expect(JSON.stringify(event)).not.toContain("METAFOUND");
    expect(JSON.stringify(event)).not.toContain('"campaign"');
  });

  it("a consented web purchase → Purchase + Subscribe w/ value/currency, hashes em+external_id", () => {
    const events = mapPendingToMetaEvents(
      pending({
        eventName: "subscription_purchased",
        userId: "user-1",
        email: "Person@Example.com",
        marketingConsent: true,
        properties: { value: 12.99, currency: "GBP" },
      }),
    );
    expect(events.map((e) => e.event_name)).toEqual(["Purchase", "Subscribe"]);
    expect(events[0]!.custom_data).toEqual({ value: 12.99, currency: "GBP" });
    expect(events[0]!.user_data.em).toEqual([hashEmail("Person@Example.com")]);
    expect(events[0]!.user_data.external_id).toEqual([
      hashExternalId("user-1"),
    ]);
  });

  it("renewal→Purchase, trial_started→StartTrial, registration→CompleteRegistration", () => {
    const web = (name: string) =>
      pending({
        eventName: name,
        properties: { marketing_consent: true, fbp: "fb.1.1.z" },
      });
    expect(
      mapPendingToMetaEvents(web("renewal")).map((e) => e.event_name),
    ).toEqual(["Purchase"]);
    expect(
      mapPendingToMetaEvents(web("trial_started")).map((e) => e.event_name),
    ).toEqual(["StartTrial"]);
    expect(
      mapPendingToMetaEvents(web("registration_completed")).map(
        (e) => e.event_name,
      ),
    ).toEqual(["CompleteRegistration"]);
  });

  it("returns [] for an unmapped event name", () => {
    expect(
      mapPendingToMetaEvents(pending({ eventName: "cancellation" })),
    ).toEqual([]);
  });

  it("skips a consented anonymous row with NO identifier (no em/external_id/fbc/fbp) — Meta would reject it and poison the batch", () => {
    expect(
      mapPendingToMetaEvents(
        pending({
          eventName: "store_click",
          properties: { marketing_consent: true }, // consented but no fbc/fbp
        }),
      ),
    ).toEqual([]);
  });

  it("omits custom_data when no value/currency; omits event_id when null", () => {
    const [ev] = mapPendingToMetaEvents(
      pending({ eventName: "store_click", eventId: null }),
    );
    expect(ev!.custom_data).toBeUndefined();
    expect(ev!.event_id).toBeUndefined();
  });
});

describe("foundingPlanContentId", () => {
  it("names all four web terms and nothing else", () => {
    expect(foundingPlanContentId("premium", 6)).toBe("premium_6m");
    expect(foundingPlanContentId("premium", 12)).toBe("premium_12m");
    expect(foundingPlanContentId("premium_plus", 6)).toBe("plus_6m");
    expect(foundingPlanContentId("premium_plus", 12)).toBe("plus_12m");
    expect(Object.keys(FOUNDING_PLAN_CONTENT_IDS)).toHaveLength(4);
  });

  it("is undefined for anything not sold on the website", () => {
    // The admin/enquiry-only coach tier, a term nobody offers, and the shapes a
    // JSONB `properties` blob can actually hand it.
    expect(foundingPlanContentId("start_up_coach_plus", 6)).toBeUndefined();
    expect(foundingPlanContentId("premium", 3)).toBeUndefined();
    expect(foundingPlanContentId("premium", 6.5)).toBeUndefined();
    expect(foundingPlanContentId("premium", undefined)).toBeUndefined();
    expect(foundingPlanContentId(undefined, 6)).toBeUndefined();
    expect(foundingPlanContentId("premium", "6")).toBeUndefined();
    // A key from `Object.prototype` must not resolve to a plan.
    expect(foundingPlanContentId("constructor", 6)).toBeUndefined();
  });
});

describe("the RevenueCat rail keeps its own custom_data", () => {
  // Different products on a different store. Labelling an App Store
  // subscription with one of the four founding terms would merge two rails into
  // one unreadable report — so the commerce params are the WEB events' alone,
  // even when a row happens to carry a matching tier/months pair.
  it.each(["subscription_purchased", "renewal", "trial_started"])(
    "%s carries value/currency only",
    (eventName) => {
      const events = mapPendingToMetaEvents(
        pending({
          eventName,
          properties: {
            marketing_consent: true,
            fbp: "fb.1.1.rc",
            value: 30,
            currency: "GBP",
            tier: "premium",
            months: 6,
          },
        }),
      );
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event.custom_data).toEqual({ value: 30, currency: "GBP" });
      }
    },
  );
});

describe("event_source_url (Meta requires it for action_source: website)", () => {
  // Meta's parameter table calls it optional and then states it IS required for
  // website events sent through the Conversions API, and that it must match the
  // verified domain. Sending an `action_source: "website"` event without one is
  // accepted by the HTTP call and can still fail to register server-side.
  it("points a checkout at /founding and a purchase at /founding/thanks", () => {
    const checkout = mapPendingToMetaEvents(
      pending({
        eventName: "checkout_started",
        properties: { marketing_consent: true, fbp: "fb.1.1.c" },
      }),
    );
    const purchase = mapPendingToMetaEvents(
      pending({
        eventName: "purchase",
        properties: { marketing_consent: true, fbp: "fb.1.1.p" },
      }),
    );
    expect(checkout[0]!.event_source_url).toBe(
      "https://persistence.evans-software-solutions.com/founding",
    );
    expect(purchase[0]!.event_source_url).toBe(
      "https://persistence.evans-software-solutions.com/founding/thanks",
    );
  });

  it("rides ALONGSIDE the commerce params, not instead of them", () => {
    // These two arrived on separate branches and were merged by hand into the
    // same two `case` arms. A resolution that kept one and dropped the other
    // would still typecheck and still pass both of their own suites, so this
    // pins them together on one event.
    const [event] = mapPendingToMetaEvents(
      pending({
        eventName: "purchase",
        properties: {
          marketing_consent: true,
          fbp: "fb.1.1.p",
          value: 60,
          currency: "GBP",
          tier: "premium_plus",
          months: 12,
        },
      }),
    );
    expect(event!.event_source_url).toBe(
      "https://persistence.evans-software-solutions.com/founding/thanks",
    );
    expect(event!.custom_data).toEqual({
      value: 60,
      currency: "GBP",
      content_name: "plus_12m",
      content_ids: ["plus_12m"],
      content_type: "product",
      num_items: 1,
    });
  });

  it("carries no query string", () => {
    // The campaign and referral params that ride on a real landing URL are our
    // own attribution and have no business at Meta.
    const [event] = mapPendingToMetaEvents(
      pending({
        eventName: "checkout_started",
        properties: {
          marketing_consent: true,
          fbp: "fb.1.1.c",
          campaign: "meta",
          ref: "METAFOUND",
        },
      }),
    );
    expect(event!.event_source_url).not.toContain("?");
  });

  it("follows WEB_ORIGIN when the stage sets one", () => {
    // `finally`, not a trailing call: this config does not set `unstubEnvs`, so
    // a failed assertion here would otherwise leak the staging origin into
    // every later test in the file and turn one failure into a cascade.
    vi.stubEnv("WEB_ORIGIN", "https://staging.example.test/");
    try {
      const [event] = mapPendingToMetaEvents(
        pending({
          eventName: "purchase",
          properties: { marketing_consent: true, fbp: "fb.1.1.p" },
        }),
      );
      // Trailing slash stripped by `webOrigin()`, so no double slash in the path.
      expect(event!.event_source_url).toBe(
        "https://staging.example.test/founding/thanks",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("is ABSENT on the events whose page we do not know", () => {
    // A guessed URL that failed Meta's verified-domain check would be worse
    // than an absent one, and `store_click` already registers server-side.
    for (const eventName of ["store_click", "lead_captured"]) {
      const events = mapPendingToMetaEvents(
        pending({
          eventName,
          properties: {
            marketing_consent: true,
            fbp: "fb.1.1.s",
            store: "ios",
          },
        }),
      );
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event).not.toHaveProperty("event_source_url");
      }
    }
  });
});
