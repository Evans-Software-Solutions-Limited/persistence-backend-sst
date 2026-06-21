/**
 * Streak domain model (06-progress-goals, Phase 06.6). Mirrors the backend
 * `user_streaks` row (cross-cuts § 3.2) — the You/Progress StreakHero reads
 * `current`/`longest`/`freezeTokens`; the offline `deriveStreak` helper
 * recomputes `current` from cached habit_completions until the server engine
 * reconciles (server wins).
 */

export const STREAK_TYPES = [
  "workout_streak",
  "habit_streak",
  "measurement_streak",
  "nutrition_streak",
] as const;
export type StreakType = (typeof STREAK_TYPES)[number];

export type StreakPeriod = "daily" | "weekly" | "monthly";
export type StreakStatus = "active" | "broken" | "paused";

export type Streak = {
  id: string;
  userId: string;
  streakType: StreakType;
  sourceGoalId: string | null;
  period: StreakPeriod;
  currentCount: number;
  longestCount: number;
  /** YYYY-MM-DD of the last evaluated period. */
  lastPeriodEnd: string;
  freezeTokens: number;
  status: StreakStatus;
};
