import { describe, it, expect } from "vitest";
import {
  META_FORWARDED_EVENT_NAMES,
  mapPendingToMetaEvents,
} from "../metaEventMap";
import { hashEmail, hashExternalId } from "../metaCapiClient";
import type { PendingMetaEvent } from "../../repositories/analyticsEventRepository";

function pending(over: Partial<PendingMetaEvent>): PendingMetaEvent {
  return {
    id: "row-1",
    userId: "user-1",
    email: "Person@Example.com",
    eventName: "subscription_purchased",
    occurredAt: new Date("2026-08-12T00:00:00.000Z"),
    properties: {},
    source: "app",
    eventId: "evt-1",
    ...over,
  };
}

describe("META_FORWARDED_EVENT_NAMES", () => {
  it("excludes cancellation/expiration (no Meta standard event)", () => {
    expect(META_FORWARDED_EVENT_NAMES).not.toContain("cancellation");
    expect(META_FORWARDED_EVENT_NAMES).not.toContain("expiration");
    expect(META_FORWARDED_EVENT_NAMES).toContain("subscription_purchased");
    expect(META_FORWARDED_EVENT_NAMES).toContain("registration_completed");
  });
});

describe("mapPendingToMetaEvents", () => {
  it("maps subscription_purchased to BOTH Purchase and Subscribe with value/currency", () => {
    const events = mapPendingToMetaEvents(
      pending({ properties: { value: 12.99, currency: "GBP" } }),
    );
    expect(events.map((e) => e.event_name)).toEqual(["Purchase", "Subscribe"]);
    expect(events[0]!.custom_data).toEqual({ value: 12.99, currency: "GBP" });
    // shared event_id + unix-seconds event_time
    expect(events[0]!.event_id).toBe("evt-1");
    expect(events[0]!.event_time).toBe(
      Math.floor(new Date("2026-08-12T00:00:00.000Z").getTime() / 1000),
    );
  });

  it("hashes email + external_id into user_data (SHA-256), action_source app", () => {
    const [ev] = mapPendingToMetaEvents(pending({}));
    expect(ev!.user_data.em).toEqual([hashEmail("Person@Example.com")]);
    expect(ev!.user_data.external_id).toEqual([hashExternalId("user-1")]);
    expect(ev!.action_source).toBe("app");
  });

  it("uses action_source website + passes through fbc/fbp for web leads", () => {
    const [ev] = mapPendingToMetaEvents(
      pending({
        eventName: "lead_captured",
        source: "web",
        email: null,
        userId: null,
        properties: { audience: "athletes", fbc: "fb.1.1.x", fbp: "fb.1.1.y" },
      }),
    );
    expect(ev!.event_name).toBe("Lead");
    expect(ev!.action_source).toBe("website");
    expect(ev!.user_data.fbc).toBe("fb.1.1.x");
    expect(ev!.user_data.fbp).toBe("fb.1.1.y");
    // no email/user → no em/external_id
    expect(ev!.user_data.em).toBeUndefined();
    expect(ev!.user_data.external_id).toBeUndefined();
  });

  it("maps renewal→Purchase, trial_started→StartTrial, registration→CompleteRegistration", () => {
    expect(
      mapPendingToMetaEvents(pending({ eventName: "renewal" })).map(
        (e) => e.event_name,
      ),
    ).toEqual(["Purchase"]);
    expect(
      mapPendingToMetaEvents(pending({ eventName: "trial_started" })).map(
        (e) => e.event_name,
      ),
    ).toEqual(["StartTrial"]);
    expect(
      mapPendingToMetaEvents(
        pending({ eventName: "registration_completed" }),
      ).map((e) => e.event_name),
    ).toEqual(["CompleteRegistration"]);
  });

  it("returns [] for an unmapped event name", () => {
    expect(
      mapPendingToMetaEvents(pending({ eventName: "cancellation" })),
    ).toEqual([]);
  });

  it("omits custom_data when there is no value/currency, omits event_id when null", () => {
    const [ev] = mapPendingToMetaEvents(
      pending({ eventName: "registration_completed", eventId: null }),
    );
    expect(ev!.custom_data).toBeUndefined();
    expect(ev!.event_id).toBeUndefined();
  });
});
