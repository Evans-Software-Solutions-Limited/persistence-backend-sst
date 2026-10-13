/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";
import {
  BOOTSTRAP_CONCURRENCY,
  loadBootstrap,
  type BootstrapDeps,
  type BootstrapRequest,
} from "../loadBootstrap";
import { BOOTSTRAP_SECTIONS } from "../sections";

const NOW = new Date("2026-10-12T10:00:00.000Z");

function deps(overrides: Partial<Record<string, any>> = {}): BootstrapDeps {
  const d: any = {
    VolumeRepository: {
      getUserTimezone: vi.fn(async () => "Europe/London"),
      dailyVolume: vi.fn(async () => []),
      totalVolume: vi.fn(async () => 100),
      completedSessionCount: vi.fn(async () => 2),
      recomputeVolumeByMuscle: vi.fn(async () => undefined),
      getVolumeByMuscle: vi.fn(async () => []),
    },
    HomeReadRepository: {
      getUserTimezone: vi.fn(async () => "Europe/London"),
      ensureProgrammeMaterialized: vi.fn(async () => undefined),
      getTodaySteps: vi.fn(async () => 1000),
      getTodayActiveKcal: vi.fn(async () => 200),
      getActiveWorkoutStreakCount: vi.fn(async () => 3),
      getRecentPRs: vi.fn(async (_u: string, limit: number) => [
        { id: `pr-${limit}` },
      ]),
      getActiveProgramme: vi.fn(async () => null),
      getTodaysTraining: vi.fn(async () => []),
      getAchievements: vi.fn(async () => [{ id: "ua1" }]),
      getBodyTrend: vi.fn(async () => [{ date: "2026-10-01" }]),
    },
    HabitConfigRepository: {
      getActiveDailyTarget: vi.fn(async () => null),
      getActiveTarget: vi.fn(async () => null),
      listForUser: vi.fn(async () => []),
      isHabitCoachLocked: vi.fn(async () => false),
    },
    HabitRepository: { list: vi.fn(async () => [{ id: "hc1" }]) },
    StreakRepository: {
      getDerivedHabitGridRows: vi.fn(async () => []),
      getUserTimezone: vi.fn(async () => "Europe/London"),
      getDerivedHabitCompletions: vi.fn(async () => [{ id: "derived-1" }]),
      getActiveStreaksForUser: vi.fn(async () => [{ id: "s1" }]),
    },
    NutritionEntryRepository: { sumKcalForDay: vi.fn(async () => 0) },
    NutritionTargetRepository: { get: vi.fn(async () => null) },
    SleepRepository: { getForDate: vi.fn(async () => null) },
    ProfileRepository: {
      getProfilePageData: vi.fn(async () => ({ profile: { id: "u1" } })),
    },
    WorkoutRepository: {
      list: vi.fn(async (_u: string, f: any) => ({
        workouts: [{ id: `${f.type}-w` }],
        total: 1,
        ...(f.type === "mine" ? { quota: { used: 1, limit: 3 } } : {}),
      })),
    },
    NotificationRepository: {
      countUnread: vi.fn(async () => 4),
      list: vi.fn(async () => ({ rows: [{ id: "n1" }], nextCursor: null })),
    },
    OnboardingStateRepository: { get: vi.fn(async () => null) },
    ExerciseRepository: {
      getMuscleGroups: vi.fn(async () => [
        { id: "m1", name: "chest", displayName: "Chest" },
      ]),
      getEquipmentTypes: vi.fn(async () => [
        { id: "e1", name: "barbell", category: null },
      ]),
    },
    subscriptions: { findForUser: vi.fn(async () => ({ tierName: "free" })) },
    tiers: {
      listActive: vi.fn(async () => [
        {
          tierName: "premium",
          displayName: "Premium",
          description: null,
          priceMonthly: "9.99",
          priceYearly: "99.00",
          currency: "GBP",
          features: {},
          workoutLimit: null,
          aiAccess: true,
          aiWorkoutLimit: 0,
          gymBuddyAccess: true,
          trainerClientLimit: null,
          isTrainerTier: false,
          analyticsAccess: true,
          exportAccess: true,
          stripePriceIdMonthly: null,
          stripePriceIdYearly: null,
        },
      ]),
    },
    founding: { applyPendingForUser: vi.fn(async () => false) },
    assertEntitlement: vi.fn(async () => ({ allowed: true })),
    reconcileWorkoutStreak: vi.fn(async () => undefined),
    ...overrides,
  };
  return d;
}

const request = (
  sections: BootstrapRequest["sections"] = BOOTSTRAP_SECTIONS,
): BootstrapRequest => ({
  userId: "u1",
  email: "a@b.c",
  sections,
  ownerLibraryOnly: true,
  now: NOW,
});

describe("loadBootstrap", () => {
  it("answers every section the way its single endpoint does", async () => {
    const d = deps();
    const out = await loadBootstrap(d, request());
    expect(out.generatedAt).toBe(NOW.toISOString());
    expect(Object.keys(out.sections)).toEqual([...BOOTSTRAP_SECTIONS]);
    for (const key of BOOTSTRAP_SECTIONS)
      expect(out.sections[key]?.ok).toBe(true);
    const value = (k: string) => (out.sections as any)[k].value;
    expect(value("home")).toMatchObject({
      rings: expect.anything(),
      micro: { streak: 3 },
    });
    expect(value("profile")).toEqual({ profile: { id: "u1" } });
    expect(value("subscription")).toEqual({ tierName: "free" });
    expect(d.founding.applyPendingForUser).toHaveBeenCalledWith("u1", "a@b.c");
    expect(value("tiers")[0]).toMatchObject({
      tierName: "premium",
      priceMonthly: 9.99,
    });
    expect(value("onboarding")).toBeNull();
    expect(value("workouts")).toEqual({
      mine: {
        workouts: [{ id: "mine-w" }],
        total: 1,
        quota: { used: 1, limit: 3 },
      },
      assigned: { workouts: [{ id: "assigned-w" }], total: 1 },
      default: { workouts: [{ id: "default-w" }], total: 1 },
    });
    expect(d.assertEntitlement).toHaveBeenCalledTimes(1);
    expect(d.WorkoutRepository.list).toHaveBeenCalledWith("u1", {
      type: "mine",
      limit: 20,
      offset: 0,
      ownerLibraryOnly: true,
      includeLoadoutVariations: true,
    });
    expect(d.WorkoutRepository.list).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ type: "assigned", ownerLibraryOnly: false }),
    );
    expect(value("notifications")).toEqual({
      rows: [{ id: "n1" }],
      nextCursor: null,
      unreadCount: 4,
    });
    expect(d.NotificationRepository.list).toHaveBeenCalledWith("u1", {
      limit: 50,
      unreadOnly: true,
    });
    expect(value("habitConfig")).toHaveLength(value("habitConfig").length);
    expect(value("habitCompletions")).toEqual([
      { id: "hc1" },
      { id: "derived-1" },
    ]);
    expect(value("streaks")).toEqual([{ id: "s1" }]);
    expect(value("achievements")).toEqual([{ id: "ua1" }]);
    expect(d.reconcileWorkoutStreak).toHaveBeenCalledWith("u1");
    expect(value("volumeStats")).toMatchObject({
      window: "month",
      workouts: 2,
      totalKg: 100,
    });
    expect(value("bodyTrend")).toEqual([{ date: "2026-10-01" }]);
    expect(d.HomeReadRepository.getBodyTrend).toHaveBeenCalledWith(
      "u1",
      30,
      "Europe/London",
    );
    expect(value("recentPRs")).toEqual([{ id: "pr-20" }]);
    expect(value("muscleGroups")).toEqual([
      { id: "m1", name: "chest", display_name: "Chest" },
    ]);
    expect(value("equipment")).toEqual([
      { id: "e1", name: "barbell", display_name: null, category: null },
    ]);
  });

  it("returns only the requested sections, in canonical order", async () => {
    const out = await loadBootstrap(deps(), request(["tiers", "home"]));
    expect(Object.keys(out.sections)).toEqual(["home", "tiers"]);
  });

  it("isolates a failing section and reports missing profile and subscription as not_found", async () => {
    const d = deps({
      ProfileRepository: { getProfilePageData: vi.fn(async () => null) },
      subscriptions: { findForUser: vi.fn(async () => null) },
      StreakRepository: {
        getDerivedHabitGridRows: vi.fn(async () => []),
        getUserTimezone: vi.fn(async () => "Europe/London"),
        getDerivedHabitCompletions: vi.fn(async () => []),
        getActiveStreaksForUser: vi.fn(async () => {
          throw new Error("db down");
        }),
      },
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await loadBootstrap(
      d,
      request(["profile", "subscription", "streaks", "tiers"]),
    );
    expect(out.sections.profile).toEqual({ ok: false, error: "not_found" });
    expect(out.sections.subscription).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(out.sections.streaks).toEqual({ ok: false, error: "db down" });
    expect(out.sections.tiers?.ok).toBe(true);
    errors.mockRestore();
  });

  it("reports a non-Error throw as failed", async () => {
    const d = deps({
      OnboardingStateRepository: {
        get: vi.fn(async () => {
          throw "boom";
        }),
      },
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await loadBootstrap(d, request(["onboarding"]));
    expect(out.sections.onboarding).toEqual({ ok: false, error: "failed" });
    errors.mockRestore();
  });

  it("never runs more than the concurrency bound at once", async () => {
    let active = 0;
    let peak = 0;
    const gate = async <T>(value: T) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      return value;
    };
    const d = deps({
      StreakRepository: {
        getDerivedHabitGridRows: vi.fn(async () => []),
        getUserTimezone: vi.fn(async () => "Europe/London"),
        getDerivedHabitCompletions: vi.fn(async () => []),
        getActiveStreaksForUser: vi.fn(() => gate([])),
      },
      OnboardingStateRepository: { get: vi.fn(() => gate(null)) },
      subscriptions: { findForUser: vi.fn(() => gate({ tierName: "free" })) },
      ProfileRepository: { getProfilePageData: vi.fn(() => gate({})) },
      ExerciseRepository: {
        getMuscleGroups: vi.fn(() => gate([])),
        getEquipmentTypes: vi.fn(() => gate([])),
      },
    });
    const out = await loadBootstrap(
      d,
      request([
        "profile",
        "subscription",
        "onboarding",
        "streaks",
        "muscleGroups",
        "equipment",
      ]),
      2,
    );
    expect(Object.values(out.sections).every((s) => s?.ok)).toBe(true);
    expect(peak).toBeLessThanOrEqual(2);
    expect(BOOTSTRAP_CONCURRENCY).toBeGreaterThan(0);
  });
});
