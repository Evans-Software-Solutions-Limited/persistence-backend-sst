import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UserStreak } from "@persistence/db";
import {
  evaluateStreaks,
  milestoneMessage,
  EVENT_TO_STREAK_TYPE,
  type StreakDataPort,
  type StreakNotifier,
  type StreakAdvanceFields,
} from "../engine";

function makeStreak(overrides: Partial<UserStreak> = {}): UserStreak {
  return {
    id: "s1",
    userId: "u1",
    streakType: "habit_streak",
    sourceGoalId: "g1",
    period: "daily",
    currentCount: 0,
    longestCount: 0,
    lastPeriodEnd: "2026-06-06",
    freezeTokens: 0,
    status: "active",
    createdAt: new Date("2026-06-01T00:00:00Z"),
    updatedAt: new Date("2026-06-01T00:00:00Z"),
    ...overrides,
  } as UserStreak;
}

type FakeData = StreakDataPort & {
  _persisted: StreakAdvanceFields[];
};

function makeData(opts: {
  streaks: UserStreak[];
  satisfied?: boolean;
  tz?: string;
  unlock?: Awaited<ReturnType<StreakDataPort["unlockAchievement"]>>;
}): FakeData {
  const persisted: StreakAdvanceFields[] = [];
  return {
    _persisted: persisted,
    getUserTimezone: vi.fn(async () => opts.tz ?? "Europe/London"),
    getActiveStreaksByType: vi.fn(async () => opts.streaks),
    isPeriodSatisfied: vi.fn(async () => opts.satisfied ?? true),
    persistAdvance: vi.fn(async (id: string, fields: StreakAdvanceFields) => {
      persisted.push(fields);
      return makeStreak({ id, ...fields });
    }),
    unlockAchievement: vi.fn(async () =>
      opts.unlock === undefined
        ? { achievementId: "a1", newlyUnlocked: true }
        : opts.unlock,
    ),
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

const TS = new Date("2026-06-07T12:00:00Z"); // Sunday, London

describe("evaluateStreaks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps each event type to its streak type", () => {
    expect(EVENT_TO_STREAK_TYPE.workout_logged).toBe("workout_streak");
    expect(EVENT_TO_STREAK_TYPE.habit_completed).toBe("habit_streak");
    expect(EVENT_TO_STREAK_TYPE.measurement_logged).toBe("measurement_streak");
    expect(EVENT_TO_STREAK_TYPE.nutrition_in_target).toBe("nutrition_streak");
  });

  it("returns empty and skips tz lookup when no streaks match", async () => {
    const data = makeData({ streaks: [] });
    const notifier = makeNotifier();
    const result = await evaluateStreaks("u1", "habit_completed", TS, {
      data,
      notifier,
    });
    expect(result).toEqual({ advanced: [], milestones: [] });
    expect(data.getUserTimezone).not.toHaveBeenCalled();
  });

  it("advances a satisfied streak into a new period", async () => {
    const data = makeData({ streaks: [makeStreak()], satisfied: true });
    const notifier = makeNotifier();
    const result = await evaluateStreaks("u1", "habit_completed", TS, {
      data,
      notifier,
    });
    expect(data._persisted[0]).toEqual({
      currentCount: 1,
      longestCount: 1,
      lastPeriodEnd: "2026-06-07",
      freezeTokens: 0,
    });
    expect(result.advanced).toHaveLength(1);
    // count 1 is not a daily milestone (7,14,…) → no notification
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it("is idempotent — no advance when the period is already counted", async () => {
    const data = makeData({
      streaks: [makeStreak({ lastPeriodEnd: "2026-06-07" })],
    });
    const notifier = makeNotifier();
    const result = await evaluateStreaks("u1", "habit_completed", TS, {
      data,
      notifier,
    });
    expect(data.persistAdvance).not.toHaveBeenCalled();
    expect(result.advanced).toHaveLength(0);
  });

  it("does not advance when the period threshold is unmet", async () => {
    const data = makeData({ streaks: [makeStreak()], satisfied: false });
    const notifier = makeNotifier();
    await evaluateStreaks("u1", "habit_completed", TS, { data, notifier });
    expect(data.persistAdvance).not.toHaveBeenCalled();
  });

  it("unlocks a milestone + emits streak_milestone when a tier is crossed", async () => {
    // weekly workout streak advancing 0→1 crosses the 1-week tier
    const data = makeData({
      streaks: [
        makeStreak({
          streakType: "workout_streak",
          period: "weekly",
          sourceGoalId: null,
        }),
      ],
    });
    const notifier = makeNotifier();
    const result = await evaluateStreaks("u1", "workout_logged", TS, {
      data,
      notifier,
    });
    expect(result.milestones).toEqual([
      {
        streakId: "s1",
        streakType: "workout_streak",
        threshold: 1,
        achievementId: "a1",
      },
    ]);
    expect(notifier.notify).toHaveBeenCalledTimes(1);
    expect(notifier.calls[0]).toMatchObject({
      type: "streak_milestone",
      relatedEntityId: "s1",
      data: { threshold: 1, streakType: "workout_streak" },
    });
  });

  it("does not re-notify when the achievement was already unlocked", async () => {
    const data = makeData({
      streaks: [makeStreak({ streakType: "workout_streak", period: "weekly" })],
      unlock: { achievementId: "a1", newlyUnlocked: false },
    });
    const notifier = makeNotifier();
    const result = await evaluateStreaks("u1", "workout_logged", TS, {
      data,
      notifier,
    });
    expect(result.advanced).toHaveLength(1);
    expect(result.milestones).toHaveLength(0);
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it("tolerates a missing seeded achievement (unlock returns null)", async () => {
    const data = makeData({
      streaks: [makeStreak({ streakType: "workout_streak", period: "weekly" })],
      unlock: null,
    });
    const notifier = makeNotifier();
    const result = await evaluateStreaks("u1", "workout_logged", TS, {
      data,
      notifier,
    });
    expect(result.advanced).toHaveLength(1);
    expect(result.milestones).toHaveLength(0);
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it("earns a freeze token on the 4th period and keeps longest", async () => {
    const data = makeData({
      streaks: [
        makeStreak({
          streakType: "workout_streak",
          period: "weekly",
          currentCount: 3,
          longestCount: 10,
          freezeTokens: 0,
        }),
      ],
    });
    const notifier = makeNotifier();
    await evaluateStreaks("u1", "workout_logged", TS, { data, notifier });
    expect(data._persisted[0]).toMatchObject({
      currentCount: 4,
      longestCount: 10, // preserved (3+1 < 10)
      freezeTokens: 1, // 4th period → +1
    });
  });

  it("spends one token per missed period in the gap before advancing", async () => {
    // lastPeriodEnd 06-04, event on 06-07 → gap = 06-05 + 06-06 = 2 missed.
    const data = makeData({
      streaks: [
        makeStreak({
          currentCount: 5,
          lastPeriodEnd: "2026-06-04",
          freezeTokens: 2,
        }),
      ],
    });
    const notifier = makeNotifier();
    const result = await evaluateStreaks("u1", "habit_completed", TS, {
      data,
      notifier,
    });
    expect(result.advanced).toHaveLength(1);
    expect(data._persisted[0]).toMatchObject({
      currentCount: 6,
      lastPeriodEnd: "2026-06-07",
      freezeTokens: 0, // both tokens spent on the gap
    });
    expect(notifier.calls[0]).toMatchObject({
      type: "freeze_token_applied",
      data: { periodsMissed: 2, tokensSpent: 2, freezeTokensRemaining: 0 },
    });
    // Phantom-notify guard: the freeze notification must commit AFTER the
    // advance persists, never before (Inspector finding).
    const persistOrder = (data.persistAdvance as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    const notifyOrder = (notifier.notify as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    expect(persistOrder).toBeLessThan(notifyOrder);
  });

  it("reports the POST-mint balance when a gap-spend advance hits a token boundary", async () => {
    // count 3, 3 tokens, lastPeriodEnd 06-04 → gap = 06-05/06-06 (2 missed).
    // Cover spends 2 (tokensAfterGap=1); newCount=4 mints +1 → persisted 2.
    // The notification must report the persisted 2, not the pre-mint 1
    // (Inspector finding — freezeTokensRemaining was read pre-mint).
    const data = makeData({
      streaks: [
        makeStreak({
          currentCount: 3,
          longestCount: 3,
          lastPeriodEnd: "2026-06-04",
          freezeTokens: 3,
        }),
      ],
    });
    const notifier = makeNotifier();
    await evaluateStreaks("u1", "habit_completed", TS, { data, notifier });
    expect(data._persisted[0]).toMatchObject({
      currentCount: 4,
      freezeTokens: 2, // 1 left after the gap + 1 minted at the boundary
    });
    expect(notifier.calls[0]).toMatchObject({
      type: "freeze_token_applied",
      data: { periodsMissed: 2, tokensSpent: 2, freezeTokensRemaining: 2 },
    });
  });

  it("bails with no side effects when persistAdvance loses the TOCTOU race", async () => {
    // A concurrent cron break/spend moved the row past our snapshot — the
    // conditional UPDATE matches nothing. No advance, no freeze notification
    // (despite the gap-spend path being taken), no milestone unlock.
    const data = makeData({
      streaks: [
        makeStreak({
          currentCount: 5,
          lastPeriodEnd: "2026-06-04",
          freezeTokens: 2,
        }),
      ],
    });
    (data.persistAdvance as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const notifier = makeNotifier();
    const result = await evaluateStreaks("u1", "habit_completed", TS, {
      data,
      notifier,
    });
    expect(result.advanced).toHaveLength(0);
    expect(result.milestones).toHaveLength(0);
    expect(notifier.notify).not.toHaveBeenCalled();
    expect(data.unlockAchievement).not.toHaveBeenCalled();
  });

  it("breaks-and-restarts at 1 when the gap exceeds the token balance", async () => {
    // 2 missed periods, 1 token → the old streak breaks per § 3.5, but the
    // satisfied current period seeds the new streak at 1 instead of being
    // discarded into a dead row. Tokens are kept (break never drains them).
    const data = makeData({
      streaks: [
        makeStreak({
          currentCount: 5,
          longestCount: 5,
          lastPeriodEnd: "2026-06-04",
          freezeTokens: 1,
        }),
      ],
    });
    const notifier = makeNotifier();
    const result = await evaluateStreaks("u1", "habit_completed", TS, {
      data,
      notifier,
    });
    expect(result.advanced).toHaveLength(1);
    expect(data._persisted[0]).toMatchObject({
      currentCount: 1, // restarted, not 6
      longestCount: 5, // history preserved
      lastPeriodEnd: "2026-06-07",
      freezeTokens: 1, // NOT spent — the gap wasn't covered
    });
    expect(notifier.notify).not.toHaveBeenCalled(); // no freeze applied
  });

  it("revives a broken streak at 1 on the next satisfied period", async () => {
    // Cron broke it (count 0); today's completion restarts it without any
    // creation endpoint — broken is no longer a terminal dead end.
    const data = makeData({
      streaks: [
        makeStreak({
          status: "broken",
          currentCount: 0,
          longestCount: 9,
          lastPeriodEnd: "2026-06-06",
          freezeTokens: 2,
        }),
      ],
    });
    const notifier = makeNotifier();
    const result = await evaluateStreaks("u1", "habit_completed", TS, {
      data,
      notifier,
    });
    expect(result.advanced).toHaveLength(1);
    expect(data._persisted[0]).toMatchObject({
      currentCount: 1,
      longestCount: 9,
      lastPeriodEnd: "2026-06-07",
      freezeTokens: 2, // untouched — no gap maths for a broken streak
    });
  });

  it("evaluates the authoritative localDate for date-only events, not the drifted instant", async () => {
    // A Pacific/Auckland (+12) user backfills 2026-06-04. The handler anchors
    // the stored instant at noon UTC — 2026-06-04T12:00Z — which is already
    // 2026-06-05 in Auckland. Without the threaded localDate the engine would
    // evaluate the 06-05 period (and the just-stored 06-04 row wouldn't satisfy
    // it). With it, the engine evaluates 06-04 exactly.
    const driftInstant = new Date("2026-06-04T12:00:00.000Z");
    const data = makeData({
      streaks: [makeStreak({ period: "daily", lastPeriodEnd: "2026-06-03" })],
      tz: "Pacific/Auckland",
      satisfied: true,
    });
    const notifier = makeNotifier();
    const result = await evaluateStreaks(
      "u1",
      "habit_completed",
      driftInstant,
      { data, notifier },
      { localDate: "2026-06-04" },
    );
    expect(result.advanced).toHaveLength(1);
    expect(data._persisted[0].lastPeriodEnd).toBe("2026-06-04");
    // Threshold query targeted the tapped cell, never the drifted 06-05.
    expect(data.isPeriodSatisfied).toHaveBeenCalledWith(
      expect.anything(),
      "2026-06-04",
      "2026-06-04",
      "Pacific/Auckland",
    );
  });

  it("falls back to deriving the local day from the instant when no localDate is given", async () => {
    // Same +12 user, no authoritative day → the engine derives 06-05 from the
    // noon-UTC instant (the pre-fix behaviour, exercised by full-ISO events).
    const driftInstant = new Date("2026-06-04T12:00:00.000Z");
    const data = makeData({
      streaks: [makeStreak({ period: "daily", lastPeriodEnd: "2026-06-03" })],
      tz: "Pacific/Auckland",
      satisfied: true,
    });
    await evaluateStreaks("u1", "habit_completed", driftInstant, {
      data,
      notifier: makeNotifier(),
    });
    expect(data._persisted[0].lastPeriodEnd).toBe("2026-06-05");
  });

  it("handles a mix of advancing and skipped streaks", async () => {
    const data = makeData({
      streaks: [
        makeStreak({ id: "adv", lastPeriodEnd: "2026-06-06" }),
        makeStreak({ id: "skip", lastPeriodEnd: "2026-06-07" }),
      ],
    });
    const notifier = makeNotifier();
    const result = await evaluateStreaks("u1", "habit_completed", TS, {
      data,
      notifier,
    });
    expect(result.advanced.map((s) => s.id)).toEqual(["adv"]);
  });
});

describe("milestoneMessage", () => {
  it("uses week/weeks for weekly streaks and days for daily", () => {
    expect(milestoneMessage("workout_streak", 1)).toContain("1-week");
    expect(milestoneMessage("measurement_streak", 2)).toContain("2-weeks");
    expect(milestoneMessage("habit_streak", 7)).toContain("7-days");
    expect(milestoneMessage("nutrition_streak", 14)).toContain("14-days");
  });
});
