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

  it("logs user_id + subscription_id + trial_end on a well-formed event", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleTrialWillEnd(buildEvent());
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("user=user-1"));
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("subscription=sub_test"),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("trial_end=1700000000"),
    );
    logSpy.mockRestore();
  });

  it("warns and skips when supabase_user_id is missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleTrialWillEnd(
      buildEvent({ metadata: {} } as Partial<Stripe.Subscription>),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("missing supabase_user_id"),
    );
    expect(logSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("renders trial_end='null' in the log when Stripe omits the field", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleTrialWillEnd(
      buildEvent({ trial_end: null } as Partial<Stripe.Subscription>),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("trial_end=null"),
    );
    logSpy.mockRestore();
  });
});
