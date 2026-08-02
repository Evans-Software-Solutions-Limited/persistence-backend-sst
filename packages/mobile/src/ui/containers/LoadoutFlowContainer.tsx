import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import type {
  LoadoutPreview,
  LoadoutPreviewRow,
  SubstituteCandidate,
} from "@/domain/models/loadout";
import { isEquipmentGroupingStale } from "@/domain/models/reference-list";
import type { ApiError } from "@/shared/errors";
import {
  buildVariationExercises,
  deriveVariationName,
  describeLoadoutRow,
  describeVariationSaveError,
  groupEquipmentForPicker,
} from "@/domain/services/loadout.service";
import { useLoadoutFlow, type LoadoutContext } from "@/state/loadout-flow";
import { EquipmentAwareSwapSheet } from "@/ui/components/workouts/EquipmentAwareSwapSheet";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useLoadoutGate } from "@/ui/hooks/useLoadoutGate";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import { useReferenceLists } from "@/ui/hooks/useReferenceLists";
import { useSavedGyms } from "@/ui/hooks/useSavedGyms";
import { EquipmentScanSheetContainer } from "@/ui/containers/EquipmentScanSheetContainer";
import {
  LoadoutAdaptingStep,
  type LoadoutAdaptingError,
} from "@/ui/presenters/loadout/LoadoutAdaptingStep";
import { LoadoutCollectStep } from "@/ui/presenters/loadout/LoadoutCollectStep";
import { LoadoutManualStep } from "@/ui/presenters/loadout/LoadoutManualStep";
import {
  LoadoutReviewStep,
  type LoadoutRowView,
} from "@/ui/presenters/loadout/LoadoutReviewStep";
import { LoadoutSavedStep } from "@/ui/presenters/loadout/LoadoutSavedStep";
import { color } from "@/ui/theme/tokens";

/**
 * <LoadoutFlowContainer> — the whole athlete flow (T-2.3 … T-2.8b, T-3.4).
 *
 * ## ⚠ This is a ROUTE, and two wrong answers came before it
 *
 * It renders as the `/(app)/loadout` screen, pushed onto the same Stack as the
 * workout detail that opens it. The store remains the STEP machine — which step,
 * which equipment context, which rows were hand-picked — but presentation is the
 * navigator's job, not a `visible` flag's.
 *
 * Attempt 1 was `StyleSheet.absoluteFillObject` mounted as a sibling of the
 * Stack. A sibling does not own navigator presentation and rendered underneath
 * the active screen. Tapping "Adapt to your gym" mounted the entire flow behind
 * workout detail and nothing appeared to happen.
 *
 * Attempt 2 wrapped that overlay in an RN `<Modal>`. Worse: a root-mounted modal
 * cannot reliably present over a route that is itself presented, so iOS put it
 * behind the workout sheet — and dismissing the workout then left an invisible
 * presented modal swallowing every touch. The screen froze.
 *
 * A route has none of those problems: react-native-screens presents it as its own
 * view controller above the workout's, the app root's `GestureHandlerRootView`
 * covers it because it is inside the Stack, and back/swipe-dismiss are native.
 *
 * ⚠ **Do not "simplify" this back to a root-mounted overlay or an RN Modal.**
 * Both were tried on device and both broke, the second one worse than the first.
 *
 * ## ⚠ The upsell sheet is NOT here — it belongs to the screen that opens it
 *
 * It lives in the workout-detail tree (`WorkoutDetailContainer`) as a bottom
 * sheet over its owning screen.
 * `memory/feedback_sheets_mount_at_root` is about clearing the TAB BAR, which is
 * a different concern from owning screen-local presentation.
 *
 * ## ⚠ `adapting` is bound to the request, never a timer
 *
 * The prototype's 1700 ms auto-advance must not ship. E2 measured the re-map at
 * 2.6 s p50 / 3.8 s max, and `createWithRetry` can spend 24 s on the retry path,
 * so a timer would either cut the request off visually or show a review screen
 * with no rows. Only `previewResolved` reaches `review`.
 *
 * ## ⚠ Dropped rows are filtered BEFORE `buildVariationExercises`, not inside it
 *
 * That function is the tested contract for the save payload (targets verbatim,
 * `substitutionReason` round-tripped, `isUserOverride` carried from the pick).
 * "The user chose to leave this row out" is a UI decision, not part of that
 * contract, so it is applied by narrowing the preview handed in — leaving the
 * one function that gets `isUserOverride` right untouched.
 */

/** `ApiError` → the copy branch the adapting step should show. */
export function classifyAdaptingError(error: ApiError): LoadoutAdaptingError {
  if (error.code === "entitlement_denied") return "entitlement";
  if (error.status === 429) return "limit";
  // 503 = Bedrock down, and there is deliberately NO fallback to the § 6.2
  // ranker (design § 6.0 — ranker-only output lost the bake-off 4-50). So this
  // must read as an outage, not as a transient blip.
  if (error.status === 503) return "unavailable";
  return "generic";
}

/** Superset runs get letters (A1/A2); everything else is numbered. */
export function buildRowTags(
  rows: readonly LoadoutPreviewRow[],
): readonly { readonly tag: string; readonly isSupersetMember: boolean }[] {
  const letters = "ABCDEFGH";
  const groupLetters = new Map<number, string>();
  let nextLetter = 0;
  let singleNumber = 0;
  const memberIndex = new Map<number, number>();

  return rows.map((row) => {
    if (row.supersetGroup === null) {
      singleNumber += 1;
      return { tag: `${singleNumber}`, isSupersetMember: false };
    }
    let letter = groupLetters.get(row.supersetGroup);
    if (letter === undefined) {
      letter = letters[nextLetter] ?? `${nextLetter + 1}`;
      nextLetter += 1;
      groupLetters.set(row.supersetGroup, letter);
    }
    const position = (memberIndex.get(row.supersetGroup) ?? 0) + 1;
    memberIndex.set(row.supersetGroup, position);
    return { tag: `${letter}${position}`, isSupersetMember: true };
  });
}

/** What to call the equipment context on screen. */
function contextLabel(context: LoadoutContext | null): string {
  if (context === null) return "your kit";
  return context.kind === "gym" ? context.gymName : context.label;
}

/**
 * The kit the swap sheet ranks `best` / `others` against.
 *
 * ⚠ **From the PREVIEW, not from the client's saved-gym list.** A gym context
 * sends only `savedGymId`; the server resolves the kit and echoes it back as
 * `preview.equipmentTypeIds`, so this is by definition the exact set the
 * adaptation used. Deriving it from the locally-listed gym row instead — which
 * an earlier version did — meant a gym edited on another device (or in Settings)
 * ranked a now-incompatible exercise into `best`, where it was picked with
 * `isUserOverride: false` and lost the whole reviewed adaptation to a
 * 400 `EQUIPMENT_NOT_AVAILABLE` the sheet would not offer to override, because
 * it did not think that row was incompatible.
 *
 * Null preview → undefined, but that is unreachable: the swap button only exists
 * on the review step, which only renders with a preview.
 */
function contextEquipmentIds(
  preview: LoadoutPreview | null,
): readonly string[] | undefined {
  return preview?.equipmentTypeIds;
}

export function LoadoutFlowContainer() {
  const { api } = useAdapters();
  const online = useOnlineStatus();
  const gate = useLoadoutGate();

  const step = useLoadoutFlow((s) => s.step);
  const workoutId = useLoadoutFlow((s) => s.workoutId);
  const workoutName = useLoadoutFlow((s) => s.workoutName);
  const replacementVariationId = useLoadoutFlow(
    (s) => s.replacementVariationId,
  );
  const context = useLoadoutFlow((s) => s.context);
  const collectRev = useLoadoutFlow((s) => s.collectRev);
  const preview = useLoadoutFlow((s) => s.preview);
  const manualPicks = useLoadoutFlow((s) => s.manualPicks);
  const swapTarget = useLoadoutFlow((s) => s.swapTarget);
  const goToStep = useLoadoutFlow((s) => s.goToStep);
  const selectGym = useLoadoutFlow((s) => s.selectGym);
  const selectEquipmentIds = useLoadoutFlow((s) => s.selectEquipmentIds);
  const previewResolved = useLoadoutFlow((s) => s.previewResolved);
  const openSwap = useLoadoutFlow((s) => s.openSwap);
  const closeSwap = useLoadoutFlow((s) => s.closeSwap);
  const applyManualPick = useLoadoutFlow((s) => s.applyManualPick);
  const markSaved = useLoadoutFlow((s) => s.saved);
  const reset = useLoadoutFlow((s) => s.reset);

  const isOpen = step !== null;
  const gyms = useSavedGyms(isOpen);
  const reference = useReferenceLists();

  // ── Local step state ──────────────────────────────────────────────────────
  const [selectedEquipment, setSelectedEquipment] = useState<
    ReadonlySet<string>
  >(new Set());
  const [gymName, setGymName] = useState("");
  const [saveAsGym, setSaveAsGym] = useState(true);
  const [adaptError, setAdaptError] = useState<LoadoutAdaptingError | null>(
    null,
  );
  const [attempt, setAttempt] = useState(0);
  const [droppedRows, setDroppedRows] = useState<ReadonlySet<number>>(
    new Set(),
  );
  const [acceptedRows, setAcceptedRows] = useState<ReadonlySet<number>>(
    new Set(),
  );
  /** Display names for hand-picked rows — `ManualPick` deliberately carries only ids. */
  const [pickedNames, setPickedNames] = useState<ReadonlyMap<number, string>>(
    new Map(),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** A gym this run already created, so a save retry does not 409 on itself. */
  const createdGymIdRef = useRef<string | null>(null);
  /** Invalidates async save completions when the review flow has moved on. */
  const saveRunRef = useRef(0);

  // Every run starts clean. `open()` already resets the STORE; this clears the
  // decisions that live here, which would otherwise be applied by `sortOrder` to
  // a completely different plan on the next workout.
  const runKey = `${workoutId ?? ""}`;
  const lastRunKeyRef = useRef(runKey);
  useEffect(() => {
    if (lastRunKeyRef.current === runKey) return;
    lastRunKeyRef.current = runKey;
    setSelectedEquipment(new Set());
    setGymName("");
    setSaveAsGym(true);
    setAdaptError(null);
    setDroppedRows(new Set());
    setAcceptedRows(new Set());
    setPickedNames(new Map());
    setSaveError(null);
  }, [runKey]);

  // ── Equipment catalogue ───────────────────────────────────────────────────
  const equipmentEntries = reference.equipment;

  // A cache written before Loadout has no `category` key at all, which is
  // indistinguishable from "uncategorised" — so every chip would render under
  // "Other" for up to 24 h, and nothing on screen could explain why. Force one
  // refresh when that is detected.
  const groupingRefreshedRef = useRef(false);
  useEffect(() => {
    if (!isOpen || groupingRefreshedRef.current) return;
    if (!isEquipmentGroupingStale(equipmentEntries)) return;
    groupingRefreshedRef.current = true;
    void reference.refresh();
  }, [isOpen, equipmentEntries, reference]);

  const equipmentGroups = useMemo(
    () => groupEquipmentForPicker(equipmentEntries),
    [equipmentEntries],
  );

  const equipmentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of equipmentEntries) {
      map.set(entry.id, entry.displayName ?? entry.name);
    }
    return map;
  }, [equipmentEntries]);

  // ── The preview request ───────────────────────────────────────────────────
  //
  // Keyed on (workout, context, attempt) so it fires exactly once per distinct
  // adaptation and once more per explicit retry. `preview` is cleared by
  // `selectGym`/`selectEquipmentIds`, so a re-collect always re-requests.
  const contextKey =
    context === null
      ? ""
      : context.kind === "gym"
        ? `gym:${context.gymId}`
        : `ids:${[...context.equipmentTypeIds].join(",")}`;
  // Preview identity is equipment-only, but saved-gym identity is not: the same
  // kit saved as "Home" and later "Garage" must create two distinct gyms.
  const gymCreateKey =
    context?.kind === "ids"
      ? `${contextKey}|${context.label.trim().toLowerCase()}|${context.saveAsGym}`
      : contextKey;
  const requestKey = `${workoutId ?? ""}|${contextKey}|${attempt}`;

  // ⚠ The review decisions are keyed by `sortOrder`, which comes from the PARENT
  // workout — so two previews of the same workout share one sortOrder space and
  // a decision carried across them lands on a different row by construction, not
  // by accident. The run-level reset above is keyed on the workout alone, so
  // review → back → collect again kept them.
  //
  // Keyed on `collectRev`, NOT on `contextKey`. Stage 2 of the adaptation is an
  // LLM, so re-collecting against the SAME gym can still return a different
  // substitute on the same `sortOrder` — a context-value key returns early on
  // exactly that path. The counter bumps where the store already clears
  // `manualPicks` for this same reason; these three live here and were missed.
  //
  // It bites harder than a stale banner count now that `acceptedRows` decides
  // whether a row is SAVED: accept an `intensity_mismatch`, re-collect, and the
  // row is saved with a mismatch the user was never shown — `needsAttention` is
  // false, so the review step hides the action block entirely and the presenter
  // has no marker for an accepted row. `droppedRows` is at least visible, but
  // just as wrong: a row dropped against the first kit stays out of the second
  // save even after it resolved cleanly.
  const lastCollectRevRef = useRef(collectRev);
  useEffect(() => {
    if (lastCollectRevRef.current === collectRev) return;
    lastCollectRevRef.current = collectRev;
    setDroppedRows(new Set());
    setAcceptedRows(new Set());
    setPickedNames(new Map());
    // The failed save belonged to the previous plan too, and it is otherwise
    // cleared only by tapping Save again. `EQUIPMENT_NOT_AVAILABLE` is the worst
    // of the three messages to strand: it tells the user to open a swap sheet
    // and confirm a pick that `selectGym` has just deleted.
    setSaveError(null);
  }, [collectRev]);

  // ⚠ Cleared on any CONTEXT change, not just a new workout. The id exists so a
  // save retry does not 409 on its own gym name — but scoped to the workout it
  // also survives a re-collect: create "Home" from kit1, fail on the variation,
  // go back and build "Garage" from kit2, and the second save would silently
  // reuse "Home"'s id, never create "Garage", and label a kit2 variation "Home"
  // in Saved setups forever.
  const firedRef = useRef<string | null>(null);
  const gymCreateFiredRef = useRef<string | null>(null);
  /** In flight, so `save()` can await it instead of racing it into a 409. */
  const gymCreatePromiseRef = useRef<Promise<void> | null>(null);
  useEffect(() => {
    createdGymIdRef.current = null;
    gymCreateFiredRef.current = null;
    gymCreatePromiseRef.current = null;
  }, [gymCreateKey]);

  // ── "Save this gym for next time" ─────────────────────────────────────────
  //
  // ⚠ Fired when the user COMMITS the kit, not when the variation saves — and
  // the difference is a bug Brad hit on device. The toggle's label promises
  // something about the KIT ("save this gym for next time"), unconditionally.
  // Creating the row inside `save()` instead made that promise contingent on the
  // adaptation succeeding AND the user going on to save the variation: a 503 from
  // Bedrock, a 429, or a dropped connection left them back at the collect step
  // with no saved gym and every chip to re-tick. The kit is the cheap, durable
  // half of the flow; it should not be lost with the expensive, fragile half.
  //
  // Runs alongside the preview rather than before it — a saved-gym INSERT must
  // not add latency to a request that already spends 2.6 s p50 in Bedrock.
  //
  // `save()` keeps its own create as the fallback for when this one failed
  // (most likely a 409 on a name already used), so the variation can still pick
  // up `sourceGymId` on a later attempt.
  const refreshGyms = gyms.refresh;
  useEffect(() => {
    if (step !== "adapting") return;
    const current = useLoadoutFlow.getState().context;
    if (current === null || current.kind !== "ids" || !current.saveAsGym)
      return;
    if (createdGymIdRef.current !== null) return;
    // Keyed on the context, so an explicit retry (which bumps `attempt` but
    // leaves the kit alone) does not create the gym a second time.
    if (gymCreateFiredRef.current === gymCreateKey) return;
    gymCreateFiredRef.current = gymCreateKey;

    const createContextKey = gymCreateKey;
    gymCreatePromiseRef.current = api
      .createSavedGym({
        name: current.label,
        equipmentTypeIds: current.equipmentTypeIds,
      })
      .then((result) => {
        // A slow create for gym A must not become gym B's source link after the
        // user goes back and recollects while the request is in flight.
        if (gymCreateFiredRef.current !== createContextKey) return;
        if (result.ok) createdGymIdRef.current = result.value.id;
        // Refreshed even on failure: a 409 means the gym is already there under
        // that name, and the collect step should show it either way.
        void refreshGyms();
      });
  }, [step, gymCreateKey, api, refreshGyms]);

  // ⚠ THE GUARD MUST BE CLEARED, and forgetting to was a permanent hang.
  //
  // `firedRef` exists to stop the effect double-firing on an unrelated re-render.
  // Keyed on (workout, context, attempt) alone it is also a permanent record:
  // adapt workout W against gym G, close the flow, reopen W and pick G again —
  // `selectGym` produces an identical `requestKey`, the effect returns early, no
  // request is made, and nothing ever calls `previewResolved`. The user sits on
  // the skeleton forever, and the "Try again" button that would bump `attempt`
  // only renders on an error, so there is no way out. That pair is then dead for
  // the rest of the app session.
  //
  // Clearing it whenever the step LEAVES `adapting` keeps the double-fire
  // protection (which only has to hold within one adapting step) while making
  // every fresh entry into the step a fresh request.
  useEffect(() => {
    if (step !== "adapting") firedRef.current = null;
  }, [step]);

  useEffect(() => {
    if (step !== "adapting" || workoutId === null) return;
    if (firedRef.current === requestKey) return;
    // ⚠ `context` is READ FROM THE STORE rather than taken as a dependency, and
    // that is load-bearing. `selectGym` / `selectEquipmentIds` mint a fresh
    // object even when the contents are identical, so a double-tap on the same
    // saved-gym card re-runs this effect with an unchanged `requestKey`: the
    // previous run's cleanup sets `cancelled = true`, then the guard above
    // returns early — cancelling the in-flight request and issuing no
    // replacement, which is the permanent-skeleton hang all over again.
    // `requestKey` already encodes the context's CONTENTS, so its identity is
    // not information this effect needs.
    const current = useLoadoutFlow.getState().context;
    if (current === null) return;
    firedRef.current = requestKey;
    setAdaptError(null);

    let cancelled = false;
    void api
      .previewLoadout(
        workoutId,
        current.kind === "gym"
          ? { savedGymId: current.gymId }
          : { equipmentTypeIds: current.equipmentTypeIds },
      )
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setAdaptError(classifyAdaptingError(result.error));
          return;
        }
        // The ONLY transition into `review`.
        previewResolved(result.value);
      });
    return () => {
      cancelled = true;
    };
  }, [step, workoutId, requestKey, api, previewResolved]);

  // ── Review view models ────────────────────────────────────────────────────
  const rowViews = useMemo<readonly LoadoutRowView[]>(() => {
    if (preview === null) return [];
    const tags = buildRowTags(preview.rows);
    return preview.rows.map((row, index) => {
      const pick = manualPicks.get(row.sortOrder);
      const copy = describeLoadoutRow(
        // A hand-picked row is a `user_override` by definition — the copy has to
        // say "You chose this one" rather than repeat the model's reasoning for
        // an exercise that is no longer in the plan.
        pick
          ? {
              ...row,
              reason: {
                ...row.reason,
                code: "user_override" as const,
                flags: [],
                note: null,
              },
            }
          : row,
        equipmentNameById,
      );
      const isDropped = droppedRows.has(row.sortOrder);
      const isAccepted = acceptedRows.has(row.sortOrder);
      const unresolved = row.status === "unresolved";
      const mismatch = copy.intensityMismatch;
      return {
        row,
        copy,
        tag: tags[index]?.tag ?? `${index + 1}`,
        isSupersetMember: tags[index]?.isSupersetMember ?? false,
        displayName:
          (pick ? pickedNames.get(row.sortOrder) : undefined) ??
          row.exercise?.name ??
          "This exercise",
        displayExerciseId: pick?.exerciseId ?? row.exerciseId,
        isManualPick: pick !== undefined,
        isDropped,
        isAccepted,
        needsAttention:
          !isDropped &&
          !isAccepted &&
          pick === undefined &&
          (unresolved || mismatch),
      };
    });
  }, [
    preview,
    manualPicks,
    equipmentNameById,
    droppedRows,
    acceptedRows,
    pickedNames,
  ]);

  const attentionCount = rowViews.filter((view) => view.needsAttention).length;

  // Exercises the saved plan will contain, EXCLUDING the row being swapped —
  // that one is about to be replaced, so listing it would disable the user's
  // ability to pick it back.
  const planExerciseIds = useMemo(
    () =>
      rowViews
        .filter(
          (view) =>
            !view.isDropped && view.row.sortOrder !== swapTarget?.sortOrder,
        )
        .map(
          (view) =>
            manualPicks.get(view.row.sortOrder)?.exerciseId ??
            view.row.exerciseId,
        )
        .filter((id): id is string => id !== null),
    [rowViews, manualPicks, swapTarget],
  );

  // ── Actions ───────────────────────────────────────────────────────────────
  // Clears the store AND dismisses the route. Both, always: leaving the route up
  // with a reset store would render a blank screen, and clearing without
  // dismissing would leave the user on a step machine with no step.
  const onClose = useCallback(() => {
    saveRunRef.current += 1;
    reset();
    router.back();
  }, [reset]);

  const onManualAdapt = useCallback(() => {
    const label = gymName.trim().length > 0 ? gymName.trim() : "Custom gym";
    selectEquipmentIds([...selectedEquipment], label, saveAsGym);
  }, [gymName, selectedEquipment, saveAsGym, selectEquipmentIds]);

  const onRetryAdapt = useCallback(() => {
    setAdaptError(null);
    setAttempt((value) => value + 1);
  }, []);

  const onSwapRow = useCallback(
    (row: LoadoutPreviewRow) => {
      openSwap({
        sortOrder: row.sortOrder,
        // ⚠ Falls back to the exercise this row REPLACED, and must. An
        // `unresolved` row has `exerciseId: null` — that is what unresolved
        // means — so ranking against it would send `forExerciseId: null` and
        // open an empty picker on the one row that most needs replacing.
        // `adaptWorkout` sets `substitutedFromExerciseId` to the source on every
        // unresolved row precisely so the original is still reachable here.
        exerciseId: row.exerciseId ?? row.substitutedFromExerciseId,
        exerciseName: row.exercise?.name ?? "This exercise",
      });
    },
    [openSwap],
  );

  const onSwapSelect = useCallback(
    (candidate: SubstituteCandidate, isUserOverride: boolean) => {
      if (swapTarget === null) return;
      const sortOrder = swapTarget.sortOrder;
      applyManualPick(sortOrder, { exerciseId: candidate.id, isUserOverride });
      setPickedNames((previous) => {
        const next = new Map(previous);
        next.set(sortOrder, candidate.name);
        return next;
      });
      // ⚠ No "un-drop on pick" here, deliberately. It looks like a needed guard
      // and is unreachable: a dropped row renders the struck-through variant,
      // whose only affordance is Undo — there is no swap button to reach this
      // from. Writing the branch anyway would be a condition no test can fail on.
    },
    [swapTarget, applyManualPick],
  );

  const onAcceptMismatch = useCallback((sortOrder: number) => {
    setAcceptedRows((previous) => new Set(previous).add(sortOrder));
  }, []);

  const onDropRow = useCallback((sortOrder: number) => {
    setDroppedRows((previous) => new Set(previous).add(sortOrder));
  }, []);

  const onRestoreRow = useCallback((sortOrder: number) => {
    setDroppedRows((previous) => {
      const next = new Set(previous);
      next.delete(sortOrder);
      return next;
    });
  }, []);

  const save = useCallback(
    async (thenStart: boolean) => {
      if (preview === null || workoutId === null || context === null) return;
      const saveRun = saveRunRef.current + 1;
      saveRunRef.current = saveRun;
      setIsSaving(true);
      setSaveError(null);

      // A "Save" toggle the user ticked is a side quest, not the save. It runs
      // first so the variation can carry `sourceGymId`, but a failure here —
      // most likely a 409 on a name they have used before — must NOT lose the
      // reviewed adaptation. The variation still records the kit itself via
      // `sourceEquipmentTypeIds`, so the only thing lost is the link.
      let sourceGymId: string | null =
        context.kind === "gym" ? context.gymId : null;
      if (context.kind === "ids" && context.saveAsGym) {
        // ⚠ Await the commit-time create before deciding anything. It is fired
        // when the user leaves the picker and the preview normally takes 2.6 s
        // p50, so it has almost always landed by now — but "almost always" is
        // not a guarantee, and losing that race means creating a SECOND gym
        // with the same name, taking a 409, and saving the variation unlinked.
        // The one outcome worse than a slow save is a silently unlinked one.
        if (gymCreatePromiseRef.current !== null) {
          await gymCreatePromiseRef.current;
        }
        if (saveRunRef.current !== saveRun) return;
        // ⚠ Remembered across retries. Without the ref, a save that created the
        // gym and then failed on the VARIATION (a dropped connection) would, on
        // the user's second tap, 409 on its own gym name and save the variation
        // unlinked — permanently showing the variation's name instead of the
        // gym's in "Saved setups".
        if (createdGymIdRef.current !== null) {
          sourceGymId = createdGymIdRef.current;
        } else {
          const result = await api.createSavedGym({
            name: context.label,
            equipmentTypeIds: context.equipmentTypeIds,
          });
          if (saveRunRef.current !== saveRun) return;
          if (result.ok) {
            sourceGymId = result.value.id;
            createdGymIdRef.current = result.value.id;
          }
        }
      }

      const kept: LoadoutPreview = {
        ...preview,
        rows: preview.rows.filter((row) => {
          if (droppedRows.has(row.sortOrder)) return false;
          const hasIntensityMismatch =
            row.reason.flags?.includes("intensity_mismatch") === true;
          // The banner promises that undecided attention rows are dropped.
          // A manual pick resolves the row; otherwise a mismatch survives only
          // after the user explicitly accepts it as accessory volume.
          return (
            !hasIntensityMismatch ||
            acceptedRows.has(row.sortOrder) ||
            manualPicks.has(row.sortOrder)
          );
        }),
      };
      const exercises = buildVariationExercises(kept, manualPicks);

      if (exercises.length === 0) {
        setIsSaving(false);
        setSaveError(
          "There's nothing left to save — every exercise has been left out.",
        );
        return;
      }

      const variationInput = {
        name: deriveVariationName(preview.parentName, contextLabel(context)),
        sourceGymId,
        // Freeze the exact kit the SERVER resolved for the preview. This is
        // required for saved-gym contexts too: the gym may later change or be
        // deleted, while the setup must remain explainable.
        sourceEquipmentTypeIds: preview.equipmentTypeIds,
        exercises,
      };
      const result =
        replacementVariationId === null
          ? await api.createWorkoutVariation(workoutId, variationInput)
          : await api.replaceWorkoutVariation(
              workoutId,
              replacementVariationId,
              variationInput,
            );
      if (saveRunRef.current !== saveRun) return;
      setIsSaving(false);

      if (!result.ok) {
        // ⚠ Every code gets its own copy — see `describeVariationSaveError`. The
        // two-code ternary this replaced reported seven distinct failures, a 404
        // and a 500 as "Check your connection and try again", which is how a save
        // failure on a working connection became undiagnosable from the screen.
        setSaveError(describeVariationSaveError(result.error));
        return;
      }

      const variationId = result.value.id;
      // `saved()` bumps `rev`, which is what makes the workout-detail screen's
      // "Saved setups" list re-read. It survives `reset()` deliberately.
      markSaved();

      if (thenStart) {
        // AC-5.3 — the variation IS a workout, so the existing start path takes
        // it unchanged. `replace`, not push-after-back: this route must not stay
        // in the history behind the session, or backing out of the session lands
        // the user on a reset step machine rendering nothing.
        reset();
        router.replace(`/(app)/session?workoutId=${variationId}` as never);
      }
    },
    [
      preview,
      workoutId,
      context,
      droppedRows,
      acceptedRows,
      manualPicks,
      replacementVariationId,
      api,
      markSaved,
      reset,
    ],
  );

  const onSave = useCallback(() => void save(false), [save]);
  const onSaveAndStart = useCallback(() => void save(true), [save]);
  const onReviewBack = useCallback(() => {
    // Leaving during an in-flight write is both confusing and unsafe: an older
    // completion could otherwise advance a newly collected flow.
    if (isSaving) return;
    saveRunRef.current += 1;
    goToStep("collect");
  }, [goToStep, isSaving]);
  const onExercisePress = useCallback((exerciseId: string) => {
    router.push(`/(app)/exercises/${exerciseId}` as never);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  //
  // No `visible` flag and no wrapper: being mounted IS being open, because this
  // is a route. `step` still selects which screen shows, and the two sheets are
  // siblings of it so they layer above the step rather than behind it.
  return (
    <View style={styles.screen} testID="loadout-flow">
      {(step === "collect" || step === "scan") && (
        <LoadoutCollectStep
          workoutName={workoutName}
          // AC-2.1/2.2 are the floor: offline, the scan cannot run at all and the
          // picker can — so the scan is hidden rather than offered and failed.
          scanAvailable={online}
          savedGyms={gyms.gyms}
          isLoadingGyms={gyms.isLoading}
          onBack={onClose}
          onScan={() => goToStep("scan")}
          onManual={() => goToStep("manual")}
          onUseGym={(gym) => selectGym(gym)}
        />
      )}

      {step === "manual" && (
        <LoadoutManualStep
          groups={equipmentGroups}
          selectedIds={selectedEquipment}
          onToggle={(id) =>
            setSelectedEquipment((previous) => {
              const next = new Set(previous);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          name={gymName}
          onNameChange={setGymName}
          saveAsGym={saveAsGym}
          onToggleSave={() => setSaveAsGym((value) => !value)}
          isLoading={reference.isLoading}
          onBack={() => goToStep("collect")}
          onAdapt={onManualAdapt}
        />
      )}

      {step === "adapting" && (
        <LoadoutAdaptingStep
          workoutName={workoutName}
          gymLabel={contextLabel(context)}
          error={adaptError}
          onBack={() => goToStep("collect")}
          onRetry={onRetryAdapt}
          onPickManually={() => goToStep("manual")}
          onUpgrade={gate.onUpgrade}
        />
      )}

      {step === "review" && preview !== null && (
        <LoadoutReviewStep
          workoutName={workoutName}
          gymLabel={contextLabel(context)}
          preview={preview}
          rows={rowViews}
          attentionCount={attentionCount}
          isSaving={isSaving}
          saveError={saveError}
          onBack={onReviewBack}
          onExercisePress={onExercisePress}
          onSwapRow={onSwapRow}
          onAcceptMismatch={onAcceptMismatch}
          onDropRow={onDropRow}
          onRestoreRow={onRestoreRow}
          onSave={onSave}
          onSaveAndStart={onSaveAndStart}
        />
      )}

      {step === "saved" && (
        <LoadoutSavedStep
          workoutName={workoutName}
          gymLabel={contextLabel(context)}
          replaced={replacementVariationId !== null}
          onDone={onClose}
        />
      )}

      <EquipmentScanSheetContainer
        equipmentGroups={equipmentGroups}
        // Carry the confirmed detections into the checklist rather than dropping
        // them: "edit the list" after a scan means "start from what you found",
        // and re-ticking six chips by hand is the fastest way to make the scan
        // feel pointless.
        onPickManually={(ids) => setSelectedEquipment(new Set(ids))}
        onUpgrade={gate.onUpgrade}
      />

      <EquipmentAwareSwapSheet
        visible={swapTarget !== null}
        onClose={closeSwap}
        forExerciseId={swapTarget?.exerciseId ?? null}
        exerciseName={swapTarget?.exerciseName ?? ""}
        equipmentTypeIds={contextEquipmentIds(preview)}
        equipmentContextLabel={contextLabel(context)}
        equipmentNameById={equipmentNameById}
        // Everything already in the plan, so a swap cannot duplicate a row.
        // `workoutVariationsCreateHandler` does not reject duplicate
        // `exerciseId`s, so nothing downstream would catch it: the variation
        // would simply prescribe the same exercise twice, with two different
        // reason blocks explaining it.
        existingExerciseIds={planExerciseIds}
        onSelect={onSwapSelect}
        testID="loadout-swap-sheet"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.$bg,
  },
});
