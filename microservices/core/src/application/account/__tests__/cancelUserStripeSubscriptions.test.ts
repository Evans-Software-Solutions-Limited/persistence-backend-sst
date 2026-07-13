import { describe, it, expect, vi, beforeEach } from "vitest";

const { findStripeSubscriptionIdsForUser, stripeCancelMock } = vi.hoisted(
  () => ({
    findStripeSubscriptionIdsForUser: vi.fn(async (): Promise<string[]> => []),
    stripeCancelMock: vi.fn(async () => ({})),
  }),
);

vi.mock("../../repositories/subscriptionRepository", () => ({
  SubscriptionRepository: vi.fn(() => ({ findStripeSubscriptionIdsForUser })),
}));
vi.mock("../../stripe/stripeClient", () => ({
  getStripe: () => ({ subscriptions: { cancel: stripeCancelMock } }),
}));

import { cancelStripeSubscriptions } from "../cancelUserStripeSubscriptions";

describe("cancelStripeSubscriptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findStripeSubscriptionIdsForUser.mockResolvedValue([]);
  });

  it("no-ops when the user has no sub_ ids", async () => {
    findStripeSubscriptionIdsForUser.mockResolvedValue([]);
    await cancelStripeSubscriptions("user-1");
    expect(stripeCancelMock).not.toHaveBeenCalled();
  });

  it("cancels every sub_ id and skips rc_ ids", async () => {
    findStripeSubscriptionIdsForUser.mockResolvedValue([
      "sub_a",
      "rc_user-1",
      "sub_b",
    ]);
    await cancelStripeSubscriptions("user-1");
    expect(stripeCancelMock).toHaveBeenCalledTimes(2);
    expect(stripeCancelMock).toHaveBeenCalledWith("sub_a");
    expect(stripeCancelMock).toHaveBeenCalledWith("sub_b");
  });

  it("treats a `resource_missing` code as already-cancelled (idempotent, no throw)", async () => {
    findStripeSubscriptionIdsForUser.mockResolvedValue(["sub_a"]);
    const err = new Error("gone") as Error & { code: string };
    err.code = "resource_missing";
    stripeCancelMock.mockRejectedValueOnce(err);
    await expect(cancelStripeSubscriptions("user-1")).resolves.toBeUndefined();
  });

  it("treats a Stripe SDK `raw.code` shape of `resource_missing` as already-cancelled", async () => {
    findStripeSubscriptionIdsForUser.mockResolvedValue(["sub_a"]);
    const err = { raw: { code: "resource_missing" } };
    stripeCancelMock.mockRejectedValueOnce(err);
    await expect(cancelStripeSubscriptions("user-1")).resolves.toBeUndefined();
  });

  it("treats an 'already cancelled' message as idempotent success", async () => {
    findStripeSubscriptionIdsForUser.mockResolvedValue(["sub_a"]);
    stripeCancelMock.mockRejectedValueOnce(
      new Error("This subscription has been canceled already"),
    );
    await expect(cancelStripeSubscriptions("user-1")).resolves.toBeUndefined();
  });

  it("re-throws a genuine Stripe error", async () => {
    findStripeSubscriptionIdsForUser.mockResolvedValue(["sub_a"]);
    stripeCancelMock.mockRejectedValueOnce(new Error("Stripe is down"));
    await expect(cancelStripeSubscriptions("user-1")).rejects.toThrow(
      "Stripe is down",
    );
  });

  it("re-throws a non-object rejection (never matches the already-canceled shape)", async () => {
    findStripeSubscriptionIdsForUser.mockResolvedValue(["sub_a"]);
    stripeCancelMock.mockRejectedValueOnce("weird string rejection");
    await expect(cancelStripeSubscriptions("user-1")).rejects.toBe(
      "weird string rejection",
    );
  });

  it("stops at the first genuine failure and does not cancel subsequent ids", async () => {
    findStripeSubscriptionIdsForUser.mockResolvedValue(["sub_a", "sub_b"]);
    stripeCancelMock.mockRejectedValueOnce(new Error("Stripe down"));
    await expect(cancelStripeSubscriptions("user-1")).rejects.toThrow();
    expect(stripeCancelMock).toHaveBeenCalledTimes(1);
  });
});
