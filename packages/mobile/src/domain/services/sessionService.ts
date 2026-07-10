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
import type { PersonalRecord, RecordType } from "@/domain/models/record";
import type {
  ExerciseSet,
  SessionClientRef,
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
  /**
   * M18 coach Start-live — stamps the on-behalf client onto the session so it
   * persists in SQLite (the existence authority) and survives a rehydrate.
   */
  withClient?: SessionClientRef | null;
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
    withClient: ctx.withClient ?? null,
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
    withClient: ctx.withClient ?? null,
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
 * Substitute an exercise mid-session, in place.
 *
 * Mirrors legacy `useActiveWorkout.swapExercise` (lines 928-992):
 * the existing row keeps its `id` / `sortOrder` / `supersetGroup` /
 * `notes`; only the exercise pointer + name swap. Sets are CLEARED
 * to empties matching the original set count (legacy "Clear all set
 * data when swapping" + "Preserve the number of sets based on
 * targetSets"). No new row is inserted — the row count stays the
 * same and downstream sortOrders are untouched.
 *
 * The previous behaviour kept the old row visible with
 * `isSubstituted: true` and inserted the replacement next to it,
 * which the user perceived on device as "the swap doesn't swap, it
 * just adds the other one." This matches that bug report and the
 * legacy implementation (which never had the lingering-row concept).
 *
 * Guard: if `newExercise.id` already lives on a different row in the
 * session, the swap is a no-op (legacy lines 949-954). The pickers
 * disable that row in the UI, but defending here keeps the invariant
 * honest under cache-reread races.
 *
 * `originalExerciseId` records the FIRST source across a chain of
 * swaps (A→B→C → still records A) so the server payload can show the
 * user's original plan vs. final attempt. `isSubstituted` stays false
 * — the row is the active exercise now, not a stale placeholder. The
 * flag is reserved for the API wire format and any future server
 * hook that wants it.
 */
export function substituteExercise(
  session: WorkoutSession,
  oldSessionExerciseId: string,
  newExercise: Exercise,
  idFactory: IdFactory,
): WorkoutSession {
  const oldRow = session.exercises.find((e) => e.id === oldSessionExerciseId);
  if (!oldRow) return session;

  // Same shape as the addExerciseToSession guard: substituted rows are
  // skipped. They're stale carryover from pre-2026-05 sessions where
  // the old "lingering substituted row" semantic was in effect, and
  // the picker UI's `existingExerciseIds` already filters them out —
  // catching them here would make a swap silently no-op when the user
  // can clearly see the target row in the list.
  const duplicate = session.exercises.find(
    (e) =>
      e.id !== oldSessionExerciseId &&
      !e.isSubstituted &&
      e.exerciseId === newExercise.id,
  );
  if (duplicate) return session;

  const seededSets: ExerciseSet[] = oldRow.sets.map((_, idx) =>
    emptySet(oldRow.id, idx + 1, idFactory),
  );

  const exercises = session.exercises.map((ex) => {
    if (ex.id !== oldSessionExerciseId) return ex;
    return {
      ...ex,
      exerciseId: newExercise.id,
      exerciseName: newExercise.name,
      originalExerciseId: ex.originalExerciseId ?? ex.exerciseId,
      isSubstituted: false,
      sets: seededSets,
    };
  });

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
  // Legacy duplicate-guard (mirrors useActiveWorkout.swapExercise
  // lines 949-954): silently no-op if the exercise already lives in
  // the session as an active row. Picker UI also disables already-in-
  // session rows; this is the belt-and-braces invariant for cache-
  // reread races and any non-UI caller (tests, future imports).
  // Substituted rows don't block — they're stale placeholders from
  // pre-2026-05 sessions that may still surface from SQLite.
  const dupe = session.exercises.find(
    (ex) => !ex.isSubstituted && ex.exerciseId === exercise.id,
  );
  if (dupe) return session;

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
 * Record types the client-side predictor emits — mirrors the backend's
 * `recordPRsForSession` exactly so the Summary screen's local prediction
 * agrees with the server response that lands ~500 ms later. Every
 * weighted set contributes `max_weight` + `max_volume`; the `Xrm`
 * ladder only fires on exact rep counts (1 / 3 / 5 / 10). 7-rep sets
 * produce NO `Xrm` PR — surfacing an Epley-derived 1RM on the
 * achievements screen was the bug PR-3 exists to fix on the server,
 * and the local predictor has to honour the same rule or it flashes
 * the very PR card the user is here to stop seeing.
 *
 * Order matches `RECORD_TYPES` in the domain model.
 */
const COMPUTED_RECORD_TYPES = [
  "1rm",
  "3rm",
  "5rm",
  "10rm",
  "max_weight",
  "max_volume",
] as const;

/**
 * Maps an EXACT rep count to its `Xrm` record type, or null when the
 * count doesn't sit on the legacy ladder. Mirrors backend
 * `personalRecordsRepository.ts#repMaxTypeForReps`.
 */
function repMaxTypeForReps(reps: number): RecordType | null {
  switch (reps) {
    case 1:
      return "1rm";
    case 3:
      return "3rm";
    case 5:
      return "5rm";
    case 10:
      return "10rm";
    default:
      return null;
  }
}

/**
 * Predict client-side personal records for the Summary screen.
 *
 * Mirrors the backend's `recordPRsForSession` exactly: every weighted
 * completed set contributes `max_weight` (value = weight) +
 * `max_volume` (value = weight × reps) candidates, plus a `1rm` /
 * `3rm` / `5rm` / `10rm` candidate ONLY when reps matches that rung
 * EXACTLY. Picks the best candidate per `(exerciseId, recordType)`
 * tuple, then emits a PR ONLY when a prior exists in
 * `previousRecords` AND the candidate beats it (skip-first-occurrence
 * — Brad's "no PRs on the first workout" rule).
 *
 * The two-axis correctness criterion ties this function to the
 * backend rewrite (PR-3): if either side diverges, the Summary
 * screen renders one PR shape immediately on mount (from this
 * function's output), then ~500 ms later swaps to a different shape
 * once the bulk-record POST lands and `SessionSummaryContainer`
 * picks up the cached server response. Off-by-one in record types,
 * different reps→type mapping, or different precision rounding all
 * produce a visible flash of the wrong card. Both sides emit the
 * same 6 types with the same exact-rep filter and the same
 * `toFixed(2) → parseFloat` normalisation; both apply the same skip-
 * first-occurrence partition.
 *
 * Bodyweight (no weight) and timed-only sets are filtered out — they
 * don't fit this weight-based ladder. Substituted exercise rows are
 * also skipped (the original row already produced the contribution
 * before the substitution).
 *
 * Spec: specs/05-active-session/design.md § Personal-record detection: hybrid
 *       specs/milestones/M3-active-session/BACKEND_BRIEF.md § PR-detection
 *       microservices/core/src/application/repositories/personalRecordsRepository.ts
 *       (server-side counterpart — keep in lockstep)
 */
export function detectPersonalRecords(
  session: WorkoutSession,
  previousRecords: readonly PersonalRecord[],
  ctx: SessionContext,
  idFactory: IdFactory,
): PersonalRecord[] {
  // Build prior map keyed by `${exerciseId}|${recordType}` — used as
  // both the first-occurrence gate and the comparison floor. Bound
  // to the six computed types so unrelated record types in cache
  // history (e.g. `max_reps`) don't pollute the lookup.
  const computedTypeSet = new Set<RecordType>(COMPUTED_RECORD_TYPES);
  const priorByKey = new Map<string, number>();
  for (const rec of previousRecords) {
    if (!computedTypeSet.has(rec.recordType)) continue;
    const k = `${rec.exerciseId}|${rec.recordType}`;
    const current = priorByKey.get(k);
    if (current == null || rec.value > current) {
      priorByKey.set(k, rec.value);
    }
  }

  // Enumerate per-set candidates across the qualifying record types.
  type Candidate = {
    exerciseId: string;
    exerciseName: string;
    recordType: RecordType;
    value: number;
    setId: string;
  };
  const candidates: Candidate[] = [];
  for (const ex of session.exercises) {
    if (ex.isSubstituted) continue;
    for (const set of ex.sets) {
      if (!set.isCompleted) continue;
      if (set.weightKg == null || set.weightKg <= 0) continue;
      if (set.reps == null || set.reps <= 0) continue;
      const weight = set.weightKg;
      const reps = set.reps;

      candidates.push({
        exerciseId: ex.exerciseId,
        exerciseName: ex.exerciseName,
        recordType: "max_weight",
        value: weight,
        setId: set.id,
      });
      candidates.push({
        exerciseId: ex.exerciseId,
        exerciseName: ex.exerciseName,
        recordType: "max_volume",
        value: weight * reps,
        setId: set.id,
      });
      const repMaxType = repMaxTypeForReps(reps);
      if (repMaxType !== null) {
        candidates.push({
          exerciseId: ex.exerciseId,
          exerciseName: ex.exerciseName,
          recordType: repMaxType,
          value: weight,
          setId: set.id,
        });
      }
    }
  }

  // Collapse to one winner per (exerciseId, recordType).
  const bestPerKey = new Map<string, Candidate>();
  for (const c of candidates) {
    const k = `${c.exerciseId}|${c.recordType}`;
    const existing = bestPerKey.get(k);
    if (!existing || c.value > existing.value) {
      bestPerKey.set(k, c);
    }
  }

  // Emit PRs that beat their priors. Skip first-occurrence (no prior
  // → no surfaced PR). Apply the same `toFixed(2) → parseFloat`
  // round-trip the server uses so the local prediction's `value`
  // agrees byte-for-byte with what the server will compute — without
  // it, `max_volume` float artefacts (e.g. 99.99 × 10 =
  // 999.9000000000001) would render a slightly-different number on
  // the local prediction vs the server-truth swap.
  const records: PersonalRecord[] = [];
  for (const [k, candidate] of bestPerKey) {
    const prior = priorByKey.get(k);
    if (prior == null) continue;
    const valueAt2dp = parseFloat(candidate.value.toFixed(2));
    if (valueAt2dp > prior) {
      records.push({
        id: `local-${idFactory()}`,
        userId: ctx.userId,
        exerciseId: candidate.exerciseId,
        exerciseName: candidate.exerciseName,
        recordType: candidate.recordType,
        value: valueAt2dp,
        achievedAt: ctx.now,
        sessionId: session.id,
        setId: candidate.setId,
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
