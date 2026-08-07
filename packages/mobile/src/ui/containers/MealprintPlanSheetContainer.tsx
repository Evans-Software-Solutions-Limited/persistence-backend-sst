import { useCallback, useEffect, useState } from "react";
import { router, type Href } from "expo-router";
import { useFuelSheets } from "@/state/fuel-sheets";
import { usePlanFlow } from "@/state/plan-flow";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useMealprintGate } from "@/ui/hooks/useMealprintGate";
import { useMealprintPreferences } from "@/ui/hooks/useMealprintPreferences";
import { useGetNutritionTarget } from "@/ui/hooks/useGetNutritionTarget";
import { usePlanGenerate } from "@/ui/hooks/usePlanGenerate";
import { usePlanSwap } from "@/ui/hooks/usePlanSwap";
import { usePlanAccept } from "@/ui/hooks/usePlanAccept";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import {
  DEFAULT_MEALPRINT_PREFERENCES,
  heldTotalsExcluding,
  planDraftToAcceptInput,
  summarisePreferences,
  type EffortLevel,
} from "@/domain/models/mealprint";
import {
  MealprintPlanSheetPresenter,
  type MealprintPlanSheetStage,
  type PlanAcceptRecovery,
} from "@/ui/presenters/mealprint/MealprintPlanSheetPresenter";

/**
 * <MealprintPlanSheetContainer> — root-mounted "Plan my day" sheet (spec-26
 * Phase 2, T-2.6, STORY-004). Same family as `MealprintSuggestSheetContainer`
 * (mounted at root, opened via `useFuelSheets`, gated on `visible` — nothing
 * fires on mount, see that file's docstring for why closing a sheet is not an
 * unmount).
 *
 * ## Why this one DOES use a store (`usePlanFlow`) where the suggest sheet doesn't
 *
 * `MealprintSuggestSheetContainer`'s docstring explains why a single-selection
 * suggestion draft is local `useState`. A plan draft is the opposite: several
 * independently editable meals that each round-trip through their OWN swap
 * request while the rest of the draft must hold still — exactly the
 * multi-step working state `useLoadoutFlow` exists for, hence
 * `state/plan-flow.ts` mirrors it (design § 4), including its per-field
 * selector convention (`usePlanFlow((s) => s.step)` rather than the whole
 * store) so this container only re-renders on the slices it actually reads.
 *
 * ## Config inputs are local state, not store state
 *
 * `mealsPerDay`/`effortLevel`/`steer` are seeded from preferences on every
 * real open and are pure form inputs with no lifetime past this render tree —
 * putting them in the store would only add a reset path to get wrong.
 */

const MEALS_PER_DAY_DEFAULT = DEFAULT_MEALPRINT_PREFERENCES.mealsPerDay;
const EFFORT_DEFAULT = DEFAULT_MEALPRINT_PREFERENCES.effortLevel;

export function MealprintPlanSheetContainer() {
  const sheet = useFuelSheets((s) => s.sheet);
  const close = useFuelSheets((s) => s.close);
  const notifyMutated = useFuelSheets((s) => s.notifyMutated);
  const activeDate = useFuelSheets((s) => s.date);
  const visible = sheet === "mealprintPlan";

  const { api, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const online = useOnlineStatus();
  const gate = useMealprintGate();
  const preferences = useMealprintPreferences(visible);
  const target = useGetNutritionTarget(visible);

  const step = usePlanFlow((s) => s.step);
  const draft = usePlanFlow((s) => s.draft);
  const emptyReason = usePlanFlow((s) => s.emptyReason);
  const flaggedIds = usePlanFlow((s) => s.flaggedIds);
  const swappingId = usePlanFlow((s) => s.swappingId);
  const flowOpen = usePlanFlow((s) => s.open);
  const flowGenerating = usePlanFlow((s) => s.generating);
  const flowDraftReady = usePlanFlow((s) => s.draftReady);
  const flowEmpty = usePlanFlow((s) => s.empty);
  const flowRemoveMeal = usePlanFlow((s) => s.removeMeal);
  const flowUpdateItemServings = usePlanFlow((s) => s.updateItemServings);
  const flowBeginSwap = usePlanFlow((s) => s.beginSwap);
  const flowSwapApplied = usePlanFlow((s) => s.swapApplied);
  const flowSwapAbandoned = usePlanFlow((s) => s.swapAbandoned);
  const flowMarkUnresolvable = usePlanFlow((s) => s.markUnresolvable);
  const flowAccepted = usePlanFlow((s) => s.accepted);
  const flowReset = usePlanFlow((s) => s.reset);

  const generate = usePlanGenerate();
  const swap = usePlanSwap();
  const accept = usePlanAccept();

  const [mealsPerDay, setMealsPerDay] = useState(MEALS_PER_DAY_DEFAULT);
  const [effortLevel, setEffortLevel] = useState<EffortLevel>(EFFORT_DEFAULT);
  const [steer, setSteer] = useState("");

  const onSheetClose = useCallback(() => {
    if (visible) close();
  }, [visible, close]);

  const { reset: resetGenerate } = generate;
  const { reset: resetSwap } = swap;
  const { reset: resetAccept } = accept;
  // Reset on OPEN, same reasoning as the suggest sheet: the close animation is
  // still running when `visible` flips false.
  useEffect(() => {
    if (!visible) return;
    flowOpen(activeDate);
    resetGenerate();
    resetSwap();
    resetAccept();
    setMealsPerDay(preferences.data?.mealsPerDay ?? MEALS_PER_DAY_DEFAULT);
    setEffortLevel(preferences.data?.effortLevel ?? EFFORT_DEFAULT);
    setSteer("");
    // Only the OPEN transition should reseed — re-running on every preferences
    // refresh would blow away whatever the user has already typed into the
    // config form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, activeDate, flowOpen, resetGenerate, resetSwap, resetAccept]);

  const { run: runGenerate, retry: retryGenerate } = generate;
  const onGenerate = useCallback(() => {
    if (!online) return;
    if (!gate.isResolved) return;
    if (!gate.allowed) {
      gate.onUpgrade();
      return;
    }
    flowGenerating();
    void runGenerate({
      planDate: activeDate,
      mealsPerDay,
      effortLevel,
      steer: steer.trim() === "" ? undefined : steer.trim(),
    });
  }, [
    online,
    gate,
    flowGenerating,
    runGenerate,
    activeDate,
    mealsPerDay,
    effortLevel,
    steer,
  ]);

  const onRetryGenerate = useCallback(() => {
    if (!online) return;
    flowGenerating();
    void retryGenerate();
  }, [online, flowGenerating, retryGenerate]);

  // Drive the store off the generate call's own result — mirrors the suggest
  // sheet's `stage`-derivation, but here the transition is committed into
  // `usePlanFlow` because the draft has to survive per-meal swap round trips.
  useEffect(() => {
    if (generate.stage !== "ready" || generate.result === null) return;
    const result = generate.result;
    if (result.emptyReason !== null) {
      flowEmpty(result.emptyReason);
    } else {
      flowDraftReady(result);
    }
    // `generate.result` is a fresh object per call — safe to key the effect on
    // it directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generate.stage, generate.result]);

  const { run: runSwap, reset: resetSwapCall } = swap;
  const onSwapMeal = useCallback(
    (localId: string) => {
      if (draft === null) return;
      const targetMeal = draft.meals.find((m) => m.localId === localId);
      if (targetMeal === undefined) return;
      flowBeginSwap(localId);
      void runSwap({
        dayTarget: draft.target,
        heldTotals: heldTotalsExcluding(draft, localId),
        logSlot: targetMeal.meal.logSlot,
      });
    },
    [draft, flowBeginSwap, runSwap],
  );

  useEffect(() => {
    if (swap.stage !== "ready" && swap.stage !== "error") return;
    if (swappingId === null) return;
    if (swap.stage === "ready" && swap.result?.meal) {
      flowSwapApplied(swappingId, swap.result.meal);
    } else {
      // Either a genuine failure, or an `ok` empty result (budget_exhausted /
      // no_candidates) — both leave the meal un-swapped; the user can retry.
      flowSwapAbandoned();
    }
    resetSwapCall();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swap.stage, swap.result]);

  const onRemoveMeal = useCallback(
    (localId: string) => flowRemoveMeal(localId),
    [flowRemoveMeal],
  );

  const onItemServingsChange = useCallback(
    (localId: string, candidateId: string, servings: number) =>
      flowUpdateItemServings(localId, candidateId, servings),
    [flowUpdateItemServings],
  );

  const { accept: runAccept, reset: resetAcceptCall } = accept;
  const onAccept = useCallback(async () => {
    if (draft === null || flaggedIds.size > 0) return;
    const result = await runAccept(planDraftToAcceptInput(draft));
    if (result) {
      flowAccepted(result);
      notifyMutated();
    }
  }, [draft, flaggedIds, runAccept, flowAccepted, notifyMutated]);

  // Side effect of an `unresolvable_items` accept failure: flag the affected
  // draft meal(s) so the user sees exactly which one needs a swap. A fresh
  // failure object is set per attempt, so this only fires once per failure.
  useEffect(() => {
    if (accept.failure?.code === "unresolvable_items") {
      flowMarkUnresolvable(accept.failure.unresolvableItems);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accept.failure]);

  const onAcceptRecovery = useCallback(async () => {
    if (draft === null) return;
    const failure = accept.failure;
    if (failure?.code === "active_plan_exists" && failure.activePlanDate) {
      const existing = await api.getActivePlan(failure.activePlanDate);
      if (existing.ok && existing.value) {
        await api.patchPlan(existing.value.id, { status: "archived" });
        if (userId) {
          storage.removeCachedMealPlan(userId, failure.activePlanDate);
        }
      }
      resetAcceptCall();
      const result = await runAccept(planDraftToAcceptInput(draft));
      if (result) {
        flowAccepted(result);
        notifyMutated();
      }
      return;
    }
    if (failure?.code === "avoidance_violation") {
      resetAcceptCall();
      resetGenerate();
      flowOpen(activeDate);
    }
  }, [
    draft,
    accept.failure,
    api,
    storage,
    userId,
    resetAcceptCall,
    runAccept,
    flowAccepted,
    notifyMutated,
    resetGenerate,
    flowOpen,
    activeDate,
  ]);

  const onViewToday = useCallback(() => {
    close();
    flowReset();
    router.push("/(app)/fuel/plan-today" as Href);
  }, [close, flowReset]);

  // ⚠ CLOSE FIRST, same reasoning as `onViewToday` above. `preferences.tsx` is
  // a pushed screen, not a root-mounted sheet — leaving this sheet open under
  // it renders the editor BEHIND the gorhom sheet (root-mounted sheets sit
  // above the navigator stack), which looked like the preferences screen had
  // failed to open at all.
  const onEditPreferences = useCallback(() => {
    close();
    router.push("/(app)/fuel/preferences?mode=editor" as Href);
  }, [close]);

  const stage: MealprintPlanSheetStage =
    step === "saved"
      ? "saved"
      : step === "draft"
        ? "draft"
        : step === "generating"
          ? "generating"
          : generate.stage === "error"
            ? "error"
            : "config";

  const draftTotals = draft
    ? draft.meals.reduce(
        (acc, { meal }) => ({
          kcal: acc.kcal + meal.kcal,
          proteinG: acc.proteinG + meal.proteinG,
          carbsG: acc.carbsG + meal.carbsG,
          fatG: acc.fatG + meal.fatG,
        }),
        { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
      )
    : { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };

  const acceptRecovery: PlanAcceptRecovery =
    accept.failure?.code === "active_plan_exists"
      ? "replace"
      : accept.failure?.code === "avoidance_violation"
        ? "regenerate"
        : null;

  const acceptErrorMessage =
    accept.failure === null
      ? null
      : accept.failure.code === "unresolvable_items"
        ? "Some of this plan's items are no longer available — swap the flagged meal(s) and try again."
        : accept.failure.code === "avoidance_violation"
          ? "Your preferences changed since this plan was generated. Start over to build a fresh one."
          : accept.failure.code === "active_plan_exists"
            ? `You already have a plan for ${accept.failure.activePlanDate ?? "that day"}.`
            : accept.failure.message;

  return (
    <MealprintPlanSheetPresenter
      visible={visible}
      onClose={onSheetClose}
      stage={stage}
      offline={!online}
      preferencesSummary={summarisePreferences(preferences.data)}
      mealsPerDay={mealsPerDay}
      onMealsPerDayChange={setMealsPerDay}
      effortLevel={effortLevel}
      onEffortLevelChange={setEffortLevel}
      steer={steer}
      onSteerChange={setSteer}
      dayTarget={
        target.data
          ? {
              kcal: target.data.dailyKcal,
              proteinG: target.data.proteinG,
              carbsG: target.data.carbsG,
              fatG: target.data.fatG,
            }
          : null
      }
      emptyReason={emptyReason}
      onGenerate={onGenerate}
      onEditPreferences={onEditPreferences}
      draft={draft}
      flaggedIds={flaggedIds}
      swappingId={swappingId}
      onSwapMeal={onSwapMeal}
      onRemoveMeal={onRemoveMeal}
      onItemServingsChange={onItemServingsChange}
      draftTotals={draftTotals}
      accepting={accept.accepting}
      acceptBlocked={
        draft === null || draft.meals.length === 0 || flaggedIds.size > 0
      }
      onAccept={() => void onAccept()}
      acceptErrorMessage={acceptErrorMessage}
      acceptRecovery={acceptRecovery}
      onAcceptRecovery={() => void onAcceptRecovery()}
      labelCheckRequired={generate.result?.labelCheckRequired ?? true}
      onViewToday={onViewToday}
      errorMessage={generate.failure?.message ?? null}
      errorRetryable={generate.failure?.retryable ?? false}
      errorIsEntitlement={generate.failure?.entitlementDenied ?? false}
      onRetryGenerate={onRetryGenerate}
      onUpgrade={gate.onUpgrade}
    />
  );
}
