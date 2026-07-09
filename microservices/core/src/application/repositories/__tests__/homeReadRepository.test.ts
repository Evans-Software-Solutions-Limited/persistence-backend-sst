/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));

import { getDb } from "@persistence/db/client";
import { HomeReadRepository } from "../homeReadRepository";

function chain(result: unknown) {
  const c: any = {};
  for (const k of [
    "from",
    "innerJoin",
    "leftJoin",
    "where",
    "orderBy",
    "limit",
  ]) {
    c[k] = () => c;
  }
  c.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
  return c;
}

describe("HomeReadRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getTodaySteps sums today's steps, 0 when none", async () => {
    (getDb as any).mockReturnValue({ select: () => chain([{ s: 7420 }]) });
    expect(
      await new HomeReadRepository().getTodaySteps("u1", "2026-06-10"),
    ).toBe(7420);
    (getDb as any).mockReturnValue({ select: () => chain([]) });
    expect(
      await new HomeReadRepository().getTodaySteps("u1", "2026-06-10"),
    ).toBe(0);
  });

  it("getActiveWorkoutStreakCount returns the count or 0", async () => {
    (getDb as any).mockReturnValue({ select: () => chain([{ c: 23 }]) });
    expect(
      await new HomeReadRepository().getActiveWorkoutStreakCount("u1"),
    ).toBe(23);
    (getDb as any).mockReturnValue({ select: () => chain([]) });
    expect(
      await new HomeReadRepository().getActiveWorkoutStreakCount("u1"),
    ).toBe(0);
  });

  it("getRecentPRs maps rows + ISO-formats achievedAt", async () => {
    (getDb as any).mockReturnValue({
      select: () =>
        chain([
          {
            id: "pr1",
            exerciseId: "e1",
            exerciseName: "Bench Press",
            recordType: "1rm",
            value: "100.00",
            achievedAt: new Date("2026-06-07T10:00:00Z"),
          },
        ]),
    });
    const prs = await new HomeReadRepository().getRecentPRs("u1", 5);
    expect(prs[0]).toEqual({
      id: "pr1",
      exerciseId: "e1",
      exerciseName: "Bench Press",
      recordType: "1rm",
      value: 100,
      achievedAt: "2026-06-07T10:00:00.000Z",
    });
  });

  it("getAchievements maps rows + handles null requirements/unlockedAt", async () => {
    (getDb as any).mockReturnValue({
      select: () =>
        chain([
          {
            id: "ua1",
            achievementId: "a1",
            name: "Workout Streak — 4 weeks",
            description: null,
            category: "streak",
            requirements: { streak_type: "workout_streak", threshold: 4 },
            unlockedAt: null,
          },
        ]),
    });
    const rows = await new HomeReadRepository().getAchievements("u1");
    expect(rows[0]).toMatchObject({
      achievementId: "a1",
      category: "streak",
      requirements: { threshold: 4 },
      unlockedAt: null,
    });
  });

  it("getBodyTrend maps series with date + numeric/null fields", async () => {
    (getDb as any).mockReturnValue({
      select: () =>
        chain([
          {
            measuredAt: new Date("2026-06-01T08:00:00Z"),
            weightKg: "82.50",
            bodyFat: null,
          },
        ]),
    });
    // 08:00 UTC on 06-01 is still 06-01 in Sydney (UTC+10/11) → user-local
    // bucketing keeps the date stable here.
    const series = await new HomeReadRepository().getBodyTrend(
      "u1",
      30,
      "Australia/Sydney",
    );
    expect(series[0]).toEqual({
      date: "2026-06-01",
      weightKg: 82.5,
      bodyFat: null,
    });
  });

  it("getBodyTrend buckets the date by user-local day, not UTC", async () => {
    (getDb as any).mockReturnValue({
      select: () =>
        chain([
          {
            // 22:00 UTC 06-01 = 08:00 06-02 in Sydney → local day is 06-02.
            measuredAt: new Date("2026-06-01T22:00:00Z"),
            weightKg: "80.00",
            bodyFat: null,
          },
        ]),
    });
    const series = await new HomeReadRepository().getBodyTrend(
      "u1",
      30,
      "Australia/Sydney",
    );
    expect(series[0].date).toBe("2026-06-02");
  });

  it("getTodaysTraining maps occurrences + derives assignedByType/name from the trainer profile", async () => {
    (getDb as any).mockReturnValue({
      select: () =>
        chain([
          {
            assignmentId: "wa1",
            workoutId: "w1",
            name: "Upper Body",
            estimatedDurationMinutes: 45,
            dueDate: "2026-06-10",
            trainerRole: "personal_trainer",
            trainerName: "Bradley Evans",
          },
          {
            assignmentId: "wa2",
            workoutId: "w2",
            name: "Rehab Flow",
            estimatedDurationMinutes: null,
            dueDate: null,
            trainerRole: "physiotherapist",
            trainerName: "Jane Physio",
          },
          {
            assignmentId: "wa3",
            workoutId: "w3",
            name: "Self Push",
            estimatedDurationMinutes: 30,
            dueDate: "2026-06-11",
            // No trainer profile joined (self/ad-hoc) → null attribution.
            trainerRole: null,
            trainerName: null,
          },
        ]),
    });
    const items = await new HomeReadRepository().getTodaysTraining("u1");
    expect(items).toEqual([
      {
        assignmentId: "wa1",
        workoutId: "w1",
        name: "Upper Body",
        estimatedDurationMinutes: 45,
        dueDate: "2026-06-10",
        assignedByType: "personal_trainer",
        assignedByName: "Bradley Evans",
      },
      {
        assignmentId: "wa2",
        workoutId: "w2",
        name: "Rehab Flow",
        estimatedDurationMinutes: null,
        dueDate: null,
        assignedByType: "physiotherapist",
        assignedByName: "Jane Physio",
      },
      {
        assignmentId: "wa3",
        workoutId: "w3",
        name: "Self Push",
        estimatedDurationMinutes: 30,
        dueDate: "2026-06-11",
        assignedByType: null,
        assignedByName: null,
      },
    ]);
  });

  it("getActiveProgramme + ensureProgrammeMaterialized delegate to the assignment repo", async () => {
    const repo = new HomeReadRepository();
    const summary = {
      assignmentId: "pa1",
      programId: "p1",
      name: "Strength Foundations",
      week: 4,
      totalWeeks: 12,
      endDate: "2026-08-01",
      startDate: "2026-05-01",
      assignedByName: "Bradley Evans",
    };
    const ensureMaterializedForClient = vi.fn().mockResolvedValue(undefined);
    const getActiveProgrammeForClient = vi.fn().mockResolvedValue(summary);
    (repo as any).programAssignmentRepository = {
      ensureMaterializedForClient,
      getActiveProgrammeForClient,
    };

    await repo.ensureProgrammeMaterialized("u1", "2026-06-10");
    expect(ensureMaterializedForClient).toHaveBeenCalledWith(
      "u1",
      "2026-06-10",
    );

    const active = await repo.getActiveProgramme("u1", "2026-06-10");
    expect(getActiveProgrammeForClient).toHaveBeenCalledWith(
      "u1",
      "2026-06-10",
    );
    expect(active).toEqual(summary);
  });

  it("getUserTimezone returns the profile tz, default Europe/London", async () => {
    (getDb as any).mockReturnValue({
      select: () => chain([{ tz: "America/New_York" }]),
    });
    expect(await new HomeReadRepository().getUserTimezone("u1")).toBe(
      "America/New_York",
    );
    (getDb as any).mockReturnValue({ select: () => chain([]) });
    expect(await new HomeReadRepository().getUserTimezone("u1")).toBe(
      "Europe/London",
    );
  });
});
