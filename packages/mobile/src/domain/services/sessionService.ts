/**
 * Active-session domain services — pure functions used by the M3 command
 * layer and the Summary screen.
 *
 * No I/O, no React, no platform calls. Returns immutable `WorkoutSession`
 * snapshots; commands persist via `StoragePort.cacheActiveSession` (full
 * upsert per EXECUTION_PLAN § 3.4).
 *
 * Spec: specs/05-active-session/design.md § Domain Services
 *       specs/milestones/M3-active-session/FRONTEND_BRIEF.md § Pure domain services
 */

import type { Exercise } from "@/domain/models/exercise";
import type { PersonalRecord } from "@/domain/models/record";
import type {
  ExerciseSet,
  SessionExercise,
  SessionSummary,
  WorkoutSession,
} from "@/domain/models/session";
import type { Workout } from "@/domain/models/workout";

export type IdFactory = () => string;

/** Inputs the session-service can't derive (caller-supplied for testability). */
export type SessionContext = {
  userId: string;
  /** ISO timestamp; defaults to `new Date().toISOString()` if omitted in tests. */
  now: string;
};

/**
 * Build a fresh `in_progress` session from a workout template. Pre-seeds
 * `targetSets` empty rows per exercise so the SetLogger renders "set 1
 * of N" immediately on session-start (smoke test § A.1).
 *
 * `exercise` may be null on a `WorkoutExercise` (FK soft-cascade — the
 * library exercise was deleted but the workout row survived); fall
 * back to the exerciseId in that case so the row still renders.
 * Optimistic workout-create + workout-update commands hydrate
 * `wx.exercise` from the local exercise cache, so this fallback only
 * fires on genuinely-deleted library entries.
 */
export function createSessionFromWorkout(
  workout: Workout,
  ctx: SessionContext,
  idFactory: IdFactory,
): WorkoutSession {
  const sessionId = `local-${idFactory()}`;
  const exercises: SessionExercise[] = workout.exercises
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((wx, idx) => {
      const sessionExerciseId = `local-${idFactory()}`;
      const targetSets = wx.targetSets ?? 0;
      const sets: ExerciseSet[] = [];
      for (let i = 0; i < targetSets; i++) {
        sets.push(emptySet(sessionExerciseId, i + 1, idFactory));
      }
      return {
        id: sessionExerciseId,
        sessionId,
        exerciseId: wx.exerciseId,
        exerciseName: wx.exercise?.name ?? wx.exerciseId,
        sortOrder: idx,
        supersetGroup: wx.supersetGroup,
        isSubstituted: false,
        originalExerciseId: null,
        // Session notes start empty — `wx.notes` is the workout-template's
        // per-exercise notes (coach guidance), NOT the user's session
        // notes. Legacy `useActiveWorkout.initializeExercises` (lines
        // 327-348) does NOT carry template notes through to the active
        // exercise either. The user adds session notes via the popover.
        notes: null,
        sets,
      };
    });

  return {
    id: sessionId,
    userId: ctx.userId,
    workoutId: workout.id,
    name: workout.name,
    status: "in_progress",
    startedAt: ctx.now,
    completedAt: null,
    exercises,
    notes: null,
  };
}

/**
 * Build an empty Quick Start session (no template). User adds exercises
 * via `addExerciseToSession`.
 */
export function createEmptySession(
  ctx: SessionContext,
  idFactory: IdFactory,
): WorkoutSession {
  return {
    id: `local-${idFactory()}`,
    userId: ctx.userId,
    workoutId: null,
    name: "Quick Workout",
    status: "in_progress",
    startedAt: ctx.now,
    completedAt: null,
    exercises: [],
    notes: null,
  };
}

/**
 * Append a set to an exercise. The new `setNumber` is `max(existing) + 1`
 * — defensive against gaps left by mid-session removals (without this,
 * `[1,2,3]` → remove 2 → `[1,3]` → add → would re-emit `setNumber: 3`,
 * a wire-shape duplicate that would corrupt the bulk-record flush).
 *
 * Returns a new session; original is untouched.
 */
export function addSetToExercise(
  session: WorkoutSession,
  sessionExerciseId: string,
  partial: Partial<Omit<ExerciseSet, "id" | "sessionExerciseId" | "setNumber">>,
  idFactory: IdFactory,
): WorkoutSession {
  return {
    ...session,
    exercises: session.exercises.map((ex) =>
      ex.id === sessionExerciseId
        ? {
            ...ex,
            sets: [
              ...ex.sets,
              {
                ...emptySet(ex.id, nextSetNumberFor(ex.sets), idFactory),
                ...partial,
              },
            ],
          }
        : ex,
    ),
  };
}

function nextSetNumberFor(sets: readonly ExerciseSet[]): number {
  let max = 0;
  for (const s of sets) {
    if (s.setNumber > max) max = s.setNumber;
  }
  return max + 1;
}

/**
 * Add an empty set to EVERY exercise in a superset group, all at the
 * same setNumber. Mirrors legacy
 * `useActiveWorkout.addSupersetSet` (lines 488-499) — supersets are
 * paired logging: exercise A and B always have the same number of
 * sets, lined up by setNumber.
 *
 * Picks `max(setNumber across all peers) + 1` so re-adding after a
 * removal doesn't collide with surviving rows. New rows are empty
 * (null weight/reps/rpe, isCompleted=false), one per exercise in
 * `sessionExerciseIds`.
 *
 * Pure; returns a new session. No-op (returns the same session) when
 * no exercises match.
 */
export function addSupersetSet(
  session: WorkoutSession,
  sessionExerciseIds: readonly string[],
  idFactory: IdFactory,
): WorkoutSession {
  if (sessionExerciseIds.length === 0) return session;
  const idSet = new Set(sessionExerciseIds);
  const targets = session.exercises.filter((ex) => idSet.has(ex.id));
  if (targets.length === 0) return session;

  let nextSetNumber = 0;
  for (const ex of targets) {
    nextSetNumber = Math.max(nextSetNumber, nextSetNumberFor(ex.sets));
  }
  if (nextSetNumber === 0) nextSetNumber = 1;

  return {
    ...session,
    exercises: session.exercises.map((ex) =>
      idSet.has(ex.id)
        ? {
            ...ex,
            sets: [...ex.sets, emptySet(ex.id, nextSetNumber, idFactory)],
          }
        : ex,
    ),
  };
}

/**
 * Remove a specific setNumber from every exercise in a superset
 * group, then renumber the survivors so 1..n stays contiguous (same
 * gap-free invariant as `renumberSets`). Mirrors legacy
 * `useActiveWorkout.removeSupersetSet` (lines 540-588).
 *
 * Pure; returns a new session. No-op when no exercises match.
 */
export function removeSupersetSet(
  session: WorkoutSession,
  sessionExerciseIds: readonly string[],
  setNumber: number,
): WorkoutSession {
  if (sessionExerciseIds.length === 0) return session;
  const idSet = new Set(sessionExerciseIds);
  return {
    ...session,
    exercises: session.exercises.map((ex) => {
      if (!idSet.has(ex.id)) return ex;
      const filtered = ex.sets.filter((s) => s.setNumber !== setNumber);
      return {
        ...ex,
        sets: filtered.map((s, idx) => ({ ...s, setNumber: idx + 1 })),
      };
    }),
  };
}

/**
 * Renumber an exercise's sets to a contiguous 1..n sequence preserving
 * array order. Used after a set is removed mid-session so the display
 * (which prints `idx + 1`) stays in sync with the persisted
 * `setNumber` and the wire shape stays gap-free for the bulk-record
 * flush.
 *
 * Pure: returns a new session; original is untouched. Idempotent.
 */
export function renumberSets(
  session: WorkoutSession,
  sessionExerciseId: string,
): WorkoutSession {
  return {
    ...session,
    exercises: session.exercises.map((ex) =>
      ex.id === sessionExerciseId
        ? {
            ...ex,
            sets: ex.sets.map((s, idx) => ({ ...s, setNumber: idx + 1 })),
          }
        : ex,
    ),
  };
}

/**
 * Mark a single set complete. No-op if the set is already complete or
 * the id doesn't match. `completedAt` should be the ISO timestamp at
 * which the user tapped Mark Complete (passed in for testability).
 */
export function completeSet(
  session: WorkoutSession,
  setId: string,
  completedAt: string,
): WorkoutSession {
  return {
    ...session,
    exercises: session.exercises.map((ex) => ({
      ...ex,
      sets: ex.sets.map((set) =>
        set.id === setId && !set.isCompleted
          ? { ...set, isCompleted: true, completedAt }
          : set,
      ),
    })),
  };
}

/**
 * Mark every set with both `weightKg` and `reps` as completed,
 * stamping `completedAt`. Mirrors legacy semantics: legacy has no
 * per-set "Mark Complete" UI — any set with data is "logged" — but
 * V2's calculateSummary / detectPersonalRecords / bulk-record
 * payload all gate on `isCompleted`. Apply this transform at
 * finalize-on-complete so the downstream gates see the user's
 * actual logged sets. Substituted exercises are skipped (their sets
 * belong to an exercise the user moved away from). Sets already
 * `isCompleted` are untouched (preserves any prior `completedAt`).
 */
export function markLoggedSetsCompleted(
  session: WorkoutSession,
  completedAt: string,
): WorkoutSession {
  return {
    ...session,
    exercises: session.exercises.map((ex) => {
      if (ex.isSubstituted) return ex;
      return {
        ...ex,
        sets: ex.sets.map((set) =>
          !set.isCompleted && set.weightKg != null && set.reps != null
            ? { ...set, isCompleted: true, completedAt }
            : set,
        ),
      };
    }),
  };
}

/**
 * Substitute an exercise mid-session. Old row stays in place with
 * `isSubstituted: true` (sets preserved per Story-004 AC); new row is
 * inserted at `oldSortOrder + 1` and downstream rows shift by +1.
 *
 * The new row is seeded with the SAME number of empty sets the old
 * row had, mirroring legacy `useActiveWorkout.swapExercise` (lines
 * 967-972 / 1016-1021):
 *
 *   const clearedSets = Array.from({ length: exercise.targetSets }, …);
 *
 * Without this seeding the user has to re-add every set after a swap,
 * which is the regression the user flagged.
 *
 * Per EXECUTION_PLAN § 3.4: mutate the in-memory model only — the
 * storage layer sees the full session via `cacheActiveSession`, never
 * partial sortOrder updates.
 */
export function substituteExercise(
  session: WorkoutSession,
  oldSessionExerciseId: string,
  newExercise: Exercise,
  idFactory: IdFactory,
): WorkoutSession {
  const oldRow = session.exercises.find((e) => e.id === oldSessionExerciseId);
  if (!oldRow) return session;

  const oldSortOrder = oldRow.sortOrder;
  const newRowId = `local-${idFactory()}`;
  // Preserve the old row's set count — same number of empty,
  // unchecked rows so the user lands on the new exercise with their
  // expected log slots already laid out.
  const seededSets: ExerciseSet[] = oldRow.sets.map((_, idx) =>
    emptySet(newRowId, idx + 1, idFactory),
  );
  const newRow: SessionExercise = {
    id: newRowId,
    sessionId: session.id,
    exerciseId: newExercise.id,
    exerciseName: newExercise.name,
    sortOrder: oldSortOrder + 1,
    supersetGroup: oldRow.supersetGroup,
    isSubstituted: false,
    originalExerciseId: oldRow.exerciseId,
    notes: null,
    sets: seededSets,
  };

  const exercises = session.exercises
    .map((ex) => {
      if (ex.id === oldSessionExerciseId) {
        return { ...ex, isSubstituted: true };
      }
      if (ex.sortOrder > oldSortOrder) {
        return { ...ex, sortOrder: ex.sortOrder + 1 };
      }
      return ex;
    })
    .concat(newRow)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return { ...session, exercises };
}

/**
 * Remove an exercise from the session by `sessionExerciseId`. If the
 * removed row was in a superset and only one survivor remains in that
 * group, ungroup the survivor (a "superset" of one is meaningless).
 *
 * Mirrors legacy `useActiveWorkout.removeExercise` (lines 1078-1112).
 */
export function removeExerciseFromSession(
  session: WorkoutSession,
  sessionExerciseId: string,
): WorkoutSession {
  const target = session.exercises.find((e) => e.id === sessionExerciseId);
  if (!target) return session;

  const remaining = session.exercises.filter((e) => e.id !== sessionExerciseId);

  // If the removed row carried a supersetGroup AND only one peer
  // survives, that peer is no longer part of a "set" — ungroup it.
  const group = target.supersetGroup;
  if (group != null) {
    const peers = remaining.filter((e) => e.supersetGroup === group);
    if (peers.length === 1) {
      const ungrouped = remaining.map((e) =>
        e.supersetGroup === group ? { ...e, supersetGroup: null } : e,
      );
      return { ...session, exercises: ungrouped };
    }
  }

  return { ...session, exercises: remaining };
}

/**
 * Update the `notes` field on a single session_exercise row. Returns
 * a new session; original untouched.
 */
export function setExerciseNotes(
  session: WorkoutSession,
  sessionExerciseId: string,
  notes: string | null,
): WorkoutSession {
  return {
    ...session,
    exercises: session.exercises.map((ex) =>
      ex.id === sessionExerciseId ? { ...ex, notes } : ex,
    ),
  };
}

/**
 * Default number of sets seeded when a user adds an exercise mid-session.
 * Matches legacy `useActiveWorkout.addExerciseToWorkout` (line 1060) —
 * the legacy app hardcodes targetSets=3 with three empty sets.
 */
const DEFAULT_ADDED_EXERCISE_SETS = 3;

/**
 * Append a new exercise to the session at `max(sortOrder) + 1`. Used by
 * Quick Start ("+ Add exercise") and mid-session add. Seeds three empty
 * sets to match legacy. Returns a new session.
 *
 * Pass `supersetGroup` to drop the new exercise straight into an
 * existing superset (legacy "Add Exercise to Superset" flow). The sort
 * order still pushes the new row to the end of the list — the
 * presenter groups by `supersetGroup` regardless of position.
 */
export function addExerciseToSession(
  session: WorkoutSession,
  exercise: Exercise,
  idFactory: IdFactory,
  options: { supersetGroup?: number | null } = {},
): WorkoutSession {
  const nextSortOrder = nextSortOrderFor(session.exercises);
  const sessionExerciseId = `local-${idFactory()}`;
  const sets: ExerciseSet[] = [];
  for (let i = 0; i < DEFAULT_ADDED_EXERCISE_SETS; i++) {
    sets.push(emptySet(sessionExerciseId, i + 1, idFactory));
  }
  const newRow: SessionExercise = {
    id: sessionExerciseId,
    sessionId: session.id,
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    sortOrder: nextSortOrder,
    supersetGroup: options.supersetGroup ?? null,
    isSubstituted: false,
    originalExerciseId: null,
    notes: null,
    sets,
  };
  return { ...session, exercises: [...session.exercises, newRow] };
}

/**
 * Total volume across completed sets. Skips sets with null weight or
 * null reps (volume is undefined for bodyweight + cardio entries).
 */
export function calculateVolume(sets: readonly ExerciseSet[]): number {
  let total = 0;
  for (const set of sets) {
    if (!set.isCompleted) continue;
    if (set.weightKg == null || set.reps == null) continue;
    total += set.weightKg * set.reps;
  }
  return total;
}

/**
 * Collapse a session into a Summary view. `now` defaults to
 * `Date.now()` so callers can preview a still-running session; pass
 * the ISO `completedAt` to freeze the duration on Finish.
 *
 * Substituted exercises are excluded from `totalExercises` /
 * `exercisesCompleted` to avoid double-counting after a swap.
 */
export function calculateSummary(
  session: WorkoutSession,
  now: string = new Date().toISOString(),
): SessionSummary {
  const startMs = Date.parse(session.startedAt);
  const endMs = Date.parse(session.completedAt ?? now);
  const duration =
    Number.isFinite(startMs) && Number.isFinite(endMs)
      ? Math.max(0, Math.floor((endMs - startMs) / 1000))
      : 0;

  const activeExercises = session.exercises.filter((ex) => !ex.isSubstituted);
  let totalSets = 0;
  let setsCompleted = 0;
  let exercisesCompleted = 0;
  let totalVolume = 0;

  for (const ex of activeExercises) {
    totalSets += ex.sets.length;
    let exHasCompleted = false;
    for (const set of ex.sets) {
      if (set.isCompleted) {
        setsCompleted += 1;
        exHasCompleted = true;
        if (set.weightKg != null && set.reps != null) {
          totalVolume += set.weightKg * set.reps;
        }
      }
    }
    if (exHasCompleted) exercisesCompleted += 1;
  }

  return {
    duration,
    totalVolume,
    exercisesCompleted,
    totalExercises: activeExercises.length,
    setsCompleted,
    totalSets,
    personalRecords: [],
  };
}

/**
 * Predict client-side personal records for the Summary screen.
 *
 * M3 detects `1rm` only — matches the backend (BACKEND_BRIEF § 3 says
 * server writes `1rm` only). Volume / max-weight / max-reps PRs are
 * M4-future. Epley formula: `weightKg × (1 + reps / 30)`. Only completed
 * sets with both `weightKg > 0` and `reps > 0` qualify.
 *
 * Compares the session's best-1RM-per-exercise against the
 * `previousRecords` slice (cached by `storage.getPersonalRecords`); a
 * new record is emitted only when the session beats the previous best
 * for that exercise. Server reconciles canonically on flush; this is
 * the predictive cut for the offline Summary screen.
 *
 * Spec: specs/05-active-session/design.md § Personal-record detection: hybrid
 *       specs/milestones/M3-active-session/BACKEND_BRIEF.md § PR-detection
 */
export function detectPersonalRecords(
  session: WorkoutSession,
  previousRecords: readonly PersonalRecord[],
  ctx: SessionContext,
  idFactory: IdFactory,
): PersonalRecord[] {
  const previous1RmByExercise = new Map<string, number>();
  for (const rec of previousRecords) {
    if (rec.recordType !== "1rm") continue;
    const current = previous1RmByExercise.get(rec.exerciseId);
    if (current == null || rec.value > current) {
      previous1RmByExercise.set(rec.exerciseId, rec.value);
    }
  }

  type Best = { value: number; setId: string };
  const bestByExercise = new Map<
    string,
    { exerciseName: string; best: Best }
  >();

  for (const ex of session.exercises) {
    if (ex.isSubstituted) continue;
    for (const set of ex.sets) {
      if (!set.isCompleted) continue;
      if (set.weightKg == null || set.weightKg <= 0) continue;
      if (set.reps == null || set.reps <= 0) continue;
      const oneRm = set.weightKg * (1 + set.reps / 30);
      const existing = bestByExercise.get(ex.exerciseId);
      if (!existing || oneRm > existing.best.value) {
        bestByExercise.set(ex.exerciseId, {
          exerciseName: ex.exerciseName,
          best: { value: oneRm, setId: set.id },
        });
      }
    }
  }

  const records: PersonalRecord[] = [];
  for (const [exerciseId, { exerciseName, best }] of bestByExercise) {
    const prior = previous1RmByExercise.get(exerciseId) ?? 0;
    if (best.value > prior) {
      records.push({
        id: `local-${idFactory()}`,
        userId: ctx.userId,
        exerciseId,
        exerciseName,
        recordType: "1rm",
        value: best.value,
        achievedAt: ctx.now,
        sessionId: session.id,
        setId: best.setId,
      });
    }
  }
  return records;
}

function emptySet(
  sessionExerciseId: string,
  setNumber: number,
  idFactory: IdFactory,
): ExerciseSet {
  return {
    id: `local-${idFactory()}`,
    sessionExerciseId,
    setNumber,
    weightKg: null,
    reps: null,
    rpe: null,
    durationSeconds: null,
    distanceMeters: null,
    isCompleted: false,
    completedAt: null,
  };
}

function nextSortOrderFor(exercises: readonly SessionExercise[]): number {
  let max = -1;
  for (const ex of exercises) {
    if (ex.sortOrder > max) max = ex.sortOrder;
  }
  return max + 1;
}
