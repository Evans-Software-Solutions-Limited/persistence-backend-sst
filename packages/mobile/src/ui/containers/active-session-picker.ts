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
 * The exercise the substitute picker is ranking AGAINST — the identity of the row
 * the user tapped Substitute on.
 *
 * ⚠ **Replaces `resolveSubstituteMuscleFilter` / `resolveSubstituteMuscleLabels`
 * (deleted in spec-21 T-2.7).** Those resolved the source's primary muscle groups
 * so the picker could narrow the LOCAL exercise cache client-side, and its chip
 * could explain the narrowing. Ranking is now `GET /exercises/substitutes`, which
 * needs only the source's id: it derives the muscles itself, ranks on five more
 * signals than muscle overlap, and — the part the client could not do — scopes
 * the read to what this user is allowed to see (AC-3.6).
 *
 * Returns `null` when the picker isn't in substitute mode or the source row has
 * fallen out of the session. In that case the sheet has nothing to rank against
 * and shows its empty state, which is the honest answer: a full unranked library
 * dump is what the old fallback did, and it was never useful for a swap.
 *
 * `name` comes from the CACHE and falls back to the sheet's default, because it
 * is only the sheet's eyebrow. A cache miss must not stop the swap — the ranking
 * itself needs no cache at all.
 */
export function resolveSubstituteSourceRef(
  mode: ActiveSessionPickerMode,
  exercises: readonly { id: string; exerciseId: string }[],
  storage: StoragePort,
): { readonly id: string; readonly name: string | null } | null {
  if (mode?.kind !== "substitute") return null;
  const oldRow = exercises.find((ex) => ex.id === mode.oldSessionExerciseId);
  if (!oldRow) return null;
  return {
    id: oldRow.exerciseId,
    name: storage.getCachedExercise(oldRow.exerciseId)?.name ?? null,
  };
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
