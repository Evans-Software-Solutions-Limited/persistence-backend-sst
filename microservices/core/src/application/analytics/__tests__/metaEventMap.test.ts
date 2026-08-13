import { describe, it, expect } from "vitest";
import {
  META_FORWARDED_EVENT_NAMES,
  mapPendingToMetaEvents,
} from "../metaEventMap";
import { hashEmail, hashExternalId } from "../metaCapiClient";
import type { PendingMetaEvent } from "../../repositories/analyticsEventRepository";

// Default: a CONSENTED, anonymous, WEB-origin event — the shape that actually
// forwards after the R2.7/R2.8 gates. Gate-specific tests override source/consent.
function pending(over: Partial<PendingMetaEvent>): PendingMetaEvent {
  return {
    id: "row-1",
    userId: null,
    email: null,
    marketingConsent: null,
    eventName: "lead_captured",
    occurredAt: new Date("2026-08-12T00:00:00.000Z"),
    properties: { marketing_consent: true },
    source: "web",
    eventId: "evt-1",
    ...over,
  };
}

describe("META_FORWARDED_EVENT_NAMES", () => {
  it("includes lead_captured + store_click; excludes cancellation/expiration", () => {
    expect(META_FORWARDED_EVENT_NAMES).toContain("lead_captured");
    expect(META_FORWARDED_EVENT_NAMES).toContain("store_click");
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
        pending({ properties: { marketing_consent: true } }),
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

  it("store_click → AppStoreClick", () => {
    expect(
      mapPendingToMetaEvents(pending({ eventName: "store_click" })).map(
        (e) => e.event_name,
      ),
    ).toEqual(["AppStoreClick"]);
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
      pending({ eventName: name, properties: { marketing_consent: true } });
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

  it("omits custom_data when no value/currency; omits event_id when null", () => {
    const [ev] = mapPendingToMetaEvents(
      pending({ eventName: "store_click", eventId: null }),
    );
    expect(ev!.custom_data).toBeUndefined();
    expect(ev!.event_id).toBeUndefined();
  });
});
