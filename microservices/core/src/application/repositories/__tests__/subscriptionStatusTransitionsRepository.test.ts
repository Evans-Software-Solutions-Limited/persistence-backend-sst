/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@persistence/db", () => ({
  subscriptionStatusTransitions: { name: "subscription_status_transitions" },
}));

import { getDb } from "@persistence/db/client";

describe("SubscriptionStatusTransitionsRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts an append-only ledger row with the provided fields", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    (getDb as any).mockReturnValue({
      insert: vi.fn().mockReturnValue({ values }),
    });

    const { SubscriptionStatusTransitionsRepository } =
      await import("../subscriptionStatusTransitionsRepository");
    await new SubscriptionStatusTransitionsRepository().record({
      userSubscriptionId: "us_1",
      userId: "user-1",
      fromStatus: "active",
      toStatus: "cancelled",
      source: "webhook:customer.subscription.updated",
      stripeEventId: "evt_1",
      blocked: false,
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userSubscriptionId: "us_1",
        userId: "user-1",
        fromStatus: "active",
        toStatus: "cancelled",
        source: "webhook:customer.subscription.updated",
        stripeEventId: "evt_1",
        blocked: false,
      }),
    );
  });

  it("defaults optional fields (null/false) when omitted", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    (getDb as any).mockReturnValue({
      insert: vi.fn().mockReturnValue({ values }),
    });

    const { SubscriptionStatusTransitionsRepository } =
      await import("../subscriptionStatusTransitionsRepository");
    await new SubscriptionStatusTransitionsRepository().record({
      userSubscriptionId: "us_2",
      toStatus: "past_due",
      source: "webhook:invoice.payment_failed",
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userSubscriptionId: "us_2",
        userId: null,
        fromStatus: null,
        toStatus: "past_due",
        stripeEventId: null,
        blocked: false,
      }),
    );
  });
});
