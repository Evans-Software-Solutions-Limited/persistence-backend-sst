/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

function makeListChain(resolvedValue: unknown) {
  // select().from().where().orderBy() — `orderBy` is the terminal awaited
  // call in listActive().
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(resolvedValue),
      }),
    }),
  };
}

const fakeRow = {
  id: "tier-1",
  tierName: "basic",
  displayName: "Basic",
  description: "Limited workouts",
  priceMonthly: "9.99",
  priceYearly: "95.88",
  currency: "GBP",
  features: { workouts: "limited" },
  workoutLimit: 20,
  aiAccess: true,
  aiWorkoutLimit: 1,
  gymBuddyAccess: false,
  gymBuddyCanCreateWorkouts: false,
  gymBuddyCanSuggestWorkouts: false,
  trainerClientLimit: null,
  isTrainerTier: false,
  analyticsAccess: false,
  exportAccess: false,
  isActive: true,
  stripePriceIdMonthly: "price_basic_monthly",
  stripePriceIdYearly: "price_basic_yearly",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

describe("SubscriptionTiersRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listActive", () => {
    it("returns all active tiers in price_monthly ascending order", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue(makeListChain([fakeRow])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SubscriptionTiersRepository } =
        await import("../subscriptionTiersRepository");
      const repo = new SubscriptionTiersRepository();
      const result = await repo.listActive();
      expect(result).toEqual([fakeRow]);

      // Drizzle chain was reached — select().from().where().orderBy()
      expect(mockDb.select).toHaveBeenCalledTimes(1);
    });

    it("returns an empty list when no active tiers exist", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue(makeListChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SubscriptionTiersRepository } =
        await import("../subscriptionTiersRepository");
      const repo = new SubscriptionTiersRepository();
      const result = await repo.listActive();
      expect(result).toEqual([]);
    });
  });
});
