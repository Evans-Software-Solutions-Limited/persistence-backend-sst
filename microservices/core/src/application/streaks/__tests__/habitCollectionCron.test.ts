/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../engine", () => ({ evaluateStreaks: vi.fn() }));
import { evaluateStreaks } from "../engine";
import { habitCollectionCron } from "../habitCollectionCron";
import type { UserStreak } from "@persistence/db";

// now = Wed 2026-06-10 (Europe/London). Last completed week: Mon 2026-06-01 →
// Sun 2026-06-07. Current week: Mon 2026-06-08 → Sun 2026-06-14.
const now = new Date("2026-06-10T09:00:00.000Z");
const notifier = { notify: vi.fn() };

function streak(o: Partial<UserStreak> = {}): UserStreak {
  return {
    id: "s1",
    userId: "u1",
    streakType: "habit_streak",
    sourceGoalId: null,
    period: "weekly",
    currentCount: 3,
    longestCount: 3,
    lastPeriodEnd: "2026-05-31",
    freezeTokens: 0,
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...o,
  } as UserStreak;
}

function makeData(over: Partial<any> = {}): any {
  return {
    getCollectionHabitStreakUserIds: vi.fn(async () => ["u1"]),
    getUserTimezone: vi.fn(async () => "Europe/London"),
    promoteHabitPendingEdits: vi.fn(async () => 0),
    getCollectionHabitStreak: vi.fn(async () => streak()),
    weekIntersectsHoliday: vi.fn(async () => false),
    getCollectionHabitAggregates: vi.fn(async () => []),
    persistHolidayPause: vi.fn(async () => streak({ status: "paused" })),
    persistHolidayResume: vi.fn(async () => streak({ status: "active" })),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (evaluateStreaks as any).mockResolvedValue({ advanced: [], milestones: [] });
});

describe("habitCollectionCron", () => {
  it("does nothing with no collection streaks", async () => {
    const data = makeData({
      getCollectionHabitStreakUserIds: vi.fn(async () => []),
    });
    const out = await habitCollectionCron({ data, notifier, now });
    expect(out.users).toBe(0);
    expect(evaluateStreaks).not.toHaveBeenCalled();
  });

  it("promotes pending edits for every user", async () => {
    const data = makeData({ promoteHabitPendingEdits: vi.fn(async () => 2) });
    const out = await habitCollectionCron({ data, notifier, now });
    expect(data.promoteHabitPendingEdits).toHaveBeenCalledWith("u1", now);
    expect(out.promoted).toBe(2);
  });

  it("pauses a behind streak whose completed week is a holiday, skips advance", async () => {
    const data = makeData({ weekIntersectsHoliday: vi.fn(async () => true) });
    const out = await habitCollectionCron({ data, notifier, now });
    expect(data.persistHolidayPause).toHaveBeenCalledWith("s1", {
      lastPeriodEnd: "2026-06-07",
      snapshotLastPeriodEnd: "2026-05-31",
    });
    expect(out.paused).toBe(1);
    expect(evaluateStreaks).not.toHaveBeenCalled();
  });

  it("does NOT pause a holiday week when already caught up", async () => {
    const data = makeData({
      weekIntersectsHoliday: vi.fn(async () => true),
      getCollectionHabitStreak: vi.fn(async () =>
        streak({ lastPeriodEnd: "2026-06-07" }),
      ),
    });
    const out = await habitCollectionCron({ data, notifier, now });
    expect(data.persistHolidayPause).not.toHaveBeenCalled();
    expect(out.paused).toBe(0);
  });

  it("resumes a paused streak once the holiday passes, then advances", async () => {
    const data = makeData({
      getCollectionHabitStreak: vi.fn(async () => streak({ status: "paused" })),
    });
    const out = await habitCollectionCron({ data, notifier, now });
    expect(data.persistHolidayResume).toHaveBeenCalledWith("s1");
    expect(out.resumed).toBe(1);
    expect(evaluateStreaks).toHaveBeenCalledWith(
      "u1",
      "habit_completed",
      now,
      { data, notifier },
      { localDate: "2026-06-07" },
    );
  });

  it("advances a satisfied just-completed week via the engine", async () => {
    (evaluateStreaks as any).mockResolvedValue({
      advanced: [{ id: "s1" }],
      milestones: [],
    });
    const data = makeData();
    const out = await habitCollectionCron({ data, notifier, now });
    expect(out.advanced).toBe(1);
  });

  it("emits streak_at_risk mid-week when a habit is doomed + no token", async () => {
    const data = makeData({
      // caught up after the (no-op) advance; no tokens.
      getCollectionHabitStreak: vi.fn(async () =>
        streak({ lastPeriodEnd: "2026-06-07", freezeTokens: 0 }),
      ),
      getCollectionHabitAggregates: vi.fn(async () => [
        {
          goalId: "gym",
          completionRule: "count",
          targetValue: 8, // 5 days left → 0 + 5 < 8 → doomed
          daysPerWeek: null,
          tolerancePct: null,
          qualifyingDays: 0,
          sessionCount: 0,
        },
      ]),
    });
    const out = await habitCollectionCron({ data, notifier, now });
    expect(out.atRisk).toBe(1);
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: "streak_at_risk", userId: "u1" }),
    );
  });

  it("does NOT emit at-risk when a token is queued", async () => {
    const data = makeData({
      getCollectionHabitStreak: vi.fn(async () =>
        streak({ lastPeriodEnd: "2026-06-07", freezeTokens: 1 }),
      ),
      getCollectionHabitAggregates: vi.fn(async () => [
        {
          goalId: "gym",
          completionRule: "count",
          targetValue: 3,
          daysPerWeek: null,
          tolerancePct: null,
          qualifyingDays: 0,
          sessionCount: 0,
        },
      ]),
    });
    const out = await habitCollectionCron({ data, notifier, now });
    expect(out.atRisk).toBe(0);
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it("isolates a per-user failure (counts failed, continues)", async () => {
    const data = makeData({
      getCollectionHabitStreakUserIds: vi.fn(async () => ["u1", "u2"]),
      promoteHabitPendingEdits: vi.fn(async (u: string) => {
        if (u === "u1") throw new Error("boom");
        return 0;
      }),
    });
    const out = await habitCollectionCron({ data, notifier, now });
    expect(out.failed).toBe(1);
    expect(out.users).toBe(2);
  });
});
