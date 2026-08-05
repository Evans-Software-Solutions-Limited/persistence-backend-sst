import { useCallback, useRef, useState } from "react";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";
import type {
  MealPlanApiError,
  MealPlanErrorCode,
} from "@/domain/ports/api.port";
import type { PlanReplaceInput, MealPlan } from "@/domain/models/mealprint";

/**
 * `POST /nutrition/plans/:id/meals/:mealId/replace` — persist a swapped/
 * edited meal into an ALREADY-ACCEPTED plan (spec-26 Phase 2, AC 4.4 applied
 * post-accept — the Today view's own "swap this meal" action). Imperative and
 * online-direct, same reasoning as `usePlanAccept`: deterministic, but not
 * queued, because it's the second half of a swap round trip
 * (`usePlanSwap.run` → this) and the swap itself is AI-backed and online-only.
 *
 * Writes through `storage.cacheMealPlan` on success so the Today view and the
 * Fuel ghost rows reflect the replacement without a separate refetch.
 */

export type PlanReplaceFailure = {
  readonly message: string;
  readonly code: MealPlanErrorCode | undefined;
};

export type UseReplacePlanMeal = {
  readonly replacing: boolean;
  readonly failure: PlanReplaceFailure | null;
  readonly replace: (
    planId: string,
    mealId: string,
    input: PlanReplaceInput,
  ) => Promise<MealPlan | null>;
  readonly reset: () => void;
};

export function useReplacePlanMeal(): UseReplacePlanMeal {
  const { api, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const [replacing, setReplacing] = useState(false);
  const [failure, setFailure] = useState<PlanReplaceFailure | null>(null);
  const inFlightRef = useRef(false);

  const replace = useCallback(
    async (
      planId: string,
      mealId: string,
      input: PlanReplaceInput,
    ): Promise<MealPlan | null> => {
      if (inFlightRef.current || userId === null) return null;
      inFlightRef.current = true;
      setReplacing(true);
      setFailure(null);
      try {
        const response = await api.replacePlanMeal(planId, mealId, input);
        if (!response.ok) {
          const error: MealPlanApiError = response.error;
          setFailure({ message: error.message, code: error.planErrorCode });
          return null;
        }
        storage.cacheMealPlan(userId, response.value);
        return response.value;
      } finally {
        setReplacing(false);
        inFlightRef.current = false;
      }
    },
    [api, storage, userId],
  );

  const reset = useCallback(() => setFailure(null), []);

  return { replacing, failure, replace, reset };
}
