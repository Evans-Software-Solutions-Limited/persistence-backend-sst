/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

function makeSelectChain(resolvedValue: unknown) {
  // Two shapes: select().from().where().limit() (findByExternalId)
  // and select().from().where().orderBy().limit() (findMostRecentForUser).
  // Both terminal `limit()` calls resolve to the same array of rows, so
  // we wire one chain that returns itself for non-terminal links.
  const chain: any = {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(resolvedValue),
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(resolvedValue),
        }),
      }),
    }),
  };
  return chain;
}

function makeInsertChain(resolvedValue: unknown) {
  return {
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(resolvedValue),
    }),
  };
}

function makeUpdateChain(resolvedValue: unknown) {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(resolvedValue),
      }),
    }),
  };
}

const fakeRow = {
  id: "00000000-0000-0000-0000-000000000001",
  userId: "user-1",
  tierName: "premium",
  currency: "GBP",
  paymentStatus: "active",
  startsAt: new Date("2026-01-01T00:00:00Z"),
  expiresAt: new Date("2026-02-01T00:00:00Z"),
  cancelledAt: null,
  trialEndsAt: null,
  billingCycle: "monthly",
  nextBillingDate: new Date("2026-02-01T00:00:00Z"),
  externalSubscriptionId: "sub_test_123",
  metadata: { stripe_customer_id: "cus_test" },
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("SubscriptionRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("findByExternalId", () => {
    it("returns the row when an external_subscription_id matches", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([fakeRow])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SubscriptionRepository } =
        await import("../subscriptionRepository");
      const repo = new SubscriptionRepository();
      const result = await repo.findByExternalId("sub_test_123");
      expect(result).toEqual(fakeRow);
    });

    it("returns null when no row matches", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SubscriptionRepository } =
        await import("../subscriptionRepository");
      const repo = new SubscriptionRepository();
      const result = await repo.findByExternalId("sub_missing");
      expect(result).toBeNull();
    });
  });

  describe("findByIdForUser", () => {
    it("returns the row when both id AND userId match", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([fakeRow])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SubscriptionRepository } =
        await import("../subscriptionRepository");
      const repo = new SubscriptionRepository();
      const result = await repo.findByIdForUser(
        "00000000-0000-0000-0000-000000000001",
        "user-1",
      );
      expect(result).toEqual(fakeRow);
    });

    it("returns null when no row matches the (id, userId) pair", async () => {
      // covers BOTH the "id doesn't exist" case AND the "id exists but
      // belongs to a different user" case — the row scope is enforced
      // at the SQL layer via the AND clause.
      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SubscriptionRepository } =
        await import("../subscriptionRepository");
      const repo = new SubscriptionRepository();
      const result = await repo.findByIdForUser(
        "00000000-0000-0000-0000-000000000999",
        "user-other",
      );
      expect(result).toBeNull();
    });
  });

  describe("findMostRecentForUser", () => {
    it("returns the most recent row for a user", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([fakeRow])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SubscriptionRepository } =
        await import("../subscriptionRepository");
      const repo = new SubscriptionRepository();
      const result = await repo.findMostRecentForUser("user-1");
      expect(result).toEqual(fakeRow);
    });

    it("returns null when the user has no subscriptions", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SubscriptionRepository } =
        await import("../subscriptionRepository");
      const repo = new SubscriptionRepository();
      const result = await repo.findMostRecentForUser("user-fresh");
      expect(result).toBeNull();
    });
  });

  describe("insert", () => {
    it("returns the inserted row", async () => {
      const mockDb = {
        insert: vi.fn().mockReturnValue(makeInsertChain([fakeRow])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SubscriptionRepository } =
        await import("../subscriptionRepository");
      const repo = new SubscriptionRepository();
      const result = await repo.insert({
        userId: "user-1",
        tierName: "premium",
        externalSubscriptionId: "sub_test_123",
      });
      expect(result).toEqual(fakeRow);
    });

    it("throws when the insert returns no rows (sanity guard)", async () => {
      const mockDb = {
        insert: vi.fn().mockReturnValue(makeInsertChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SubscriptionRepository } =
        await import("../subscriptionRepository");
      const repo = new SubscriptionRepository();
      await expect(
        repo.insert({
          userId: "user-1",
          tierName: "premium",
        }),
      ).rejects.toThrow(/no rows for user user-1/);
    });
  });

  describe("updateById", () => {
    it("returns the updated row, with updatedAt bumped", async () => {
      const updated = { ...fakeRow, paymentStatus: "cancelled" };
      const mockDb = {
        update: vi.fn().mockReturnValue(makeUpdateChain([updated])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SubscriptionRepository } =
        await import("../subscriptionRepository");
      const repo = new SubscriptionRepository();
      const result = await repo.updateById(fakeRow.id, {
        paymentStatus: "cancelled",
      });
      expect(result?.paymentStatus).toBe("cancelled");
      // The `set()` call should include an `updatedAt` Date — verify via
      // the mock's call args. set is the first link in the update chain.
      const updateMock = mockDb.update.mock.results[0]?.value as {
        set: ReturnType<typeof vi.fn>;
      };
      expect(updateMock.set).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentStatus: "cancelled",
          updatedAt: expect.any(Date),
        }),
      );
    });

    it("returns null when no row matched the id", async () => {
      const mockDb = {
        update: vi.fn().mockReturnValue(makeUpdateChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SubscriptionRepository } =
        await import("../subscriptionRepository");
      const repo = new SubscriptionRepository();
      const result = await repo.updateById("missing-id", {
        paymentStatus: "cancelled",
      });
      expect(result).toBeNull();
    });
  });
});
