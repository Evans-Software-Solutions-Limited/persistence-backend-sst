import { mapCreateExerciseInputToApi } from "@/adapters/api/sst-api.adapter";
import type {
  CreateExerciseInput,
  Exercise,
  MuscleGroup,
} from "@/domain/models/exercise";
import type { StoragePort } from "@/domain/ports/storage.port";
import { validateExerciseInput } from "@/domain/services/exercise.service";
import { ok, type Result, type ValidationError } from "@/shared/errors";

/**
 * Dependencies for `updateExerciseCommand`. Storage-only — like the create
 * command, the update path never awaits the network. It writes the edit to
 * the local cache and lets the sync engine flush it on the next online window.
 */
export type UpdateExerciseCommandDeps = {
  storage: StoragePort;
};

/**
 * Edit a custom exercise: validate → persist locally → coalesce-or-enqueue the
 * API sync. Offline-first, no network await.
 *
 * Flow:
 *   1. Validate the granular input via the domain service. On failure, return
 *      the ValidationError unchanged (no side effects, no mutation touched).
 *   2. Sanitize once. Unlike create, empty optional text fields are sent as
 *      explicit `""` (not dropped) so an edit can CLEAR a field the exercise
 *      previously had — otherwise a PATCH that omits the key leaves the old
 *      server value in place.
 *   3. Upsert the updated row into the local cache (optimistic). Immutable
 *      identity fields — `id`, `isCustom`, `createdBy` — are carried over from
 *      the existing exercise unchanged.
 *   4. Sync, in one of two ways:
 *      a. **Coalesce** — if a mutation for this exercise is still queued
 *         (its create POST hasn't flushed, or a prior edit's PATCH is still
 *         pending), rewrite THAT entry's payload in place via
 *         `updateMutationPayload`. A still-pending create stays a create, so
 *         when it flushes it POSTs the final edited state — we never PATCH a
 *         `local-*` id the server has never seen (which would 404). Rapid
 *         re-edits collapse onto the single pending entry.
 *      b. **Enqueue** — otherwise the exercise already exists server-side
 *         (real id); enqueue a `PATCH /exercises/:id`. The sync engine flushes
 *         the wire-format payload verbatim — same generic path as create, no
 *         per-entity dispatch.
 *
 * Matches the adapter's online `updateExercise` (PATCH + the same
 * `mapCreateExerciseInputToApi` body), so the cache and a later full refresh
 * agree. Spec: specs/04-workout-management/requirements.md STORY-008
 *   (AC 8.1, 8.2, 8.3) · design.md § <ExerciseEditorPresenter>.
 */
export function updateExerciseCommand(
  deps: UpdateExerciseCommandDeps,
  existing: Exercise,
  input: CreateExerciseInput,
): Result<Exercise, ValidationError> {
  const validation = validateExerciseInput(input);
  if (!validation.ok) return validation;

  const sanitized = sanitizeUpdateInput(input);

  const updated: Exercise = {
    ...existing,
    name: sanitized.name,
    // For the optional text fields, the sanitizer preserves the
    // undefined-vs-"" distinction the wire payload relies on:
    //   - `undefined` → the field wasn't part of this edit (the editor form
    //     exposes neither `description` nor `videoUrl`, and emits `undefined`
    //     for a cleared photo). The PATCH omits the key, so the SERVER keeps
    //     its value — the cache MUST keep `existing` too, or the two drift
    //     until the next refresh silently restores the original.
    //   - `""` → the user explicitly cleared the field. Cache stores `null`
    //     and the PATCH sends `""` so the clear lands server-side as well.
    // `sanitized.x || null` alone (the prior code) collapsed both cases to
    // `null`, wiping a cached value the edit never touched.
    description:
      sanitized.description !== undefined
        ? sanitized.description || null
        : existing.description,
    instructions: sanitized.instructions || null,
    category: sanitized.category,
    difficulty: sanitized.difficulty,
    primaryMuscleGroups: sanitized.primaryMuscleGroups,
    secondaryMuscleGroups: sanitized.secondaryMuscleGroups,
    equipment: sanitized.equipment,
    videoUrl:
      sanitized.videoUrl !== undefined
        ? sanitized.videoUrl || null
        : existing.videoUrl,
    thumbnailUrl:
      sanitized.thumbnailUrl !== undefined
        ? sanitized.thumbnailUrl || null
        : existing.thumbnailUrl,
  };

  deps.storage.saveCustomExercise(updated);

  const payload = mapCreateExerciseInputToApi(sanitized);

  // Coalesce onto a still-pending mutation for the same exercise if one
  // exists, regardless of whether it's the original create or a prior edit's
  // PATCH — rewriting the payload keeps a single in-order entry and avoids a
  // PATCH against an id the server hasn't assigned yet.
  const pending = deps.storage
    .getPendingMutations()
    .find((e) => e.entityType === "exercise" && e.entityId === existing.id);

  if (pending) {
    deps.storage.updateMutationPayload(pending.id, payload);
  } else {
    deps.storage.enqueueMutation({
      entityType: "exercise",
      entityId: existing.id,
      operation: "update",
      payload,
      endpoint: `/exercises/${existing.id}`,
      method: "PATCH",
    });
  }

  return ok(updated);
}

/**
 * Trim free-text fields. Unlike the create command's `sanitizeInput`, optional
 * text fields are kept as explicit `""` rather than dropped to `undefined`, so
 * the resulting PATCH carries the empty value and clears a field the user
 * removed. Required fields pass through unchanged. Pure; returns a new object.
 */
function sanitizeUpdateInput(
  input: CreateExerciseInput,
): CreateExerciseInput & { secondaryMuscleGroups: MuscleGroup[] } {
  const sanitized = {
    name: input.name.trim(),
    category: input.category,
    difficulty: input.difficulty,
    primaryMuscleGroups: input.primaryMuscleGroups,
    secondaryMuscleGroups: input.secondaryMuscleGroups ?? [],
    equipment: input.equipment,
    instructions: input.instructions?.trim() ?? "",
  } as CreateExerciseInput & { secondaryMuscleGroups: MuscleGroup[] };

  const description = input.description?.trim();
  if (description !== undefined) sanitized.description = description;

  const videoUrl = input.videoUrl?.trim();
  if (videoUrl !== undefined) sanitized.videoUrl = videoUrl;

  const thumbnailUrl = input.thumbnailUrl?.trim();
  if (thumbnailUrl !== undefined) sanitized.thumbnailUrl = thumbnailUrl;

  return sanitized;
}
