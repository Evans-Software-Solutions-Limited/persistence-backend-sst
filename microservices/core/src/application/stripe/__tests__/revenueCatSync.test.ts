import { beforeEach, describe, expect, it, vi } from "vitest";

const associateMock = vi.hoisted(() => vi.fn());

vi.mock("../../revenuecat/revenueCatClient", () => ({
  associateStripePurchaseWithRevenueCat: associateMock,
}));

import { syncStripeSubscriptionToRevenueCat } from "../revenueCatSync";

describe("syncStripeSubscriptionToRevenueCat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("binds the subscription to the user via the RevenueCat client", async () => {
    associateMock.mockResolvedValue(undefined);
    await syncStripeSubscriptionToRevenueCat("sub_123", "user-1");
    expect(associateMock).toHaveBeenCalledWith("sub_123", "user-1");
  });

  it("swallows + logs a client failure (never throws — Stripe webhook must not retry on RC errors)", async () => {
    associateMock.mockRejectedValue(new Error("rc down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      syncStripeSubscriptionToRevenueCat("sub_123", "user-1"),
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("failed to bind sub_123"),
    );
    errSpy.mockRestore();
  });
});
