import { useCallback } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import { processSyncQueue } from "@/application/commands/sync.command";
import { localIdFactory } from "@/application/commands/localId";
import { logPlanMealCommand } from "@/application/commands/mealPlan.command";
import type { MealPlan, PlanMeal } from "@/domain/models/mealprint";
import type { NutritionEntry } from "@/domain/models/nutrition";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * Log a planned meal (spec-26 Phase 2, AC 5.2). Optimistic + offline-queued —
 * mirrors `useLogEntry` exactly (same shape, same fire-and-forget queue
 * flush), because this IS the plan-flavoured sibling of that mutation: the
 * ghost row's "Log it" button and the Today view's per-meal "Log" both call
 * this.
 */
export function useLogPlanMeal(): {
  mutate: (args: {
    plan: MealPlan;
    meal: PlanMeal;
  }) => Promise<NutritionEntry | null>;
} {
  const { auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const mutate = useCallback(
    async (args: { plan: MealPlan; meal: PlanMeal }) => {
      if (!userId) return null;
      const entry = logPlanMealCommand(
        { storage, userId, idFactory: localIdFactory },
        args,
      );
      try {
        await processSyncQueue(storage, auth, getApiBaseUrl());
      } catch (err) {
        console.error("[useLogPlanMeal] queue flush failed:", err);
      }
      return entry;
    },
    [auth, storage, userId],
  );

  return { mutate };
}
