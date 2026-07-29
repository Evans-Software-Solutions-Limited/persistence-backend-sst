/**
 * Create-workout command — offline-capable; mirrors create-exercise (M0).
 *
 * Flow:
 *   1. Validate the input via the domain service. Failure short-circuits.
 *   2. Sanitize once; the SAME sanitized payload is used for the local
 *      cache and the enqueued sync mutation.
 *   3. Build a Workout with a `local-` prefixed id (the sync engine
 *      recognises this as awaiting a server id).
 *   4. Write the local row into both the detail cache and the `mine` list
 *      slice (optimistic UI).
 *   5. Enqueue a POST /workouts mutation. The sync engine flushes
 *      verbatim — payload is already in wire format (camelCase), no
 *      per-entity dispatch needed.
 *
 * Spec: specs/04-workout-management/design.md § Offline Strategy
 *       specs/04-workout-management/requirements.md STORY-008 AC 8.3
 */

import {
  calculateEstimatedDuration,
  sanitizeCreateWorkoutInput,
  validateWorkoutInput,
} from "@/domain/services/workout.service";
import type {
  CreateWorkoutInput,
  Workout,
  WorkoutExercise,
} from "@/domain/models/workout";
import type { StoragePort } from "@/domain/ports/storage.port";
import { ok, type Result, type ValidationError } from "@/shared/errors";

export type CreateWorkoutCommandDeps = {
  storage: StoragePort;
  generateId: () => string;
  /** User id of the creator — stored on the Workout and scoping cache writes. */
  userId: string;
  /**
   * Override clock for deterministic tests; defaults to Date.now-derived
   * ISO timestamps.
   */
  now?: () => Date;
};

export function createWorkoutCommand(
  deps: CreateWorkoutCommandDeps,
  input: CreateWorkoutInput,
): Result<Workout, ValidationError> {
  const validation = validateWorkoutInput(input);
  if (!validation.ok) return validation;

  const sanitized = sanitizeCreateWorkoutInput(input);
  const nowDate = (deps.now?.() ?? new Date()).toISOString();
  const workoutId = `local-${deps.generateId()}`;

  // Hydrate `exercise` from the local exercise library cache. The
  // backend response (when sync flushes) returns the join-populated
  // shape; we mirror that here so downstream consumers (the session
  // start flow in particular) see `wx.exercise.name` immediately,
  // not after the next workout-detail refresh. Without this, a session
  // started right after create renders the exercise UUID in the name
  // column.
  const exercises: WorkoutExercise[] = sanitized.exercises.map((ex, idx) => {
    const cached = deps.storage.getCachedExercise(ex.exerciseId);
    return {
      id: `local-${deps.generateId()}-${idx}`,
      exerciseId: ex.exerciseId,
      sortOrder: ex.sortOrder,
      supersetGroup: ex.supersetGroup ?? null,
      targetSets: ex.targetSets ?? null,
      targetRepsMin: ex.targetRepsMin ?? 1,
      targetRepsMax: ex.targetRepsMax ?? 1,
      targetDurationSeconds: ex.targetDurationSeconds ?? null,
      restSeconds: ex.restSeconds ?? 90,
      notes: ex.notes ?? null,
      exercise: cached
        ? {
            id: cached.id,
            name: cached.name,
            category: cached.category,
            difficultyLevel: cached.difficulty,
            videoUrl: cached.videoUrl,
            thumbnailUrl: cached.thumbnailUrl,
          }
        : null,
    };
  });

  const workout: Workout = {
    id: workoutId,
    name: sanitized.name,
    description: sanitized.description ?? null,
    createdBy: deps.userId,
    visibility: sanitized.visibility ?? "private",
    // Derived locally with the SAME heuristic the server applies, so the
    // optimistic row matches what the create will store. A flat 30 here made
    // the detail screen read "30 min" for a workout the server saved as 80,
    // and offline it never self-corrected (the sync drain swaps the local id
    // but does not rewrite the cached body).
    estimatedDurationMinutes:
      sanitized.estimatedDurationMinutes ??
      calculateEstimatedDuration(exercises),
    // Absent => true (personal). The coach-authoring flow passes false.
    showInOwnerLibrary: sanitized.showInOwnerLibrary ?? true,
    exercises,
    createdAt: nowDate,
    updatedAt: nowDate,
  };

  // Optimistic write into detail + mine list slice. We do NOT touch the
  // assigned/default slices — a freshly created workout belongs under
  // mine. Anyone consuming those slices will see the new row when their
  // next refresh fires.
  deps.storage.cacheWorkoutDetail(deps.userId, workout);
  // Skip the `mine` splatter for a workout the author flagged NOT
  // owner-visible (coach authoring for a client): a trainer's personal My
  // Workouts is fetched with ownerLibraryOnly=true, so adding it here would
  // briefly show a client-authored workout in the coach's personal list
  // until the next refresh re-filters it out.
  if (workout.showInOwnerLibrary !== false) {
    const existingMine = deps.storage.getCachedWorkoutsList(
      deps.userId,
      "mine",
    );
    deps.storage.cacheWorkoutsList(
      deps.userId,
      "mine",
      [workout, ...(existingMine?.workouts ?? [])],
      existingMine?.quota ?? null,
    );
  } else {
    // ...but it has to land SOMEWHERE. Skipping the `mine` slice was correct;
    // writing nothing at all was not. A coach-authored workout
    // (`?ctx=coach` → showInOwnerLibrary false) was excluded from `mine` by
    // this branch AND never written to the coach library slice, whose only
    // writer is the network path — so offline it was invisible in both lists
    // and looked like the save had failed. Prepend it to the coach library.
    const existingLibrary = deps.storage.getCachedCoachWorkoutLibrary(
      deps.userId,
    );
    deps.storage.cacheCoachWorkoutLibrary(deps.userId, [
      workout,
      ...(existingLibrary ?? []),
    ]);
  }

  deps.storage.enqueueMutation({
    entityType: "workout",
    entityId: workoutId,
    operation: "create",
    payload: sanitized,
    endpoint: "/workouts",
    method: "POST",
  });

  // Dashboard's `recentWorkouts` slice depends on the workout list;
  // dropping the cache here means the next home-tab focus refetches
  // and picks up the new row instead of showing the pre-create
  // snapshot until the dashboard's own 5-minute TTL elapses.
  deps.storage.invalidateDashboard(deps.userId);
  // ⚠ Deliberately NOT `invalidateHome`. This branch briefly added it here, on the
  // reasoning that Home reads `cached_home` rather than `cached_dashboard` — but no
  // `HomePayload` field reflects a user-authored workout (rings, micro pills, weekly
  // volume, recent PRs, habits, today's workout, programme), and Home's carousel
  // comes from `useWorkouts()`/`cached_workouts`, not from this payload. So the call
  // bought nothing and cost real behaviour: `invalidateHome` DELETES the row, and
  // after a cold start still offline there is no cached Home to fall back on — no
  // rings, no PRs, no today's training, where a snapshot had been. Reachable by
  // create-a-workout-offline → app killed → reopen offline.

  return ok(workout);
}
