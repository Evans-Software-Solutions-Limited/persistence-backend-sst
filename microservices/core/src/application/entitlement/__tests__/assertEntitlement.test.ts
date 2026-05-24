/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

import {
  assertEntitlement,
  EntitlementError,
  classifySubscriptionStatus,
  coerceTierName,
  isExpiresInFuture,
  normaliseRole,
  parsePriceDecimal,
  pickUpgradeTier,
} from "../assertEntitlement";

/**
 * Drizzle select chains in this helper take three terminal shapes:
 *
 *   profile read:  select().from().where().limit()
 *   sub join read: select().from().leftJoin().where().orderBy().limit()
 *   limit read:    select().from().where().limit()
 *   tier read:     select().from().where().limit()
 *
 * Tests stage the responses in the order calls are made by the helper.
 * `makeQueueDb` returns a Drizzle-shaped stub whose `.select()` consumes
 * one queued row-set per call, so a test can assert "profile=X, then
 * sub=Y, then tier=Z" without per-table threading.
 */
function makeChainResolving(rows: unknown) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ limit, orderBy });
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
  { tierName: "basic", workoutLimit: null, priceMonthly: "7.99" },
];
const TRAINER_TIER_ROW = [
  {
    tierName: "individual_trainer_standard",
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
    tierName: "basic",
    paymentStatus: "past_due",
    expiresAt: null,
    workoutLimit: null,
  },
];

const TRAINER_SUB_ACTIVE = [
  {
    tierName: "individual_trainer_standard",
    paymentStatus: "active",
    expiresAt: null,
    workoutLimit: null,
  },
];

describe("assertEntitlement — stub features", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    "ai_workout",
    "gym_buddy",
    "unlimited_exercise_library",
    "trainer_clients",
  ] as const)("returns allowed for stub feature %s", async (feature) => {
    // Stubs short-circuit before any DB read — no getDb stub needed.
    const verdict = await assertEntitlement("user-1", feature);
    expect(verdict).toEqual({ allowed: true });
    expect(getDb).not.toHaveBeenCalled();
  });
});

describe("assertEntitlement — create_workout, no sub row (free defaults)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows when user is under the free-tier workout limit", async () => {
    // Queue: profile → sub (empty) → free tier meta → limits (count=1)
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        [], // no user_subscriptions row
        FREE_TIER_ROW,
        [{ currentCount: 1 }],
      ]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({ allowed: true });
  });

  it("allows when limit-row query returns no current-month row (stale prior-month data filtered out by gte(resetDate) — Inspector Brad PR #72 high-severity find — sweep #1)", async () => {
    // Regression: previously the limit-row WHERE had no month-boundary
    // filter, so a free user who hit cap in month N read at-cap in month
    // N+1, denying the next workout before the trigger could ever reset
    // the row. There is no scheduled `reset_monthly_limits()` job, so
    // the user was locked out until they upgraded.
    //
    // After the fix: the gte(resetDate, currentMonthStartUtc) filter
    // excludes stale prior-month rows; query returns []; helper defaults
    // count to 0; verdict is `allowed`.
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        [],
        FREE_TIER_ROW,
        [], // ← stale prior-month row excluded by the new gte filter
      ]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({ allowed: true });
  });

  it("denies with reason='limit' when count >= 3 and suggests basic", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        [],
        FREE_TIER_ROW,
        [{ currentCount: 3 }],
        BASIC_TIER_ROW, // buildDenyVerdict loads the upgrade tier
      ]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({
      allowed: false,
      reason: "limit",
      currentTier: "free",
      upgradeTo: "basic",
      upgradePriceMonthly: 7.99,
    });
  });

  it("denies with reason='limit' for trainer-role users and suggests individual_trainer_standard", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_TRAINER,
        [],
        FREE_TIER_ROW,
        [{ currentCount: 5 }],
        TRAINER_TIER_ROW,
      ]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({
      allowed: false,
      reason: "limit",
      currentTier: "free",
      upgradeTo: "individual_trainer_standard",
      upgradePriceMonthly: 9.99,
    });
  });

  it("denies with upgradeTo=null when admin is somehow at limit", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_ADMIN,
        [],
        FREE_TIER_ROW,
        [{ currentCount: 3 }],
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
        [{ currentCount: 3 }],
        BASIC_TIER_ROW,
      ]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toMatchObject({
      allowed: false,
      reason: "limit",
      upgradeTo: "basic",
    });
  });

  it("returns upgradePriceMonthly=null when the catalog row for the upgrade tier is missing", async () => {
    // Defensive case: pickUpgradeTier picks `basic`, but the catalog
    // lookup returns an empty array (someone deleted the row out of
    // band, or the catalog hasn't been seeded in this env). The verdict
    // still reports `upgradeTo: 'basic'` so mobile can show the CTA,
    // but `upgradePriceMonthly` is null. This exercises the
    // `tier?.priceMonthly ?? null` branch.
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        [],
        FREE_TIER_ROW,
        [{ currentCount: 3 }],
        [], // upgrade-tier catalog row missing
      ]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({
      allowed: false,
      reason: "limit",
      currentTier: "free",
      upgradeTo: "basic",
      upgradePriceMonthly: null,
    });
  });

  it("treats missing subscription_limits row as count=0", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        [],
        FREE_TIER_ROW,
        [], // no limits row
      ]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({ allowed: true });
  });

  it("treats subscription_limits.current_count = null as count=0", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([PROFILE_USER, [], FREE_TIER_ROW, [{ currentCount: null }]]),
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
        [{ currentCount: 3 }],
        BASIC_TIER_ROW,
      ]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({
      allowed: false,
      reason: "limit",
      currentTier: "free",
      upgradeTo: "basic",
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
        [{ currentCount: 1 }],
        BASIC_TIER_ROW,
      ]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({
      allowed: false,
      reason: "limit",
      currentTier: "free",
      upgradeTo: "basic",
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

  it("denies cancelled-with-past-expires_at as reason='cancelled'", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([PROFILE_USER, CANCELLED_SUB_EXPIRED]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({
      allowed: false,
      reason: "cancelled",
      currentTier: "premium",
      upgradeTo: null,
      upgradePriceMonthly: null,
    });
  });

  it("denies cancelled-with-null-expires_at as reason='cancelled'", async () => {
    const cancelledNoExpiry = [
      {
        tierName: "premium",
        paymentStatus: "cancelled",
        expiresAt: null,
        workoutLimit: null,
      },
    ];
    (getDb as any).mockReturnValue(
      makeQueueDb([PROFILE_USER, cancelledNoExpiry]),
    );

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toMatchObject({ allowed: false, reason: "cancelled" });
  });

  it("denies past_due sub as reason='expired'", async () => {
    (getDb as any).mockReturnValue(makeQueueDb([PROFILE_USER, PAST_DUE_SUB]));

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toEqual({
      allowed: false,
      reason: "expired",
      currentTier: "basic",
      upgradeTo: null,
      upgradePriceMonthly: null,
    });
  });

  it("denies unknown payment_status as reason='expired' (conservative default)", async () => {
    const exotic = [
      {
        tierName: "basic",
        paymentStatus: "vendor_specific_new_status_2026",
        expiresAt: null,
        workoutLimit: null,
      },
    ];
    (getDb as any).mockReturnValue(makeQueueDb([PROFILE_USER, exotic]));

    const verdict = await assertEntitlement("user-1", "create_workout");
    expect(verdict).toMatchObject({ allowed: false, reason: "expired" });
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
      "basic",
      "premium",
      "individual_trainer_standard",
      "individual_trainer_pro",
      "small_business_standard",
      "small_business_pro",
      "medium_enterprise_standard",
      "medium_enterprise_pro",
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
    it("returns basic for user-role", () => {
      expect(pickUpgradeTier("user")).toBe("basic");
    });
    it("returns basic for physiotherapist", () => {
      expect(pickUpgradeTier("physiotherapist")).toBe("basic");
    });
    it("returns individual_trainer_standard for personal_trainer", () => {
      expect(pickUpgradeTier("personal_trainer")).toBe(
        "individual_trainer_standard",
      );
    });
    it("returns null for admin", () => {
      expect(pickUpgradeTier("admin")).toBeNull();
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
      upgradeTo: "basic" as const,
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
