/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";
import {
  DashboardRepository,
  coerceNumeric,
  computeIsFreeTier,
  deriveFirstName,
  normaliseSubscriptionStatus,
  pickPROfTheWeek,
  rankPersonalRecord,
  type PersonalRecordRow,
  type RecordType,
  type SubscriptionRow,
} from "../dashboardRepository";

/**
 * Every repository method issues its own chain of select/from/where/orderBy/
 * limit/leftJoin/innerJoin calls. The helper below builds a mock chain that
 * records each arrival and resolves with whichever rows the test wants for
 * that specific query.
 */
function createChain(rows: any[]) {
  const chain: any = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    offset: vi.fn(() => Promise.resolve(rows)),
    leftJoin: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    then: (onFulfilled: any, onRejected?: any) =>
      Promise.resolve(rows).then(onFulfilled, onRejected),
  };
  return chain;
}

/**
 * Build a `getDb()` mock whose `select()` returns queued chains in order —
 * mirrors the Drizzle fluent API one call at a time. Any trailing calls
 * fall through to an empty chain so an unexpected query is forgiving.
 */
function mockDbWithQueryResults(resultsInOrder: any[][]) {
  const remaining = [...resultsInOrder];
  return {
    select: vi.fn(() => {
      const next = remaining.shift();
      return createChain(next ?? []);
    }),
  };
}

describe("DashboardRepository pure helpers", () => {
  describe("deriveFirstName", () => {
    it("returns the first whitespace-delimited token", () => {
      expect(deriveFirstName("Ada Lovelace")).toBe("Ada");
    });

    it("handles single names", () => {
      expect(deriveFirstName("Prince")).toBe("Prince");
    });

    it("returns null for null input", () => {
      expect(deriveFirstName(null)).toBeNull();
    });

    it("returns null for an empty string", () => {
      expect(deriveFirstName("")).toBeNull();
    });

    it("returns null for whitespace-only input", () => {
      expect(deriveFirstName("   \t  ")).toBeNull();
    });

    it("trims leading whitespace before splitting", () => {
      expect(deriveFirstName("   Grace   Hopper  ")).toBe("Grace");
    });

    it("handles non-ASCII whitespace", () => {
      // U+00A0 NO-BREAK SPACE — \s matches it in JS regex.
      expect(deriveFirstName("Ada\u00A0Lovelace")).toBe("Ada");
    });
  });

  describe("rankPersonalRecord", () => {
    it("orders the record types exactly per the spec weighting", () => {
      expect(rankPersonalRecord("1rm")).toBeGreaterThan(
        rankPersonalRecord("3rm"),
      );
      expect(rankPersonalRecord("3rm")).toBeGreaterThan(
        rankPersonalRecord("5rm"),
      );
      expect(rankPersonalRecord("5rm")).toBeGreaterThan(
        rankPersonalRecord("10rm"),
      );
      expect(rankPersonalRecord("10rm")).toBeGreaterThan(
        rankPersonalRecord("max_weight"),
      );
      // max_volume slots between max_weight and max_reps (Inspector
      // Brad regression: the hand-rolled `RecordType` union didn't
      // include max_volume, so its rank was `undefined` → NaN
      // comparator → undefined-behaviour sort. Schema-derived
      // RecordType + exhaustive Record<…, number> forces this to be
      // handled).
      expect(rankPersonalRecord("max_weight")).toBeGreaterThan(
        rankPersonalRecord("max_volume"),
      );
      expect(rankPersonalRecord("max_volume")).toBeGreaterThan(
        rankPersonalRecord("max_reps"),
      );
      expect(rankPersonalRecord("max_reps")).toBeGreaterThan(
        rankPersonalRecord("best_time"),
      );
      expect(rankPersonalRecord("best_time")).toBeGreaterThan(
        rankPersonalRecord("longest_distance"),
      );
    });

    it("returns a finite number for every schema-derived RecordType (no NaN ranks)", () => {
      // Direct guard against the Inspector Brad PR #61 finding: if
      // ANY enum value falls through to `undefined`,
      // pickPROfTheWeek's comparator would return NaN and produce
      // undefined-behaviour ordering. Iterating every enum value
      // catches a future migration that adds a new value without
      // ranking it (compile time would catch it first via
      // Record<RecordType, number>, but this is the runtime safety
      // net).
      const allTypes: RecordType[] = [
        "1rm",
        "3rm",
        "5rm",
        "10rm",
        "max_reps",
        "max_weight",
        "max_volume",
        "best_time",
        "longest_distance",
      ];
      for (const t of allTypes) {
        const rank = rankPersonalRecord(t);
        expect(Number.isFinite(rank)).toBe(true);
      }
    });
  });

  describe("pickPROfTheWeek", () => {
    it("returns null for an empty window", () => {
      expect(pickPROfTheWeek([])).toBeNull();
    });

    it("picks the most recently achieved record first", () => {
      const recent: PersonalRecordRow = {
        id: "pr-recent",
        exerciseId: "ex-1",
        recordType: "5rm",
        value: 100,
        achievedAt: new Date("2026-04-22T12:00:00Z"),
      };
      const older: PersonalRecordRow = {
        id: "pr-older",
        exerciseId: "ex-1",
        recordType: "1rm",
        value: 200,
        achievedAt: new Date("2026-04-20T12:00:00Z"),
      };

      expect(pickPROfTheWeek([older, recent])?.id).toBe("pr-recent");
    });

    it("breaks ties by recordType rank when achievedAt matches", () => {
      const when = new Date("2026-04-22T12:00:00Z");
      const oneRm: PersonalRecordRow = {
        id: "pr-a",
        exerciseId: "ex-1",
        recordType: "1rm",
        value: 100,
        achievedAt: when,
      };
      const maxWeight: PersonalRecordRow = {
        id: "pr-b",
        exerciseId: "ex-1",
        recordType: "max_weight",
        value: 120,
        achievedAt: when,
      };

      // Tie-break MUST prefer 1rm over max_weight regardless of input order.
      expect(pickPROfTheWeek([maxWeight, oneRm])?.id).toBe("pr-a");
      expect(pickPROfTheWeek([oneRm, maxWeight])?.id).toBe("pr-a");
    });

    it("breaks identical achievedAt + recordType ties by id", () => {
      const when = new Date("2026-04-22T12:00:00Z");
      const pr1: PersonalRecordRow = {
        id: "pr-a",
        exerciseId: "ex-1",
        recordType: "1rm",
        value: 100,
        achievedAt: when,
      };
      const pr2: PersonalRecordRow = {
        id: "pr-b",
        exerciseId: "ex-2",
        recordType: "1rm",
        value: 110,
        achievedAt: when,
      };

      expect(pickPROfTheWeek([pr2, pr1])?.id).toBe("pr-a");
      expect(pickPROfTheWeek([pr1, pr2])?.id).toBe("pr-a");
    });

    it("ranks max_volume below max_weight + above max_reps on same-day ties (Inspector Brad PR #61 regression)", () => {
      // Direct repro of the NaN-comparator bug: pre-fix, the
      // dashboard's hand-rolled `RecordType` union didn't include
      // `max_volume`, so `RECORD_TYPE_RANK["max_volume"]` returned
      // undefined. `pickPROfTheWeek`'s comparator subtracted
      // `undefined - <number>` → NaN, which made Array.prototype.sort
      // ordering undefined-behaviour. After the fix, `max_volume`
      // ranks between max_weight and max_reps and the tie-break is
      // deterministic regardless of input order.
      const when = new Date("2026-04-22T12:00:00Z");
      const maxWeight: PersonalRecordRow = {
        id: "pr-mw",
        exerciseId: "ex-1",
        recordType: "max_weight",
        value: 120,
        achievedAt: when,
      };
      const maxVolume: PersonalRecordRow = {
        id: "pr-mv",
        exerciseId: "ex-1",
        recordType: "max_volume",
        value: 1000,
        achievedAt: when,
      };
      const maxReps: PersonalRecordRow = {
        id: "pr-mr",
        exerciseId: "ex-1",
        recordType: "max_reps",
        value: 15,
        achievedAt: when,
      };

      // max_weight beats max_volume beats max_reps; input order
      // shouldn't matter.
      expect(pickPROfTheWeek([maxReps, maxVolume, maxWeight])?.id).toBe(
        "pr-mw",
      );
      expect(pickPROfTheWeek([maxWeight, maxReps, maxVolume])?.id).toBe(
        "pr-mw",
      );
      // Drop max_weight to check the middle position deterministically
      // (this is what NaN sorts would mangle).
      expect(pickPROfTheWeek([maxReps, maxVolume])?.id).toBe("pr-mv");
      expect(pickPROfTheWeek([maxVolume, maxReps])?.id).toBe("pr-mv");
    });

    it("tolerates string timestamps and null fallbacks", () => {
      const stringTime: PersonalRecordRow = {
        id: "pr-string",
        exerciseId: "ex-1",
        recordType: "1rm",
        value: 100,
        achievedAt: "2026-04-22T12:00:00Z",
      };
      const nullTime: PersonalRecordRow = {
        id: "pr-null",
        exerciseId: "ex-1",
        recordType: "1rm",
        value: 50,
        achievedAt: null,
      };

      // String time > null (0 epoch) → string PR wins.
      expect(pickPROfTheWeek([nullTime, stringTime])?.id).toBe("pr-string");
    });
  });

  describe("computeIsFreeTier", () => {
    const now = new Date("2026-04-22T12:00:00Z");

    it("returns true when there is no subscription row", () => {
      expect(computeIsFreeTier(null, now)).toBe(true);
    });

    it("returns true when the joined tier is the 'free' tier", () => {
      const row: SubscriptionRow = {
        tierName: "free",
        paymentStatus: "active",
        expiresAt: new Date("2027-01-01T00:00:00Z"),
        cancelledAt: null,
        isTrainerTier: false,
        tierDbName: "free",
      };
      expect(computeIsFreeTier(row, now)).toBe(true);
    });

    it("returns true for a cancelled subscription whose billing window has ended", () => {
      const row: SubscriptionRow = {
        tierName: "pro",
        paymentStatus: "cancelled",
        expiresAt: new Date("2026-04-01T00:00:00Z"),
        cancelledAt: new Date("2026-03-15T00:00:00Z"),
        isTrainerTier: false,
        tierDbName: "pro",
      };
      expect(computeIsFreeTier(row, now)).toBe(true);
    });

    it("returns false for an active paid subscription", () => {
      const row: SubscriptionRow = {
        tierName: "pro",
        paymentStatus: "active",
        expiresAt: new Date("2027-01-01T00:00:00Z"),
        cancelledAt: null,
        isTrainerTier: false,
        tierDbName: "pro",
      };
      expect(computeIsFreeTier(row, now)).toBe(false);
    });

    it("returns false for a trialing subscription still inside the trial window", () => {
      const row: SubscriptionRow = {
        tierName: "pro",
        paymentStatus: "trialing",
        expiresAt: new Date("2027-01-01T00:00:00Z"),
        cancelledAt: null,
        isTrainerTier: false,
        tierDbName: "pro",
      };
      expect(computeIsFreeTier(row, now)).toBe(false);
    });

    it("returns true for a trialing subscription past expires_at (missed webhook safety net)", () => {
      // Belt-and-braces: V2 backend doesn't yet handle the Stripe
      // webhook events that move a row out of `trialing`, so a row
      // with `paymentStatus = 'trialing'` and a past `expiresAt`
      // would otherwise render as an active Trial badge with a
      // stale renew date. Treating it as free tier is the correct
      // user-facing fallback.
      const row: SubscriptionRow = {
        tierName: "pro",
        paymentStatus: "trialing",
        // `now` in this suite is set to 2026-05-15, so 2026-02-15 is
        // three months in the past.
        expiresAt: new Date("2026-02-15T00:00:00Z"),
        cancelledAt: null,
        isTrainerTier: false,
        tierDbName: "pro",
      };
      expect(computeIsFreeTier(row, now)).toBe(true);
    });

    it("returns false for a trialing subscription with a null expiresAt", () => {
      // No expiry → can't conclude it's expired. Stay non-free; the
      // user keeps premium until either a webhook updates the row
      // or someone fills in expires_at by hand.
      const row: SubscriptionRow = {
        tierName: "pro",
        paymentStatus: "trialing",
        expiresAt: null,
        cancelledAt: null,
        isTrainerTier: false,
        tierDbName: "pro",
      };
      expect(computeIsFreeTier(row, now)).toBe(false);
    });

    it("returns false for a past_due subscription (still within grace)", () => {
      const row: SubscriptionRow = {
        tierName: "pro",
        paymentStatus: "past_due",
        expiresAt: new Date("2027-01-01T00:00:00Z"),
        cancelledAt: null,
        isTrainerTier: false,
        tierDbName: "pro",
      };
      expect(computeIsFreeTier(row, now)).toBe(false);
    });

    it("returns false for a cancelled subscription still inside the paid window", () => {
      const row: SubscriptionRow = {
        tierName: "pro",
        paymentStatus: "cancelled",
        expiresAt: new Date("2026-05-01T00:00:00Z"),
        cancelledAt: new Date("2026-04-10T00:00:00Z"),
        isTrainerTier: false,
        tierDbName: "pro",
      };
      expect(computeIsFreeTier(row, now)).toBe(false);
    });

    it("returns false for a cancelled subscription with a null expiresAt", () => {
      const row: SubscriptionRow = {
        tierName: "pro",
        paymentStatus: "cancelled",
        expiresAt: null,
        cancelledAt: new Date("2026-04-10T00:00:00Z"),
        isTrainerTier: false,
        tierDbName: "pro",
      };
      expect(computeIsFreeTier(row, now)).toBe(false);
    });

    it("falls back to userSubscriptions.tier_name when the join is empty", () => {
      const row: SubscriptionRow = {
        tierName: "free",
        paymentStatus: "active",
        expiresAt: null,
        cancelledAt: null,
        isTrainerTier: null,
        tierDbName: null,
      };
      expect(computeIsFreeTier(row, now)).toBe(true);
    });

    it("defaults `now` to the current time when omitted", () => {
      expect(computeIsFreeTier(null)).toBe(true);
    });
  });

  describe("normaliseSubscriptionStatus", () => {
    it("passes through the four business-meaningful states", () => {
      expect(normaliseSubscriptionStatus("active")).toBe("active");
      expect(normaliseSubscriptionStatus("trialing")).toBe("trialing");
      expect(normaliseSubscriptionStatus("cancelled")).toBe("cancelled");
      expect(normaliseSubscriptionStatus("past_due")).toBe("past_due");
    });

    it("collapses 'pending' to null", () => {
      expect(normaliseSubscriptionStatus("pending")).toBeNull();
    });

    it("returns null for unknown or missing inputs", () => {
      expect(normaliseSubscriptionStatus(null)).toBeNull();
      expect(normaliseSubscriptionStatus("gibberish")).toBeNull();
    });
  });

  describe("coerceNumeric", () => {
    it("parses Drizzle numeric strings", () => {
      expect(coerceNumeric("75.5")).toBe(75.5);
    });

    it("passes through finite numbers", () => {
      expect(coerceNumeric(42)).toBe(42);
    });

    it("rejects NaN / Infinity", () => {
      expect(coerceNumeric(Number.NaN)).toBeNull();
      expect(coerceNumeric("not a number")).toBeNull();
    });

    it("returns null for null inputs", () => {
      expect(coerceNumeric(null)).toBeNull();
    });
  });
});

describe("DashboardRepository sub-query composition", () => {
  let repository: DashboardRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new DashboardRepository();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getProfileSlice", () => {
    it("derives firstName and preferredUnits from the row", async () => {
      (getDb as any).mockReturnValue(
        mockDbWithQueryResults([
          [
            {
              id: "user-1",
              fullName: "Grace Hopper",
              preferredUnits: "imperial",
            },
          ],
        ]),
      );

      const slice = await repository.getProfileSlice("user-1");

      expect(slice).toEqual({
        id: "user-1",
        fullName: "Grace Hopper",
        firstName: "Grace",
        preferredUnits: "imperial",
      });
    });

    it("returns a null-shaped profile when the row is missing", async () => {
      (getDb as any).mockReturnValue(mockDbWithQueryResults([[]]));

      const slice = await repository.getProfileSlice("user-missing");

      expect(slice).toEqual({
        id: "user-missing",
        fullName: null,
        firstName: null,
        preferredUnits: "metric",
      });
    });

    it("defaults preferredUnits to 'metric' for unknown values", async () => {
      (getDb as any).mockReturnValue(
        mockDbWithQueryResults([
          [{ id: "user-1", fullName: null, preferredUnits: "something" }],
        ]),
      );

      const slice = await repository.getProfileSlice("user-1");
      expect(slice.preferredUnits).toBe("metric");
      expect(slice.firstName).toBeNull();
    });
  });

  describe("getSubscriptionSlice", () => {
    it("builds the free fallback when no subscription row exists", async () => {
      (getDb as any).mockReturnValue(mockDbWithQueryResults([[]]));

      const slice = await repository.getSubscriptionSlice("user-1");

      expect(slice).toEqual({
        tierName: null,
        isFreeTier: true,
        isTrainerTier: false,
        status: null,
      });
    });

    it("propagates the joined tier details", async () => {
      (getDb as any).mockReturnValue(
        mockDbWithQueryResults([
          [
            {
              tierName: "pro",
              paymentStatus: "active",
              expiresAt: new Date("2027-01-01T00:00:00Z"),
              cancelledAt: null,
              isTrainerTier: true,
              tierDbName: "pro",
            },
          ],
        ]),
      );

      const slice = await repository.getSubscriptionSlice("user-1");

      expect(slice).toEqual({
        tierName: "pro",
        isFreeTier: false,
        isTrainerTier: true,
        status: "active",
      });
    });

    it("does not report a lapsed trainer (expired trialing) as a trainer tier", async () => {
      // Regression: a trainer-tier row stuck in `trialing` past its expiry is
      // free-tier by effect — isTrainerTier must follow, not stay true. The
      // contradictory `isFreeTier: true, isTrainerTier: true` left coach mode
      // enabled after the subscription lapsed.
      (getDb as any).mockReturnValue(
        mockDbWithQueryResults([
          [
            {
              tierName: "individual_trainer",
              paymentStatus: "trialing",
              expiresAt: new Date("2026-02-15T00:00:00Z"),
              cancelledAt: null,
              isTrainerTier: true,
              tierDbName: "individual_trainer",
            },
          ],
        ]),
      );

      const slice = await repository.getSubscriptionSlice("user-1");
      expect(slice.isFreeTier).toBe(true);
      expect(slice.isTrainerTier).toBe(false);
    });

    it("collapses pending status to null", async () => {
      (getDb as any).mockReturnValue(
        mockDbWithQueryResults([
          [
            {
              tierName: "pro",
              paymentStatus: "pending",
              expiresAt: null,
              cancelledAt: null,
              isTrainerTier: false,
              tierDbName: "pro",
            },
          ],
        ]),
      );

      const slice = await repository.getSubscriptionSlice("user-1");
      expect(slice.status).toBeNull();
    });
  });

  describe("getRecentWorkouts", () => {
    it("concatenates own + assigned + default, deduping and truncating to the limit", async () => {
      const own = [
        {
          id: "w-own-1",
          name: "Push day",
          description: null,
          estimatedDurationMinutes: 45,
          createdBy: "user-1",
          createdAt: new Date(),
        },
      ];
      const assigned = [
        {
          id: "w-assigned-1",
          name: "PT block 1",
          description: null,
          estimatedDurationMinutes: 60,
          createdBy: "trainer-1",
          assignedAt: new Date(),
          trainerRole: "personal_trainer",
        },
        // Duplicate id to prove dedup behaviour.
        {
          id: "w-own-1",
          name: "Push day",
          description: null,
          estimatedDurationMinutes: 45,
          createdBy: "user-1",
          assignedAt: new Date(),
          trainerRole: "physiotherapist",
        },
      ];
      const defaults = [
        {
          id: "w-default-1",
          name: "System default",
          description: "Default template",
          estimatedDurationMinutes: 30,
          createdBy: "00000000-0000-0000-0000-000000000000",
          createdAt: new Date(),
        },
      ];

      (getDb as any).mockReturnValue(
        mockDbWithQueryResults([own, assigned, defaults]),
      );

      const workouts = await repository.getRecentWorkouts("user-1");

      expect(workouts).toHaveLength(3);
      expect(workouts[0]).toMatchObject({
        id: "w-own-1",
        isAssigned: false,
        assignedByType: null,
      });
      expect(workouts[1]).toMatchObject({
        id: "w-assigned-1",
        isAssigned: true,
        assignedByType: "personal_trainer",
      });
      expect(workouts[2]).toMatchObject({
        id: "w-default-1",
        isAssigned: false,
      });
    });

    it("maps trainer roles to assignedByType and falls back to null", async () => {
      (getDb as any).mockReturnValue(
        mockDbWithQueryResults([
          [], // own
          [
            {
              id: "w-1",
              name: "A",
              description: null,
              estimatedDurationMinutes: 30,
              createdBy: "trainer-1",
              assignedAt: new Date(),
              trainerRole: "physiotherapist",
            },
            {
              id: "w-2",
              name: "B",
              description: null,
              estimatedDurationMinutes: 30,
              createdBy: "trainer-2",
              assignedAt: new Date(),
              trainerRole: "user",
            },
            {
              id: "w-3",
              name: "C",
              description: null,
              estimatedDurationMinutes: 30,
              createdBy: "trainer-3",
              assignedAt: new Date(),
              trainerRole: null,
            },
          ], // assigned
          [], // defaults
        ]),
      );

      const workouts = await repository.getRecentWorkouts("user-1");

      expect(workouts).toHaveLength(3);
      expect(workouts[0].assignedByType).toBe("physiotherapist");
      expect(workouts[1].assignedByType).toBeNull();
      expect(workouts[2].assignedByType).toBeNull();
    });

    it("respects the limit across all three sections", async () => {
      const own = Array.from({ length: 5 }, (_, i) => ({
        id: `w-own-${i}`,
        name: `Own ${i}`,
        description: null,
        estimatedDurationMinutes: 30,
        createdBy: "user-1",
        createdAt: new Date(),
      }));
      const assigned = Array.from({ length: 5 }, (_, i) => ({
        id: `w-assigned-${i}`,
        name: `Assigned ${i}`,
        description: null,
        estimatedDurationMinutes: 30,
        createdBy: "trainer",
        assignedAt: new Date(),
        trainerRole: "personal_trainer",
      }));
      const defaults = Array.from({ length: 5 }, (_, i) => ({
        id: `w-default-${i}`,
        name: `Default ${i}`,
        description: null,
        estimatedDurationMinutes: 30,
        createdBy: "00000000-0000-0000-0000-000000000000",
        createdAt: new Date(),
      }));

      (getDb as any).mockReturnValue(
        mockDbWithQueryResults([own, assigned, defaults]),
      );

      const workouts = await repository.getRecentWorkouts("user-1", 3);
      expect(workouts).toHaveLength(3);
      expect(workouts.map((w) => w.id)).toEqual([
        "w-own-0",
        "w-own-1",
        "w-own-2",
      ]);
    });

    it("stops iterating assigned once the limit is exhausted", async () => {
      const own = Array.from({ length: 8 }, (_, i) => ({
        id: `w-own-${i}`,
        name: `Own ${i}`,
        description: null,
        estimatedDurationMinutes: 30,
        createdBy: "user-1",
        createdAt: new Date(),
      }));
      const assigned = Array.from({ length: 5 }, (_, i) => ({
        id: `w-assigned-${i}`,
        name: `Assigned ${i}`,
        description: null,
        estimatedDurationMinutes: 30,
        createdBy: "trainer",
        assignedAt: new Date(),
        trainerRole: "personal_trainer",
      }));

      (getDb as any).mockReturnValue(
        mockDbWithQueryResults([own, assigned, []]),
      );

      const workouts = await repository.getRecentWorkouts("user-1", 10);
      expect(workouts).toHaveLength(10);
      expect(workouts.filter((w) => w.isAssigned)).toHaveLength(2);
    });

    it("fills the tail with defaults when own + assigned are sparse", async () => {
      (getDb as any).mockReturnValue(
        mockDbWithQueryResults([
          [], // own
          [], // assigned
          Array.from({ length: 3 }, (_, i) => ({
            id: `w-default-${i}`,
            name: `Default ${i}`,
            description: null,
            estimatedDurationMinutes: 30,
            createdBy: "00000000-0000-0000-0000-000000000000",
            createdAt: new Date(),
          })),
        ]),
      );

      const workouts = await repository.getRecentWorkouts("user-1");
      expect(workouts).toHaveLength(3);
      expect(workouts.every((w) => !w.isAssigned)).toBe(true);
    });

    it("falls back to SYSTEM_USER_ID when createdBy is null on any row", async () => {
      (getDb as any).mockReturnValue(
        mockDbWithQueryResults([
          [
            {
              id: "w-1",
              name: "Own",
              description: null,
              estimatedDurationMinutes: 30,
              createdBy: null,
              createdAt: new Date(),
            },
          ],
          [
            {
              id: "w-2",
              name: "Assigned",
              description: null,
              estimatedDurationMinutes: 30,
              createdBy: null,
              assignedAt: new Date(),
              trainerRole: "personal_trainer",
            },
          ],
          [
            {
              id: "w-3",
              name: "Default",
              description: null,
              estimatedDurationMinutes: 30,
              createdBy: null,
              createdAt: new Date(),
            },
          ],
        ]),
      );

      const workouts = await repository.getRecentWorkouts("user-1");
      for (const w of workouts) {
        expect(w.createdBy).toBe("00000000-0000-0000-0000-000000000000");
      }
    });

    it("issues its three sub-queries in parallel (Promise.all)", async () => {
      // Regression test for the bugbot finding: the three fetches are
      // independent, so the method must not serialise them. We assert
      // this by making every chain resolution wait on a manually-released
      // promise — if getRecentWorkouts still awaited sequentially, the
      // second select() would never be called while the first is pending.
      const callOrder: number[] = [];
      const release: Array<() => void> = [];

      const makeDeferredChain = (ix: number, rows: any[]) => {
        const chain: any = {
          from: vi.fn(() => chain),
          where: vi.fn(() => chain),
          orderBy: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          leftJoin: vi.fn(() => chain),
          innerJoin: vi.fn(() => chain),
          then: (onFulfilled: any, onRejected?: any) => {
            callOrder.push(ix);
            return new Promise<any[]>((resolve) => {
              release.push(() => resolve(rows));
            }).then(onFulfilled, onRejected);
          },
        };
        return chain;
      };

      let selectIndex = 0;
      (getDb as any).mockReturnValue({
        select: vi.fn(() => {
          const ix = selectIndex++;
          return makeDeferredChain(ix, []);
        }),
      });

      const pending = repository.getRecentWorkouts("user-1");

      // Give the event loop a tick so getRecentWorkouts can kick off all
      // three queries before any resolves.
      await Promise.resolve();
      await Promise.resolve();

      // All three chains must have been awaited before any of them resolve.
      expect(callOrder).toEqual([0, 1, 2]);

      for (const fn of release) fn();
      await pending;
    });
  });

  describe("getRecentActivity", () => {
    it("projects completed sessions, prefers session.name over workout.name", async () => {
      const completedAt = new Date("2026-04-22T10:00:00Z");

      (getDb as any).mockReturnValue(
        mockDbWithQueryResults([
          [
            {
              workoutSessionId: "s-1",
              workoutId: "w-1",
              sessionName: "Back Squat session",
              completedAt,
              durationSeconds: 3600,
              workoutName: "Leg day",
            },
            {
              workoutSessionId: "s-2",
              workoutId: "w-2",
              sessionName: null,
              completedAt,
              durationSeconds: 1800,
              workoutName: "Push day",
            },
            {
              workoutSessionId: "s-3",
              workoutId: null,
              sessionName: null,
              completedAt,
              durationSeconds: null,
              workoutName: null,
            },
          ],
        ]),
      );

      const activity = await repository.getRecentActivity("user-1");

      expect(activity).toHaveLength(3);
      expect(activity[0].workoutName).toBe("Back Squat session");
      expect(activity[0].completedAt).toBe(completedAt.toISOString());
      expect(activity[1].workoutName).toBe("Push day");
      expect(activity[2].workoutName).toBe("Workout");
    });

    it("returns an empty array when no sessions match the window", async () => {
      (getDb as any).mockReturnValue(mockDbWithQueryResults([[]]));
      const activity = await repository.getRecentActivity("user-1");
      expect(activity).toEqual([]);
    });
  });

  describe("getActiveGoalsWithProgress", () => {
    it("derives title from goal_types.description and zeros out progress", async () => {
      (getDb as any).mockReturnValue(
        mockDbWithQueryResults([
          [
            {
              id: "g-1",
              priority: 2,
              targetDate: "2026-12-31",
              goalTypeName: "strength",
              goalTypeDescription: "Increase overall strength",
              goalTypeCategory: "lift",
            },
            {
              id: "g-2",
              priority: 1,
              targetDate: null,
              goalTypeName: "weight_loss",
              goalTypeDescription: null,
              goalTypeCategory: null,
            },
          ],
        ]),
      );

      const goals = await repository.getActiveGoalsWithProgress("user-1");

      expect(goals).toHaveLength(2);
      // Sorted by priority ascending → g-2 (priority 1) first.
      expect(goals[0]).toEqual({
        id: "g-2",
        title: "weight_loss",
        current: 0,
        target: 0,
        unit: "",
        priority: 1,
        targetDate: null,
      });
      expect(goals[1].title).toBe("Increase overall strength");
    });

    it("applies defensive defaults when the join is empty", async () => {
      (getDb as any).mockReturnValue(
        mockDbWithQueryResults([
          [
            {
              id: "g-1",
              priority: null,
              targetDate: null,
              goalTypeName: null,
              goalTypeDescription: null,
              goalTypeCategory: null,
            },
          ],
        ]),
      );

      const goals = await repository.getActiveGoalsWithProgress("user-1");
      expect(goals[0]).toEqual({
        id: "g-1",
        title: "Goal",
        current: 0,
        target: 0,
        unit: "",
        priority: 1,
        targetDate: null,
      });
    });
  });

  describe("getPROfTheWeek", () => {
    it("returns null when the window is empty", async () => {
      (getDb as any).mockReturnValue(mockDbWithQueryResults([[]]));
      const pr = await repository.getPROfTheWeek("user-1");
      expect(pr).toBeNull();
    });

    it("picks the highest-ranked PR and fetches the exercise name", async () => {
      const achievedAt = new Date("2026-04-22T08:00:00Z");

      (getDb as any).mockReturnValue(
        mockDbWithQueryResults([
          [
            {
              id: "pr-a",
              exerciseId: "ex-1",
              recordType: "max_weight",
              value: "200",
              achievedAt,
            },
            {
              id: "pr-b",
              exerciseId: "ex-2",
              recordType: "1rm",
              value: "150.5",
              achievedAt,
            },
          ],
          [{ id: "ex-2", name: "Deadlift" }],
        ]),
      );

      const pr = await repository.getPROfTheWeek("user-1");
      expect(pr).not.toBeNull();
      expect(pr?.exerciseId).toBe("ex-2");
      expect(pr?.exerciseName).toBe("Deadlift");
      expect(pr?.recordType).toBe("1rm");
      expect(pr?.value).toBe(150.5); // coerced from the Drizzle string
      expect(pr?.unit).toBe("kg");
      expect(pr?.achievedAt).toBe(achievedAt.toISOString());
    });

    it("falls back to 'Exercise' when the join misses the exercise row", async () => {
      (getDb as any).mockReturnValue(
        mockDbWithQueryResults([
          [
            {
              id: "pr-a",
              exerciseId: "ex-unknown",
              recordType: "best_time",
              value: "42",
              achievedAt: new Date(),
            },
          ],
          [],
        ]),
      );

      const pr = await repository.getPROfTheWeek("user-1");
      expect(pr?.exerciseName).toBe("Exercise");
      expect(pr?.unit).toBe("s");
    });

    it("emits per-record-type units", async () => {
      const cases: Array<{
        type: RecordType;
        unit: string;
      }> = [
        { type: "1rm", unit: "kg" },
        { type: "3rm", unit: "kg" },
        { type: "5rm", unit: "kg" },
        { type: "10rm", unit: "kg" },
        { type: "max_weight", unit: "kg" },
        // Inspector Brad PR #61 regression: pre-fix, `max_volume`
        // fell through to `default: return ""` because the hand-rolled
        // `RecordType` union didn't include it. The PR-of-the-week
        // card would render a unit-less value. Now `kg` (volume in
        // strength training is conventionally a kg total).
        { type: "max_volume", unit: "kg" },
        { type: "max_reps", unit: "reps" },
        { type: "best_time", unit: "s" },
        { type: "longest_distance", unit: "m" },
      ];

      for (const { type, unit } of cases) {
        (getDb as any).mockReturnValue(
          mockDbWithQueryResults([
            [
              {
                id: `pr-${type}`,
                exerciseId: "ex-1",
                recordType: type,
                value: "10",
                achievedAt: new Date(),
              },
            ],
            [{ id: "ex-1", name: "Ex" }],
          ]),
        );

        const pr = await repository.getPROfTheWeek("user-1");
        expect(pr?.unit).toBe(unit);
      }
    });
  });

  describe("getProgressStats", () => {
    it("computes workoutsThisMonth / workoutsLastMonth from completed_at buckets", async () => {
      const now = new Date("2026-04-22T12:00:00Z");
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const thisMonth1 = new Date("2026-04-01T10:00:00Z");
      const thisMonth2 = new Date("2026-04-15T10:00:00Z");
      const lastMonth1 = new Date("2026-03-31T23:00:00Z");
      const lastMonth2 = new Date("2026-03-01T01:00:00Z");
      const ancient = new Date("2025-12-01T01:00:00Z");

      const completed = [
        { id: "s-1", completedAt: thisMonth1 },
        { id: "s-2", completedAt: thisMonth2 },
        { id: "s-3", completedAt: lastMonth1 },
        { id: "s-4", completedAt: lastMonth2 },
        { id: "s-5", completedAt: ancient },
        { id: "s-6", completedAt: null },
        { id: "s-7", completedAt: "bogus" },
      ];
      // personal_records is now a SQL COUNT(*), not a row fetch.
      const recordsCountRow = [{ total: 2 }];
      const streakSessions: Array<{ startedAt: Date | null }> = [];

      (getDb as any).mockReturnValue(
        mockDbWithQueryResults([completed, recordsCountRow, streakSessions]),
      );

      const stats = await repository.getProgressStats("user-1");

      expect(stats.workoutsThisMonth).toBe(2);
      expect(stats.workoutsLastMonth).toBe(2);
      expect(stats.personalRecordsCount).toBe(2);
      expect(stats.streak).toBe(0);
    });

    it("handles string completed_at values", async () => {
      const now = new Date("2026-04-22T12:00:00Z");
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const completed = [
        { id: "s-1", completedAt: "2026-04-10T10:00:00Z" },
        { id: "s-2", completedAt: "2026-03-10T10:00:00Z" },
      ];

      (getDb as any).mockReturnValue(
        mockDbWithQueryResults([completed, [], []]),
      );

      const stats = await repository.getProgressStats("user-1");
      expect(stats.workoutsThisMonth).toBe(1);
      expect(stats.workoutsLastMonth).toBe(1);
    });

    it("ignores sessions with null or invalid completedAt", async () => {
      const now = new Date("2026-04-22T12:00:00Z");
      vi.useFakeTimers();
      vi.setSystemTime(now);

      (getDb as any).mockReturnValue(
        mockDbWithQueryResults([
          [
            { id: "s-1", completedAt: null },
            { id: "s-2", completedAt: "not a date" },
          ],
          // COUNT(*) row-shape, empty: falls back to 0 per the ?? guard
          [],
          [],
        ]),
      );

      const stats = await repository.getProgressStats("user-1");
      expect(stats.workoutsThisMonth).toBe(0);
      expect(stats.workoutsLastMonth).toBe(0);
      expect(stats.personalRecordsCount).toBe(0);
    });

    it("reads personalRecordsCount from the SQL COUNT(*) row, not a row fetch", async () => {
      // Regression test for the bugbot finding: the records query must
      // return a single { total } row (SQL COUNT(*)), not every record
      // row for the user. A large total must be reflected exactly once
      // — not as an array length derived from N transferred rows.
      const now = new Date("2026-04-22T12:00:00Z");
      vi.useFakeTimers();
      vi.setSystemTime(now);

      (getDb as any).mockReturnValue(
        mockDbWithQueryResults([
          [], // no sessions in window
          [{ total: 4812 }], // SQL COUNT(*) result
          [], // streak
        ]),
      );

      const stats = await repository.getProgressStats("user-1");
      expect(stats.personalRecordsCount).toBe(4812);
      expect(stats.workoutsThisMonth).toBe(0);
      expect(stats.workoutsLastMonth).toBe(0);
    });
  });

  describe("getLatestMeasurement", () => {
    it("coerces weightKg / bodyFatPercentage to numbers and returns ISO timestamps", async () => {
      const measuredAt = new Date("2026-04-20T10:00:00Z");

      (getDb as any).mockReturnValue(
        mockDbWithQueryResults([
          [
            {
              id: "m-1",
              weightKg: "75.5",
              bodyFatPercentage: "15.25",
              measuredAt,
            },
          ],
        ]),
      );

      const m = await repository.getLatestMeasurement("user-1");
      expect(m).toEqual({
        id: "m-1",
        weightKg: 75.5,
        bodyFatPercentage: 15.25,
        measuredAt: measuredAt.toISOString(),
      });
    });

    it("returns null when no measurement exists", async () => {
      (getDb as any).mockReturnValue(mockDbWithQueryResults([[]]));
      expect(await repository.getLatestMeasurement("user-1")).toBeNull();
    });

    it("handles null numeric fields gracefully", async () => {
      (getDb as any).mockReturnValue(
        mockDbWithQueryResults([
          [
            {
              id: "m-1",
              weightKg: null,
              bodyFatPercentage: null,
              measuredAt: new Date(),
            },
          ],
        ]),
      );

      const m = await repository.getLatestMeasurement("user-1");
      expect(m?.weightKg).toBeNull();
      expect(m?.bodyFatPercentage).toBeNull();
    });
  });

  describe("calculateStreak", () => {
    it("returns 0 when the user has no sessions", async () => {
      (getDb as any).mockReturnValue(mockDbWithQueryResults([[]]));
      expect(await repository.calculateStreak("user-1")).toBe(0);
    });

    it("counts consecutive days starting from the most recent session", async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const twoAgo = new Date(today);
      twoAgo.setDate(twoAgo.getDate() - 2);

      (getDb as any).mockReturnValue(
        mockDbWithQueryResults([
          [
            { startedAt: today },
            { startedAt: yesterday },
            { startedAt: twoAgo },
          ],
        ]),
      );

      expect(await repository.calculateStreak("user-1")).toBe(3);
    });

    it("breaks the streak on a gap", async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const twoAgo = new Date(today);
      twoAgo.setDate(twoAgo.getDate() - 2);

      (getDb as any).mockReturnValue(
        mockDbWithQueryResults([[{ startedAt: today }, { startedAt: twoAgo }]]),
      );

      expect(await repository.calculateStreak("user-1")).toBe(1);
    });

    it("skips sessions with a null startedAt without crashing", async () => {
      (getDb as any).mockReturnValue(
        mockDbWithQueryResults([
          [{ startedAt: null }, { startedAt: new Date() }],
        ]),
      );
      const streak = await repository.calculateStreak("user-1");
      expect(streak).toBeGreaterThanOrEqual(0);
    });
  });

  describe("getDashboard composition", () => {
    it("runs every sub-query in parallel via Promise.all and returns the full payload", async () => {
      // Rather than thread 13 Drizzle chains through the shared getDb() mock
      // (whose order depends on microtask scheduling), stub each sub-query
      // method. This exercises exactly the aggregation surface of
      // getDashboard and proves the payload is assembled field-for-field.
      const profile = {
        id: "user-1",
        fullName: "Grace Hopper",
        firstName: "Grace",
        preferredUnits: "metric" as const,
      };
      const subscription = {
        tierName: "pro",
        isFreeTier: false,
        isTrainerTier: false,
        status: "active" as const,
      };
      const recentWorkouts = [
        {
          id: "w-1",
          name: "Leg Day",
          description: null,
          estimatedDurationMinutes: 45,
          createdBy: "user-1",
          isAssigned: false,
          assignedByType: null,
        },
      ];
      const recentActivity = [
        {
          workoutSessionId: "s-1",
          workoutId: "w-1",
          workoutName: "Leg Day",
          completedAt: "2026-04-22T10:00:00.000Z",
          durationSeconds: 3600,
        },
      ];
      const activeGoals = [
        {
          id: "g-1",
          title: "Build strength",
          current: 0,
          target: 0,
          unit: "lift",
          priority: 1,
          targetDate: null,
        },
      ];
      const progress = {
        workoutsThisMonth: 3,
        workoutsLastMonth: 5,
        streak: 2,
        personalRecordsCount: 1,
      };
      const prOfTheWeek = {
        exerciseId: "ex-1",
        exerciseName: "Back Squat",
        recordType: "1rm" as const,
        value: 120,
        unit: "kg",
        achievedAt: "2026-04-22T08:00:00.000Z",
      };
      const latestMeasurement = {
        id: "m-1",
        weightKg: 75.5,
        bodyFatPercentage: 15,
        measuredAt: "2026-04-20T10:00:00.000Z",
      };

      const profileSpy = vi
        .spyOn(repository, "getProfileSlice")
        .mockResolvedValue(profile);
      const subSpy = vi
        .spyOn(repository, "getSubscriptionSlice")
        .mockResolvedValue(subscription);
      const workoutsSpy = vi
        .spyOn(repository, "getRecentWorkouts")
        .mockResolvedValue(recentWorkouts);
      const activitySpy = vi
        .spyOn(repository, "getRecentActivity")
        .mockResolvedValue(recentActivity);
      const goalsSpy = vi
        .spyOn(repository, "getActiveGoalsWithProgress")
        .mockResolvedValue(activeGoals);
      const prSpy = vi
        .spyOn(repository, "getPROfTheWeek")
        .mockResolvedValue(prOfTheWeek);
      const progressSpy = vi
        .spyOn(repository, "getProgressStats")
        .mockResolvedValue(progress);
      const measurementSpy = vi
        .spyOn(repository, "getLatestMeasurement")
        .mockResolvedValue(latestMeasurement);

      const payload = await repository.getDashboard("user-1");

      // Every sub-query must be invoked exactly once with the userId.
      expect(profileSpy).toHaveBeenCalledTimes(1);
      expect(profileSpy).toHaveBeenCalledWith("user-1");
      expect(subSpy).toHaveBeenCalledWith("user-1");
      expect(workoutsSpy).toHaveBeenCalledWith("user-1");
      expect(activitySpy).toHaveBeenCalledWith("user-1");
      expect(goalsSpy).toHaveBeenCalledWith("user-1");
      expect(prSpy).toHaveBeenCalledWith("user-1");
      expect(progressSpy).toHaveBeenCalledWith("user-1");
      expect(measurementSpy).toHaveBeenCalledWith("user-1");

      // The payload is a straight projection. `activeProgramme` resolves to
      // null here: the un-stubbed ProgramAssignmentRepository slice runs
      // against the shared getDb mock, whose empty result set means "no
      // live programme" (specs/19-programs).
      expect(payload).toEqual({
        profile,
        subscription,
        recentWorkouts,
        recentActivity,
        activeGoals,
        progress,
        prOfTheWeek,
        latestMeasurement,
        activeProgramme: null,
      });
    });

    it("runs the sub-queries concurrently (not sequentially)", async () => {
      // Each stubbed sub-query resolves after a shared deferred that only
      // completes once getDashboard has started all eight. If any method
      // were awaited sequentially, the trace order would be monotonic —
      // Promise.all interleaves them, so all eight observe "started"
      // before any has resolved.
      const startedBeforeResolve: string[] = [];
      let resolveGate!: () => void;
      const gate = new Promise<void>((resolve) => {
        resolveGate = resolve;
      });

      function trace<T>(name: string, value: T) {
        return async (): Promise<T> => {
          startedBeforeResolve.push(name);
          if (startedBeforeResolve.length === 8) resolveGate();
          await gate;
          return value;
        };
      }

      vi.spyOn(repository, "getProfileSlice").mockImplementation(
        trace("profile", {
          id: "user-1",
          fullName: null,
          firstName: null,
          preferredUnits: "metric" as const,
        }),
      );
      vi.spyOn(repository, "getSubscriptionSlice").mockImplementation(
        trace("subscription", {
          tierName: null,
          isFreeTier: true,
          isTrainerTier: false,
          status: null,
        }),
      );
      vi.spyOn(repository, "getRecentWorkouts").mockImplementation(
        trace("recentWorkouts", []),
      );
      vi.spyOn(repository, "getRecentActivity").mockImplementation(
        trace("recentActivity", []),
      );
      vi.spyOn(repository, "getActiveGoalsWithProgress").mockImplementation(
        trace("activeGoals", []),
      );
      vi.spyOn(repository, "getPROfTheWeek").mockImplementation(
        trace("prOfTheWeek", null),
      );
      vi.spyOn(repository, "getProgressStats").mockImplementation(
        trace("progress", {
          workoutsThisMonth: 0,
          workoutsLastMonth: 0,
          streak: 0,
          personalRecordsCount: 0,
        }),
      );
      vi.spyOn(repository, "getLatestMeasurement").mockImplementation(
        trace("latestMeasurement", null),
      );

      await repository.getDashboard("user-1");
      expect(startedBeforeResolve).toHaveLength(8);
    });

    it("returns an empty-state payload with every slot initialised for a fresh user", async () => {
      vi.spyOn(repository, "getProfileSlice").mockResolvedValue({
        id: "user-empty",
        fullName: null,
        firstName: null,
        preferredUnits: "metric",
      });
      vi.spyOn(repository, "getSubscriptionSlice").mockResolvedValue({
        tierName: null,
        isFreeTier: true,
        isTrainerTier: false,
        status: null,
      });
      vi.spyOn(repository, "getRecentWorkouts").mockResolvedValue([]);
      vi.spyOn(repository, "getRecentActivity").mockResolvedValue([]);
      vi.spyOn(repository, "getActiveGoalsWithProgress").mockResolvedValue([]);
      vi.spyOn(repository, "getPROfTheWeek").mockResolvedValue(null);
      vi.spyOn(repository, "getProgressStats").mockResolvedValue({
        workoutsThisMonth: 0,
        workoutsLastMonth: 0,
        streak: 0,
        personalRecordsCount: 0,
      });
      vi.spyOn(repository, "getLatestMeasurement").mockResolvedValue(null);

      const payload = await repository.getDashboard("user-empty");

      expect(payload.profile.firstName).toBeNull();
      expect(payload.subscription.isFreeTier).toBe(true);
      expect(payload.recentWorkouts).toEqual([]);
      expect(payload.recentActivity).toEqual([]);
      expect(payload.activeGoals).toEqual([]);
      expect(payload.prOfTheWeek).toBeNull();
      expect(payload.progress).toEqual({
        workoutsThisMonth: 0,
        workoutsLastMonth: 0,
        streak: 0,
        personalRecordsCount: 0,
      });
      expect(payload.latestMeasurement).toBeNull();
    });
  });
});
