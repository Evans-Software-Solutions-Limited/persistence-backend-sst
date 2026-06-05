import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { handleTrialWillEnd } from "../../eventHandlers/trialWillEnd";

function buildEvent(
  overrides: Partial<Stripe.Subscription> = {},
): Stripe.Event {
  const subscription = {
    id: "sub_test",
    metadata: { supabase_user_id: "user-1" },
    trial_end: 1700000000,
    ...overrides,
  } as Stripe.Subscription;
  return {
    id: "evt_test",
    type: "customer.subscription.trial_will_end",
    data: { object: subscription },
  } as Stripe.Event;
}

describe("handleTrialWillEnd", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits a [stripe:alert] trial_will_end ops alert with user + sub on a well-formed event", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await handleTrialWillEnd(buildEvent());
    const alert = warnSpy.mock.calls
      .map((c) => String(c[0]))
      .find((m) => m.includes("[stripe:alert]"));
    expect(alert).toBeDefined();
    expect(alert).toContain('"kind":"trial_will_end"');
    expect(alert).toContain("user-1");
    expect(alert).toContain("sub_test");
    warnSpy.mockRestore();
  });

  it("warns and skips (no alert emitted) when supabase_user_id is missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await handleTrialWillEnd(
      buildEvent({ metadata: {} } as Partial<Stripe.Subscription>),
    );
    const messages = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("missing supabase_user_id"))).toBe(
      true,
    );
    expect(messages.some((m) => m.includes("[stripe:alert]"))).toBe(false);
    warnSpy.mockRestore();
  });

  it("includes trialEnd:null in the alert when Stripe omits the field", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await handleTrialWillEnd(
      buildEvent({ trial_end: null } as Partial<Stripe.Subscription>),
    );
    const alert = warnSpy.mock.calls
      .map((c) => String(c[0]))
      .find((m) => m.includes("[stripe:alert]"));
    expect(alert).toContain('"trialEnd":null');
    warnSpy.mockRestore();
  });
});
