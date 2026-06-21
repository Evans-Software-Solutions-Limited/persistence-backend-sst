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
  /**
   * Authoritative user-local calendar day (YYYY-MM-DD) the completion counts
   * for — the backend's `local_completed_date`, the same grain its dedup index
   * + streak engine use. Prefer this for bucketing: `completedAt` is a
   * noon-UTC-ish anchor the server may clamp to a *different* UTC day for tz
   * ≥ +12, so slicing it would drop the toggle. Optional only because an older
   * cache row / a freshly-built optimistic row may lack it (fall back to
   * `completedAt.slice(0, 10)` then).
   */
  localCompletedDate?: string;
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
