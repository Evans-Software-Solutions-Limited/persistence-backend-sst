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

  if (input.done) {
    storage.upsertHabitCompletion({
      id: `local-${deps.idFactory()}`,
      userId,
      goalId: input.goalId,
      day: input.day,
      completedAt,
      value: null,
    });
    storage.enqueueMutation({
      entityType: "habit_completion",
      entityId: `${input.goalId}:${input.day}`,
      operation: "create",
      payload: { goalId: input.goalId, date: wireDate },
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
