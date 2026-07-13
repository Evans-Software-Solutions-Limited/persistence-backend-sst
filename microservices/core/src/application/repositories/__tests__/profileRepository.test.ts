/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

// Partial drizzle-orm mock: keeps the real exports so the schema-typed
// column references continue to work, but lets tests spy on the
// predicate helpers (or / isNull / eq) used by `getTrainerRelationships`.
// Matches the pattern in `exerciseRepository.test.ts`.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    or: vi.fn(actual.or),
    isNull: vi.fn(actual.isNull),
    eq: vi.fn(actual.eq),
  };
});

import { getDb } from "@persistence/db/client";
import { isNull, or } from "drizzle-orm";

function makeSelectChain(resolvedValue: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(resolvedValue),
      }),
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

describe("ProfileRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getById", () => {
    it("should return profile when found", async () => {
      const mockProfile = {
        id: "test-user-id",
        email: "test@example.com",
        fullName: "Test User",
        username: "testuser",
        avatarUrl: null,
        role: "user",
        fitnessLevel: "beginner",
        dateOfBirth: null,
        heightCm: null,
        weightKg: null,
        availableEquipment: [],
        accessibilityNeeds: [],
        preferredUnits: "metric",
        isProfilePublic: false,
        subscriptionId: null,
        hasUsedUserTrial: false,
        hasUsedTrainerTrial: false,
        primaryGoalId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([mockProfile])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { ProfileRepository } = await import("../profileRepository");
      const repo = new ProfileRepository();
      const result = await repo.getById("test-user-id");

      expect(result).toEqual(mockProfile);
    });

    it("should return null when profile not found", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { ProfileRepository } = await import("../profileRepository");
      const repo = new ProfileRepository();
      const result = await repo.getById("nonexistent-id");

      expect(result).toBeNull();
    });
  });

  describe("update", () => {
    it("should update profile and return updated data", async () => {
      const mockProfile = {
        id: "test-user-id",
        email: "test@example.com",
        fullName: "Test User",
        username: "testuser",
        avatarUrl: null,
        role: "user",
        fitnessLevel: "beginner",
        dateOfBirth: null,
        heightCm: null,
        weightKg: null,
        availableEquipment: [],
        accessibilityNeeds: [],
        preferredUnits: "metric",
        isProfilePublic: false,
        subscriptionId: null,
        hasUsedUserTrial: false,
        hasUsedTrainerTrial: false,
        primaryGoalId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockUpdatedProfile = {
        ...mockProfile,
        fullName: "Updated User",
        fitnessLevel: "intermediate",
        isProfilePublic: true,
      };

      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([mockProfile])),
        update: vi.fn().mockReturnValue(makeUpdateChain([mockUpdatedProfile])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { ProfileRepository } = await import("../profileRepository");
      const repo = new ProfileRepository();
      const result = await repo.update("test-user-id", {
        fullName: "Updated User",
        fitnessLevel: "intermediate",
        isProfilePublic: true,
      });

      expect(result).toEqual(mockUpdatedProfile);
    });

    it("should return null when profile not found for update", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([])),
        update: vi.fn().mockReturnValue(makeUpdateChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { ProfileRepository } = await import("../profileRepository");
      const repo = new ProfileRepository();
      const result = await repo.update("nonexistent-id", {
        fullName: "Updated User",
      });

      expect(result).toBeNull();
    });

    it("should update updatedAt timestamp", async () => {
      const mockProfile = {
        id: "test-user-id",
        email: "test@example.com",
        fullName: "Test User",
        username: "testuser",
        avatarUrl: null,
        role: "user",
        fitnessLevel: "beginner",
        dateOfBirth: null,
        heightCm: null,
        weightKg: null,
        availableEquipment: [],
        accessibilityNeeds: [],
        preferredUnits: "metric",
        isProfilePublic: false,
        subscriptionId: null,
        hasUsedUserTrial: false,
        hasUsedTrainerTrial: false,
        primaryGoalId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([mockProfile])),
        update: vi.fn().mockReturnValue(makeUpdateChain([mockProfile])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { ProfileRepository } = await import("../profileRepository");
      const repo = new ProfileRepository();
      await repo.update("test-user-id", { fullName: "Updated User" });

      const updateChain = mockDb.update.mock.results[0].value;
      expect(updateChain.set).toHaveBeenCalled();
      const setCall = updateChain.set.mock.calls[0];
      expect(setCall[0]).toHaveProperty("updatedAt");
    });
  });
});

describe("formatTierDisplayName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("title-cases a snake_case tier name", async () => {
    const { formatTierDisplayName } = await import("../profileRepository");
    expect(formatTierDisplayName("premium_annual")).toBe("Premium Annual");
  });

  it("handles single-word tiers", async () => {
    const { formatTierDisplayName } = await import("../profileRepository");
    expect(formatTierDisplayName("free")).toBe("Free");
  });

  it("returns null for null input", async () => {
    const { formatTierDisplayName } = await import("../profileRepository");
    expect(formatTierDisplayName(null)).toBeNull();
  });

  it("returns null for whitespace-only input", async () => {
    const { formatTierDisplayName } = await import("../profileRepository");
    expect(formatTierDisplayName("   ")).toBeNull();
  });

  it("strips empty segments from consecutive underscores", async () => {
    const { formatTierDisplayName } = await import("../profileRepository");
    expect(formatTierDisplayName("premium__annual")).toBe("Premium Annual");
  });
});

describe("ProfileRepository.getProfilePageData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Build a db mock that dispatches per-query based on the projection
   * keys passed to `select()`. Each query path returns its own fixture.
   *
   *   profileSlice           → select({ id, fullName, ... })
   *   subscriptionSlice      → select({ tierName, paymentStatus, ... })
   *   workoutsCompletedCount → select({ total })
   *   recentAchievements     → select({ id, name, description, iconUrl, unlockedAt })
   *   trainerRelationships   → select({ relationshipId, trainerId, ... })
   *
   * The chain shapes per query:
   *   profile / subscription / achievements / trainers / count
   *   = .from().{join}.where().{orderBy}.{limit}() OR .from().where()
   *
   * The shim resolves every terminal node directly so any chain depth
   * works — limit / orderBy / count terminals all hit the same resolved
   * fixture.
   */
  function makeAggregateDb(fixtures: {
    profile?: unknown[];
    subscription?: unknown[];
    workoutsCount?: Array<{ total: number }>;
    achievements?: unknown[];
    trainers?: unknown[];
  }) {
    const select = vi.fn((projection?: Record<string, unknown>) => {
      let resolved: unknown[];
      if (!projection) {
        // No-projection select() is the legacy getById path.
        resolved = fixtures.profile ?? [];
      } else if ("trainerId" in projection) {
        resolved = fixtures.trainers ?? [];
      } else if ("total" in projection) {
        resolved = fixtures.workoutsCount ?? [];
      } else if ("relationshipId" in projection) {
        resolved = fixtures.trainers ?? [];
      } else if ("tierName" in projection && "paymentStatus" in projection) {
        resolved = fixtures.subscription ?? [];
      } else if ("unlockedAt" in projection && "iconUrl" in projection) {
        resolved = fixtures.achievements ?? [];
      } else if ("fullName" in projection && "weightUnit" in projection) {
        resolved = fixtures.profile ?? [];
      } else {
        resolved = [];
      }
      // Each terminal node is thenable (resolves directly when awaited)
      // AND exposes downstream chain methods. Drizzle queries terminate at
      // varying chain depths — `.orderBy()` for trainers/achievements,
      // `.limit()` for profile/subscription, `.where()` for the count —
      // so any node in the chain must be awaitable.
      const makeThenable = (downstream: Record<string, unknown> = {}) => ({
        ...downstream,
        then: (onResolve: (v: unknown) => unknown, onReject?: any) =>
          Promise.resolve(resolved).then(onResolve, onReject),
      });
      const limitNode = makeThenable();
      const orderByNode = makeThenable({
        limit: vi.fn().mockReturnValue(limitNode),
      });
      const terminal: any = makeThenable({
        limit: vi.fn().mockReturnValue(limitNode),
        orderBy: vi.fn().mockReturnValue(orderByNode),
      });
      // After `.where()` resolves OR chains into orderBy/limit. The
      // thenable lets `count()` await `where()` directly while still
      // allowing the chain-style calls.
      const wherePath = terminal;
      const fromPath: any = {
        where: vi.fn().mockReturnValue(wherePath),
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue(wherePath),
        }),
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue(wherePath),
        }),
      };
      return { from: vi.fn().mockReturnValue(fromPath) };
    });
    return { select };
  }

  function makeProfileRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "user-1",
      fullName: "Alex Doe",
      email: "alex@example.com",
      username: "alex",
      avatarUrl: null,
      role: "user",
      fitnessLevel: "intermediate",
      dateOfBirth: "1990-01-15",
      gender: "male",
      heightCm: "180.5",
      weightKg: "75.25",
      weightUnit: "kg",
      heightUnit: "cm",
      isProfilePublic: false,
      createdAt: new Date("2024-01-15T10:00:00Z"),
      ...overrides,
    };
  }

  it("returns null when profile slice doesn't exist (handler maps to 404)", async () => {
    const mockDb = makeAggregateDb({ profile: [] });
    (getDb as any).mockReturnValue(mockDb);

    const { ProfileRepository } = await import("../profileRepository");
    const repo = new ProfileRepository();
    const result = await repo.getProfilePageData("missing-user");
    expect(result).toBeNull();
  });

  it("assembles full payload from sub-slices", async () => {
    const mockDb = makeAggregateDb({
      profile: [makeProfileRow()],
      subscription: [
        {
          tierName: "premium",
          paymentStatus: "active",
          expiresAt: new Date("2026-12-31T00:00:00Z"),
          cancelledAt: null,
          isTrainerTier: false,
          tierDbName: "premium",
          tierFeatures: { workouts: "unlimited" },
          workoutLimit: null,
        },
      ],
      workoutsCount: [{ total: 42 }],
      achievements: [
        {
          id: "ach-1",
          name: "First Workout",
          description: "Completed your first session",
          iconUrl: null,
          unlockedAt: new Date("2024-02-01T12:00:00Z"),
        },
      ],
      trainers: [
        {
          relationshipId: "rel-1",
          trainerId: "trainer-1",
          trainerFullName: "Coach Sam",
          trainerAvatarUrl: "https://example.com/sam.jpg",
        },
      ],
    });
    (getDb as any).mockReturnValue(mockDb);

    const { ProfileRepository } = await import("../profileRepository");
    const repo = new ProfileRepository();
    const result = await repo.getProfilePageData("user-1");

    expect(result).not.toBeNull();
    expect(result?.profile.id).toBe("user-1");
    expect(result?.profile.heightCm).toBe(180.5);
    expect(result?.profile.weightKg).toBe(75.25);
    expect(result?.profile.dateOfBirth).toBe("1990-01-15");
    expect(result?.profile.gender).toBe("male");
    expect(result?.subscription.tierName).toBe("premium");
    expect(result?.subscription.tierDisplayName).toBe("Premium");
    expect(result?.subscription.status).toBe("active");
    expect(result?.subscription.isFreeTier).toBe(false);
    expect(result?.subscription.isUnlimited).toBe(true);
    expect(result?.stats.workoutsCompleted).toBe(42);
    expect(result?.recentAchievements).toHaveLength(1);
    expect(result?.recentAchievements[0].name).toBe("First Workout");
    expect(result?.activeTrainers).toHaveLength(1);
    expect(result?.activeTrainers[0].trainer.fullName).toBe("Coach Sam");
  });

  it("surfaces deletedAt/purgeAfter as null for an active (never soft-deleted) account", async () => {
    const mockDb = makeAggregateDb({
      profile: [makeProfileRow()],
      workoutsCount: [{ total: 0 }],
    });
    (getDb as any).mockReturnValue(mockDb);

    const { ProfileRepository } = await import("../profileRepository");
    const repo = new ProfileRepository();
    const result = await repo.getProfilePageData("user-1");

    expect(result?.profile.deletedAt).toBeNull();
    expect(result?.profile.purgeAfter).toBeNull();
  });

  it("surfaces deletedAt/purgeAfter as ISO strings for a soft-deleted account (Cluster 2a restore-screen gate)", async () => {
    const mockDb = makeAggregateDb({
      profile: [
        makeProfileRow({
          deletedAt: new Date("2026-07-13T12:00:00Z"),
          purgeAfter: new Date("2026-08-12T12:00:00Z"),
        }),
      ],
      workoutsCount: [{ total: 0 }],
    });
    (getDb as any).mockReturnValue(mockDb);

    const { ProfileRepository } = await import("../profileRepository");
    const repo = new ProfileRepository();
    const result = await repo.getProfilePageData("user-1");

    expect(result?.profile.deletedAt).toBe("2026-07-13T12:00:00.000Z");
    expect(result?.profile.purgeAfter).toBe("2026-08-12T12:00:00.000Z");
  });

  it("falls back to free-tier defaults when no subscription row exists", async () => {
    const mockDb = makeAggregateDb({
      profile: [makeProfileRow()],
      subscription: [],
      workoutsCount: [{ total: 0 }],
    });
    (getDb as any).mockReturnValue(mockDb);

    const { ProfileRepository } = await import("../profileRepository");
    const repo = new ProfileRepository();
    const result = await repo.getProfilePageData("user-1");

    expect(result?.subscription).toEqual({
      tierName: null,
      tierDisplayName: null,
      status: null,
      isFreeTier: true,
      isTrainerTier: false,
      expiresAt: null,
      cancelledAt: null,
      workoutLimit: null,
      isUnlimited: false,
    });
  });

  it("coerces decimal columns (heightCm / weightKg) to numbers", async () => {
    const mockDb = makeAggregateDb({
      profile: [makeProfileRow({ heightCm: "165.7", weightKg: "60.5" })],
      workoutsCount: [{ total: 0 }],
    });
    (getDb as any).mockReturnValue(mockDb);

    const { ProfileRepository } = await import("../profileRepository");
    const repo = new ProfileRepository();
    const result = await repo.getProfilePageData("user-1");

    expect(typeof result?.profile.heightCm).toBe("number");
    expect(typeof result?.profile.weightKg).toBe("number");
    expect(result?.profile.heightCm).toBe(165.7);
    expect(result?.profile.weightKg).toBe(60.5);
  });

  it.each(["male", "female", "other"] as const)(
    "surfaces a valid gender (%s) verbatim",
    async (gender) => {
      const mockDb = makeAggregateDb({
        profile: [makeProfileRow({ gender })],
        workoutsCount: [{ total: 0 }],
      });
      (getDb as any).mockReturnValue(mockDb);

      const { ProfileRepository } = await import("../profileRepository");
      const repo = new ProfileRepository();
      const result = await repo.getProfilePageData("user-1");

      expect(result?.profile.gender).toBe(gender);
    },
  );

  it.each([null, "banana", ""])(
    "collapses an unset/stray gender (%p) to null so the editor prompts",
    async (gender) => {
      const mockDb = makeAggregateDb({
        profile: [makeProfileRow({ gender })],
        workoutsCount: [{ total: 0 }],
      });
      (getDb as any).mockReturnValue(mockDb);

      const { ProfileRepository } = await import("../profileRepository");
      const repo = new ProfileRepository();
      const result = await repo.getProfilePageData("user-1");

      expect(result?.profile.gender).toBeNull();
    },
  );

  it("normalises weightUnit to 'kg' when not 'lb'", async () => {
    const mockDb = makeAggregateDb({
      profile: [makeProfileRow({ weightUnit: "garbage" })],
      workoutsCount: [{ total: 0 }],
    });
    (getDb as any).mockReturnValue(mockDb);

    const { ProfileRepository } = await import("../profileRepository");
    const repo = new ProfileRepository();
    const result = await repo.getProfilePageData("user-1");

    expect(result?.profile.weightUnit).toBe("kg");
  });

  it("normalises heightUnit to 'cm' when not 'ftin'", async () => {
    const mockDb = makeAggregateDb({
      profile: [makeProfileRow({ heightUnit: "garbage" })],
      workoutsCount: [{ total: 0 }],
    });
    (getDb as any).mockReturnValue(mockDb);

    const { ProfileRepository } = await import("../profileRepository");
    const repo = new ProfileRepository();
    const result = await repo.getProfilePageData("user-1");

    expect(result?.profile.heightUnit).toBe("cm");
  });

  it("collapses unknown role values to 'user'", async () => {
    const mockDb = makeAggregateDb({
      profile: [makeProfileRow({ role: "intruder" })],
      workoutsCount: [{ total: 0 }],
    });
    (getDb as any).mockReturnValue(mockDb);

    const { ProfileRepository } = await import("../profileRepository");
    const repo = new ProfileRepository();
    const result = await repo.getProfilePageData("user-1");

    expect(result?.profile.role).toBe("user");
  });

  it("preserves valid roles (personal_trainer / physiotherapist / admin)", async () => {
    const mockDb = makeAggregateDb({
      profile: [makeProfileRow({ role: "personal_trainer" })],
      workoutsCount: [{ total: 0 }],
    });
    (getDb as any).mockReturnValue(mockDb);

    const { ProfileRepository } = await import("../profileRepository");
    const repo = new ProfileRepository();
    const result = await repo.getProfilePageData("user-1");

    expect(result?.profile.role).toBe("personal_trainer");
  });

  it("returns total=0 when workouts-completed count yields no rows (defensive)", async () => {
    const mockDb = makeAggregateDb({
      profile: [makeProfileRow()],
      workoutsCount: [],
    });
    (getDb as any).mockReturnValue(mockDb);

    const { ProfileRepository } = await import("../profileRepository");
    const repo = new ProfileRepository();
    const result = await repo.getProfilePageData("user-1");
    expect(result?.stats.workoutsCompleted).toBe(0);
  });

  it("returns empty arrays for achievements / trainers when none exist", async () => {
    const mockDb = makeAggregateDb({
      profile: [makeProfileRow()],
      workoutsCount: [{ total: 5 }],
      achievements: [],
      trainers: [],
    });
    (getDb as any).mockReturnValue(mockDb);

    const { ProfileRepository } = await import("../profileRepository");
    const repo = new ProfileRepository();
    const result = await repo.getProfilePageData("user-1");

    expect(result?.recentAchievements).toEqual([]);
    expect(result?.activeTrainers).toEqual([]);
    expect(result?.pendingTrainerRequests).toEqual([]);
  });

  it("uses tier.workoutLimit when tier.features.workouts is not 'unlimited'", async () => {
    const mockDb = makeAggregateDb({
      profile: [makeProfileRow()],
      subscription: [
        {
          tierName: "premium",
          paymentStatus: "active",
          expiresAt: new Date("2026-12-31T00:00:00Z"),
          cancelledAt: null,
          isTrainerTier: false,
          tierDbName: "premium",
          tierFeatures: { workouts: 10 },
          workoutLimit: 10,
        },
      ],
      workoutsCount: [{ total: 3 }],
    });
    (getDb as any).mockReturnValue(mockDb);

    const { ProfileRepository } = await import("../profileRepository");
    const repo = new ProfileRepository();
    const result = await repo.getProfilePageData("user-1");

    expect(result?.subscription.workoutLimit).toBe(10);
    expect(result?.subscription.isUnlimited).toBe(false);
  });

  it("derives isUnlimited=true when workoutLimit is null even without features.workouts='unlimited'", async () => {
    // Catches the legacy edge case where a tier has no explicit cap but
    // also no marker — treat absence-of-limit as unlimited.
    const mockDb = makeAggregateDb({
      profile: [makeProfileRow()],
      subscription: [
        {
          tierName: "founder",
          paymentStatus: "active",
          expiresAt: new Date("2026-12-31T00:00:00Z"),
          cancelledAt: null,
          isTrainerTier: false,
          tierDbName: "founder",
          tierFeatures: {},
          workoutLimit: null,
        },
      ],
      workoutsCount: [{ total: 0 }],
    });
    (getDb as any).mockReturnValue(mockDb);

    const { ProfileRepository } = await import("../profileRepository");
    const repo = new ProfileRepository();
    const result = await repo.getProfilePageData("user-1");

    expect(result?.subscription.isUnlimited).toBe(true);
  });

  it("prefers subscription_tiers.display_name over the title-cased tier_name (trainer-tier parity)", async () => {
    // Inspector Brad on PR #66: the title-cased tier_name diverges from
    // the seeded display_name for trainer/business tiers — e.g.
    // 'small_business' title-cases to 'Small Business Standard'
    // but the authoritative display_name is 'Small Business Trainer
    // Standard'. Prefer the joined column when present.
    const mockDb = makeAggregateDb({
      profile: [makeProfileRow()],
      subscription: [
        {
          tierName: "small_business",
          paymentStatus: "active",
          expiresAt: new Date("2026-12-31T00:00:00Z"),
          cancelledAt: null,
          isTrainerTier: true,
          tierDbName: "small_business",
          tierDisplayName: "Small Business Trainer Standard",
          tierFeatures: { workouts: "unlimited" },
          workoutLimit: null,
        },
      ],
      workoutsCount: [{ total: 0 }],
    });
    (getDb as any).mockReturnValue(mockDb);

    const { ProfileRepository } = await import("../profileRepository");
    const repo = new ProfileRepository();
    const result = await repo.getProfilePageData("user-1");

    expect(result?.subscription.tierDisplayName).toBe(
      "Small Business Trainer Standard",
    );
  });

  it("does not report a lapsed trainer (expired trialing) as a trainer tier", async () => {
    // Regression: a trainer-tier row stuck in `trialing` past its expiry is
    // free-tier by effect, so isTrainerTier must follow. The contradictory
    // `isFreeTier: true, isTrainerTier: true` left coach mode enabled after the
    // subscription lapsed (staging: a 4-month-expired individual_trainer trial).
    const mockDb = makeAggregateDb({
      profile: [makeProfileRow()],
      subscription: [
        {
          tierName: "individual_trainer",
          paymentStatus: "trialing",
          expiresAt: new Date("2026-02-15T00:00:00Z"),
          cancelledAt: null,
          isTrainerTier: true,
          tierDbName: "individual_trainer",
          tierDisplayName: "Individual Trainer",
          tierFeatures: {},
          workoutLimit: null,
        },
      ],
      workoutsCount: [{ total: 0 }],
    });
    (getDb as any).mockReturnValue(mockDb);

    const { ProfileRepository } = await import("../profileRepository");
    const repo = new ProfileRepository();
    const result = await repo.getProfilePageData("user-1");

    expect(result?.subscription.isFreeTier).toBe(true);
    expect(result?.subscription.isTrainerTier).toBe(false);
  });

  it("falls back to title-cased tier_name when display_name is null on the joined row", async () => {
    const mockDb = makeAggregateDb({
      profile: [makeProfileRow()],
      subscription: [
        {
          tierName: "premium_annual",
          paymentStatus: "active",
          expiresAt: new Date("2026-12-31T00:00:00Z"),
          cancelledAt: null,
          isTrainerTier: false,
          tierDbName: "premium_annual",
          tierDisplayName: null,
          tierFeatures: { workouts: "unlimited" },
          workoutLimit: null,
        },
      ],
      workoutsCount: [{ total: 0 }],
    });
    (getDb as any).mockReturnValue(mockDb);

    const { ProfileRepository } = await import("../profileRepository");
    const repo = new ProfileRepository();
    const result = await repo.getProfilePageData("user-1");

    expect(result?.subscription.tierDisplayName).toBe("Premium Annual");
  });

  it("forces isUnlimited=false when subscription is cancelled and expired (free-tier derived)", async () => {
    // Inspector Brad on PR #66: the cancelled+expired case correctly
    // derives `isFreeTier=true` via `computeIsFreeTier`, but the previous
    // `isUnlimited` computation read tier.features in isolation and
    // emitted `isFreeTier: true, isUnlimited: true` — an impossible
    // combination that would let an expired user past the free quota.
    // Gate on the effective tier.
    const expiredCancelled = new Date("2024-01-01T00:00:00Z"); // < now
    const mockDb = makeAggregateDb({
      profile: [makeProfileRow()],
      subscription: [
        {
          tierName: "premium",
          paymentStatus: "cancelled",
          expiresAt: expiredCancelled,
          cancelledAt: new Date("2023-12-01T00:00:00Z"),
          isTrainerTier: false,
          tierDbName: "premium",
          tierDisplayName: "Premium",
          tierFeatures: { workouts: "unlimited" },
          workoutLimit: null,
        },
      ],
      workoutsCount: [{ total: 0 }],
    });
    (getDb as any).mockReturnValue(mockDb);

    const { ProfileRepository } = await import("../profileRepository");
    const repo = new ProfileRepository();
    const result = await repo.getProfilePageData("user-1");

    expect(result?.subscription.isFreeTier).toBe(true);
    expect(result?.subscription.isUnlimited).toBe(false);
  });

  it("constructs an OR(eq false, isNull) predicate so NULL is_ai_trainer rows are treated as not-AI", async () => {
    // Inspector Brad on PR #66: `is_ai_trainer` is nullable; a strict
    // `eq(isAiTrainer, false)` evaluates to NULL for those rows and
    // silently drops them from the user's "Active Trainers" list. The
    // safer reading is "exclude rows where the flag is explicitly true"
    // — i.e. NULL counts as not-an-AI-trainer.
    const orMock = or as unknown as ReturnType<typeof vi.fn>;
    const isNullMock = isNull as unknown as ReturnType<typeof vi.fn>;
    orMock.mockClear();
    isNullMock.mockClear();

    const mockDb = makeAggregateDb({
      profile: [makeProfileRow()],
      workoutsCount: [{ total: 0 }],
      trainers: [],
    });
    (getDb as any).mockReturnValue(mockDb);

    const { ProfileRepository } = await import("../profileRepository");
    const repo = new ProfileRepository();
    await repo.getProfilePageData("user-1");

    // `isNull` should have been called for the `is_ai_trainer` column,
    // and `or` should have wrapped it with the explicit-false branch.
    expect(isNullMock).toHaveBeenCalled();
    expect(orMock).toHaveBeenCalled();
    // Verify the isNull call targeted the isAiTrainer column. Drizzle's
    // column references have a `.name` property — defensively check
    // either `.name` or the raw column object for resilience across
    // Drizzle versions.
    const isNullArgs = isNullMock.mock.calls.flat();
    const hitAiTrainer = isNullArgs.some(
      (arg: any) =>
        arg?.name === "is_ai_trainer" ||
        arg?._.name === "is_ai_trainer" ||
        // Drizzle pg-core column shape exposes the snake-case column
        // name on a few possible paths; cover the obvious ones.
        String(arg).includes("is_ai_trainer"),
    );
    expect(hitAiTrainer).toBe(true);
  });

  it("maps subscription dates to ISO strings (or null when absent)", async () => {
    const mockDb = makeAggregateDb({
      profile: [makeProfileRow()],
      subscription: [
        {
          tierName: "premium",
          paymentStatus: "cancelled",
          expiresAt: new Date("2026-12-31T00:00:00Z"),
          cancelledAt: new Date("2026-06-01T00:00:00Z"),
          isTrainerTier: false,
          tierDbName: "premium",
          tierFeatures: { workouts: "unlimited" },
          workoutLimit: null,
        },
      ],
      workoutsCount: [{ total: 0 }],
    });
    (getDb as any).mockReturnValue(mockDb);

    const { ProfileRepository } = await import("../profileRepository");
    const repo = new ProfileRepository();
    const result = await repo.getProfilePageData("user-1");

    expect(result?.subscription.expiresAt).toBe("2026-12-31T00:00:00.000Z");
    expect(result?.subscription.cancelledAt).toBe("2026-06-01T00:00:00.000Z");
    expect(result?.subscription.status).toBe("cancelled");
  });
});

describe("defaultNotificationPreferences", () => {
  it("returns every NotificationType key mapped to true", async () => {
    const { defaultNotificationPreferences } =
      await import("../profileRepository");
    const result = defaultNotificationPreferences();
    expect(result).toEqual({
      workout_assigned: true,
      friend_request: true,
      pt_request: true,
      pt_accepted: true,
      physio_request: true,
      physio_accepted: true,
      workout_reminder: true,
      goal_milestone: true,
      trainer_feedback: true,
      // M4 (06-progress-goals) streak events — default opt-in "on".
      streak_milestone: true,
      streak_at_risk: true,
      freeze_token_applied: true,
      // M8 (10-trainer-features) Phase 3 on-behalf events — default opt-in "on".
      goal_assigned_by_trainer: true,
      workout_logged_on_behalf: true,
      measurement_logged_on_behalf: true,
      nutrition_target_set_by_trainer: true,
      // M17 Send brief — default opt-in "on".
      coach_brief: true,
      // Trainer-client-caps — default opt-in "on".
      trainer_client_limit_reached: true,
      // Coach Mode Phase 8 — default opt-in "on".
      coach_request_accepted: true,
    });
  });

  it("returns a fresh object so callers can mutate without poisoning", async () => {
    const { defaultNotificationPreferences } =
      await import("../profileRepository");
    const first = defaultNotificationPreferences();
    first.workout_reminder = false;
    const second = defaultNotificationPreferences();
    expect(second.workout_reminder).toBe(true);
  });
});

describe("reconcileNotificationPreferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all-defaults when stored is null", async () => {
    const { reconcileNotificationPreferences } =
      await import("../profileRepository");
    const result = reconcileNotificationPreferences(null);
    expect(result.workout_assigned).toBe(true);
    expect(result.trainer_feedback).toBe(true);
  });

  it("returns all-defaults when stored is undefined", async () => {
    const { reconcileNotificationPreferences } =
      await import("../profileRepository");
    const result = reconcileNotificationPreferences(undefined);
    expect(result.workout_assigned).toBe(true);
  });

  it("returns all-defaults when stored is empty object", async () => {
    const { reconcileNotificationPreferences } =
      await import("../profileRepository");
    const result = reconcileNotificationPreferences({});
    expect(result.workout_reminder).toBe(true);
  });

  it("overrides defaults with explicit false values", async () => {
    const { reconcileNotificationPreferences } =
      await import("../profileRepository");
    const result = reconcileNotificationPreferences({
      workout_reminder: false,
      friend_request: false,
    });
    expect(result.workout_reminder).toBe(false);
    expect(result.friend_request).toBe(false);
    expect(result.goal_milestone).toBe(true);
  });

  it("drops unknown keys (legacy values no longer in the enum)", async () => {
    const { reconcileNotificationPreferences } =
      await import("../profileRepository");
    const result = reconcileNotificationPreferences({
      workout_reminder: false,
      legacy_unknown_key: true,
    } as Record<string, unknown>);
    expect("legacy_unknown_key" in result).toBe(false);
    expect(result.workout_reminder).toBe(false);
  });

  it("ignores non-boolean values, applies defaults for those keys", async () => {
    const { reconcileNotificationPreferences } =
      await import("../profileRepository");
    const result = reconcileNotificationPreferences({
      workout_reminder: "yes" as unknown as boolean,
      friend_request: 0 as unknown as boolean,
      pt_request: null as unknown as boolean,
    });
    // Non-boolean values fall through → defaults apply
    expect(result.workout_reminder).toBe(true);
    expect(result.friend_request).toBe(true);
    expect(result.pt_request).toBe(true);
  });
});

describe("ProfileRepository.getNotificationPreferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeSelectChain(resolvedValue: unknown) {
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(resolvedValue),
        }),
      }),
    };
  }

  it("returns defaults when notification_preferences column is empty", async () => {
    const mockDb = {
      select: vi
        .fn()
        .mockReturnValue(makeSelectChain([{ notificationPreferences: {} }])),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { ProfileRepository } = await import("../profileRepository");
    const repo = new ProfileRepository();
    const result = await repo.getNotificationPreferences("user-1");

    expect(result).toEqual({
      workout_assigned: true,
      friend_request: true,
      pt_request: true,
      pt_accepted: true,
      physio_request: true,
      physio_accepted: true,
      workout_reminder: true,
      goal_milestone: true,
      trainer_feedback: true,
      // M4 (06-progress-goals) streak events — default opt-in "on".
      streak_milestone: true,
      streak_at_risk: true,
      freeze_token_applied: true,
      // M8 (10-trainer-features) Phase 3 on-behalf events — default opt-in "on".
      goal_assigned_by_trainer: true,
      workout_logged_on_behalf: true,
      measurement_logged_on_behalf: true,
      nutrition_target_set_by_trainer: true,
      // M17 Send brief — default opt-in "on".
      coach_brief: true,
      // Trainer-client-caps — default opt-in "on".
      trainer_client_limit_reached: true,
      // Coach Mode Phase 8 — default opt-in "on".
      coach_request_accepted: true,
    });
  });

  it("merges stored overrides over defaults", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue(
        makeSelectChain([
          {
            notificationPreferences: {
              workout_reminder: false,
              goal_milestone: false,
            },
          },
        ]),
      ),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { ProfileRepository } = await import("../profileRepository");
    const repo = new ProfileRepository();
    const result = await repo.getNotificationPreferences("user-1");

    expect((result as Record<string, boolean>).workout_reminder).toBe(false);
    expect((result as Record<string, boolean>).goal_milestone).toBe(false);
    expect((result as Record<string, boolean>).trainer_feedback).toBe(true);
  });

  it("returns the sentinel when no profile row exists", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue(makeSelectChain([])),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { ProfileRepository, NOTIFICATION_PREFERENCES_PROFILE_MISSING } =
      await import("../profileRepository");
    const repo = new ProfileRepository();
    const result = await repo.getNotificationPreferences("missing-user");

    expect(result).toBe(NOTIFICATION_PREFERENCES_PROFILE_MISSING);
  });

  it("treats null JSONB column the same as empty (returns defaults)", async () => {
    const mockDb = {
      select: vi
        .fn()
        .mockReturnValue(makeSelectChain([{ notificationPreferences: null }])),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { ProfileRepository } = await import("../profileRepository");
    const repo = new ProfileRepository();
    const result = await repo.getNotificationPreferences("user-1");

    expect((result as Record<string, boolean>).workout_assigned).toBe(true);
  });
});

describe("ProfileRepository.mergeNotificationPreferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeUpdateChain(resolvedValue: unknown) {
    const returning = vi.fn().mockResolvedValue(resolvedValue);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    return { set };
  }

  /**
   * Flatten Drizzle's `queryChunks` recursively (each chunk can be a
   * string, a nested SQL with its own queryChunks, a Param object
   * carrying `value`, or a PgColumn with circular table refs). Returns
   * all leaf strings + Param values; column refs are skipped to avoid
   * the circular-structure traversal.
   */
  function flattenSqlLeaves(node: unknown, out: unknown[] = []): unknown[] {
    if (node === null || node === undefined) return out;
    if (typeof node === "string" || typeof node === "number") {
      out.push(node);
      return out;
    }
    if (Array.isArray(node)) {
      for (const item of node) flattenSqlLeaves(item, out);
      return out;
    }
    if (typeof node === "object") {
      const obj = node as Record<string, unknown>;
      if ("value" in obj && !("table" in obj)) {
        // Param-shaped object (carries `value`, no table back-ref)
        out.push(obj.value);
        return out;
      }
      if ("queryChunks" in obj) {
        flattenSqlLeaves(obj.queryChunks, out);
        return out;
      }
      // Column / Table refs — skip to avoid circular traversal.
      return out;
    }
    return out;
  }

  it("returns the merged JSONB column when the UPDATE touches a row", async () => {
    // The DB's RETURNING surfaces the post-merge state — the handler
    // reconciles against this rather than echoing the request body.
    const mergedFromDb = {
      workout_reminder: false,
      friend_request: false,
    };
    const mockDb = {
      update: vi
        .fn()
        .mockReturnValue(
          makeUpdateChain([{ notificationPreferences: mergedFromDb }]),
        ),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { ProfileRepository } = await import("../profileRepository");
    const repo = new ProfileRepository();
    const result = await repo.mergeNotificationPreferences("user-1", {
      workout_reminder: false,
    });

    expect(result).toEqual(mergedFromDb);
    const updateChain = mockDb.update.mock.results[0].value;
    const setPayload = updateChain.set.mock.calls[0][0];
    // notificationPreferences is now a Drizzle SQL expression doing
    // atomic JSONB merge — verify the JSON-serialised partial is bound
    // as a parameter (the SQL fragments themselves are Drizzle-internal
    // shapes that don't surface as plain strings here).
    const leaves = flattenSqlLeaves(setPayload.notificationPreferences);
    expect(leaves).toContain(JSON.stringify({ workout_reminder: false }));
    // It must NOT be a plain object literal — that would be the old
    // full-replace bug.
    expect(setPayload.notificationPreferences).not.toMatchObject({
      workout_reminder: false,
    });
    expect(setPayload.updatedAt).toBeInstanceOf(Date);
  });

  it("returns null when no profile row matched", async () => {
    const mockDb = {
      update: vi.fn().mockReturnValue(makeUpdateChain([])),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { ProfileRepository } = await import("../profileRepository");
    const repo = new ProfileRepository();
    const result = await repo.mergeNotificationPreferences("missing-user", {
      workout_reminder: true,
    });

    expect(result).toBeNull();
  });

  it("returns an empty object when the stored column was null but the row matched", async () => {
    // The COALESCE in the SQL forces the merge against '{}'::jsonb if
    // the column was null, so RETURNING never surfaces null — but
    // defensive-code-wise the repo treats a null notificationPreferences
    // as `{}` to give callers a stable shape.
    const mockDb = {
      update: vi
        .fn()
        .mockReturnValue(makeUpdateChain([{ notificationPreferences: null }])),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { ProfileRepository } = await import("../profileRepository");
    const repo = new ProfileRepository();
    const result = await repo.mergeNotificationPreferences("user-1", {});

    expect(result).toEqual({});
  });

  it("accepts an empty partial map (no-op merge)", async () => {
    const mockDb = {
      update: vi
        .fn()
        .mockReturnValue(makeUpdateChain([{ notificationPreferences: {} }])),
    };
    (getDb as any).mockReturnValue(mockDb);

    const { ProfileRepository } = await import("../profileRepository");
    const repo = new ProfileRepository();
    const result = await repo.mergeNotificationPreferences("user-1", {});

    expect(result).toEqual({});
    const updateChain = mockDb.update.mock.results[0].value;
    const setPayload = updateChain.set.mock.calls[0][0];
    const leaves = flattenSqlLeaves(setPayload.notificationPreferences);
    // Empty body still serialises into the bind so the SQL is valid;
    // the JSONB || with `{}` is a no-op on the stored column.
    expect(leaves).toContain("{}");
  });
});
