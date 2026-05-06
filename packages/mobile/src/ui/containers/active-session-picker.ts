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
