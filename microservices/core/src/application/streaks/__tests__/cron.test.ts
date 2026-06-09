import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UserStreak } from "@persistence/db";
import { streakCron, type StreakCronDataPort } from "../cron";
import type { StreakNotifier } from "../engine";

function makeStreak(overrides: Partial<UserStreak> = {}): UserStreak {
  return {
    id: "s1",
    userId: "u1",
    streakType: "habit_streak",
    sourceGoalId: "g1",
    period: "daily",
    currentCount: 5,
    longestCount: 5,
    lastPeriodEnd: "2026-06-09",
    freezeTokens: 0,
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as UserStreak;
}

function makeData(
  streaks: UserStreak[],
  tz = "Europe/London",
): StreakCronDataPort {
  return {
    getActiveStreaks: vi.fn(async () => streaks),
    getUserTimezone: vi.fn(async () => tz),
    persistFreezeSpend: vi.fn(async (id) => makeStreak({ id })),
    persistBreak: vi.fn(async (id) => makeStreak({ id, status: "broken" })),
  };
}

function makeNotifier(): StreakNotifier & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    notify: vi.fn(async (n) => {
      calls.push(n);
    }),
  };
}

// Wed 2026-06-10, London → daily last-completed = 2026-06-09
const NOW = new Date("2026-06-10T12:00:00Z");

describe("streakCron", () => {
  beforeEach(() => vi.clearAllMocks());

  it("skips streaks that are already up to date", async () => {
    const data = makeData([makeStreak({ lastPeriodEnd: "2026-06-09" })]);
    const notifier = makeNotifier();
    const summary = await streakCron({ data, notifier, now: NOW });
    expect(summary).toEqual({ swept: 1, upToDate: 1, frozen: 0, broken: 0 });
    expect(data.persistFreezeSpend).not.toHaveBeenCalled();
    expect(data.persistBreak).not.toHaveBeenCalled();
  });

  it("counts a streak advanced to today as up to date", async () => {
    const data = makeData([makeStreak({ lastPeriodEnd: "2026-06-10" })]);
    const summary = await streakCron({
      data,
      notifier: makeNotifier(),
      now: NOW,
    });
    expect(summary.upToDate).toBe(1);
  });

  it("spends one token for a single missed period and notifies", async () => {
    // lastPeriodEnd 06-08, daily, now 06-10 → last completed = 06-09 → 1 missed
    const data = makeData([
      makeStreak({ lastPeriodEnd: "2026-06-08", freezeTokens: 2 }),
    ]);
    const notifier = makeNotifier();
    const summary = await streakCron({ data, notifier, now: NOW });
    expect(summary).toEqual({ swept: 1, upToDate: 0, frozen: 1, broken: 0 });
    expect(data.persistFreezeSpend).toHaveBeenCalledWith("s1", {
      freezeTokens: 1,
      lastPeriodEnd: "2026-06-09",
    });
    expect(notifier.calls[0]).toMatchObject({
      type: "freeze_token_applied",
      data: { periodsMissed: 1, tokensSpent: 1, freezeTokensRemaining: 1 },
    });
  });

  it("spends ONE token PER missed period (N tokens for N periods)", async () => {
    // lastPeriodEnd 06-06 → missed 06-07/08/09 = 3 periods; 3 tokens cover them
    const data = makeData([
      makeStreak({ lastPeriodEnd: "2026-06-06", freezeTokens: 3 }),
    ]);
    const notifier = makeNotifier();
    const summary = await streakCron({ data, notifier, now: NOW });
    expect(summary).toEqual({ swept: 1, upToDate: 0, frozen: 1, broken: 0 });
    expect(data.persistFreezeSpend).toHaveBeenCalledWith("s1", {
      freezeTokens: 0,
      lastPeriodEnd: "2026-06-09",
    });
    expect(notifier.calls[0]).toMatchObject({
      data: { periodsMissed: 3, tokensSpent: 3, freezeTokensRemaining: 0 },
    });
  });

  it("breaks when there aren't enough tokens to cover every missed period", async () => {
    // 3 missed periods but only 1 token → can't cover all → break
    const data = makeData([
      makeStreak({ lastPeriodEnd: "2026-06-06", freezeTokens: 1 }),
    ]);
    const notifier = makeNotifier();
    const summary = await streakCron({ data, notifier, now: NOW });
    expect(summary).toEqual({ swept: 1, upToDate: 0, frozen: 0, broken: 1 });
    expect(data.persistBreak).toHaveBeenCalledWith("s1", {
      lastPeriodEnd: "2026-06-09",
    });
    expect(data.persistFreezeSpend).not.toHaveBeenCalled();
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it("breaks a missed streak with no tokens and does not notify", async () => {
    const data = makeData([
      makeStreak({ lastPeriodEnd: "2026-06-07", freezeTokens: 0 }),
    ]);
    const notifier = makeNotifier();
    const summary = await streakCron({ data, notifier, now: NOW });
    expect(summary).toEqual({ swept: 1, upToDate: 0, frozen: 0, broken: 1 });
    expect(data.persistBreak).toHaveBeenCalledWith("s1", {
      lastPeriodEnd: "2026-06-09",
    });
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it("memoises timezone per user across the sweep", async () => {
    const data = makeData([
      makeStreak({ id: "a", lastPeriodEnd: "2026-06-09" }),
      makeStreak({ id: "b", lastPeriodEnd: "2026-06-09" }),
    ]);
    await streakCron({ data, notifier: makeNotifier(), now: NOW });
    expect(data.getUserTimezone).toHaveBeenCalledTimes(1);
  });

  it("handles a weekly missed period boundary", async () => {
    const data = makeData([
      makeStreak({
        streakType: "workout_streak",
        period: "weekly",
        lastPeriodEnd: "2026-05-31", // missed the week ending 2026-06-07
        freezeTokens: 0,
      }),
    ]);
    const summary = await streakCron({
      data,
      notifier: makeNotifier(),
      now: NOW,
    });
    expect(summary.broken).toBe(1);
    expect(data.persistBreak).toHaveBeenCalledWith("s1", {
      lastPeriodEnd: "2026-06-07",
    });
  });
});
