/**
 * Pure dispatcher for the active-session picker callback. Pulled out
 * of `ActiveSessionContainer.tsx` so commit-9 unit tests can drive
 * the substitute / add / no-op branches in isolation without
 * rendering the AddExercisePopover modal or the expo-router surface.
 *
 * Spec: specs/05-active-session/requirements.md STORY-004 / STORY-009
 *       specs/milestones/M3-active-session/EXECUTION_PLAN.md § 2 Commit 7
 */

import {
  addExerciseCommand,
  substituteExerciseCommand,
} from "@/application/commands/session";
import type { Exercise } from "@/domain/models/exercise";
import type { ApiPort } from "@/domain/ports/api.port";
import type { StoragePort } from "@/domain/ports/storage.port";

export type LegacyPickerRow = {
  id: string;
  name: string;
};

export type ActiveSessionPickerMode =
  | { kind: "substitute"; oldSessionExerciseId: string }
  | { kind: "add" }
  | null;

export type ApplyPickerSelectionDeps = {
  rows: readonly LegacyPickerRow[];
  mode: ActiveSessionPickerMode;
  resolveExercise: (row: LegacyPickerRow) => Exercise | null;
  storage: StoragePort;
  generateId: () => string;
  userId: string;
  /** Called once after the dispatch lands at least one command. */
  onAfter: () => void;
};

/**
 * Resolve a legacy `(id, name)` picker row into the canonical V2
 * `Exercise` model via the local exercise cache. Returns null on
 * cache miss — callers (substitute / add command paths) silently
 * skip unresolved rows. Pure dependency-injected; the container
 * wires `storage` + `api` once and forwards this resolver to
 * `applyPickerSelection`.
 */
export function resolveLegacyExercise(
  storage: StoragePort,
  api: ApiPort,
  row: LegacyPickerRow,
): Exercise | null {
  const cached = storage.getCachedExercise(row.id);
  if (!cached) return null;
  return api.enrichExerciseLabels(cached);
}

/**
 * Resolve the substitute picker's muscle-group filter. When the user
 * taps Substitute on a session row, we narrow the picker to exercises
 * that share at least one primary muscle group with the original
 * (Story-004 AC: "Opens exercise picker filtered by same muscle
 * group"). Returns undefined when:
 *   - the picker is not in substitute mode
 *   - the source exercise's row isn't in the session anymore
 *   - the source exercise isn't in the local cache (the picker then
 *     falls back to the unfiltered library)
 *
 * Pure helper extracted from the container so the substitute /
 * fallback / no-mode branches are unit-testable without rendering.
 */
export function resolveSubstituteMuscleFilter(
  mode: ActiveSessionPickerMode,
  exercises: readonly { id: string; exerciseId: string }[],
  storage: StoragePort,
): readonly string[] | undefined {
  if (mode?.kind !== "substitute") return undefined;
  const oldRow = exercises.find((ex) => ex.id === mode.oldSessionExerciseId);
  if (!oldRow) return undefined;
  const cached = storage.getCachedExercise(oldRow.exerciseId);
  return cached?.primaryMuscleGroups ?? undefined;
}

/**
 * - Empty `rows` → no-op (caller resets pickerMode).
 * - `substitute` mode → resolve the first row, fire
 *   `substituteExerciseCommand`, call `onAfter`.
 * - `add` mode → resolve every row, fire `addExerciseCommand` per
 *   resolved exercise, call `onAfter` once at the end.
 * - Unresolved rows (cache miss) silently skip.
 */
export function applyPickerSelection(deps: ApplyPickerSelectionDeps): void {
  const { rows, mode, resolveExercise, storage, generateId, userId, onAfter } =
    deps;
  if (rows.length === 0) return;
  if (mode?.kind === "substitute") {
    const exercise = resolveExercise(rows[0]);
    if (!exercise) return;
    substituteExerciseCommand(
      { storage, generateId, userId },
      {
        oldSessionExerciseId: mode.oldSessionExerciseId,
        newExercise: exercise,
      },
    );
    onAfter();
    return;
  }
  if (mode?.kind === "add") {
    let added = 0;
    for (const row of rows) {
      const exercise = resolveExercise(row);
      if (!exercise) continue;
      addExerciseCommand({ storage, generateId, userId }, { exercise });
      added++;
    }
    if (added > 0) onAfter();
  }
}
