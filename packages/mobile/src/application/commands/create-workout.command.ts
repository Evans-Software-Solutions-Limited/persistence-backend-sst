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

  const exercises: WorkoutExercise[] = sanitized.exercises.map((ex, idx) => ({
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
    exercise: null,
  }));

  const workout: Workout = {
    id: workoutId,
    name: sanitized.name,
    description: sanitized.description ?? null,
    createdBy: deps.userId,
    visibility: sanitized.visibility ?? "private",
    estimatedDurationMinutes: sanitized.estimatedDurationMinutes ?? 30,
    exercises,
    createdAt: nowDate,
    updatedAt: nowDate,
  };

  // Optimistic write into detail + mine list slice. We do NOT touch the
  // assigned/default slices — a freshly created workout belongs under
  // mine. Anyone consuming those slices will see the new row when their
  // next refresh fires.
  deps.storage.cacheWorkoutDetail(deps.userId, workout);
  const existingMine = deps.storage.getCachedWorkoutsList(deps.userId, "mine");
  deps.storage.cacheWorkoutsList(
    deps.userId,
    "mine",
    [workout, ...(existingMine?.workouts ?? [])],
    existingMine?.quota ?? null,
  );

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

  return ok(workout);
}
