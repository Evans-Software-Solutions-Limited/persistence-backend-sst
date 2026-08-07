import { useCallback, useEffect, useState } from "react";
import { router } from "expo-router";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useGetActiveMealPlan } from "@/ui/hooks/useGetActiveMealPlan";
import { useLogPlanMeal } from "@/ui/hooks/useLogPlanMeal";
import { usePlanSwap } from "@/ui/hooks/usePlanSwap";
import {
  useReplacePlanMeal,
  type PlanReplaceFailure,
} from "@/ui/hooks/useReplacePlanMeal";
import { localDayISO } from "@/shared/utils";
import {
  computePlanAdherence,
  planAcceptMealInputFromGenerated,
  type PlanMeal,
} from "@/domain/models/mealprint";
import { PlanTodayPresenter } from "@/ui/presenters/mealprint/PlanTodayPresenter";

/**
 * `usePlanSwap`'s own `classify` already produces a full user-facing message
 * per status (429 ceiling, 402 entitlement, 422/503/generic) — nothing to
 * remap there. `useReplacePlanMeal`'s failure is code-based instead, so this
 * gives each recognised `MealPlanErrorCode` its own copy and falls back to
 * the raw wire message for anything unrecognised (transport errors, or a
 * future code this container hasn't been taught yet).
 */
function replaceFailureMessage(failure: PlanReplaceFailure): string {
  switch (failure.code) {
    case "unresolvable_items":
      return "That item is no longer available. Try swapping again.";
    case "avoidance_violation":
      return "That swap conflicts with your preferences. Try again.";
    case "meal_not_found":
      return "This meal is no longer part of your plan.";
    case "meal_already_logged":
      return "This meal has already been logged and can't be replaced.";
    default:
      return failure.message;
  }
}

/**
 * <PlanTodayContainer> — spec-26 Phase 2, STORY-005 AC 5.3/5.4. Reads TODAY's
 * active plan (this view is always "today" — a past/future day's plan is
 * reached via history, out of scope for this pass) and wires log/swap/delete.
 *
 * ⚠ Swap here is TWO calls, not one: `usePlanSwap` (AI, regenerate ONE meal,
 * holding the rest) then `useReplacePlanMeal` (deterministic, persist the
 * result into the already-accepted plan) — see each hook's docstring. This
 * container is what stitches them into one "Swap" button.
 *
 * ## Why `actionFailure` is its own state, not a read of `swap.failure`/`replace.failure`
 *
 * Both hooks compute a `failure`, but this container can't just forward them
 * to the presenter: the swap/replace orchestration effect below calls
 * `resetSwap()` on every settle (ready OR error), which wipes `swap.failure`
 * back to `null` in the same pass that produced it — a container reading it
 * directly would show the message for at most one paint before it vanished.
 * `replace.failure` has the opposite problem: the `.then` continuation after
 * `runReplace(...)` closes over the `replace` object from the render that
 * started the call, so reading `replace.failure` inside that callback is a
 * stale read — the hook's `setFailure` has updated a DIFFERENT object by the
 * time the callback runs. Mirroring each hook's `failure` into local state
 * via its own effect (keyed on the failure object reference, same pattern as
 * `MealprintPlanSheetContainer`'s `accept.failure` effect) sidesteps both.
 */
export function PlanTodayContainer() {
  const { api, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const today = localDayISO();
  const activePlan = useGetActiveMealPlan(today);
  const logPlanMeal = useLogPlanMeal();
  const swap = usePlanSwap();
  const replace = useReplacePlanMeal();

  const [loggingMealId, setLoggingMealId] = useState<string | null>(null);
  const [swappingMealId, setSwappingMealId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionFailure, setActionFailure] = useState<string | null>(null);

  const onBack = useCallback(() => {
    router.back();
  }, []);

  // Basket icon in the header (spec-26 amendment 2026-08 § B) — the
  // presenter only renders it when `plan` is non-null, but the callback is
  // guarded here too so a stray press during the brief window before the
  // plan loads can't push a route with no `planId`.
  const onOpenShoppingList = useCallback(() => {
    const plan = activePlan.data;
    if (!plan) return;
    router.push(`/(app)/fuel/shopping?planId=${plan.id}` as never);
  }, [activePlan]);

  const onLogMeal = useCallback(
    async (meal: PlanMeal) => {
      const plan = activePlan.data;
      if (!plan) return;
      setLoggingMealId(meal.id);
      try {
        await logPlanMeal.mutate({ plan, meal });
        activePlan.reload();
      } finally {
        setLoggingMealId(null);
      }
    },
    [activePlan, logPlanMeal],
  );

  const { run: runSwap, reset: resetSwap } = swap;
  const onSwapMeal = useCallback(
    (meal: PlanMeal) => {
      const plan = activePlan.data;
      if (!plan) return;
      setActionFailure(null);
      setSwappingMealId(meal.id);
      const held = plan.meals
        .filter((m) => m.id !== meal.id)
        .reduce(
          (acc, m) => ({
            kcal: acc.kcal + m.kcal,
            proteinG: acc.proteinG + m.proteinG,
            carbsG: acc.carbsG + m.carbsG,
            fatG: acc.fatG + m.fatG,
          }),
          { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
        );
      void runSwap({
        dayTarget: {
          kcal: plan.targetKcal,
          proteinG: plan.targetProteinG,
          carbsG: plan.targetCarbsG,
          fatG: plan.targetFatG,
        },
        heldTotals: held,
        logSlot: meal.logSlot,
      });
    },
    [activePlan, runSwap],
  );

  // Mirror a swap failure (429 ceiling, 402 entitlement, 422/503/generic —
  // see `classify` in `usePlanSwap`) into `actionFailure` the instant it
  // appears. Must be a SEPARATE effect from the orchestration one below: that
  // effect calls `resetSwap()` on every settle, which clears `swap.failure`
  // in the same pass — reading it there would show nothing.
  useEffect(() => {
    if (swap.failure) setActionFailure(swap.failure.message);
  }, [swap.failure]);

  // Mirror a replace failure (400 unresolvable_items, 422 avoidance_violation,
  // 404 meal_not_found, 409 meal_already_logged) the same way. Reading
  // `replace.failure` from inside the `.then` below instead would be a stale
  // closure — that callback closes over the `replace` object from the render
  // that started the call, not the one `setFailure` updates.
  useEffect(() => {
    if (replace.failure)
      setActionFailure(replaceFailureMessage(replace.failure));
  }, [replace.failure]);

  const { replace: runReplace } = replace;
  useEffect(() => {
    if (swap.stage !== "ready" && swap.stage !== "error") return;
    const plan = activePlan.data;
    const mealId = swappingMealId;
    if (!plan || !mealId) return;
    if (swap.stage === "ready" && swap.result?.meal) {
      void runReplace(
        plan.id,
        mealId,
        planAcceptMealInputFromGenerated(swap.result.meal),
      ).then((updated) => {
        if (updated) activePlan.reload();
        setSwappingMealId(null);
      });
    } else {
      setSwappingMealId(null);
    }
    resetSwap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swap.stage, swap.result]);

  const onDeletePlan = useCallback(async () => {
    const plan = activePlan.data;
    if (!plan || deleting) return;
    setDeleting(true);
    try {
      await api.deletePlan(plan.id);
      if (userId) storage.removeCachedMealPlan(userId, plan.planDate);
      activePlan.reload();
      router.back();
    } finally {
      setDeleting(false);
    }
  }, [activePlan, api, storage, userId, deleting]);

  const adherence = activePlan.data
    ? computePlanAdherence(activePlan.data)
    : {
        loggedCount: 0,
        totalCount: 0,
        loggedTotals: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
      };

  return (
    <PlanTodayPresenter
      loading={activePlan.isRefreshing}
      plan={activePlan.data}
      loggedTotals={adherence.loggedTotals}
      loggedCount={adherence.loggedCount}
      totalCount={adherence.totalCount}
      onBack={onBack}
      onLogMeal={(meal) => void onLogMeal(meal)}
      loggingMealId={loggingMealId}
      onSwapMeal={onSwapMeal}
      swappingMealId={swappingMealId}
      actionFailure={actionFailure}
      onDeletePlan={() => void onDeletePlan()}
      deleting={deleting}
      onOpenShoppingList={onOpenShoppingList}
    />
  );
}
