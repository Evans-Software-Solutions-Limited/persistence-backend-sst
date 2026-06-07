/**
 * Achievement domain model (06-progress-goals, Phase 06.6). Mirrors the
 * backend `user_achievements` ⨝ `achievements` read shape. The presenter maps
 * (streak_type, threshold) → icon/tone per design.md § Achievement triggers.
 */

export type AchievementCategory =
  | "workout_count"
  | "personal_record"
  | "streak"
  | "social"
  | "special";

export type Achievement = {
  id: string; // user_achievements.id
  achievementId: string;
  name: string;
  description: string | null;
  category: AchievementCategory;
  requirements: Record<string, unknown> | null;
  unlockedAt: string | null;
};
