import { useCallback, useEffect, useState } from "react";
import { router } from "expo-router";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useGetActiveMealPlan } from "@/ui/hooks/useGetActiveMealPlan";
import { useLogPlanMeal } from "@/ui/hooks/useLogPlanMeal";
import { usePlanSwap } from "@/ui/hooks/usePlanSwap";
import { useReplacePlanMeal } from "@/ui/hooks/useReplacePlanMeal";
import { localDayISO } from "@/shared/utils";
import {
  computePlanAdherence,
  planAcceptMealInputFromGenerated,
  type PlanMeal,
} from "@/domain/models/mealprint";
import { PlanTodayPresenter } from "@/ui/presenters/mealprint/PlanTodayPresenter";

/**
 * <PlanTodayContainer> — spec-26 Phase 2, STORY-005 AC 5.3/5.4. Reads TODAY's
 * active plan (this view is always "today" — a past/future day's plan is
 * reached via history, out of scope for this pass) and wires log/swap/delete.
 *
 * ⚠ Swap here is TWO calls, not one: `usePlanSwap` (AI, regenerate ONE meal,
 * holding the rest) then `useReplacePlanMeal` (deterministic, persist the
 * result into the already-accepted plan) — see each hook's docstring. This
 * container is what stitches them into one "Swap" button.
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

  const onBack = useCallback(() => {
    router.back();
  }, []);

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
      onDeletePlan={() => void onDeletePlan()}
      deleting={deleting}
    />
  );
}
