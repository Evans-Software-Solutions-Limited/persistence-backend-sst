/**
 * Toggle-habit-day command — offline-capable (06-progress-goals, Phase 06.6).
 *
 * Mirrors updateProfileCommand: optimistic cache write + enqueue, no direct
 * network call. The habit cell flips immediately (cache), the streak count
 * re-derives client-side from cached completions (deriveStreak, 06.7), and the
 * server engine reconciles on the next drain (server wins — STORY-004 AC 4.2/4.3).
 *
 * `done=true`  → optimistic upsert + POST /habit-completions (idempotent per
 *                user/goal/UTC-day server-side).
 * `done=false` → optimistic remove + DELETE /habit-completions.
 *
 * The aggregate Home cache is invalidated so the next refresh re-pulls the grid
 * + streak micro-pill from server truth.
 *
 * REGRESSION FIX (18-habit-setup): once a habit is configured via the setup
 * screen, the backend's `validateCompletionValue` REQUIRES a `value` for
 * value_gte categories (water/steps/sleep) — a bare `{goalId, date}` POST
 * 422s. A grid tap means "I met my target today", so `input.value` (the
 * habit's live `targetValue`, threaded from `buildHabitGrid` via
 * `HabitVM.targetValue`, gated on `completionRule === "value_gte"`) is
 * written into BOTH the optimistic local row and the queued mutation's wire
 * payload, so the drain's POST carries it too.
 *
 * Gym (`count`) and any pre-configuration/legacy habit never require a value
 * server-side — the wire payload OMITS the `value` key entirely for them
 * (not `value: null`), so the POST stays byte-identical to the pre-fix
 * legacy shape. The optimistic LOCAL cache row still stores `value: null`
 * (its column always exists), but the wire payload's key presence tracks
 * whether the caller passed a real value.
 */

import type { StoragePort } from "@/domain/ports/storage.port";

export type ToggleHabitCommandDeps = {
  storage: StoragePort;
  userId: string;
  /** Stable id for the optimistic local row (e.g. a uuid factory). */
  idFactory: () => string;
};

export type ToggleHabitInput = {
  goalId: string;
  /** User-local calendar day being toggled (YYYY-MM-DD). */
  day: string;
  done: boolean;
  /**
   * The value the completion must carry to satisfy the backend's per-category
   * validation (value_gte/within_tolerance require one; count/legacy habits
   * don't). Omit/undefined for a habit with no known target (falls back to
   * `null`, matching the pre-fix wire shape for callers that predate this).
   */
  value?: number | null;
};

export function toggleHabitDayCommand(
  deps: ToggleHabitCommandDeps,
  input: ToggleHabitInput,
): void {
  const { storage, userId } = deps;
  // Noon-UTC midpoint keeps the LOCAL cache row's instant inside the intended
  // calendar day for every timezone the user is plausibly in. This instant is
  // only persisted locally; the wire payload sends the date-only `day` instead
  // (see below).
  const completedAt = `${input.day}T12:00:00.000Z`;
  // The wire MUST carry the date-only `day` (YYYY-MM-DD), NOT an ISO instant.
  // The backend treats a date-only string as the authoritative user-local day
  // and the on-write streak engine evaluates that local day directly. Sending
  // a noon-UTC instant instead would route through the tz-conversion path and
  // drift to the next local day for tz ≥ +12 (backend sweep 11).
  const wireDate = input.day;
  const value = input.value ?? null;

  if (input.done) {
    storage.upsertHabitCompletion({
      id: `local-${deps.idFactory()}`,
      userId,
      goalId: input.goalId,
      day: input.day,
      completedAt,
      value,
    });
    storage.enqueueMutation({
      entityType: "habit_completion",
      entityId: `${input.goalId}:${input.day}`,
      operation: "create",
      // Omit the `value` key entirely when none was passed — a habit that
      // doesn't require one (Gym / legacy) must stay byte-identical to the
      // pre-fix `{goalId, date}` payload, not send an inert `value: null`.
      payload:
        value !== null
          ? { goalId: input.goalId, date: wireDate, value }
          : { goalId: input.goalId, date: wireDate },
      endpoint: "/habit-completions",
      method: "POST",
    });
  } else {
    storage.removeHabitCompletion(userId, input.goalId, input.day);
    storage.enqueueMutation({
      entityType: "habit_completion",
      entityId: `${input.goalId}:${input.day}`,
      operation: "delete",
      payload: { goalId: input.goalId, date: wireDate },
      endpoint: `/habit-completions?goalId=${encodeURIComponent(
        input.goalId,
      )}&date=${encodeURIComponent(wireDate)}`,
      method: "DELETE",
    });
  }

  // Force the next Home read to re-pull grid + streak from server truth.
  storage.invalidateHome(userId);
}
