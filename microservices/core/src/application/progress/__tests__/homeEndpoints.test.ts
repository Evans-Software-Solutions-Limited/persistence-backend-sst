/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const volMock = vi.hoisted(() => ({
  getUserTimezone: vi.fn(async () => "Europe/London"),
  totalVolume: vi.fn(async () => 8400),
  dailyVolume: vi.fn(async () => [] as any[]),
  completedSessionCount: vi.fn(async () => 4),
}));
const homeMock = vi.hoisted(() => ({
  getUserTimezone: vi.fn(async () => "Europe/London"),
  getTodaySteps: vi.fn(async () => 7420),
  getActiveWorkoutStreakCount: vi.fn(async () => 23),
  getRecentPRs: vi.fn(async () => [{ id: "pr1" }] as any[]),
  getBodyTrend: vi.fn(async () => [{ date: "2026-06-01" }] as any[]),
  getAchievements: vi.fn(async () => [{ id: "ua1" }] as any[]),
  ensureProgrammeMaterialized: vi.fn(async () => undefined),
  getActiveProgramme: vi.fn(async () => ({
    assignmentId: "pa1",
    programId: "p1",
    name: "Strength Foundations",
    week: 4,
    totalWeeks: 12,
    endDate: "2026-08-01",
    startDate: "2026-05-01",
  })),
  getTodaysTraining: vi.fn(async () => [
    {
      assignmentId: "wa1",
      workoutId: "w1",
      name: "Upper Body",
      estimatedDurationMinutes: 45,
      dueDate: "2026-06-10",
      assignedByType: "personal_trainer",
    },
  ]),
}));
const habitMock = vi.hoisted(() => ({ list: vi.fn(async () => [] as any[]) }));
const nutEntryMock = vi.hoisted(() => ({
  sumKcalForDay: vi.fn(async () => 1200),
}));
const nutTargetMock = vi.hoisted(() => ({
  // Default: no target → Fuel ring stays gated (matches the assertions below).
  get: vi.fn(async () => null as any),
}));
const streakMock = vi.hoisted(() => ({
  spendTokenManually: vi.fn(async () => ({ id: "s1", freezeTokens: 1 })),
  getActiveStreaksForUser: vi.fn(async () => [
    { id: "s1", streakType: "workout_streak", currentCount: 4 },
  ]),
}));

vi.mock("../../repositories/volumeRepository", () => ({
  VolumeRepository: vi.fn().mockImplementation(() => volMock),
}));
vi.mock("../../repositories/homeReadRepository", () => ({
  HomeReadRepository: vi.fn().mockImplementation(() => homeMock),
}));
vi.mock("../../repositories/habitRepository", () => ({
  HabitRepository: vi.fn().mockImplementation(() => habitMock),
}));
vi.mock("../../repositories/streakRepository", () => ({
  StreakRepository: vi.fn().mockImplementation(() => streakMock),
}));
vi.mock("../../repositories/nutritionEntryRepository", () => ({
  NutritionEntryRepository: vi.fn().mockImplementation(() => nutEntryMock),
}));
vi.mock("../../repositories/nutritionTargetRepository", () => ({
  NutritionTargetRepository: vi.fn().mockImplementation(() => nutTargetMock),
}));
vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (h: string | undefined) =>
    h?.startsWith("Bearer ")
      ? { sub: "u1", email: "e", email_verified: true, iat: 0, exp: 9e9 }
      : null,
  ),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx: any) => ctx.user ?? { sub: "u1" }),
}));

const AUTH = { authorization: "Bearer t" };

import { getTodayRingsHandler } from "../getTodayRingsHandler";
import { getHomeHandler } from "../getHomeHandler";
import { getRecentPRsHandler } from "../getRecentPRsHandler";
import {
  getBodyTrendHandler,
  parseBodyTrendWindow,
} from "../getBodyTrendHandler";
import { getAchievementsHandler } from "../getAchievementsHandler";
import { useFreezeTokenHandler } from "../useFreezeTokenHandler";
import { getStreaksHandler } from "../getStreaksHandler";

describe("Home/You endpoints", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET /users/me/today-rings returns the ring data", async () => {
    const res = await getTodayRingsHandler.handle(
      new Request("http://localhost/users/me/today-rings", { headers: AUTH }),
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as any;
    expect(data.move.current).toBe(7420);
    expect(data.fuel).toBe("gated");
  });

  it("GET /users/me/today-rings makes Fuel live once a daily kcal target is set", async () => {
    nutTargetMock.get.mockResolvedValueOnce({ dailyKcal: 2000 } as any);
    nutEntryMock.sumKcalForDay.mockResolvedValueOnce(1500);
    const res = await getTodayRingsHandler.handle(
      new Request("http://localhost/users/me/today-rings", { headers: AUTH }),
    );
    const { data } = (await res.json()) as any;
    expect(data.fuel).toEqual({
      current: 1500,
      target: 2000,
      pct: 0.75,
      unit: "kcal",
    });
  });

  it("GET /users/me/home aggregates rings + micro + volume + PRs + habits", async () => {
    // Distinct per-window values prove the ring's train.current AND the card's
    // totalKg both read the SAME this-week total (8400), and the call-count
    // assertion proves it's queried ONCE — not duplicated across loadRings +
    // the card as it used to be (Inspector finding, PR #116).
    volMock.totalVolume
      .mockResolvedValueOnce(8400) // this week
      .mockResolvedValueOnce(7000); // last week
    const res = await getHomeHandler.handle(
      new Request("http://localhost/users/me/home", { headers: AUTH }),
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as any;
    expect(data.rings.train.current).toBe(8400);
    expect(data.weeklyVolume.totalKg).toBe(8400);
    // Exactly two totalVolume round-trips: this week + last week. (Was three —
    // loadRings re-issued the this-week query.)
    expect(volMock.totalVolume).toHaveBeenCalledTimes(2);
    expect(data.micro.streak).toBe(23);
    expect(data.weeklyVolume.workouts).toEqual({ completed: 4, target: 5 });
    expect(data.recentPRs).toHaveLength(1);
    expect(Array.isArray(data.habits)).toBe(true);
    // specs/19-programs STORY-005 — programme slices are topped up first, then
    // surfaced on the aggregate.
    expect(homeMock.ensureProgrammeMaterialized).toHaveBeenCalledWith(
      "u1",
      expect.any(String),
    );
    expect(data.activeProgramme).toMatchObject({
      programId: "p1",
      week: 4,
      totalWeeks: 12,
    });
    expect(data.todaysTraining).toHaveLength(1);
    expect(data.todaysTraining[0]).toMatchObject({
      workoutId: "w1",
      assignedByType: "personal_trainer",
    });
  });

  it("GET /users/me/home survives a programme top-up failure", async () => {
    homeMock.ensureProgrammeMaterialized.mockRejectedValueOnce(
      new Error("neon timeout"),
    );
    const res = await getHomeHandler.handle(
      new Request("http://localhost/users/me/home", { headers: AUTH }),
    );
    // The top-up is best-effort — the Home render must not 500 on its failure.
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as any;
    expect(data.rings).toBeDefined();
  });

  it("GET /users/me/prs parses limit (default 5, cap 50)", async () => {
    await getRecentPRsHandler.handle(
      new Request("http://localhost/users/me/prs?limit=20", { headers: AUTH }),
    );
    expect(homeMock.getRecentPRs).toHaveBeenCalledWith("u1", 20);
    await getRecentPRsHandler.handle(
      new Request("http://localhost/users/me/prs?limit=999", { headers: AUTH }),
    );
    expect(homeMock.getRecentPRs).toHaveBeenCalledWith("u1", 50);
    await getRecentPRsHandler.handle(
      new Request("http://localhost/users/me/prs", { headers: AUTH }),
    );
    expect(homeMock.getRecentPRs).toHaveBeenCalledWith("u1", 5);
  });

  it("GET /users/me/body-trend parses the window", async () => {
    const res = await getBodyTrendHandler.handle(
      new Request("http://localhost/users/me/body-trend?window=90d", {
        headers: AUTH,
      }),
    );
    expect(res.status).toBe(200);
    expect(homeMock.getBodyTrend).toHaveBeenCalledWith(
      "u1",
      90,
      "Europe/London",
    );
  });

  it("GET /users/me/achievements returns unlocked achievements", async () => {
    const res = await getAchievementsHandler.handle(
      new Request("http://localhost/users/me/achievements", { headers: AUTH }),
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as any;
    expect(data).toHaveLength(1);
  });

  it("POST use-token spends a token (200) or 400 when none", async () => {
    const ok = await useFreezeTokenHandler.handle(
      new Request("http://localhost/users/me/streaks/s1/use-token", {
        method: "POST",
        headers: AUTH,
      }),
    );
    expect(ok.status).toBe(200);
    expect(streakMock.spendTokenManually).toHaveBeenCalledWith("u1", "s1");

    streakMock.spendTokenManually.mockResolvedValueOnce(null as any);
    const denied = await useFreezeTokenHandler.handle(
      new Request("http://localhost/users/me/streaks/s1/use-token", {
        method: "POST",
        headers: AUTH,
      }),
    );
    expect(denied.status).toBe(400);
  });

  it("GET /users/me/streaks returns the user's active streaks", async () => {
    const res = await getStreaksHandler.handle(
      new Request("http://localhost/users/me/streaks", { headers: AUTH }),
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as any;
    expect(data[0].streakType).toBe("workout_streak");
    expect(streakMock.getActiveStreaksForUser).toHaveBeenCalledWith("u1");
  });

  it("requires authentication", async () => {
    const res = await getAchievementsHandler.handle(
      new Request("http://localhost/users/me/achievements"),
    );
    expect(res.status).toBe(401);
  });
});

describe("parseBodyTrendWindow", () => {
  it("parses Nd, defaults to 30, caps at 366", () => {
    expect(parseBodyTrendWindow("90d")).toBe(90);
    expect(parseBodyTrendWindow(undefined)).toBe(30);
    expect(parseBodyTrendWindow("nope")).toBe(30);
    expect(parseBodyTrendWindow("0d")).toBe(30);
    expect(parseBodyTrendWindow("999d")).toBe(366);
  });
});
