/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

function makeUpdateChain(resolved: unknown) {
  const returning = vi.fn().mockResolvedValue(resolved);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  return { chain: { set }, set, where, returning };
}

describe("SubscriptionRepository.cancelLiveSubscriptions (M12 RevenueCat sync)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cancels live rows and returns the count cancelled", async () => {
    const update = makeUpdateChain([{ id: "a" }, { id: "b" }]);
    (getDb as any).mockReturnValue({
      update: vi.fn().mockReturnValue(update.chain),
    });

    const { SubscriptionRepository } =
      await import("../subscriptionRepository");
    const count = await new SubscriptionRepository().cancelLiveSubscriptions(
      "user-1",
    );

    expect(count).toBe(2);
    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({ paymentStatus: "cancelled" }),
    );
  });

  it("returns 0 when the user has no live rows", async () => {
    const update = makeUpdateChain([]);
    (getDb as any).mockReturnValue({
      update: vi.fn().mockReturnValue(update.chain),
    });

    const { SubscriptionRepository } =
      await import("../subscriptionRepository");
    const count = await new SubscriptionRepository().cancelLiveSubscriptions(
      "user-1",
    );
    expect(count).toBe(0);
  });
});
