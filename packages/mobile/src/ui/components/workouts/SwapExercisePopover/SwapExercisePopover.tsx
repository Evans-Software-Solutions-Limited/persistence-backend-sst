/**
 * SwapExercisePopover — the single-select substitute picker on the active-session
 * screen.
 *
 * ## ⚠ REWRITTEN for spec-21 T-2.7 — it is now a thin adapter over the shared
 * `<EquipmentAwareSwapSheet>`
 *
 * What it used to be: a full-screen `Modal` listing the LOCAL exercise cache,
 * narrowed by a client-side memo that kept any exercise sharing one primary
 * muscle group with the source. Its own header comment recorded why —
 * _"V2 has no `similar_to` API"_. There is one now (`GET /exercises/substitutes`,
 * spec-21 § 6.4), and design § 10 / AC-4.4 call for ONE equipment-aware picker
 * serving both this surface and the Loadout review row rather than two that drift.
 *
 * Three consequences worth stating, because they are behaviour changes to a
 * shipped surface rather than a refactor:
 *
 *  1. **Candidates are ranked, not just filtered**, and each row can say why it
 *     matched (§ 6.2 signals). The visible "Filtered by <muscle>" chip is gone —
 *     it existed to explain a filter that no longer describes what the list is.
 *  2. **The read is visibility-scoped server-side.** The device's exercise cache
 *     is not visibility-aware, so the old client-side filter could not enforce
 *     AC-3.6; this one is enforced by `buildVisibilityCondition`.
 *  3. **No kit context is supplied here** — an in-session swap does not know what
 *     equipment is in the room. The endpoint is explicitly built for that
 *     (`best` empty, everything ranked into `others`, nothing marked
 *     incompatible), which is why the sheet gates its dimming and its
 *     `isUserOverride` acknowledgement on a kit context being present.
 *
 * ## ⚠ The cache-resolution guard is load-bearing, not defensive padding
 *
 * The caller's `applyPickerSelection` resolves the picked row through
 * `storage.getCachedExercise(id)` and **returns silently when it misses** — the
 * substitute is written from a full local `Exercise`, not from the picker row.
 * The old picker could not miss, because it only ever listed the cache. This one
 * lists the SERVER, which can legitimately return an exercise the 24h-stale cache
 * has never seen (one created on another device an hour ago). Without the
 * refresh-and-retry below, tapping that row would close the sheet and do nothing
 * at all, with no error — the worst possible failure for a swap mid-session.
 *
 * ## ⚠ …and the SERVER has the mirror-image blind spot: exercises you just made
 *
 * `createExerciseCommand` is offline-first — it writes a `local-…` row into
 * `cached_exercises` and enqueues `POST /exercises` for the next sync window,
 * with no immediate flush. Until that drains, `GET /exercises/substitutes`
 * cannot return it. This sheet's own header CTA routes to the creator, so
 * "swap → Create → come back" is both the most direct way to create an exercise
 * AND, on a purely server-backed list, the one place it would not appear —
 * exactly the bug Brad reported from a live session and #340 fixed on the
 * cache-reading picker this component replaced. `localOnlyCandidates` below
 * feeds those rows back in, under their own heading, invalidated by the same
 * pair of signals #340 used.
 *
 * The props contract (`visible` / `onSwap(rows)` / `existingExerciseIds`) is
 * UNCHANGED so `ActiveSessionContainer`'s picker routing and its tests keep
 * working; `filterByPrimaryMuscleGroups` / `filterMuscleGroupLabels` are accepted
 * and ignored (see their docs below).
 *
 * Spec: specs/21-adaptive-workout-ai/design.md § 10 · tasks.md T-2.7 (AC-4.4)
 *       specs/05-active-session/requirements.md STORY-004 (the surface it serves)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { EXERCISE_TABLES } from "@/adapters/storage";
import { refreshExerciseCache } from "@/application/queries/exercises.query";
import type { SubstituteCandidate } from "@/domain/models/loadout";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useCacheRevision } from "@/ui/hooks/useCacheRevision";
import { useExerciseLibrary } from "@/ui/hooks/useExerciseLibrary";
import { EquipmentAwareSwapSheet } from "../EquipmentAwareSwapSheet";
import { toPickerExerciseRow } from "../AddExercisePopover/picker-row";

/**
 * The prefix `createExerciseCommand` puts on a locally-generated id. An exercise
 * still carrying one has not been accepted by the server, so no server-side read
 * can return it.
 */
const PENDING_SYNC_ID_PREFIX = "local-";

export type SwapExercisePopoverProps = {
  readonly visible: boolean;
  readonly onClose: () => void;
  /**
   * Fires with the picked exercise wrapped in a single-element array so the
   * dispatcher (`applyPickerSelection`) can reuse its `rows` loop — matches
   * `AddExercisePopover.onAddExercises` and keeps the picker-routing wiring
   * uniform across modes.
   */
  readonly onSwap: (rows: any[]) => void;
  /**
   * Exercise UUIDs already in the active session — shown disabled so the user
   * can't pick a duplicate (legacy parity). The source row being swapped out is
   * part of this set, which also covers the "can't no-op swap to itself" case.
   */
  readonly existingExerciseIds?: readonly string[];
  /**
   * The source exercise, so the endpoint knows what to rank against.
   *
   * Optional because the caller resolves it from the session and can legitimately
   * come up empty (row gone, cache miss). With no source there is nothing to rank
   * and the sheet renders its empty state rather than a full library dump.
   */
  readonly forExerciseId?: string | null;
  /** Source exercise name — the sheet's eyebrow. */
  readonly exerciseName?: string;
  /**
   * @deprecated Ignored since T-2.7. Ranking is server-side and richer than a
   * primary-muscle overlap. Kept in the props so the call site and its tests did
   * not have to change in the same commit as the behaviour; remove once
   * `ActiveSessionContainer` stops resolving them.
   */
  readonly filterByPrimaryMuscleGroups?: readonly string[];
  /** @deprecated Ignored since T-2.7 — see `filterByPrimaryMuscleGroups`. */
  readonly filterMuscleGroupLabels?: readonly string[];
};

export function SwapExercisePopover({
  visible,
  onClose,
  onSwap,
  existingExerciseIds = [],
  forExerciseId = null,
  exerciseName = "Swap exercise",
}: SwapExercisePopoverProps) {
  const router = useRouter();
  const { api, storage } = useAdapters();
  const [resolveFailed, setResolveFailed] = useState(false);
  const [isResolving, setIsResolving] = useState(false);

  // ⚠ Cleared on every open. This component never unmounts — `ActiveSessionContainer`
  // renders it unconditionally and drives it by prop — so without this, a failed
  // resolve on row A leaves "That exercise isn't available on this device yet"
  // sitting above a perfectly good list the next time the user swaps row B, for
  // an exercise they never touched.
  useEffect(() => {
    if (visible) setResolveFailed(false);
  }, [visible]);

  /** Latches on the first open and never unlatches — see `localOnlyCandidates`. */
  const [hasOpened, setHasOpened] = useState(false);
  useEffect(() => {
    if (visible) setHasOpened(true);
  }, [visible]);

  // ⚠ Both invalidation signals, deliberately — the same pair `AddExercisePopover`
  // and (since #340) the old cache-reading swap picker already carried. They fire
  // independently: the storage change bus on any local write, `markChanged()`
  // explicitly from `CreateExerciseContainer`. This component never unmounts
  // (`ActiveSessionContainer` renders it unconditionally and drives it by prop),
  // so a read memoised on `[storage]` alone would be captured once per session.
  const storageRevision = useCacheRevision(EXERCISE_TABLES);
  const libraryRevision = useExerciseLibrary((s) => s.revision);

  /**
   * The caller's own custom exercises that are still queued for sync.
   *
   * NOT muscle-filtered against the source, unlike the server's ranked lists.
   * The only way into this list is to have just created the exercise — almost
   * always from this sheet's own Create CTA, in order to swap it in — so hiding
   * it behind a relevance rule it may not satisfy would reproduce the bug it
   * exists to close. The set is small and self-draining: a row leaves it the
   * moment the sync queue rekeys it to a server id, after which the endpoint
   * ranks it like anything else.
   */
  const localOnlyCandidates = useMemo<readonly SubstituteCandidate[]>(() => {
    // ⚠ Latched on "has ever been opened", NOT on `visible`, and neither half is
    // interchangeable with the other.
    //
    // Not `visible`: `BottomSheet` keeps its children mounted through the close
    // animation, so emptying this on dismiss makes the group vanish while it is
    // still on screen — and for an unsynced source, where the ranked lists are
    // empty and this group is the only content, that turns the whole sheet into
    // "No alternatives found for this exercise." on the way out.
    //
    // But not ungated either. `ActiveSessionContainer` renders this component
    // unconditionally, and `getCachedExercises()` is a full table read with a
    // `JSON.parse` per row — `ExerciseListContainer` measures it at ~2.3k rows
    // in production. Ungated, tapping Start Workout runs that synchronously
    // during the session screen's first render for a sheet that may never be
    // opened, then again on every `cached_exercises` write for the life of the
    // session. That is the shape #341 spent a whole PR removing.
    if (!hasOpened) return [];
    void storageRevision;
    void libraryRevision;
    return storage
      .getCachedExercises()
      .filter((exercise) => exercise.id.startsWith(PENDING_SYNC_ID_PREFIX))
      .map((exercise) => ({
        id: exercise.id,
        name: exercise.name,
        category: exercise.category ?? null,
        difficultyLevel: exercise.difficulty ?? null,
        thumbnailUrl: exercise.thumbnailUrl ?? null,
        // Empty, not `exercise.equipment`: that field holds the creator form's
        // `EquipmentType` enum members, while `equipmentRequired` is catalogue
        // UUIDs. Mapping one onto the other would put ids into the sheet that
        // `equipmentNameById` can never resolve. Nothing reads it here anyway —
        // the in-session swap supplies no kit context, so no row is incompatible.
        equipmentRequired: [],
        // Nothing ranked these, so they claim no match signals.
        matchedOn: [],
      }));
  }, [hasOpened, storage, storageRevision, libraryRevision]);

  const onCreateExercise = useCallback(() => {
    // Close first so the full-screen creator isn't stacked behind an open sheet.
    onClose();
    router.push("/(app)/exercises/create" as never);
  }, [onClose, router]);

  const onSelect = useCallback(
    async (candidate: SubstituteCandidate) => {
      // `isUserOverride` is discarded on purpose: with no kit context the sheet
      // never marks anything incompatible, so it is always false here. The
      // in-session substitute has no equipment-containment contract to override —
      // that concept belongs to the Loadout save path.
      let cached = storage.getCachedExercise(candidate.id);
      if (!cached) {
        // ⚠ Re-entrancy guard, not politeness. `refreshExerciseCache` walks up
        // to REFRESH_MAX_PAGES sequential `getExercises` calls, so on a large
        // library the sheet is inert for seconds while the user is standing at a
        // rack — and every impatient re-tap would start ANOTHER full-library walk
        // against the same storage. The busy flag also gives the sheet something
        // to show, instead of looking like the tap did nothing.
        if (isResolving) return;
        setIsResolving(true);
        try {
          // One refresh, then one retry. See the cache-resolution note in the
          // file header: a server-visible exercise missing from a stale local
          // cache is a real case, and the alternative is a swap that silently
          // does nothing.
          await refreshExerciseCache(api, storage);
          cached = storage.getCachedExercise(candidate.id);
        } catch {
          // ⚠ `refreshExerciseCache` returns a Result for API failure, but its
          // `storage.cacheExercises` write can THROW (SQLite locked, disk).
          // Uncaught, the rejection escapes through `void onSelect(...)` and
          // `setResolveFailed` below never runs — reproducing exactly the silent
          // no-op this whole path exists to prevent.
          cached = null;
        } finally {
          setIsResolving(false);
        }
      }
      if (!cached) {
        setResolveFailed(true);
        return;
      }
      setResolveFailed(false);
      onSwap([toPickerExerciseRow(api.enrichExerciseLabels(cached))]);
    },
    [api, storage, onSwap, isResolving],
  );

  return (
    <EquipmentAwareSwapSheet
      visible={visible}
      onClose={onClose}
      forExerciseId={forExerciseId}
      exerciseName={exerciseName}
      existingExerciseIds={existingExerciseIds}
      localOnlyCandidates={localOnlyCandidates}
      onSelect={(candidate) => void onSelect(candidate)}
      onCreateExercise={onCreateExercise}
      unavailableMessage={
        isResolving
          ? "Fetching that exercise…"
          : resolveFailed
            ? "That exercise isn't available on this device yet. Pull to refresh your library and try again."
            : null
      }
      testID="swap-picker-sheet"
    />
  );
}
