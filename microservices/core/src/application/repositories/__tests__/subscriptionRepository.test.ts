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

  // ─── findForUser + pure helpers (slice 2 — GET /subscriptions/me) ──

  describe("normaliseRole", () => {
    it("passes through the three trainer/admin enum values", async () => {
      const { normaliseRole } = await import("../subscriptionRepository");
      expect(normaliseRole("personal_trainer")).toBe("personal_trainer");
      expect(normaliseRole("physiotherapist")).toBe("physiotherapist");
      expect(normaliseRole("admin")).toBe("admin");
    });

    it("defaults to 'user' for null / unknown roles", async () => {
      const { normaliseRole } = await import("../subscriptionRepository");
      expect(normaliseRole(null)).toBe("user");
      expect(normaliseRole(undefined)).toBe("user");
      expect(normaliseRole("user")).toBe("user");
      expect(normaliseRole("something_else")).toBe("user");
    });
  });

  describe("normaliseBillingCycle", () => {
    it("passes through monthly/yearly, returns null for anything else", async () => {
      const { normaliseBillingCycle } =
        await import("../subscriptionRepository");
      expect(normaliseBillingCycle("monthly")).toBe("monthly");
      expect(normaliseBillingCycle("yearly")).toBe("yearly");
      expect(normaliseBillingCycle(null)).toBeNull();
      expect(normaliseBillingCycle(undefined)).toBeNull();
      expect(normaliseBillingCycle("weird")).toBeNull();
    });
  });

  describe("resolveScheduledChange", () => {
    it("returns null when metadata is null or missing the marker", async () => {
      const { resolveScheduledChange } =
        await import("../subscriptionRepository");
      expect(await resolveScheduledChange(null)).toBeNull();
      expect(await resolveScheduledChange({})).toBeNull();
      expect(await resolveScheduledChange({ other: "field" })).toBeNull();
    });

    it("returns null when the marker shape is malformed", async () => {
      const { resolveScheduledChange } =
        await import("../subscriptionRepository");
      expect(
        await resolveScheduledChange({ scheduled_change: null }),
      ).toBeNull();
      expect(
        await resolveScheduledChange({
          scheduled_change: { next_tier_name: 123, effective_at: "x" },
        }),
      ).toBeNull();
      expect(
        await resolveScheduledChange({
          scheduled_change: { next_tier_name: "premium", effective_at: "" },
        }),
      ).toBeNull();
      expect(
        await resolveScheduledChange({
          scheduled_change: { next_tier_name: "", effective_at: "2026-01-01" },
        }),
      ).toBeNull();
      // also covers the "scheduled_change is a string, not object" path
      expect(
        await resolveScheduledChange({
          scheduled_change: "not-an-object",
        }),
      ).toBeNull();
    });

    it("resolves the next display name from subscription_tiers when the marker is well-formed", async () => {
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValue(makeSelectChain([{ displayName: "Basic" }])),
      };
      (getDb as any).mockReturnValue(mockDb);
      const { resolveScheduledChange } =
        await import("../subscriptionRepository");
      const result = await resolveScheduledChange({
        scheduled_change: {
          next_tier_name: "premium",
          effective_at: "2026-03-01T00:00:00Z",
        },
      });
      expect(result).toEqual({
        nextTierName: "premium",
        nextDisplayName: "Basic",
        effectiveAt: "2026-03-01T00:00:00Z",
      });
    });

    it("returns null when the referenced tier doesn't exist in the catalog", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);
      const { resolveScheduledChange } =
        await import("../subscriptionRepository");
      const result = await resolveScheduledChange({
        scheduled_change: {
          next_tier_name: "ghost_tier",
          effective_at: "2026-03-01T00:00:00Z",
        },
      });
      expect(result).toBeNull();
    });
  });

  describe("findForUser", () => {
    // Helper: a programmable mock that returns different query results
    // in sequence. findForUser issues 2–3 SELECTs (profile, sub+tier,
    // optional free-tier fallback or scheduled-change resolver lookup).
    function makeSequentialSelectMock(responses: unknown[][]) {
      const select = vi.fn();
      for (const response of responses) {
        select.mockImplementationOnce(() => ({
          from: () => ({
            where: () => ({
              limit: async () => response,
              orderBy: () => ({
                limit: async () => response,
              }),
            }),
            innerJoin: () => ({
              where: () => ({
                orderBy: () => ({
                  limit: async () => response,
                }),
              }),
            }),
          }),
        }));
      }
      return select;
    }

    it("returns null when the profile row doesn't exist (schema corruption)", async () => {
      const mockDb = {
        select: makeSequentialSelectMock([
          [], // profile lookup → empty
        ]),
      };
      (getDb as any).mockReturnValue(mockDb);
      const { SubscriptionRepository } =
        await import("../subscriptionRepository");
      const repo = new SubscriptionRepository();
      const result = await repo.findForUser("user-missing");
      expect(result).toBeNull();
    });

    it("returns the joined shape when a sub row exists (paid tier, no scheduled change)", async () => {
      const subStartsAt = new Date("2026-01-01T00:00:00Z");
      const subExpiresAt = new Date("2026-02-01T00:00:00Z");
      const mockDb = {
        select: makeSequentialSelectMock([
          // profile slice
          [
            {
              role: "user",
              hasUsedUserTrial: true,
              hasUsedTrainerTrial: false,
            },
          ],
          // sub join
          [
            {
              subscriptionId: "us_uuid",
              tierName: "premium",
              paymentStatus: "active",
              billingCycle: "monthly",
              startsAt: subStartsAt,
              expiresAt: subExpiresAt,
              cancelledAt: null,
              trialEndsAt: null,
              externalSubscriptionId: "sub_test",
              metadata: null,
              tierDisplayName: "Premium",
              tierDescription: "Unlimited",
              workoutLimit: null,
              aiAccess: true,
              aiWorkoutLimit: 6,
              gymBuddyAccess: true,
              trainerClientLimit: null,
              isTrainerTier: false,
            },
          ],
        ]),
      };
      (getDb as any).mockReturnValue(mockDb);
      const { SubscriptionRepository } =
        await import("../subscriptionRepository");
      const repo = new SubscriptionRepository();
      const result = await repo.findForUser("user-1");
      expect(result).toMatchObject({
        subscriptionId: "us_uuid",
        tierName: "premium",
        paymentStatus: "active",
        billingCycle: "monthly",
        startsAt: subStartsAt.toISOString(),
        expiresAt: subExpiresAt.toISOString(),
        cancelledAt: null,
        trialEndsAt: null,
        externalSubscriptionId: "sub_test",
        tierDisplayName: "Premium",
        aiAccess: true,
        gymBuddyAccess: true,
        isTrainerTier: false,
        role: "user",
        hasUsedUserTrial: true,
        hasUsedTrainerTrial: false,
        isEligibleForUserTrial: false,
        isEligibleForTrainerTrial: true,
        scheduledChange: null,
      });
    });

    it("synthesises the free-tier shape when no sub row exists", async () => {
      const mockDb = {
        select: makeSequentialSelectMock([
          // profile
          [
            {
              role: "user",
              hasUsedUserTrial: false,
              hasUsedTrainerTrial: false,
            },
          ],
          // sub join → empty
          [],
          // free-tier fallback
          [
            {
              id: "tier-uuid",
              tierName: "free",
              displayName: "Free",
              description: null,
              workoutLimit: 5,
              aiAccess: false,
              aiWorkoutLimit: 0,
              gymBuddyAccess: false,
              trainerClientLimit: null,
              isTrainerTier: false,
            },
          ],
        ]),
      };
      (getDb as any).mockReturnValue(mockDb);
      const { SubscriptionRepository } =
        await import("../subscriptionRepository");
      const repo = new SubscriptionRepository();
      const result = await repo.findForUser("user-fresh");
      expect(result).toMatchObject({
        subscriptionId: null,
        tierName: "free",
        paymentStatus: "active",
        billingCycle: null,
        expiresAt: null,
        cancelledAt: null,
        trialEndsAt: null,
        externalSubscriptionId: null,
        tierDisplayName: "Free",
        tierDescription: null,
        workoutLimit: 5,
        aiAccess: false,
        aiWorkoutLimit: 0,
        gymBuddyAccess: false,
        isTrainerTier: false,
        role: "user",
        hasUsedUserTrial: false,
        hasUsedTrainerTrial: false,
        isEligibleForUserTrial: true,
        isEligibleForTrainerTrial: true,
        scheduledChange: null,
      });
      // startsAt is synthesised — accept any valid ISO string
      expect(typeof result?.startsAt).toBe("string");
      expect(Date.parse(result!.startsAt)).not.toBeNaN();
    });

    it("treats a lapsed (cancelled-most-recent) trainer as free — no stale entitlement", async () => {
      // The LIVE_SUBSCRIPTION_STATUSES filter on the sub-join means a trainer
      // whose most-recent row is `cancelled`/`expired` matches NO live row, so
      // the join returns empty and we synthesise free. Without the filter this
      // would return the stale trainer tier (isTrainerTier: true) and keep
      // coach mode enabled on mobile after the subscription lapsed.
      const mockDb = {
        select: makeSequentialSelectMock([
          // profile slice — note the user's role is still personal_trainer
          [
            {
              role: "personal_trainer",
              hasUsedUserTrial: true,
              hasUsedTrainerTrial: true,
            },
          ],
          // sub join → empty: the cancelled row is filtered out by the
          // live-status WHERE clause.
          [],
          // free-tier fallback
          [
            {
              id: "tier-uuid",
              tierName: "free",
              displayName: "Free",
              description: null,
              workoutLimit: 5,
              aiAccess: false,
              aiWorkoutLimit: 0,
              gymBuddyAccess: false,
              trainerClientLimit: null,
              isTrainerTier: false,
            },
          ],
        ]),
      };
      (getDb as any).mockReturnValue(mockDb);
      const { SubscriptionRepository } =
        await import("../subscriptionRepository");
      const repo = new SubscriptionRepository();
      const result = await repo.findForUser("lapsed-trainer");
      expect(result).toMatchObject({
        subscriptionId: null,
        tierName: "free",
        isTrainerTier: false,
        trainerClientLimit: null,
        // role still reflects profiles.role — entitlement is what changes
        role: "personal_trainer",
      });
    });

    it("throws when the free tier is missing from the catalog (deploy misconfig)", async () => {
      const mockDb = {
        select: makeSequentialSelectMock([
          [
            {
              role: "user",
              hasUsedUserTrial: false,
              hasUsedTrainerTrial: false,
            },
          ],
          [],
          [], // free-tier fallback → empty
        ]),
      };
      (getDb as any).mockReturnValue(mockDb);
      const { SubscriptionRepository } =
        await import("../subscriptionRepository");
      const repo = new SubscriptionRepository();
      await expect(repo.findForUser("user-fresh")).rejects.toThrow(
        /free.*not found/i,
      );
    });

    it("resolves a scheduled-change marker to its joined display name", async () => {
      const mockDb = {
        select: makeSequentialSelectMock([
          // profile
          [
            {
              role: "user",
              hasUsedUserTrial: true,
              hasUsedTrainerTrial: false,
            },
          ],
          // sub with scheduled_change in metadata
          [
            {
              subscriptionId: "us_uuid",
              tierName: "premium",
              paymentStatus: "active",
              billingCycle: "monthly",
              startsAt: new Date("2026-01-01"),
              expiresAt: new Date("2026-02-01"),
              cancelledAt: null,
              trialEndsAt: null,
              externalSubscriptionId: "sub_X",
              metadata: {
                scheduled_change: {
                  next_tier_name: "premium",
                  effective_at: "2026-02-01T00:00:00.000Z",
                },
              },
              tierDisplayName: "Premium",
              tierDescription: null,
              workoutLimit: null,
              aiAccess: true,
              aiWorkoutLimit: 6,
              gymBuddyAccess: true,
              trainerClientLimit: null,
              isTrainerTier: false,
            },
          ],
          // scheduled-change lookup
          [{ displayName: "Basic" }],
        ]),
      };
      (getDb as any).mockReturnValue(mockDb);
      const { SubscriptionRepository } =
        await import("../subscriptionRepository");
      const repo = new SubscriptionRepository();
      const result = await repo.findForUser("user-1");
      expect(result?.scheduledChange).toEqual({
        nextTierName: "premium",
        nextDisplayName: "Basic",
        effectiveAt: "2026-02-01T00:00:00.000Z",
      });
    });

    it("defensively coerces null/unknown role to 'user'", async () => {
      const mockDb = {
        select: makeSequentialSelectMock([
          [
            {
              role: null,
              hasUsedUserTrial: null,
              hasUsedTrainerTrial: null,
            },
          ],
          [
            {
              subscriptionId: "us_uuid",
              tierName: "premium",
              paymentStatus: "trialing",
              billingCycle: "monthly",
              startsAt: new Date("2026-01-01"),
              expiresAt: null,
              cancelledAt: null,
              trialEndsAt: new Date("2026-01-08"),
              externalSubscriptionId: "sub_X",
              metadata: {},
              tierDisplayName: "Premium",
              tierDescription: null,
              workoutLimit: null,
              aiAccess: null,
              aiWorkoutLimit: null,
              gymBuddyAccess: null,
              trainerClientLimit: null,
              isTrainerTier: null,
            },
          ],
        ]),
      };
      (getDb as any).mockReturnValue(mockDb);
      const { SubscriptionRepository } =
        await import("../subscriptionRepository");
      const repo = new SubscriptionRepository();
      const result = await repo.findForUser("user-1");
      expect(result?.role).toBe("user");
      expect(result?.aiAccess).toBe(false);
      expect(result?.gymBuddyAccess).toBe(false);
      expect(result?.aiWorkoutLimit).toBe(0);
      expect(result?.isTrainerTier).toBe(false);
      expect(result?.hasUsedUserTrial).toBe(false);
      expect(result?.hasUsedTrainerTrial).toBe(false);
      expect(result?.isEligibleForUserTrial).toBe(true);
      expect(result?.isEligibleForTrainerTrial).toBe(true);
    });

    it("round-trips string-typed timestamps through `new Date(value)` (Drizzle pre-parse paths)", async () => {
      // Drizzle normally hands back Date instances for `timestamp` columns,
      // but reflection through Postgres connection-string adapters / Neon
      // serverless responses can yield ISO strings. The toIsoString helper
      // has a string-input branch (`new Date(value)`) that this exercises.
      const mockDb = {
        select: makeSequentialSelectMock([
          [
            {
              role: "user",
              hasUsedUserTrial: false,
              hasUsedTrainerTrial: false,
            },
          ],
          [
            {
              subscriptionId: "us_uuid",
              tierName: "premium",
              paymentStatus: "active",
              billingCycle: "monthly",
              startsAt: "2026-01-01T00:00:00.000Z", // STRING
              expiresAt: "2026-02-01T00:00:00.000Z", // STRING
              cancelledAt: null,
              trialEndsAt: null,
              externalSubscriptionId: "sub_X",
              metadata: null,
              tierDisplayName: "Premium",
              tierDescription: null,
              workoutLimit: null,
              aiAccess: true,
              aiWorkoutLimit: 6,
              gymBuddyAccess: true,
              trainerClientLimit: null,
              isTrainerTier: false,
            },
          ],
        ]),
      };
      (getDb as any).mockReturnValue(mockDb);
      const { SubscriptionRepository } =
        await import("../subscriptionRepository");
      const repo = new SubscriptionRepository();
      const result = await repo.findForUser("user-1");
      expect(result?.startsAt).toBe("2026-01-01T00:00:00.000Z");
      expect(result?.expiresAt).toBe("2026-02-01T00:00:00.000Z");
    });

    it("collapses unparseable string timestamps to empty/null on the wire", async () => {
      const mockDb = {
        select: makeSequentialSelectMock([
          [
            {
              role: "user",
              hasUsedUserTrial: false,
              hasUsedTrainerTrial: false,
            },
          ],
          [
            {
              subscriptionId: "us_uuid",
              tierName: "premium",
              paymentStatus: "active",
              billingCycle: "monthly",
              startsAt: "garbage", // unparseable string
              expiresAt: "also garbage",
              cancelledAt: null,
              trialEndsAt: null,
              externalSubscriptionId: null,
              metadata: null,
              tierDisplayName: "Premium",
              tierDescription: null,
              workoutLimit: null,
              aiAccess: true,
              aiWorkoutLimit: 6,
              gymBuddyAccess: true,
              trainerClientLimit: null,
              isTrainerTier: false,
            },
          ],
        ]),
      };
      (getDb as any).mockReturnValue(mockDb);
      const { SubscriptionRepository } =
        await import("../subscriptionRepository");
      const repo = new SubscriptionRepository();
      const result = await repo.findForUser("user-1");
      // toIsoString returns "" for unparseable → toOptionalIsoString
      // converts "" to null for expiresAt; startsAt stays as "".
      expect(result?.startsAt).toBe("");
      expect(result?.expiresAt).toBeNull();
    });

    it("falls back to 'pending' paymentStatus when the column is null", async () => {
      const mockDb = {
        select: makeSequentialSelectMock([
          [
            {
              role: "personal_trainer",
              hasUsedUserTrial: false,
              hasUsedTrainerTrial: true,
            },
          ],
          [
            {
              subscriptionId: "us_uuid",
              tierName: "individual_trainer",
              paymentStatus: null,
              billingCycle: "monthly",
              startsAt: new Date("2026-01-01"),
              expiresAt: null,
              cancelledAt: null,
              trialEndsAt: null,
              externalSubscriptionId: null,
              metadata: null,
              tierDisplayName: "Individual Trainer (Pro)",
              tierDescription: null,
              workoutLimit: null,
              aiAccess: true,
              aiWorkoutLimit: 6,
              gymBuddyAccess: true,
              trainerClientLimit: 10,
              isTrainerTier: true,
            },
          ],
        ]),
      };
      (getDb as any).mockReturnValue(mockDb);
      const { SubscriptionRepository } =
        await import("../subscriptionRepository");
      const repo = new SubscriptionRepository();
      const result = await repo.findForUser("user-trainer");
      expect(result?.paymentStatus).toBe("pending");
      expect(result?.role).toBe("personal_trainer");
      expect(result?.isTrainerTier).toBe(true);
      expect(result?.isEligibleForTrainerTrial).toBe(false);
    });
  });
});
