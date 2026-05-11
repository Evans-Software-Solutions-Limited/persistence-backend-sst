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

/**
 * Lightweight row contract emitted by the picker UI components when
 * the user taps Add / Add-to-Superset / Substitute. Just `(id, name)`
 * — the dispatcher rehydrates the full `Exercise` via
 * `resolvePickerExercise` against the local cache.
 */
export type PickerExerciseRow = {
  id: string;
  name: string;
};

export type ActiveSessionPickerMode =
  | { kind: "substitute"; oldSessionExerciseId: string }
  | { kind: "add" }
  | { kind: "add-to-superset"; supersetGroup: number }
  /**
   * "Superset" button on the multi-select picker — take the picked
   * rows and add them all as a NEW superset (one fresh group number
   * shared across every row). Distinct from `add-to-superset` which
   * appends to an EXISTING group.
   */
  | { kind: "create-superset" }
  | null;

export type ApplyPickerSelectionDeps = {
  rows: readonly PickerExerciseRow[];
  mode: ActiveSessionPickerMode;
  resolveExercise: (row: PickerExerciseRow) => Exercise | null;
  storage: StoragePort;
  generateId: () => string;
  userId: string;
  /** Called once after the dispatch lands at least one command. */
  onAfter: () => void;
};

/**
 * Rehydrate a `(id, name)` picker row into the canonical V2 `Exercise`
 * model via the local exercise cache. Returns null on cache miss —
 * callers (substitute / add command paths) silently skip unresolved
 * rows. Pure dependency-injected; the container wires `storage` +
 * `api` once and forwards this resolver to `applyPickerSelection`.
 */
export function resolvePickerExercise(
  storage: StoragePort,
  api: ApiPort,
  row: PickerExerciseRow,
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
 * Display labels matching `resolveSubstituteMuscleFilter` — drives the
 * SwapExercisePopover's visible muscle-filter chip ("Filtered by
 * Chest, Triceps") so the user sees WHY the list is narrowed.
 *
 * Returns undefined for non-substitute modes, missing source rows, or
 * cache misses; the chip just doesn't render in those cases.
 */
export function resolveSubstituteMuscleLabels(
  mode: ActiveSessionPickerMode,
  exercises: readonly { id: string; exerciseId: string }[],
  storage: StoragePort,
): readonly string[] | undefined {
  if (mode?.kind !== "substitute") return undefined;
  const oldRow = exercises.find((ex) => ex.id === mode.oldSessionExerciseId);
  if (!oldRow) return undefined;
  const cached = storage.getCachedExercise(oldRow.exerciseId);
  return cached?.primaryMuscleGroupLabels ?? undefined;
}

/**
 * Source-exercise UUID for the substitute picker — passed as
 * `currentExerciseId` to disable that row in the list so the user
 * can't no-op-swap to the same exercise (legacy parity).
 *
 * Returns null for non-substitute modes or when the session no longer
 * contains the source row (the picker simply doesn't disable any row
 * in that case).
 */
export function resolveSubstituteSourceExerciseId(
  mode: ActiveSessionPickerMode,
  exercises: readonly { id: string; exerciseId: string }[],
): string | null {
  if (mode?.kind !== "substitute") return null;
  const oldRow = exercises.find((ex) => ex.id === mode.oldSessionExerciseId);
  return oldRow?.exerciseId ?? null;
}

/**
 * - Empty `rows` → no-op (caller resets pickerMode).
 * - `substitute` mode → resolve the first row, fire
 *   `substituteExerciseCommand`, call `onAfter`.
 * - `add` mode → resolve every row, fire `addExerciseCommand` per
 *   resolved exercise (supersetGroup=null), call `onAfter` once at the
 *   end.
 * - `add-to-superset` mode → resolve every row, fire `addExerciseCommand`
 *   with the mode's `supersetGroup` so the new rows land directly in the
 *   target superset (legacy "Add Exercise to Superset" flow).
 * - `create-superset` mode → allocate a fresh superset group from the
 *   active session (max existing group + 1, or 1 if none), then fire
 *   `addExerciseCommand` for every row with that shared group. Hits
 *   the legacy multi-select picker's "Superset" CTA — distinct from
 *   plain `add` (no group) and `add-to-superset` (existing group).
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
  if (
    mode?.kind === "add" ||
    mode?.kind === "add-to-superset" ||
    mode?.kind === "create-superset"
  ) {
    const supersetGroup = resolveDispatchSupersetGroup(mode, storage, userId);
    let added = 0;
    for (const row of rows) {
      const exercise = resolveExercise(row);
      if (!exercise) continue;
      addExerciseCommand(
        { storage, generateId, userId },
        { exercise, supersetGroup },
      );
      added++;
    }
    if (added > 0) onAfter();
  }
}

/**
 * Pick the supersetGroup for the dispatch loop.
 *
 * - `add` → null (plain row, no group)
 * - `add-to-superset` → the mode's existing group
 * - `create-superset` → next available group (max+1 of every non-null
 *   supersetGroup on the live session's exercises, or 1 if none).
 *   Reads from storage at dispatch time so the group allocation is
 *   atomic with the writes that follow.
 */
function resolveDispatchSupersetGroup(
  mode:
    | { kind: "add" }
    | { kind: "add-to-superset"; supersetGroup: number }
    | { kind: "create-superset" },
  storage: StoragePort,
  userId: string,
): number | null {
  if (mode.kind === "add") return null;
  if (mode.kind === "add-to-superset") return mode.supersetGroup;
  const session = storage.getActiveSession(userId);
  const usedGroups = (session?.exercises ?? [])
    .map((ex) => ex.supersetGroup)
    .filter((g): g is number => g != null);
  return usedGroups.length > 0 ? Math.max(...usedGroups) + 1 : 1;
}
