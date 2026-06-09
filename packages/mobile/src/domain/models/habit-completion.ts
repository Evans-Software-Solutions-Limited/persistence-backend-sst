/**
 * Habit-completion domain model (06-progress-goals, Phase 06.6). Mirrors the
 * backend `habit_completions` row (cross-cuts § 3.3). Cached offline-first; a
 * habit toggle writes optimistically + enqueues a sync mutation.
 */

export type HabitCompletion = {
  id: string;
  userId: string;
  goalId: string;
  /** ISO timestamp the habit was completed (user-local day is what matters). */
  completedAt: string;
  value: number | null;
};

/**
 * A single habit row for the 7-day Home grid (STORY-004). `days` is length-7
 * with TODAY last; `tone` maps to a `<HabitTile>` tone (set by the container).
 */
export type HabitTileTone =
  | "primary"
  | "gold"
  | "trainer"
  | "ember"
  | "success";

export type Habit = {
  id: string; // goalId
  label: string;
  tone: HabitTileTone;
  days: boolean[]; // length 7, today last
};
