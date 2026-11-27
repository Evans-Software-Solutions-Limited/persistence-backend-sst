import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router, type Href } from "expo-router";
import { useForm } from "react-hook-form";
import { getApiBaseUrl } from "@/adapters/api";
import { localIdFactory } from "@/application/commands/localId";
import {
  adoptSavedMealprintPlanCommand,
  archiveMealprintDayCommand,
  dayEntryIds,
  logAllTodayCommand,
  undoLogAllCommand,
} from "@/application/commands/mealprintDay.command";
import { processSyncQueue } from "@/application/commands/sync.command";
import {
  DEFAULT_MEALPRINT_PREFERENCES,
  MEAL_SEARCH_FULL_MESSAGE,
  addNotWantedMeals,
  heldTotalsExcluding,
  planDraftToAcceptInput,
  sumPlanDraftTotals,
  type EffortLevel,
  type MealPlan,
  type NotWantedMeal,
  type PlanSwapMeal,
} from "@/domain/models/mealprint";
import type { NutritionEntry } from "@/domain/models/nutrition";
import type { NutritionPlan } from "@/domain/models/nutritionPlans";
import { flattenFuelEntries } from "@/domain/services/nutrition.service";
import {
  MEAL_PORTION_STEP,
  SWAP_DELTA_QUIET_KCAL,
  SWAP_STEER_CHIPS,
  applyPlanPortions,
  canScalePlanMeal,
  joinNames,
  kcalDeltaLabel,
  mealItemsLine,
  mealsForGenerate,
  notWantedFrom,
  planLogAll,
  preferencesLine,
  swapSteer,
  userMealForGeneratedMeal,
  userMealNames,
  type LogAllRow,
} from "@/domain/services/mealprintDay.service";
import { firstMessage } from "@/shared/form";
import { localDayISO, loggedAtNoonUtc } from "@/shared/utils";
import { useFuelSheets } from "@/state/fuel-sheets";
import { usePlanFlow } from "@/state/plan-flow";
import { usePlanSheets } from "@/state/plan-sheets";
import {
  mealprintSteerResolver,
  swapFeedbackResolver,
  type MealprintSteerValues,
  type SwapFeedbackValues,
} from "@/ui/forms/mealprintForms";
import { planNameResolver, type PlanNameValues } from "@/ui/forms/planForms";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useGetNutritionTarget } from "@/ui/hooks/useGetNutritionTarget";
import { useMealprintGate } from "@/ui/hooks/useMealprintGate";
import { useMealprintPreferences } from "@/ui/hooks/useMealprintPreferences";
import {
  useNutritionPlans,
  usePlansShoppingList,
} from "@/ui/hooks/useNutritionPlans";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import { usePlanAccept } from "@/ui/hooks/usePlanAccept";
import { usePlanGenerate } from "@/ui/hooks/usePlanGenerate";
import { usePlanSwap } from "@/ui/hooks/usePlanSwap";
import { useUserMeals } from "@/ui/hooks/useUserMeals";
import { MealprintDayPresenter } from "@/ui/presenters/mealprint/MealprintDayPresenter";
import {
  MealprintLoggedPresenter,
  MealprintSavedPresenter,
} from "@/ui/presenters/mealprint/MealprintDoneScreens";
import {
  MealprintHomePresenter,
  type MealprintTab,
} from "@/ui/presenters/mealprint/MealprintHomePresenter";
import { MealprintLockedPresenter } from "@/ui/presenters/mealprint/MealprintLockedPresenter";
import {
  MealprintStatePresenter,
  type MealprintState,
} from "@/ui/presenters/mealprint/MealprintStatePresenter";
import { MealprintWorkingPresenter } from "@/ui/presenters/mealprint/MealprintWorkingPresenter";

/**
 * <MealprintDayContainer> — Mealprint Whole day (PER-134, canvas N15 → N16
 * → N19/N20 → N21 or N22, states N27). Reuses `usePlanGenerate`,
 * `usePlanSwap`, `usePlanAccept` and the `usePlanFlow` draft store.
 *
 * - The day uses Your meals (BE-D3 `meals`), up to six; with fewer than two
 *   it falls back to meals a day.
 * - Swap asks for three options (`count: 3`). "Show 3 others" sends the
 *   options already shown in `notWantedMeals`; the feedback box and steer
 *   chips go in `steer`.
 * - Save as a plan accepts the day (a dated Mealprint plan) and saves it as
 *   a list plan with no days (`POST /nutrition/meal-plans
 *   {fromMealprintPlanId}`), then archives the dated plan so nothing shows
 *   as "today's plan" in Log (there is none, product rule 18 Nov).
 * - Log all today logs each meal into its meal in today's Log, skipping meals
 *   that already have food; the entries go out in one batch, and Undo takes
 *   them off again.
 */

export type MealprintDayContainerProps = {
  onTab: (tab: MealprintTab) => void;
  onClose: () => void;
};

const MEALS_PER_DAY_DEFAULT = DEFAULT_MEALPRINT_PREFERENCES.mealsPerDay;
const EFFORT_DEFAULT = DEFAULT_MEALPRINT_PREFERENCES.effortLevel;
const NO_REPLACEMENT = "No replacement matched. Try different feedback.";

/** The state screen for a failed plan-generate call. */
export function generateFailureState(
  status: number | undefined,
): MealprintState {
  if (status === 429) return "cap";
  if (status === 422) return "none";
  return "down";
}

/** The message for a failed save-from-Mealprint call. */
export function saveErrorMessage(status: number | undefined): string {
  if (status === 403) return "Saving plans needs Premium or Premium+.";
  if (status === 409)
    return "Some of these foods can't be saved in a plan. Swap the meal and try again.";
  return "Couldn't save this plan. Check your connection and try again.";
}

type LogResult = {
  rows: LogAllRow[];
  logged: NutritionEntry[];
  before: ReadonlySet<string>;
};

export function MealprintDayContainer({
  onTab,
  onClose,
}: MealprintDayContainerProps) {
  const { api, auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const online = useOnlineStatus();
  const gate = useMealprintGate();
  const preferences = useMealprintPreferences(true);
  const target = useGetNutritionTarget(true);
  const userMeals = useUserMeals();
  const plans = useNutritionPlans(false);
  const shopping = usePlansShoppingList(false);
  const notifyMutated = useFuelSheets((s) => s.notifyMutated);
  const today = useMemo(() => localDayISO(), []);

  const step = usePlanFlow((s) => s.step);
  const draft = usePlanFlow((s) => s.draft);
  const emptyReason = usePlanFlow((s) => s.emptyReason);
  const flaggedIds = usePlanFlow((s) => s.flaggedIds);
  const swappedFrom = usePlanFlow((s) => s.swappedFrom);
  const portions = usePlanFlow((s) => s.portions);
  const flowOpen = usePlanFlow((s) => s.open);
  const flowGenerating = usePlanFlow((s) => s.generating);
  const flowDraftReady = usePlanFlow((s) => s.draftReady);
  const flowEmpty = usePlanFlow((s) => s.empty);
  const flowRemoveMeal = usePlanFlow((s) => s.removeMeal);
  const flowSwapApplied = usePlanFlow((s) => s.swapApplied);
  const flowMarkUnresolvable = usePlanFlow((s) => s.markUnresolvable);
  const flowAccepted = usePlanFlow((s) => s.accepted);
  const flowUndoSwap = usePlanFlow((s) => s.undoSwap);
  const flowSetPortion = usePlanFlow((s) => s.setPortion);
  const flowLogged = usePlanFlow((s) => s.logged);
  const flowReset = usePlanFlow((s) => s.reset);

  const generate = usePlanGenerate();
  const swap = usePlanSwap();
  const accept = usePlanAccept();

  const steerForm = useForm<MealprintSteerValues>({
    resolver: mealprintSteerResolver,
    defaultValues: { steer: "" },
  });
  const feedbackForm = useForm<SwapFeedbackValues>({
    resolver: swapFeedbackResolver,
    defaultValues: { feedback: "" },
  });
  const nameForm = useForm<PlanNameValues>({
    resolver: planNameResolver,
    defaultValues: { name: "" },
  });

  const [effortLevel, setEffortLevel] = useState<EffortLevel | null>(null);
  const [effortOpen, setEffortOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [swapId, setSwapId] = useState<string | null>(null);
  const [swapOptions, setSwapOptions] = useState<readonly PlanSwapMeal[]>([]);
  const [swapChips, setSwapChips] = useState<readonly string[]>([]);
  const [sentFor, setSentFor] = useState<string | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedPlan, setSavedPlan] = useState<NutritionPlan | null>(null);
  const [inShopping, setInShopping] = useState(false);
  const [shoppingBusy, setShoppingBusy] = useState(false);
  const [logResult, setLogResult] = useState<LogResult | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);
  /**
   * Meals already shown, per meal, for "Show 3 others". Kept per meal and
   * started afresh each time a meal's swap panel opens, so swapping several
   * meals in a row never fills the server's 20-meal list (Inspector Brad,
   * #579).
   */
  const notWantedByMeal = useRef<Record<string, NotWantedMeal[]>>({});
  /** The accepted (dated) day, kept so a failed save can be retried. */
  const datedRef = useRef<MealPlan | null>(null);
  const savedRef = useRef(false);

  /**
   * Archive the accepted day when it's no longer on its way to a plan (an
   * edit, Log all, or leaving after a failed save), so it never shows as
   * "today's plan" in Log or blocks the next Save (Inspector Brad, #579).
   */
  const discardDated = useCallback(() => {
    const dated = datedRef.current;
    datedRef.current = null;
    if (dated === null || savedRef.current || userId === null) return;
    archiveMealprintDayCommand(storage, userId, dated);
    notifyMutated();
    void processSyncQueue(storage, auth, getApiBaseUrl()).catch((err) =>
      console.error("[Mealprint] queue flush failed:", err),
    );
  }, [userId, storage, auth, notifyMutated]);
  const discardRef = useRef(discardDated);
  discardRef.current = discardDated;
  useEffect(() => () => discardRef.current(), []);

  const { reset: resetGenerate } = generate;
  const { reset: resetSwap } = swap;
  const { reset: resetAccept } = accept;
  useEffect(() => {
    flowOpen(today);
    resetGenerate();
    resetSwap();
    resetAccept();
    return () => flowReset();
  }, [today, flowOpen, flowReset, resetGenerate, resetSwap, resetAccept]);

  const effort = effortLevel ?? preferences.data?.effortLevel ?? EFFORT_DEFAULT;

  // -- Generate --------------------------------------------------------------

  const onGenerate = useCallback(() => {
    void steerForm.handleSubmit((values) => {
      if (!online) return;
      notWantedByMeal.current = {};
      discardDated();
      flowGenerating();
      const meals = mealsForGenerate(userMeals.meals);
      const steer = values.steer.trim();
      void generate.run({
        planDate: today,
        ...(meals
          ? { meals }
          : {
              mealsPerDay:
                preferences.data?.mealsPerDay ?? MEALS_PER_DAY_DEFAULT,
            }),
        effortLevel: effort,
        ...(steer ? { steer } : {}),
      });
    })();
  }, [
    steerForm,
    online,
    discardDated,
    flowGenerating,
    userMeals.meals,
    generate,
    today,
    preferences.data,
    effort,
  ]);

  useEffect(() => {
    if (generate.stage !== "ready" || generate.result === null) return;
    const result = generate.result;
    if (result.emptyReason !== null) flowEmpty(result.emptyReason);
    else flowDraftReady(result);
    // `generate.result` is a fresh object per call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generate.stage, generate.result]);

  const effective = useMemo(
    () => (draft ? applyPlanPortions(draft, portions) : null),
    [draft, portions],
  );

  // An edit after the day was accepted (a save that then failed) makes that
  // accepted copy stale: archive it and accept the new day next time.
  useEffect(() => {
    if (datedRef.current !== null && savedPlan === null) discardDated();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, portions]);

  // -- Swap (N20) ------------------------------------------------------------

  const { run: runSwap, reset: resetSwapCall } = swap;
  const requestOptions = useCallback(
    (
      localId: string,
      steer: string | undefined,
      alsoExclude: readonly PlanSwapMeal[],
    ) => {
      if (!online || effective === null || draft === null) return;
      if (swap.stage === "swapping") return;
      const current = effective.meals.find((m) => m.localId === localId);
      if (!current) return;
      const history = addNotWantedMeals(
        notWantedByMeal.current[localId] ?? [],
        notWantedFrom([current.meal, ...alsoExclude]),
      );
      if (!history) {
        setSwapError(MEAL_SEARCH_FULL_MESSAGE);
        return;
      }
      notWantedByMeal.current[localId] = history;
      setSwapError(null);
      const original = steerForm.getValues("steer").trim();
      void runSwap({
        count: 3,
        notWantedMeals: history,
        dayTarget: draft.target,
        heldTotals: heldTotalsExcluding(effective, localId),
        logSlot: current.meal.logSlot,
        mealsPerDay: draft.mealsPerDay,
        ...(steer ? { steer } : {}),
        ...(original ? { originalRequest: original } : {}),
      });
    },
    [online, effective, draft, swap.stage, runSwap, steerForm],
  );

  useEffect(() => {
    if (swap.stage === "ready") {
      const result = swap.result;
      const options = result?.options ?? (result?.meal ? [result.meal] : []);
      setSwapOptions(options);
      if (options.length === 0) setSwapError(NO_REPLACEMENT);
      resetSwapCall();
    } else if (swap.stage === "error") {
      setSwapOptions([]);
      setSwapError(swap.failure?.message ?? NO_REPLACEMENT);
      resetSwapCall();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swap.stage]);

  const closeSwap = useCallback(() => {
    setSwapId(null);
    setSwapOptions([]);
    setSwapChips([]);
    setSentFor(null);
    setSwapError(null);
    feedbackForm.reset({ feedback: "" });
  }, [feedbackForm]);

  const onSwap = useCallback(
    (localId: string) => {
      if (swap.stage === "swapping") return;
      if (swapId === localId) {
        closeSwap();
        return;
      }
      closeSwap();
      setOpenId(null);
      setSwapId(localId);
      // A fresh panel starts a fresh "already shown" list for this meal.
      notWantedByMeal.current[localId] = [];
      requestOptions(localId, undefined, []);
    },
    [swap.stage, swapId, closeSwap, requestOptions],
  );

  const onSendFeedback = useCallback(() => {
    if (swapId === null) return;
    void feedbackForm.handleSubmit((values) => {
      const steer = swapSteer(swapChips, values.feedback);
      setSentFor(steer ?? null);
      requestOptions(swapId, steer, swapOptions);
    })();
  }, [swapId, feedbackForm, swapChips, requestOptions, swapOptions]);

  const onMoreOptions = useCallback(() => {
    if (swapId === null) return;
    requestOptions(
      swapId,
      swapSteer(swapChips, feedbackForm.getValues("feedback")),
      swapOptions,
    );
  }, [swapId, requestOptions, swapChips, feedbackForm, swapOptions]);

  const onPickOption = useCallback(
    (index: number) => {
      const option = swapOptions[index];
      if (swapId === null || !option) return;
      flowSwapApplied(swapId, option);
      closeSwap();
    },
    [swapOptions, swapId, flowSwapApplied, closeSwap],
  );

  // -- Meal controls (N19) ---------------------------------------------------

  const stepPortion = useCallback(
    (localId: string, direction: 1 | -1) => {
      const base = draft?.meals.find((m) => m.localId === localId)?.meal;
      if (!base) return;
      const next = (portions[localId] ?? 1) + direction * MEAL_PORTION_STEP;
      if (canScalePlanMeal(base, next)) flowSetPortion(localId, next);
    },
    [draft, portions, flowSetPortion],
  );

  const onRemove = useCallback(
    (localId: string) => {
      if (!draft?.meals.some((m) => m.localId === localId)) return;
      setOpenId(null);
      flowRemoveMeal(localId);
    },
    [draft, flowRemoveMeal],
  );

  // -- Save as a plan (N21) ---------------------------------------------------

  const { accept: runAccept, reset: resetAcceptCall } = accept;
  useEffect(() => {
    if (accept.failure?.code === "unresolvable_items") {
      flowMarkUnresolvable(accept.failure.unresolvableItems);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accept.failure]);

  const saveDay = useCallback(async (): Promise<NutritionPlan | null> => {
    if (savedPlan) return savedPlan;
    if (saving || effective === null || userId === null) return null;
    setSaving(true);
    setSaveError(null);
    try {
      const dated =
        datedRef.current ??
        (await runAccept(planDraftToAcceptInput(effective)));
      if (!dated) return null;
      datedRef.current = dated;
      const res = await api.savePlanFromMealprint(
        { fromMealprintPlanId: dated.id },
        `mealprint-save-${dated.id}`,
      );
      if (!res.ok) {
        setSaveError(saveErrorMessage(res.error.status));
        return null;
      }
      adoptSavedMealprintPlanCommand(storage, userId, res.value);
      // The dated day was only the way to the plan. Archive it so it never
      // shows as a plan for today in Log.
      discardDated();
      savedRef.current = true;
      setSavedPlan(res.value);
      nameForm.reset({ name: res.value.name });
      flowAccepted(dated);
      return res.value;
    } finally {
      setSaving(false);
    }
  }, [
    savedPlan,
    saving,
    effective,
    userId,
    runAccept,
    api,
    storage,
    discardDated,
    nameForm,
    flowAccepted,
  ]);

  const onReplaceTodaysPlan = useCallback(async () => {
    const date = accept.failure?.activePlanDate ?? today;
    const existing = await api.getActivePlan(date);
    if (existing.ok && existing.value) {
      await api.patchPlan(existing.value.id, { status: "archived" });
      if (userId) storage.removeCachedMealPlan(userId, date);
    }
    resetAcceptCall();
    await saveDay();
  }, [accept.failure, today, api, userId, storage, resetAcceptCall, saveDay]);

  const addToShopping = useCallback(
    async (plan: NutritionPlan) => {
      setShoppingBusy(true);
      try {
        await shopping.setPlanIncluded(plan.id, true);
        setInShopping(true);
      } finally {
        setShoppingBusy(false);
      }
    },
    [shopping],
  );

  const onBuilderShopping = useCallback(async () => {
    const plan = await saveDay();
    if (plan) await addToShopping(plan);
  }, [saveDay, addToShopping]);

  const onNameDone = useCallback(() => {
    void nameForm.handleSubmit((values) => {
      const name = values.name.trim();
      if (savedPlan === null || name === savedPlan.name) return;
      const next = { ...savedPlan, name };
      setSavedPlan(next);
      void plans.save(next);
    })();
  }, [nameForm, savedPlan, plans]);

  // -- Log all today (N22) -----------------------------------------------------

  const onLogAll = useCallback(async () => {
    if (effective === null || userId === null) return;
    const day = storage.getCachedFuelToday(userId, today);
    const plan = planLogAll(
      effective,
      userMeals.meals,
      day ? flattenFuelEntries(day) : [],
      loggedAtNoonUtc(today),
    );
    if (plan.inputs.length === 0) {
      setSaveError(
        "Every meal already has food today, so there's nothing to log.",
      );
      return;
    }
    const deps = { storage, userId, idFactory: localIdFactory };
    const before = dayEntryIds(storage, userId, today);
    const logged = logAllTodayCommand(deps, plan.inputs);
    notifyMutated();
    setLogResult({ rows: plan.rows, logged, before });
    flowLogged();
    // A day accepted for a save that then failed is not a plan for today.
    discardDated();
    try {
      await processSyncQueue(storage, auth, getApiBaseUrl());
    } catch (err) {
      console.error("[Mealprint] queue flush failed:", err);
    }
  }, [
    effective,
    userId,
    storage,
    today,
    userMeals.meals,
    notifyMutated,
    flowLogged,
    discardDated,
    auth,
  ]);

  const onUndo = useCallback(async () => {
    if (logResult === null || userId === null || undoing) return;
    setUndoing(true);
    try {
      undoLogAllCommand(
        { storage, userId, idFactory: localIdFactory },
        today,
        logResult.before,
        logResult.logged,
      );
      notifyMutated();
      setUndone(true);
      try {
        await processSyncQueue(storage, auth, getApiBaseUrl());
      } catch (err) {
        console.error("[Mealprint] queue flush failed:", err);
      }
    } finally {
      setUndoing(false);
    }
  }, [logResult, userId, undoing, storage, today, notifyMutated, auth]);

  const onPreferences = useCallback(() => {
    router.push("/(app)/fuel/preferences?mode=editor" as Href);
  }, []);

  const backToHome = useCallback(() => {
    resetGenerate();
    flowOpen(today);
  }, [resetGenerate, flowOpen, today]);

  // -- Which screen ----------------------------------------------------------

  if (step === "logged" && logResult) {
    const day = userId ? storage.getCachedFuelToday(userId, today) : null;
    const skipped = logResult.rows.filter((r) => r.skipped);
    return (
      <MealprintLoggedPresenter
        loggedCount={logResult.rows.length - skipped.length}
        skippedNames={
          skipped.length > 0 ? joinNames(skipped.map((r) => r.mealName)) : null
        }
        rows={logResult.rows.map((r) => ({
          key: r.localId,
          mealName: r.mealName,
          detail: r.skipped ? "Skipped · already has food" : r.dish,
          kcal: r.skipped ? null : r.kcal,
          skipped: r.skipped,
        }))}
        eatenKcal={day?.consumed.kcal ?? 0}
        targetKcal={day?.targets?.dailyKcal ?? target.data?.dailyKcal ?? null}
        onClose={onClose}
        onViewInLog={() => {
          usePlanSheets.getState().showFuelSection("log");
          onClose();
        }}
        onUndo={() => void onUndo()}
        undoing={undoing}
        undone={undone}
      />
    );
  }

  if (step === "saved" && savedPlan) {
    return (
      <MealprintSavedPresenter
        name={nameForm.watch("name")}
        onName={(name) =>
          nameForm.setValue("name", name, { shouldValidate: true })
        }
        onNameDone={onNameDone}
        nameError={firstMessage(nameForm.formState.errors) ?? null}
        mealCount={savedPlan.meals.length || (effective?.meals.length ?? 0)}
        kcal={
          savedPlan.totals.kcal ||
          (effective ? sumPlanDraftTotals(effective.meals).kcal : 0)
        }
        proteinG={
          savedPlan.totals.proteinG ||
          (effective ? sumPlanDraftTotals(effective.meals).proteinG : 0)
        }
        onClose={onClose}
        onViewInPlan={() => {
          usePlanSheets.getState().select(savedPlan.id);
          usePlanSheets.getState().showFuelSection("plan");
          onClose();
        }}
        onShoppingList={() => {
          if (inShopping) {
            router.push("/(app)/fuel/plans-shopping" as Href);
            return;
          }
          void addToShopping(savedPlan).then(() =>
            router.push("/(app)/fuel/plans-shopping" as Href),
          );
        }}
        inShoppingList={inShopping}
        shoppingBusy={shoppingBusy}
      />
    );
  }

  if (generate.stage === "error" && generate.failure) {
    if (generate.failure.entitlementDenied) {
      return (
        <MealprintLockedPresenter onBack={onClose} onUpgrade={gate.onUpgrade} />
      );
    }
    const state = online
      ? generateFailureState(generate.failure.status)
      : "offline";
    return (
      <MealprintStatePresenter
        state={state}
        onBack={backToHome}
        onPrimary={() => {
          if (state === "down") {
            flowGenerating();
            void generate.retry();
          } else backToHome();
        }}
        onSecondary={onClose}
      />
    );
  }

  if (step === "generating" || generate.stage === "generating") {
    return (
      <MealprintWorkingPresenter
        body="Filling your meals to your target and preferences. This takes a few seconds."
        onBack={onClose}
        onCancel={onClose}
      />
    );
  }

  if (emptyReason !== null) {
    return (
      <MealprintStatePresenter
        state={emptyReason === "no_targets" ? "no_target" : "none"}
        onBack={backToHome}
        onPrimary={backToHome}
        onSecondary={onClose}
      />
    );
  }

  if (step === "draft" && effective && draft) {
    const totals = sumPlanDraftTotals(effective.meals);
    const blocked =
      swapId !== null
        ? "Pick a replacement or keep the meal"
        : flaggedIds.size > 0
          ? "Swap the flagged meal to continue"
          : effective.meals.length === 0
            ? "Every meal was removed"
            : null;
    const panelMeal = swapId
      ? effective.meals.find((m) => m.localId === swapId)?.meal
      : undefined;
    const acceptMessage =
      accept.failure === null
        ? null
        : accept.failure.code === "unresolvable_items"
          ? "Some of this day's items are no longer available. Swap the flagged meal and try again."
          : accept.failure.code === "avoidance_violation"
            ? "Your preferences changed since this day was made. Start over to make a fresh one."
            : accept.failure.code === "portion_violation"
              ? "One meal is too large for a realistic portion. Swap it or change its portion."
              : accept.failure.code === "active_plan_exists"
                ? "You already have a Mealprint plan for today."
                : accept.failure.message;
    return (
      <MealprintDayPresenter
        totals={totals}
        target={draft.target}
        meals={effective.meals.map(({ localId, meal }) => {
          const base = draft.meals.find((m) => m.localId === localId)?.meal;
          const portion = portions[localId] ?? 1;
          const um = userMealForGeneratedMeal(meal, userMeals.meals);
          return {
            localId,
            slot: meal.label ?? um?.name ?? meal.logSlot,
            name: meal.name,
            items: mealItemsLine(meal),
            kcal: meal.kcal,
            flagged: flaggedIds.has(localId),
            swapped: localId in swappedFrom,
            portionLabel: `×${portion}`,
            canLess:
              base !== undefined &&
              canScalePlanMeal(base, portion - MEAL_PORTION_STEP),
            canMore:
              base !== undefined &&
              canScalePlanMeal(base, portion + MEAL_PORTION_STEP),
          };
        })}
        openId={openId}
        swap={
          swapId === null
            ? null
            : {
                localId: swapId,
                feedback: feedbackForm.watch("feedback"),
                onFeedback: (text) =>
                  feedbackForm.setValue("feedback", text, {
                    shouldValidate: true,
                  }),
                feedbackError:
                  firstMessage(feedbackForm.formState.errors) ?? null,
                sentFor,
                chips: SWAP_STEER_CHIPS.map((label) => ({
                  label,
                  on: swapChips.includes(label),
                })),
                onChip: (label) =>
                  setSwapChips((prev) =>
                    prev.includes(label)
                      ? prev.filter((c) => c !== label)
                      : [...prev, label],
                  ),
                options: swapOptions.map((o) => {
                  const delta = o.kcal - (panelMeal?.kcal ?? o.kcal);
                  return {
                    name: o.name,
                    items: mealItemsLine(o),
                    kcal: o.kcal,
                    delta: kcalDeltaLabel(delta),
                    deltaQuiet: Math.abs(delta) <= SWAP_DELTA_QUIET_KCAL,
                  };
                }),
                loading: swap.stage === "swapping",
                error: swapError,
                onSend: onSendFeedback,
                onPick: onPickOption,
                onMore: onMoreOptions,
                moreDisabled: !online || swap.stage === "swapping",
                onClose: closeSwap,
                closeLabel: flaggedIds.has(swapId) ? "Close" : "Keep this meal",
              }
        }
        onTapMeal={(localId) => {
          if (swapId !== null) return;
          setOpenId((prev) => (prev === localId ? null : localId));
        }}
        onSwap={onSwap}
        onLess={(localId) => stepPortion(localId, -1)}
        onMore={(localId) => stepPortion(localId, 1)}
        onUndo={(localId) => {
          flowUndoSwap(localId);
          setOpenId(null);
        }}
        onRemove={onRemove}
        dietaryPatterns={preferences.data?.dietaryPatterns ?? []}
        blockedLabel={blocked}
        busy={saving || accept.accepting || !online}
        errorMessage={
          saveError ??
          acceptMessage ??
          (online ? null : "You're offline. Mealprint needs a connection.")
        }
        errorAction={
          accept.failure?.code === "active_plan_exists"
            ? { label: "Replace it", onPress: () => void onReplaceTodaysPlan() }
            : accept.failure?.code === "avoidance_violation"
              ? { label: "Start over", onPress: backToHome }
              : null
        }
        onLogAll={() => void onLogAll()}
        onSave={() => void saveDay()}
        onShoppingList={() => void onBuilderShopping()}
        onBack={onClose}
      />
    );
  }

  if (!online) {
    return (
      <MealprintStatePresenter
        state="offline"
        onBack={onClose}
        onPrimary={onClose}
        onSecondary={onClose}
      />
    );
  }

  return (
    <MealprintHomePresenter
      tab="day"
      onTab={onTab}
      onBack={onClose}
      onPreferences={onPreferences}
      day={{
        target: target.data
          ? {
              kcal: target.data.dailyKcal,
              proteinG: target.data.proteinG,
              carbsG: target.data.carbsG,
              fatG: target.data.fatG,
            }
          : null,
        mealsText: userMealNames(userMeals.meals),
        onEditMeals: () => useFuelSheets.getState().openYourMeals(),
        effortLevel: effort,
        effortSheetOpen: effortOpen,
        onOpenEffort: () => setEffortOpen(true),
        onPickEffort: (level) => {
          setEffortLevel(level);
          setEffortOpen(false);
        },
        onCloseEffort: () => setEffortOpen(false),
        preferencesText: preferencesLine(preferences.data),
      }}
      steer={steerForm.watch("steer")}
      onSteer={(text) =>
        steerForm.setValue("steer", text, { shouldValidate: true })
      }
      steerError={firstMessage(steerForm.formState.errors) ?? null}
      notice={null}
      onSubmit={onGenerate}
      submitDisabled={!online}
    />
  );
}
