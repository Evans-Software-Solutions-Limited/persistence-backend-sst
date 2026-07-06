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
  /**
   * The `value_gte` target the completion must carry to satisfy the backend's
   * `validateCompletionValue` (18-habit-setup regression fix). A grid tap
   * means "I met my target today", so the toggle command sends this as the
   * completion's `value` — `null` (or absent) for `count`/read-only habits
   * (Gym scores from workout_sessions; Calories from nutrition_entries), which
   * never carry a value.
   */
  targetValue?: number | null;
  /**
   * False for a habit whose completion can't be meaningfully logged from this
   * grid — currently only Calories, which the backend engine scores from
   * `nutrition_entries`, never `habit_completions` (a completion row there is
   * inert). The tile renders read-only and taps deep-link to Fuel instead of
   * toggling. Defaults to true (every pre-18 caller stays toggleable).
   */
  toggleable?: boolean;
};
