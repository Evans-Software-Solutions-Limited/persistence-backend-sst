/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

import {
  __entitlementUpgradeSetsForTest,
  assertEntitlement,
  EntitlementError,
  classifySubscriptionStatus,
  coerceTierName,
  evaluateWorkoutTotalCapLock,
  isExpiresInFuture,
  normaliseRole,
  parsePriceDecimal,
  pickUpgradeTier,
} from "../assertEntitlement";

/**
 * Drizzle select chains in this helper take four terminal shapes:
 *
 *   profile read:  select().from().where().limit()
 *   sub join read: select().from().leftJoin().where().orderBy().limit()
 *   tier read:     select().from().where().limit()
 *   total-count read (create_workout / evaluateWorkoutTotalCapLock):
 *                  select().from().where() — awaited DIRECTLY, no
 *                  `.limit()` (mirrors `count()` aggregate queries
 *                  elsewhere in the codebase, e.g.
 *                  `workoutRepository.getQuota()`).
 *
 * Tests stage the responses in the order calls are made by the helper.
 * `makeQueueDb` returns a Drizzle-shaped stub whose `.select()` consumes
 * one queued row-set per call, so a test can assert "profile=X, then
 * sub=Y, then tier=Z" without per-table threading. The object `where()`
 * returns is BOTH chainable (`.limit()` / `.orderBy()` for the other
 * three shapes) AND directly thenable (a bare `await ...where(...)`
 * resolves to the queued rows), so one helper serves every shape without
 * the test needing to know which one a given call site uses.
 */
function makeChainResolving(rows: unknown) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const whereResult = {
    limit,
    orderBy,
    // Makes `await db.select(...).from(...).where(...)` resolve to
    // `rows` directly, for call sites that never call `.limit()`
    // (the total-count aggregate query).
    then: (resolve: (value: unknown) => void) => resolve(rows),
  };
  const where = vi.fn().mockReturnValue(whereResult);
  const leftJoin = vi.fn().mockReturnValue({ where });
  const from = vi.fn().mockReturnValue({ where, leftJoin });
  return { from };
}

function makeQueueDb(queue: unknown[][]) {
  const select = vi.fn(() => {
    if (queue.length === 0) {
      throw new Error(
        "test stub exhausted: more SELECTs ran than the test queued. Add another entry to the queue.",
      );
    }
    const next = queue.shift();
    return makeChainResolving(next);
  });
  return { select };
}

const PROFILE_USER = [{ role: "user" }];
const PROFILE_TRAINER = [{ role: "personal_trainer" }];
const PROFILE_ADMIN = [{ role: "admin" }];
const PROFILE_PHYSIO = [{ role: "physiotherapist" }];

const FREE_TIER_ROW = [
  { tierName: "free", workoutLimit: 3, priceMonthly: "0.00" },
];
const BASIC_TIER_ROW = [
  { tierName: "premium", workoutLimit: null, priceMonthly: "7.99" },
];
const TRAINER_TIER_ROW = [
  {
    tierName: "individual_trainer",
    workoutLimit: null,
    priceMonthly: "9.99",
  },
];

const PREMIUM_SUB_ACTIVE = [
  {
    tierName: "premium",
    paymentStatus: "active",
    expiresAt: null,
    workoutLimit: null,
  },
];

const FREE_SUB_ACTIVE_WITH_LIMIT_3 = [
  {
    tierName: "free",
    paymentStatus: "active",
    expiresAt: null,
    workoutLimit: 3,
  },
];

const CANCELLED_SUB_FUTURE = [
  {
    tierName: "premium",
    paymentStatus: "cancelled",
    expiresAt: new Date(Date.now() + 86_400_000), // +1 day
    workoutLimit: null,
  },
];

const CANCELLED_SUB_EXPIRED = [
  {
    tierName: "premium",
    paymentStatus: "cancelled",
    expiresAt: new Date(Date.now() - 86_400_000), // -1 day
    workoutLimit: null,
  },
];

const PAST_DUE_SUB = [
  {
    tierName: "premium",
    paymentStatus: "past_due",
    expiresAt: null,
    workoutLimit: null,
  },
];

const TRAINER_SUB_ACTIVE = [
  {
    tierName: "individual_trainer",
    paymentStatus: "active",
    expiresAt: null,
    workoutLimit: null,
  },
];

describe("assertEntitlement — stub features", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // `trainer_clients` is no longer a stub (enforced — see trainerSeats.test.ts
  // for its verdict matrix). The remaining accept-all stubs:
  it.each(["ai_workout", "gym_buddy", "unlimited_exercise_library"] as const)(
    "returns allowed for stub feature %s",
    async (feature) => {
      // Stubs short-circuit before any DB read — no getDb stub needed.
      const verdict = await assertEntitlement("user-1", feature);
      expect(verdict).toEqual({ allowed: true });
      expect(getDb).not.toHaveBeenCalled();
    },
  );
});

const FREE_TIER_NO_AI = [
  { tierName: "free", workoutLimit: 3, aiAccess: false, priceMonthly: "0.00" },
];
const PREMIUM_TIER_WITH_AI = [
  {
    tierName: "premium",
    workoutLimit: null,
    aiAccess: true,
    priceMonthly: "12.99",
  },
];
const TRAINER_TIER_WITH_AI = [
  {
    tierName: "individual_trainer",
    workoutLimit: null,
    aiAccess: true,
    priceMonthly: "14.99",
  },
];

const PREMIUM_SUB_ACTIVE_AI = [
  {
    tierName: "premium",
    paymentStatus: "active",
    expiresAt: null,
    aiAccess: true,
  },
];
const PREMIUM_SUB_TRIALING_AI = [
  {
    tierName: "premium",
    paymentStatus: "trialing",
    expiresAt: null,
    aiAccess: true,
  },
];
const CANCELLED_SUB_EXPIRED_AI = [
  {
    tierName: "premium",
    paymentStatus: "cancelled",
    expiresAt: new Date(Date.now() - 86_400_000), // -1 day
    aiAccess: true,
  },
];
const CANCELLED_SUB_FUTURE_AI = [
  {
    tierName: "premium",
    paymentStatus: "cancelled",
    expiresAt: new Date(Date.now() + 86_400_000), // +1 day
    aiAccess: true,
  },
];
const PAST_DUE_SUB_AI = [
  {
    tierName: "premium",
    paymentStatus: "past_due",
    expiresAt: null,
    aiAccess: true,
  },
];
const TRAINER_SUB_ACTIVE_AI = [
  {
    tierName: "individual_trainer",
    paymentStatus: "active",
    expiresAt: null,
    aiAccess: true,
  },
];

describe("assertEntitlement — ai_access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows when premium sub is active (ai_access=true on the tier)", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([PROFILE_USER, PREMIUM_SUB_ACTIVE_AI]),
    );

    const verdict = await assertEntitlement("user-1", "ai_access");
    expect(verdict).toEqual({ allowed: true });
  });

  it("allows when premium sub is trialing", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([PROFILE_USER, PREMIUM_SUB_TRIALING_AI]),
    );

    const verdict = await assertEntitlement("user-1", "ai_access");
    expect(verdict).toEqual({ allowed: true });
  });

  it("allows when trainer sub is active (ai_access=true on the trainer tier)", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([PROFILE_TRAINER, TRAINER_SUB_ACTIVE_AI]),
    );

    const verdict = await assertEntitlement("user-1", "ai_access");
    expect(verdict).toEqual({ allowed: true });
  });

  it("denies with reason='tier' for a free user (no sub row) and suggests premium", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        [], // no user_subscriptions row
        FREE_TIER_NO_AI, // no-sub-row free-tier lookup
        PREMIUM_TIER_WITH_AI, // buildDenyVerdict's upgrade-tier lookup
      ]),
    );

    const verdict = await assertEntitlement("user-1", "ai_access");
    expect(verdict).toEqual({
      allowed: false,
      reason: "tier",
      currentTier: "free",
      upgradeTo: "premium",
      upgradePriceMonthly: 12.99,
    });
  });

  it("denies with reason='tier' for a trainer-role free user and suggests individual_trainer", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([PROFILE_TRAINER, [], FREE_TIER_NO_AI, TRAINER_TIER_WITH_AI]),
    );

    const verdict = await assertEntitlement("user-1", "ai_access");
    expect(verdict).toEqual({
      allowed: false,
      reason: "tier",
      currentTier: "free",
      upgradeTo: "individual_trainer",
      upgradePriceMonthly: 14.99,
    });
  });

  it("denies with reason='cancelled' + upgradeTo=null once the grace period has passed", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        CANCELLED_SUB_EXPIRED_AI,
        FREE_TIER_NO_AI, // revert-to-free lookup inside the status branch
        // No upgrade-tier lookup — buildDenyVerdict short-circuits to
        // upgradeTo=null for 'cancelled'/'expired' before ever calling
        // loadTier again.
      ]),
    );

    const verdict = await assertEntitlement("user-1", "ai_access");
    expect(verdict).toEqual({
      allowed: false,
      reason: "cancelled",
      currentTier: "premium",
      upgradeTo: null,
      upgradePriceMonthly: null,
    });
  });

  it("stays allowed for a cancelled sub still within its paid grace period", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([PROFILE_USER, CANCELLED_SUB_FUTURE_AI]),
    );

    const verdict = await assertEntitlement("user-1", "ai_access");
    expect(verdict).toEqual({ allowed: true });
  });

  it("denies with reason='expired' + upgradeTo=null for a past_due sub", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([PROFILE_USER, PAST_DUE_SUB_AI, FREE_TIER_NO_AI]),
    );

    const verdict = await assertEntitlement("user-1", "ai_access");
    expect(verdict).toEqual({
      allowed: false,
      reason: "expired",
      currentTier: "premium",
      upgradeTo: null,
      upgradePriceMonthly: null,
    });
  });

  it("throws when the free tier row is missing from the catalog (no-sub-row path)", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        [],
        [], // free tier row missing
      ]),
    );

    await expect(assertEntitlement("user-1", "ai_access")).rejects.toThrow(
      /free.*missing/,
    );
  });

  it("throws when the free tier row is missing from the catalog (status-revert path)", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        PAST_DUE_SUB_AI,
        [], // free tier row missing on the revert-to-free lookup
      ]),
    );

    await expect(assertEntitlement("user-1", "ai_access")).rejects.toThrow(
      /free.*missing/,
    );
  });

  it("coerces an unknown tier_name on the sub row to 'free' in the verdict", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        [
          {
            tierName: "deleted_tier_xyz",
            paymentStatus: "active",
            expiresAt: null,
            aiAccess: null, // LEFT JOIN miss — no catalog row for the deleted tier
          },
        ],
        PREMIUM_TIER_WITH_AI, // upgrade-tier lookup
      ]),
    );

    const verdict = await assertEntitlement("user-1", "ai_access");
    expect(verdict).toEqual({
      allowed: false,
      reason: "tier",
      currentTier: "free",
      upgradeTo: "premium",
      upgradePriceMonthly: 12.99,
    });
  });

  it("throws when the profiles row is missing (schema corruption)", async () => {
    (getDb as any).mockReturnValue(makeQueueDb([[]]));

    await expect(assertEntitlement("user-1", "ai_access")).rejects.toThrow(
      /schema corruption/,
    );
  });
});

// ─── loadout (spec-21 § 5.1) ──────────────────────────────────────────────
const FREE_TIER_NO_LOADOUT = [{ loadoutAccess: false }];
const PREMIUM_PLUS_TIER = [
  {
    tierName: "premium_plus",
    workoutLimit: null,
    aiAccess: true,
    priceMonthly: "29.99",
  },
];
// Spec-29 Phase 2 (2026-08-05): the cheapest suite-bearing coach rung — the
// upgrade-tier lookup for a `personal_trainer` denied a SUITE feature
// (`loadout` / `meal_ai`). `individual_trainer` (Start Up Coach) deliberately
// has NO suite, so a coach's suite upsell must land here, not on the entry rung.
const START_UP_COACH_PLUS_TIER = [
  {
    tierName: "start_up_coach_plus",
    workoutLimit: null,
    aiAccess: true,
    priceMonthly: "34.99",
  },
];
const PREMIUM_PLUS_SUB_ACTIVE = [
  {
    tierName: "premium_plus",
    paymentStatus: "active",
    expiresAt: null,
    loadoutAccess: true,
  },
];
const PREMIUM_SUB_ACTIVE_NO_LOADOUT = [
  {
    tierName: "premium",
    paymentStatus: "active",
    expiresAt: null,
    loadoutAccess: false,
  },
];
const TRAINER_SUB_ACTIVE_LOADOUT = [
  {
    tierName: "individual_trainer",
    paymentStatus: "active",
    expiresAt: null,
    loadoutAccess: true,
  },
];
const PREMIUM_PLUS_SUB_CANCELLED_EXPIRED = [
  {
    tierName: "premium_plus",
    paymentStatus: "cancelled",
    expiresAt: new Date(Date.now() - 86_400_000), // -1 day
    loadoutAccess: true,
  },
];
const PREMIUM_PLUS_SUB_PAST_DUE = [
  {
    tierName: "premium_plus",
    paymentStatus: "past_due",
    expiresAt: null,
    loadoutAccess: true,
  },
];

describe("assertEntitlement — loadout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ⚠ THE MOST IMPORTANT TEST IN THIS BLOCK. `assertEntitlement` has a catch-all
  // `if (feature !== "create_workout") return { allowed: true }`, so a feature
  // added to the union WITHOUT an explicit routing line silently allows
  // everyone — a paid gate becomes a no-op with no type error to catch it. This
  // test fails (by returning allowed:true for a free user) if the routing line
  // is ever removed.
  it("is ROUTED — a free user is denied, not caught by the accept-all stub branch", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        [], // no user_subscriptions row
        FREE_TIER_NO_LOADOUT, // free-tier flag lookup
        PREMIUM_PLUS_TIER, // buildDenyVerdict's upgrade-tier lookup
      ]),
    );

    const verdict = await assertEntitlement("user-1", "loadout");
    expect(verdict).toEqual({
      allowed: false,
      reason: "tier",
      currentTier: "free",
      // AC-9.4: the price comes from the catalog row, never a literal.
      upgradeTo: "premium_plus",
      upgradePriceMonthly: 29.99,
    });
  });

  it("allows an active premium_plus subscriber", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([PROFILE_USER, PREMIUM_PLUS_SUB_ACTIVE]),
    );
    expect(await assertEntitlement("user-1", "loadout")).toEqual({
      allowed: true,
    });
  });

  // AC-9.2: trainer tiers carry loadout_access.
  it("allows an active trainer subscriber", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([PROFILE_TRAINER, TRAINER_SUB_ACTIVE_LOADOUT]),
    );
    expect(await assertEntitlement("user-1", "loadout")).toEqual({
      allowed: true,
    });
  });

  // The whole point of the tier: PREMIUM does not include Loadout. A paying
  // Premium subscriber must be denied and upsold Premium+, not told they
  // already have it.
  it("DENIES an active premium subscriber and upsells premium_plus", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        PREMIUM_SUB_ACTIVE_NO_LOADOUT,
        PREMIUM_PLUS_TIER, // upgrade-tier lookup
      ]),
    );

    const verdict = await assertEntitlement("user-1", "loadout");
    expect(verdict).toEqual({
      allowed: false,
      reason: "tier",
      currentTier: "premium",
      upgradeTo: "premium_plus",
      upgradePriceMonthly: 29.99,
    });
  });

  // Spec-29 Phase 2: `individual_trainer` (Start Up Coach) has NO suite, so a
  // trainer-role free user denied a SUITE feature must upsell the cheapest
  // suite-bearing coach rung (`start_up_coach_plus`), not the entry rung —
  // upselling `individual_trainer` here would charge them and leave Loadout
  // locked, same failure mode `pickUpgradeTier`'s `feature` param prevents.
  it("denies a trainer-role free user with start_up_coach_plus, not individual_trainer or premium_plus", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_TRAINER,
        [],
        FREE_TIER_NO_LOADOUT,
        START_UP_COACH_PLUS_TIER, // upgrade-tier lookup
      ]),
    );

    const verdict = await assertEntitlement("user-1", "loadout");
    expect(verdict).toMatchObject({
      allowed: false,
      upgradeTo: "start_up_coach_plus",
      upgradePriceMonthly: 34.99,
    });
  });

  // Revert-to-free: a lapsed Premium+ sub falls back to the FREE tier's flag,
  // and the reason becomes 'cancelled' so mobile shows reinstate rather than
  // "upgrade" (the user already picked the right plan).
  it("denies with reason='cancelled' once the grace period has passed", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        PREMIUM_PLUS_SUB_CANCELLED_EXPIRED,
        FREE_TIER_NO_LOADOUT,
      ]),
    );

    expect(await assertEntitlement("user-1", "loadout")).toEqual({
      allowed: false,
      reason: "cancelled",
      currentTier: "premium_plus",
      upgradeTo: null,
      upgradePriceMonthly: null,
    });
  });

  it("stays allowed for a cancelled sub still inside its paid period", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        [
          {
            tierName: "premium_plus",
            paymentStatus: "cancelled",
            expiresAt: new Date(Date.now() + 86_400_000),
            loadoutAccess: true,
          },
        ],
      ]),
    );
    expect(await assertEntitlement("user-1", "loadout")).toEqual({
      allowed: true,
    });
  });

  it("denies with reason='expired' for a past_due sub", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        PREMIUM_PLUS_SUB_PAST_DUE,
        FREE_TIER_NO_LOADOUT,
      ]),
    );

    expect(await assertEntitlement("user-1", "loadout")).toEqual({
      allowed: false,
      reason: "expired",
      currentTier: "premium_plus",
      upgradeTo: null,
      upgradePriceMonthly: null,
    });
  });

  // An out-of-band tier_name (catalog row deleted) leaves the joined flag NULL.
  // It must read as "no access", not as "unknown ⇒ allow".
  it("denies when the joined tier row is missing (null flag)", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        [
          {
            tierName: "some_deleted_tier",
            paymentStatus: "active",
            expiresAt: null,
            loadoutAccess: null,
          },
        ],
        PREMIUM_PLUS_TIER,
      ]),
    );

    expect(await assertEntitlement("user-1", "loadout")).toMatchObject({
      allowed: false,
      // coerceTierName collapses the unknown name so the wire stays stable.
      currentTier: "free",
    });
  });

  it("throws when the free tier row is missing from the catalog", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        [],
        [], // free tier row missing
      ]),
    );

    await expect(assertEntitlement("user-1", "loadout")).rejects.toThrow(
      /free.*missing/,
    );
  });

  it("throws when the caller has no profiles row (schema corruption)", async () => {
    (getDb as any).mockReturnValue(makeQueueDb([[]]));

    await expect(assertEntitlement("user-1", "loadout")).rejects.toThrow(
      /no profiles row/,
    );
  });
});

// ─── meal_ai — Mealprint (spec-26 § 3) ────────────────────────────────────
const FREE_TIER_NO_MEALPRINT = [{ mealprintAccess: false }];
const PREMIUM_PLUS_SUB_ACTIVE_MEALPRINT = [
  {
    tierName: "premium_plus",
    paymentStatus: "active",
    expiresAt: null,
    mealprintAccess: true,
  },
];
const PREMIUM_SUB_ACTIVE_NO_MEALPRINT = [
  {
    tierName: "premium",
    paymentStatus: "active",
    expiresAt: null,
    mealprintAccess: false,
  },
];
const TRAINER_SUB_ACTIVE_NO_MEALPRINT = [
  {
    tierName: "individual_trainer",
    paymentStatus: "active",
    expiresAt: null,
    // ⚠ FALSE, unlike loadoutAccess. `20260803120200_mealprint_access.sql`
    // grants mealprint_access to premium_plus ONLY.
    mealprintAccess: false,
  },
];
const PREMIUM_PLUS_SUB_CANCELLED_EXPIRED_MEALPRINT = [
  {
    tierName: "premium_plus",
    paymentStatus: "cancelled",
    expiresAt: new Date(Date.now() - 86_400_000),
    mealprintAccess: true,
  },
];

describe("assertEntitlement — meal_ai", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ⚠ THE MOST IMPORTANT TEST IN THIS BLOCK, for the same reason as loadout's:
  // `assertEntitlement`'s catch-all returns `{ allowed: true }` for any feature
  // without an explicit routing line, so deleting that line turns a £29.99/mo
  // gate into a no-op with no type error. This test fails if it goes.
  it("is ROUTED — a free user is denied, not caught by the accept-all stub branch", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        [], // no user_subscriptions row
        FREE_TIER_NO_MEALPRINT, // free-tier flag lookup
        PREMIUM_PLUS_TIER, // buildDenyVerdict's upgrade-tier lookup
      ]),
    );

    expect(await assertEntitlement("user-1", "meal_ai")).toEqual({
      allowed: false,
      reason: "tier",
      currentTier: "free",
      upgradeTo: "premium_plus",
      // From the catalog row, never a literal.
      upgradePriceMonthly: 29.99,
    });
  });

  it("allows an active premium_plus subscriber", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([PROFILE_USER, PREMIUM_PLUS_SUB_ACTIVE_MEALPRINT]),
    );
    expect(await assertEntitlement("user-1", "meal_ai")).toEqual({
      allowed: true,
    });
  });

  it("denies an active premium subscriber — hard gate, no taster", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        PREMIUM_SUB_ACTIVE_NO_MEALPRINT,
        PREMIUM_PLUS_TIER,
      ]),
    );
    expect(await assertEntitlement("user-1", "meal_ai")).toEqual({
      allowed: false,
      reason: "tier",
      currentTier: "premium",
      upgradeTo: "premium_plus",
      upgradePriceMonthly: 29.99,
    });
  });

  // Spec-29 Phase 2: `individual_trainer` grants neither suite flag, and the
  // upsell has to follow the coach ladder, not the consumer one — pointing
  // this coach at `premium_plus` would strip their coaching role, and at
  // `individual_trainer` would charge them and leave the feature locked.
  it("denies an active trainer subscriber and upsells start_up_coach_plus, NOT premium_plus or individual_trainer", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_TRAINER,
        TRAINER_SUB_ACTIVE_NO_MEALPRINT,
        START_UP_COACH_PLUS_TIER,
      ]),
    );
    expect(await assertEntitlement("user-1", "meal_ai")).toEqual({
      allowed: false,
      reason: "tier",
      currentTier: "individual_trainer",
      upgradeTo: "start_up_coach_plus",
      upgradePriceMonthly: 34.99,
    });
  });

  it("reverts a cancelled-and-expired premium_plus sub to free rules with reason 'cancelled'", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        PREMIUM_PLUS_SUB_CANCELLED_EXPIRED_MEALPRINT,
        FREE_TIER_NO_MEALPRINT,
      ]),
    );
    expect(await assertEntitlement("user-1", "meal_ai")).toEqual({
      allowed: false,
      reason: "cancelled",
      currentTier: "premium_plus",
      // Reinstate / fix payment, not "pick a higher tier".
      upgradeTo: null,
      upgradePriceMonthly: null,
    });
  });

  it("keeps a cancelled-but-paid-through sub fully entitled", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        [
          {
            tierName: "premium_plus",
            paymentStatus: "cancelled",
            expiresAt: new Date(Date.now() + 86_400_000),
            mealprintAccess: true,
          },
        ],
      ]),
    );
    expect(await assertEntitlement("user-1", "meal_ai")).toEqual({
      allowed: true,
    });
  });

  it("denies when the joined tier row is missing (null flag reads as no access)", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        [
          {
            tierName: "some_deleted_tier",
            paymentStatus: "active",
            expiresAt: null,
            mealprintAccess: null,
          },
        ],
        PREMIUM_PLUS_TIER,
      ]),
    );
    expect(await assertEntitlement("user-1", "meal_ai")).toMatchObject({
      allowed: false,
      currentTier: "free",
    });
  });

  it("throws when the free tier row is missing from the catalog", async () => {
    (getDb as any).mockReturnValue(makeQueueDb([PROFILE_USER, [], []]));
    await expect(assertEntitlement("user-1", "meal_ai")).rejects.toThrow(
      /free.*missing/,
    );
  });

  it("throws when the caller has no profiles row (schema corruption)", async () => {
    (getDb as any).mockReturnValue(makeQueueDb([[]]));
    await expect(assertEntitlement("user-1", "meal_ai")).rejects.toThrow(
      /no profiles row/,
    );
  });
});

describe("assertEntitlement — create_workout, no sub row (free defaults)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows when user is under the free-tier workout limit", async () => {
    // Queue: profile → sub (empty) → free tier meta → total count (1)
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        [], // no user_subscriptions row
        FREE_TIER_ROW,
        [{ value: 1 }],
      ]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({ allowed: true });
  });

  it("REVERT-VERIFY: denies once the TOTAL count exceeds the limit, even though the workouts were created in a PRIOR month (total cap, not a monthly counter)", async () => {
    // This is the money test for the total-cap rewrite. Before the fix,
    // `create_workout` read `subscription_limits.current_count` filtered
    // to the current month — a free user who created 3 workouts last
    // month and 0 this month read as count=0 and was ALLOWED to create a
    // 4th, forever, 3 at a time, every month. After the fix the count is
    // `COUNT(*) FROM workouts WHERE created_by = userId` — a TOTAL that
    // never resets — so the same user is now denied.
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        [],
        FREE_TIER_ROW,
        [{ value: 3 }], // 3 workouts total, none created this month
        BASIC_TIER_ROW,
      ]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({
      allowed: false,
      reason: "limit",
      currentTier: "free",
      upgradeTo: "premium",
      upgradePriceMonthly: 7.99,
    });
  });

  it("denies with reason='limit' when count >= 3 and suggests basic", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        [],
        FREE_TIER_ROW,
        [{ value: 3 }],
        BASIC_TIER_ROW, // buildDenyVerdict loads the upgrade tier
      ]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({
      allowed: false,
      reason: "limit",
      currentTier: "free",
      upgradeTo: "premium",
      upgradePriceMonthly: 7.99,
    });
  });

  it("denies with reason='limit' for trainer-role users and suggests individual_trainer", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_TRAINER,
        [],
        FREE_TIER_ROW,
        [{ value: 5 }],
        TRAINER_TIER_ROW,
      ]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({
      allowed: false,
      reason: "limit",
      currentTier: "free",
      upgradeTo: "individual_trainer",
      upgradePriceMonthly: 9.99,
    });
  });

  it("denies with upgradeTo=null when admin is somehow at limit", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_ADMIN,
        [],
        FREE_TIER_ROW,
        [{ value: 3 }],
        // No tier load — admin path returns null upgradeTo before loadTier.
      ]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({
      allowed: false,
      reason: "limit",
      currentTier: "free",
      upgradeTo: null,
      upgradePriceMonthly: null,
    });
  });

  it("treats physiotherapist as user-role for upgrade selection", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_PHYSIO,
        [],
        FREE_TIER_ROW,
        [{ value: 3 }],
        BASIC_TIER_ROW,
      ]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toMatchObject({
      allowed: false,
      reason: "limit",
      upgradeTo: "premium",
    });
  });

  it("returns upgradePriceMonthly=null when the catalog row for the upgrade tier is missing", async () => {
    // Defensive case: pickUpgradeTier picks `basic`, but the catalog
    // lookup returns an empty array (someone deleted the row out of
    // band, or the catalog hasn't been seeded in this env). The verdict
    // still reports `upgradeTo: 'premium'` so mobile can show the CTA,
    // but `upgradePriceMonthly` is null. This exercises the
    // `tier?.priceMonthly ?? null` branch.
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        [],
        FREE_TIER_ROW,
        [{ value: 3 }],
        [], // upgrade-tier catalog row missing
      ]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({
      allowed: false,
      reason: "limit",
      currentTier: "free",
      upgradeTo: "premium",
      upgradePriceMonthly: null,
    });
  });

  it("treats a brand-new user with zero workouts as count=0", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([PROFILE_USER, [], FREE_TIER_ROW, [{ value: 0 }]]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({ allowed: true });
  });

  it("throws when the free tier row is missing from the catalog", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        [],
        [], // free tier row missing
      ]),
    );

    await expect(assertEntitlement("user-1", "create_workout")).rejects.toThrow(
      /free.*missing/,
    );
  });

  it("treats free tier with workoutLimit=null as unlimited (catalog drift)", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        [],
        [{ tierName: "free", workoutLimit: null, priceMonthly: "0.00" }],
      ]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({ allowed: true });
  });
});

describe("assertEntitlement — create_workout, active sub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows when active premium sub has unlimited workouts", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([PROFILE_USER, PREMIUM_SUB_ACTIVE]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({ allowed: true });
  });

  it("allows when active trialing sub has unlimited workouts", async () => {
    const trialingSub = [
      {
        tierName: "premium",
        paymentStatus: "trialing",
        expiresAt: null,
        workoutLimit: null,
      },
    ];
    (getDb as any).mockReturnValue(makeQueueDb([PROFILE_USER, trialingSub]));

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({ allowed: true });
  });

  it("denies when active sub is on a tier with finite workout limit at cap", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        FREE_SUB_ACTIVE_WITH_LIMIT_3,
        [{ value: 3 }],
        BASIC_TIER_ROW,
      ]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({
      allowed: false,
      reason: "limit",
      currentTier: "free",
      upgradeTo: "premium",
      upgradePriceMonthly: 7.99,
    });
  });

  it("allows trainer sub regardless of count (unlimited)", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([PROFILE_TRAINER, TRAINER_SUB_ACTIVE]),
    );
    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({ allowed: true });
  });

  it("coerces an unknown tier_name on the sub row to 'free' in the verdict", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        [
          {
            tierName: "deprecated_legacy_tier",
            paymentStatus: "active",
            expiresAt: null,
            workoutLimit: 1, // catalog still has the row joined
          },
        ],
        [{ value: 1 }],
        BASIC_TIER_ROW,
      ]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({
      allowed: false,
      reason: "limit",
      currentTier: "free",
      upgradeTo: "premium",
      upgradePriceMonthly: 7.99,
    });
  });
});

describe("assertEntitlement — cancelled / expired subscriptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats cancelled-with-future-expires_at as still entitled (allowed)", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([PROFILE_USER, CANCELLED_SUB_FUTURE]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({ allowed: true });
  });

  // ── Revert-to-free behaviour (the over-block fix) ──────────────────
  //
  // A cancelled/expired sub does NOT cut the user off — they fall back
  // to free-tier rules (3 workouts TOTAL). Under the free allowance →
  // allowed; over it → denied with the cancelled/expired reason (so
  // mobile shows reinstate / fix-payment, not "upgrade").
  //
  // Queue for these paths: profile → sub → FREE tier (the revert-to-free
  // load) → total count. buildDenyVerdict short-circuits to upgradeTo=null
  // for cancelled/expired, so NO extra upgrade-tier load is queued.

  it("ALLOWS a cancelled-with-past-expires_at sub when still under the free allowance", async () => {
    // Regression for #117: a premium-cancelled account was 402'd on every
    // create regardless of usage. Now it reverts to free (3 total) and a
    // user with 1 workout is allowed.
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        CANCELLED_SUB_EXPIRED,
        FREE_TIER_ROW,
        [{ value: 1 }],
      ]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({ allowed: true });
  });

  it("ALLOWS a cancelled sub with zero workouts (count=0)", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        CANCELLED_SUB_EXPIRED,
        FREE_TIER_ROW,
        [{ value: 0 }],
      ]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({ allowed: true });
  });

  it("denies cancelled-with-past-expires_at as reason='cancelled' once the free allowance is exhausted", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        CANCELLED_SUB_EXPIRED,
        FREE_TIER_ROW,
        [{ value: 3 }],
      ]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({
      allowed: false,
      reason: "cancelled",
      currentTier: "premium", // actual tier preserved for the reinstate CTA
      upgradeTo: null,
      upgradePriceMonthly: null,
    });
  });

  it("denies cancelled-with-null-expires_at as reason='cancelled' when over the free allowance", async () => {
    const cancelledNoExpiry = [
      {
        tierName: "premium",
        paymentStatus: "cancelled",
        expiresAt: null,
        workoutLimit: null,
      },
    ];
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        cancelledNoExpiry,
        FREE_TIER_ROW,
        [{ value: 4 }],
      ]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toMatchObject({
      allowed: false,
      reason: "cancelled",
      currentTier: "premium",
      upgradeTo: null,
    });
  });

  it("denies past_due sub as reason='expired' once the free allowance is exhausted", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([PROFILE_USER, PAST_DUE_SUB, FREE_TIER_ROW, [{ value: 3 }]]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({
      allowed: false,
      reason: "expired",
      currentTier: "premium",
      upgradeTo: null,
      upgradePriceMonthly: null,
    });
  });

  it("ALLOWS a past_due sub when still under the free allowance", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([PROFILE_USER, PAST_DUE_SUB, FREE_TIER_ROW, [{ value: 2 }]]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({ allowed: true });
  });

  it("denies unknown payment_status as reason='expired' (conservative default) when over the free allowance", async () => {
    const exotic = [
      {
        tierName: "premium",
        paymentStatus: "vendor_specific_new_status_2026",
        expiresAt: null,
        workoutLimit: null,
      },
    ];
    (getDb as any).mockReturnValue(
      makeQueueDb([PROFILE_USER, exotic, FREE_TIER_ROW, [{ value: 9 }]]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toMatchObject({ allowed: false, reason: "expired" });
  });

  it("reverts to free even when free is configured unlimited (catalog drift → allowed)", async () => {
    // Defensive: if free's workout_limit were NULL, revert-to-free yields
    // unlimited → allowed. Exercises the workoutLimit===null branch on the
    // reverted path.
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        CANCELLED_SUB_EXPIRED,
        [{ tierName: "free", workoutLimit: null, priceMonthly: "0.00" }],
      ]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({ allowed: true });
  });

  it("throws when the free tier is missing while reverting a cancelled sub", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        CANCELLED_SUB_EXPIRED,
        [], // free tier row missing during revert-to-free
      ]),
    );

    await expect(assertEntitlement("user-1", "create_workout")).rejects.toThrow(
      /free.*missing/,
    );
  });
});

describe("evaluateWorkoutTotalCapLock — over-limit RECORD lock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows a free user who is UNDER the limit", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([PROFILE_USER, [], FREE_TIER_ROW, [{ value: 1 }]]),
    );

    const verdict = await evaluateWorkoutTotalCapLock("user-1");
    expect(verdict).toEqual({ allowed: true });
  });

  it("allows a free user sitting at EXACTLY the limit (strictly-over, not at-or-over)", async () => {
    // The AC that distinguishes this from create_workout's `>=` check: a
    // user at exactly 3 of 3 is fine — only strictly over 3 is locked.
    (getDb as any).mockReturnValue(
      makeQueueDb([PROFILE_USER, [], FREE_TIER_ROW, [{ value: 3 }]]),
    );

    const verdict = await evaluateWorkoutTotalCapLock("user-1");
    expect(verdict).toEqual({ allowed: true });
  });

  it("denies with reason='workout_limit_exceeded' when a free user is STRICTLY OVER the limit", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        [],
        FREE_TIER_ROW,
        [{ value: 4 }],
        BASIC_TIER_ROW,
      ]),
    );

    const verdict = await evaluateWorkoutTotalCapLock("user-1");
    expect(verdict).toEqual({
      allowed: false,
      reason: "workout_limit_exceeded",
      currentTier: "free",
      upgradeTo: "premium",
      upgradePriceMonthly: 7.99,
    });
  });

  it("REVERT-VERIFY: denies an over-limit user recording against an OWNED template — previously `sessionsRecordHandler`'s canSkipGate bypassed assertEntitlement entirely for this path and the record always succeeded", async () => {
    // This function exists specifically because create_workout's own
    // gate never runs for an owned-workout record (canSkipGate). Calling
    // it directly (as the handler now does, before canSkipGate) proves
    // the abuse path — 20 workouts made on a lapsed trial, now free — is
    // closed: the verdict denies regardless of which workout is
    // referenced, because it never looks at workoutId at all.
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        [],
        FREE_TIER_ROW,
        [{ value: 20 }],
        BASIC_TIER_ROW,
      ]),
    );

    const verdict = await evaluateWorkoutTotalCapLock("user-1");
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toBe("workout_limit_exceeded");
    }
  });

  it("denies with reason='workout_limit_exceeded' (NOT 'cancelled') for a reverted cancelled-and-expired sub that is over the free allowance", async () => {
    // Distinct from create_workout: this function ALWAYS surfaces
    // 'workout_limit_exceeded' on deny, regardless of why the effective
    // tier is free.
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        CANCELLED_SUB_EXPIRED,
        FREE_TIER_ROW,
        [{ value: 6 }],
        BASIC_TIER_ROW,
      ]),
    );

    const verdict = await evaluateWorkoutTotalCapLock("user-1");
    expect(verdict).toEqual({
      allowed: false,
      reason: "workout_limit_exceeded",
      currentTier: "premium", // actual tier preserved, same as create_workout
      upgradeTo: "premium",
      upgradePriceMonthly: 7.99,
    });
  });

  it("allows a cancelled-with-future-expires_at sub regardless of count (still entitled, grace period)", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([PROFILE_USER, CANCELLED_SUB_FUTURE]),
    );

    const verdict = await evaluateWorkoutTotalCapLock("user-1");
    expect(verdict).toEqual({ allowed: true });
  });

  it("allows an active premium sub regardless of count (unlimited)", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([PROFILE_USER, PREMIUM_SUB_ACTIVE]),
    );

    const verdict = await evaluateWorkoutTotalCapLock("user-1");
    expect(verdict).toEqual({ allowed: true });
  });

  it("throws when the profiles row is missing (schema corruption)", async () => {
    (getDb as any).mockReturnValue(makeQueueDb([[]]));

    await expect(evaluateWorkoutTotalCapLock("user-missing")).rejects.toThrow(
      /no profiles row/,
    );
  });

  it("throws when the free tier row is missing from the catalog", async () => {
    (getDb as any).mockReturnValue(makeQueueDb([PROFILE_USER, [], []]));

    await expect(evaluateWorkoutTotalCapLock("user-1")).rejects.toThrow(
      /free.*missing/,
    );
  });

  it("ISOLATION: one user's over-limit stash never affects another user's verdict — each call resolves against its own independently-mocked DB executor", async () => {
    // `evaluateWorkoutTotalCapLock` is a pure function of (userId,
    // executor) with no module-level state, so user B's DB reads can
    // never leak into user A's verdict. Two independent executors, two
    // independent counts, run back-to-back in the same test.
    const dbForUserA = makeQueueDb([
      PROFILE_USER,
      [],
      FREE_TIER_ROW,
      [{ value: 1 }], // user A: well under the limit
    ]);
    const dbForUserB = makeQueueDb([
      PROFILE_USER,
      [],
      FREE_TIER_ROW,
      [{ value: 20 }], // user B: badly over the limit (lapsed-trial stash)
    ]);

    const verdictA = await evaluateWorkoutTotalCapLock(
      "user-A",
      dbForUserA as any,
    );
    // buildDenyVerdict's upgrade-tier price lookup always reads the
    // MODULE-LEVEL getDb() (not the passed executor) — same as every
    // other deny path in this file — so it needs its own queued response
    // even though the rest of user B's reads go through `dbForUserB`.
    (getDb as any).mockReturnValue(makeQueueDb([BASIC_TIER_ROW]));
    const verdictB = await evaluateWorkoutTotalCapLock(
      "user-B",
      dbForUserB as any,
    );

    expect(verdictA).toEqual({ allowed: true });
    expect(verdictB).toMatchObject({
      allowed: false,
      reason: "workout_limit_exceeded",
    });
  });
});

describe("assertEntitlement — error paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when the user's profile row is missing", async () => {
    (getDb as any).mockReturnValue(makeQueueDb([[]]));

    await expect(
      assertEntitlement("user-missing", "create_workout"),
    ).rejects.toThrow(/no profiles row/);
  });

  it("propagates DB errors from the sub-join read", async () => {
    const select = vi
      .fn()
      .mockImplementationOnce(() => makeChainResolving(PROFILE_USER))
      .mockImplementationOnce(() => {
        const failingLimit = vi
          .fn()
          .mockRejectedValue(new Error("connection refused"));
        const failingOrderBy = vi.fn().mockReturnValue({ limit: failingLimit });
        const failingWhere = vi
          .fn()
          .mockReturnValue({ limit: failingLimit, orderBy: failingOrderBy });
        const failingLeftJoin = vi
          .fn()
          .mockReturnValue({ where: failingWhere });
        const failingFrom = vi
          .fn()
          .mockReturnValue({ where: failingWhere, leftJoin: failingLeftJoin });
        return { from: failingFrom };
      });
    (getDb as any).mockReturnValue({ select });

    await expect(assertEntitlement("user-1", "create_workout")).rejects.toThrow(
      /connection refused/,
    );
  });
});

describe("pure helpers", () => {
  describe("classifySubscriptionStatus", () => {
    it("returns null for active", () => {
      expect(classifySubscriptionStatus("active", null)).toBeNull();
    });
    it("returns null for trialing", () => {
      expect(classifySubscriptionStatus("trialing", null)).toBeNull();
    });
    it("returns null for cancelled-with-future-expires_at", () => {
      expect(
        classifySubscriptionStatus("cancelled", new Date(Date.now() + 60_000)),
      ).toBeNull();
    });
    it("returns 'cancelled' for cancelled-with-past-expires_at", () => {
      expect(
        classifySubscriptionStatus("cancelled", new Date(Date.now() - 60_000)),
      ).toBe("cancelled");
    });
    it("returns 'cancelled' for cancelled-with-null-expires_at", () => {
      expect(classifySubscriptionStatus("cancelled", null)).toBe("cancelled");
    });
    it("returns 'expired' for past_due", () => {
      expect(classifySubscriptionStatus("past_due", null)).toBe("expired");
    });
    it("returns 'expired' for unpaid", () => {
      expect(classifySubscriptionStatus("unpaid", null)).toBe("expired");
    });
    it("returns 'expired' for incomplete", () => {
      expect(classifySubscriptionStatus("incomplete", null)).toBe("expired");
    });
    it("returns 'expired' for incomplete_expired", () => {
      expect(classifySubscriptionStatus("incomplete_expired", null)).toBe(
        "expired",
      );
    });
    it("returns 'expired' for pending", () => {
      expect(classifySubscriptionStatus("pending", null)).toBe("expired");
    });
    it("returns 'expired' for null", () => {
      expect(classifySubscriptionStatus(null, null)).toBe("expired");
    });
    it("returns 'expired' for unknown strings", () => {
      expect(classifySubscriptionStatus("future_stripe_status", null)).toBe(
        "expired",
      );
    });
  });

  describe("isExpiresInFuture", () => {
    it("returns false for null", () => {
      expect(isExpiresInFuture(null)).toBe(false);
    });
    it("returns false for undefined", () => {
      expect(isExpiresInFuture(undefined)).toBe(false);
    });
    it("returns false for past Date", () => {
      expect(isExpiresInFuture(new Date(Date.now() - 1000))).toBe(false);
    });
    it("returns true for future Date", () => {
      expect(isExpiresInFuture(new Date(Date.now() + 1000))).toBe(true);
    });
    it("returns true for future ISO string", () => {
      expect(isExpiresInFuture(new Date(Date.now() + 1000).toISOString())).toBe(
        true,
      );
    });
    it("returns false for invalid date strings", () => {
      expect(isExpiresInFuture("not a date")).toBe(false);
    });
  });

  describe("coerceTierName", () => {
    it.each([
      "free",
      "premium",
      "premium_plus",
      "individual_trainer",
      "start_up_coach_plus",
      "coach",
      "coach_pro",
    ] as const)("preserves canonical tier %s", (tier) => {
      expect(coerceTierName(tier)).toBe(tier);
    });
    it("collapses unknown strings to 'free'", () => {
      expect(coerceTierName("legacy_tier_x")).toBe("free");
    });
    it("collapses null to 'free'", () => {
      expect(coerceTierName(null)).toBe("free");
    });
    it("collapses undefined to 'free'", () => {
      expect(coerceTierName(undefined)).toBe("free");
    });
  });

  describe("normaliseRole", () => {
    it.each([
      ["personal_trainer", "personal_trainer"],
      ["physiotherapist", "physiotherapist"],
      ["admin", "admin"],
    ] as const)("preserves recognised role %s", (input, expected) => {
      expect(normaliseRole(input)).toBe(expected);
    });
    it("defaults 'user' to 'user'", () => {
      expect(normaliseRole("user")).toBe("user");
    });
    it("defaults null to 'user'", () => {
      expect(normaliseRole(null)).toBe("user");
    });
    it("defaults undefined to 'user'", () => {
      expect(normaliseRole(undefined)).toBe("user");
    });
    it("defaults unknown strings to 'user'", () => {
      expect(normaliseRole("oddrole")).toBe("user");
    });
  });

  describe("pickUpgradeTier", () => {
    it("returns premium for user-role", () => {
      expect(pickUpgradeTier("user", "create_workout")).toBe("premium");
    });
    it("returns premium for physiotherapist", () => {
      expect(pickUpgradeTier("physiotherapist", "create_workout")).toBe(
        "premium",
      );
    });
    it("returns individual_trainer for personal_trainer", () => {
      expect(pickUpgradeTier("personal_trainer", "create_workout")).toBe(
        "individual_trainer",
      );
    });
    it("returns null for admin", () => {
      expect(pickUpgradeTier("admin", "create_workout")).toBeNull();
    });

    // Feature-aware branch (spec-21 design § 9.2 item 4). Upselling Premium on a
    // `loadout` deny would take the athlete's money and leave the feature
    // locked — Premium has loadout_access = false.
    it("returns premium_plus for a loadout deny on the user track", () => {
      expect(pickUpgradeTier("user", "loadout")).toBe("premium_plus");
      expect(pickUpgradeTier("physiotherapist", "loadout")).toBe(
        "premium_plus",
      );
    });

    it("keeps non-Premium+ features on premium for the user track", () => {
      expect(pickUpgradeTier("user", "ai_access")).toBe("premium");
      expect(pickUpgradeTier("user", "trainer_clients")).toBe("premium");
    });

    // Coaches stay on the coach ladder for a SUITE deny (spec-29 Phase 2):
    // `individual_trainer` (Start Up Coach) deliberately has NO suite, so the
    // cheapest suite-bearing coach rung is `start_up_coach_plus`, not the entry
    // rung — upselling `individual_trainer` here would take the coach's money
    // and still leave Loadout locked.
    it("returns start_up_coach_plus for a trainer denied loadout", () => {
      expect(pickUpgradeTier("personal_trainer", "loadout")).toBe(
        "start_up_coach_plus",
      );
    });

    // ⚠ …and the same suite-routing applies to meal_ai now that BOTH suite
    // features have a valid coach upsell (spec-29 Phase 2) — a coach denied
    // meal_ai must never be sent to premium_plus, which would strip their
    // coaching role.
    it("returns start_up_coach_plus for a trainer denied meal_ai", () => {
      expect(pickUpgradeTier("personal_trainer", "meal_ai")).toBe(
        "start_up_coach_plus",
      );
    });

    it("returns premium_plus for a meal_ai deny on the user track", () => {
      expect(pickUpgradeTier("user", "meal_ai")).toBe("premium_plus");
      expect(pickUpgradeTier("physiotherapist", "meal_ai")).toBe(
        "premium_plus",
      );
    });

    // Admin stays null even for a Premium+-exclusive feature — the exclusive
    // branch must not overtake the admin short-circuit.
    it("returns null for an admin denied meal_ai", () => {
      expect(pickUpgradeTier("admin", "meal_ai")).toBeNull();
    });

    // Spec-29 Phase 2 retired the exclusive PREMIUM_PLUS_ONLY_FEATURES split
    // (both suite features now have a valid coach upsell), so there is no
    // subset invariant left to assert here — `__entitlementUpgradeSetsForTest`
    // only exposes `premiumPlus` now. Coverage for the suite set itself lives
    // in the "returns premium_plus for a loadout/meal_ai deny" tests above.
    it("exposes the suite feature set for suite-vs-non-suite routing tests", () => {
      const { premiumPlus } = __entitlementUpgradeSetsForTest;
      expect(premiumPlus.has("loadout")).toBe(true);
      expect(premiumPlus.has("meal_ai")).toBe(true);
      expect(premiumPlus.has("create_workout")).toBe(false);
    });

    it("returns null for an admin denied loadout", () => {
      expect(pickUpgradeTier("admin", "loadout")).toBeNull();
    });
  });

  describe("parsePriceDecimal", () => {
    it("parses decimal strings", () => {
      expect(parsePriceDecimal("7.99")).toBe(7.99);
    });
    it("passes through numbers", () => {
      expect(parsePriceDecimal(12.5)).toBe(12.5);
    });
    it("returns null for null", () => {
      expect(parsePriceDecimal(null)).toBeNull();
    });
    it("returns null for undefined", () => {
      expect(parsePriceDecimal(undefined)).toBeNull();
    });
    it("returns null for unparseable strings", () => {
      expect(parsePriceDecimal("abc")).toBeNull();
    });
  });
});

describe("EntitlementError", () => {
  it("carries the deny verdict and feature on the instance", () => {
    const verdict = {
      allowed: false as const,
      reason: "limit" as const,
      currentTier: "free" as const,
      upgradeTo: "premium" as const,
      upgradePriceMonthly: 7.99,
    };
    const error = new EntitlementError(verdict, "create_workout");
    expect(error).toBeInstanceOf(EntitlementError);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("ENTITLEMENT_DENIED");
    expect(error.name).toBe("EntitlementError");
    expect(error.verdict).toBe(verdict);
    expect(error.feature).toBe("create_workout");
  });
});
