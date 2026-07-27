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
import { LoadoutUpsellSheet } from "@/ui/presenters/loadout/LoadoutUpsellSheet";
import { color } from "@/ui/theme/tokens";

/**
 * <LoadoutFlowContainer> — the whole athlete flow (T-2.3 … T-2.8b, T-3.4).
 *
 * ## Why this is root-mounted rather than a route
 *
 * Mounted in `app/(app)/_layout.tsx` as a sibling of the Stack, like
 * `ActiveWorkoutOverlay` and every sheet in the app
 * (`memory/feedback_sheets_mount_at_root`). Three reasons, and the third is the
 * one that decides it:
 *
 *  1. The store IS the navigation — `useLoadoutFlow` is a step machine, and
 *     mirroring it into five routes would give two sources of truth for "which
 *     step am I on", which is exactly the desync the store was written to avoid.
 *  2. A full-screen sibling of the Stack covers the tab bar without a modal.
 *  3. **The swap sheet and the scan sheet have to layer ABOVE the flow.** A
 *     gorhom sheet renders inline in the React tree, so a sheet mounted at the
 *     layout root would sit BEHIND a flow rendered inside an RN `<Modal>`. Both
 *     sheets are therefore siblings of the step, inside this container.
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

function contextEquipmentIds(
  context: LoadoutContext | null,
  gymEquipment: ReadonlyMap<string, readonly string[]>,
): readonly string[] | undefined {
  if (context === null) return undefined;
  if (context.kind === "ids") return context.equipmentTypeIds;
  // A saved gym's kit is not in the request the client made — only its id was
  // sent — so the swap sheet's containment context has to come from the gym row
  // we listed. Missing (deleted between list and use) → undefined, i.e. the
  // sheet claims nothing is incompatible rather than claiming everything is.
  return gymEquipment.get(context.gymId);
}

export function LoadoutFlowContainer() {
  const { api } = useAdapters();
  const online = useOnlineStatus();
  const gate = useLoadoutGate();

  const step = useLoadoutFlow((s) => s.step);
  const workoutId = useLoadoutFlow((s) => s.workoutId);
  const workoutName = useLoadoutFlow((s) => s.workoutName);
  const context = useLoadoutFlow((s) => s.context);
  const preview = useLoadoutFlow((s) => s.preview);
  const manualPicks = useLoadoutFlow((s) => s.manualPicks);
  const swapTarget = useLoadoutFlow((s) => s.swapTarget);
  const upsellOpen = useLoadoutFlow((s) => s.upsellOpen);
  const closeUpsell = useLoadoutFlow((s) => s.closeUpsell);
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

  const gymEquipment = useMemo(() => {
    const map = new Map<string, readonly string[]>();
    for (const gym of gyms.gyms) map.set(gym.id, gym.equipmentTypeIds);
    return map;
  }, [gyms.gyms]);

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
  const requestKey = `${workoutId ?? ""}|${contextKey}|${attempt}`;
  const firedRef = useRef<string | null>(null);

  useEffect(() => {
    if (step !== "adapting" || workoutId === null || context === null) return;
    if (firedRef.current === requestKey) return;
    firedRef.current = requestKey;
    setAdaptError(null);

    let cancelled = false;
    void api
      .previewLoadout(
        workoutId,
        context.kind === "gym"
          ? { savedGymId: context.gymId }
          : { equipmentTypeIds: context.equipmentTypeIds },
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
  }, [step, workoutId, context, requestKey, api, previewResolved]);

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

  // ── Actions ───────────────────────────────────────────────────────────────
  const onClose = useCallback(() => reset(), [reset]);

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
        const result = await api.createSavedGym({
          name: context.label,
          equipmentTypeIds: context.equipmentTypeIds,
        });
        if (result.ok) sourceGymId = result.value.id;
      }

      const kept: LoadoutPreview = {
        ...preview,
        rows: preview.rows.filter((row) => !droppedRows.has(row.sortOrder)),
      };
      const exercises = buildVariationExercises(kept, manualPicks);

      if (exercises.length === 0) {
        setIsSaving(false);
        setSaveError(
          "There's nothing left to save — every exercise has been left out.",
        );
        return;
      }

      const result = await api.createWorkoutVariation(workoutId, {
        name: deriveVariationName(workoutName, contextLabel(context)),
        sourceGymId,
        sourceEquipmentTypeIds:
          context.kind === "ids" ? context.equipmentTypeIds : undefined,
        exercises,
      });
      setIsSaving(false);

      if (!result.ok) {
        setSaveError(
          result.error.loadoutCode === "EQUIPMENT_NOT_AVAILABLE"
            ? "One of your picks doesn't fit the kit you chose. Open its swap sheet and confirm you want it anyway."
            : result.error.loadoutCode === "EXERCISE_NOT_VISIBLE"
              ? "One of these exercises is no longer available to you. Swap it and try again."
              : "Couldn't save this variation. Check your connection and try again.",
        );
        return;
      }

      const variationId = result.value.id;
      // `saved()` bumps `rev`, which is what makes the workout-detail screen's
      // "Saved setups" list re-read. It survives `reset()` deliberately.
      markSaved();

      if (thenStart) {
        // AC-5.3 — the variation IS a workout, so the existing start path takes
        // it unchanged. Close the overlay first: leaving it mounted would put a
        // full-screen success screen over the session that just started.
        reset();
        router.push(`/(app)/session?workoutId=${variationId}` as never);
      }
    },
    [
      preview,
      workoutId,
      context,
      droppedRows,
      manualPicks,
      workoutName,
      api,
      markSaved,
      reset,
    ],
  );

  const onSave = useCallback(() => void save(false), [save]);
  const onSaveAndStart = useCallback(() => void save(true), [save]);

  // ── Render ────────────────────────────────────────────────────────────────
  //
  // The sheets stay mounted whether or not a step is open: the upsell is reached
  // from a LOCKED entry point, where there is no flow to be in.
  return (
    <>
      {isOpen ? (
        <View style={styles.overlay} testID="loadout-flow">
          {(step === "collect" || step === "scan") && (
            <LoadoutCollectStep
              workoutName={workoutName}
              // AC-2.1/2.2 are the floor: offline, the scan cannot run at all,
              // and the picker can — so the scan is hidden rather than offered
              // and then failed.
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
              onBack={() => goToStep("collect")}
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
              onDone={onClose}
            />
          )}

          <EquipmentScanSheetContainer
            equipmentGroups={equipmentGroups}
            // Carry the confirmed detections into the checklist rather than
            // dropping them: "edit the list" after a scan means "start from what
            // you found", and re-ticking six chips by hand is the fastest way to
            // make the scan feel pointless.
            onPickManually={(ids) => setSelectedEquipment(new Set(ids))}
            onUpgrade={gate.onUpgrade}
          />

          <EquipmentAwareSwapSheet
            visible={swapTarget !== null}
            onClose={closeSwap}
            forExerciseId={swapTarget?.exerciseId ?? null}
            exerciseName={swapTarget?.exerciseName ?? ""}
            equipmentTypeIds={contextEquipmentIds(context, gymEquipment)}
            equipmentContextLabel={contextLabel(context)}
            equipmentNameById={equipmentNameById}
            onSelect={onSwapSelect}
            testID="loadout-swap-sheet"
          />
        </View>
      ) : null}

      <LoadoutUpsellSheet
        visible={upsellOpen}
        onClose={closeUpsell}
        priceMonthly={gate.upgradePriceMonthly}
        onUpgrade={() => {
          closeUpsell();
          gate.onUpgrade();
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.$bg,
  },
});
