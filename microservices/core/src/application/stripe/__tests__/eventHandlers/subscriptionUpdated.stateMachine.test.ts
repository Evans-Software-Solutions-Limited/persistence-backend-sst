import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const findByExternalIdMock = vi.fn();
const updateByIdMock = vi.fn();
const ledgerRecordMock = vi.fn();

vi.mock("../../../repositories/subscriptionRepository", () => ({
  SubscriptionRepository: vi.fn().mockImplementation(() => ({
    findByExternalId: findByExternalIdMock,
    updateById: updateByIdMock,
  })),
}));

vi.mock(
  "../../../repositories/subscriptionStatusTransitionsRepository",
  () => ({
    SubscriptionStatusTransitionsRepository: vi
      .fn()
      .mockImplementation(() => ({ record: ledgerRecordMock })),
  }),
);

vi.mock("../../stripeClient", () => ({
  getStripe: vi.fn(() => ({
    subscriptions: { retrieve: vi.fn(), cancel: vi.fn() },
  })),
  getStripeWebhookSecret: vi.fn(() => "whsec_test"),
}));

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(() => ({ select: vi.fn() })),
}));

import { handleSubscriptionUpdated } from "../../eventHandlers/subscriptionUpdated";

function activeEvent(): Stripe.Event {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: "evt_upd",
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_1",
        status: "active",
        metadata: { supabase_user_id: "user-1" },
        canceled_at: null,
        cancel_at: null,
        cancel_at_period_end: false,
        trial_end: null,
        items: { data: [{ current_period_end: now + 30 * 86400 }] },
      },
    },
  } as unknown as Stripe.Event;
}

describe("handleSubscriptionUpdated — state machine (spec 17 / Phase D)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    updateByIdMock.mockResolvedValue({ id: "us_test" });
    ledgerRecordMock.mockResolvedValue(undefined);
    // Suppress + capture alert output without restoreAllMocks (which would
    // wipe the module-mock implementations between tests).
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  it("BLOCKS a terminal→live webhook transition: keeps cancelled, alerts, ledgers the blocked attempt", async () => {
    // Local row is already terminal (cancelled); a stale 'active' event arrives.
    findByExternalIdMock.mockResolvedValue({
      id: "us_test",
      externalSubscriptionId: "sub_1",
      paymentStatus: "cancelled",
      cancelledAt: new Date(),
      metadata: {},
    });

    await handleSubscriptionUpdated(activeEvent());

    // The basic update must KEEP cancelled (not flip to active).
    expect(updateByIdMock).toHaveBeenCalledWith(
      "us_test",
      expect.objectContaining({ paymentStatus: "cancelled" }),
    );
    // An ops alert was emitted.
    expect(
      warnSpy.mock.calls
        .map((c) => String(c[0]))
        .some((m) => m.includes("illegal_transition_blocked")),
    ).toBe(true);
    // The blocked attempt was ledgered (blocked:true, attempted to_status active).
    expect(ledgerRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userSubscriptionId: "us_test",
        fromStatus: "cancelled",
        toStatus: "active",
        blocked: true,
        source: "webhook:customer.subscription.updated",
      }),
    );
  });

  it("ALLOWS a legal transition (past_due→active) and ledgers it as not-blocked", async () => {
    findByExternalIdMock.mockResolvedValue({
      id: "us_test",
      externalSubscriptionId: "sub_1",
      paymentStatus: "past_due",
      cancelledAt: null,
      metadata: {},
    });

    await handleSubscriptionUpdated(activeEvent());

    expect(updateByIdMock).toHaveBeenCalledWith(
      "us_test",
      expect.objectContaining({ paymentStatus: "active" }),
    );
    expect(ledgerRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fromStatus: "past_due",
        toStatus: "active",
        blocked: false,
      }),
    );
  });
});
