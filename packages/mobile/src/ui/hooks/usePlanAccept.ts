import { useCallback, useRef, useState } from "react";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";
import type {
  MealPlanApiError,
  MealPlanErrorCode,
} from "@/domain/ports/api.port";
import type { PlanAcceptInput, MealPlan } from "@/domain/models/mealprint";

/**
 * `POST /nutrition/plans` — accept a reviewed draft (spec-26 Phase 2, AC 4.5).
 * Imperative and online-direct: unlike `logPlanMealCommand`, this is NOT
 * queued (see `api.port.ts`'s "Mealprint day plans" docstring for why — the
 * flow needs the server-assigned plan id back before anything downstream can
 * address it).
 *
 * On success, writes through `storage.cacheMealPlan` so the Fuel card / ghost
 * rows / Today view see the freshly-accepted plan immediately, with no
 * separate `getActivePlan` round trip required — the sheet closes right after,
 * and the next `useGetActiveMealPlan` mount reads exactly this row.
 *
 * Surfaces the plan-domain error code (see {@link MealPlanApiError}) rather
 * than collapsing it, because three of its four failures have three different
 * recoveries: `unresolvable_items` → flag the affected meal(s) for swap
 * (`usePlanFlow.markUnresolvable`); `avoidance_violation` → the draft is stale,
 * regenerate; `active_plan_exists` → offer "replace today's plan".
 */

export type PlanAcceptFailure = {
  readonly message: string;
  readonly code: MealPlanErrorCode | undefined;
  readonly unresolvableItems: readonly string[];
  readonly activePlanDate: string | undefined;
};

export type UsePlanAccept = {
  readonly accepting: boolean;
  readonly failure: PlanAcceptFailure | null;
  readonly accept: (input: PlanAcceptInput) => Promise<MealPlan | null>;
  readonly reset: () => void;
};

function toFailure(error: MealPlanApiError): PlanAcceptFailure {
  return {
    message: error.message,
    code: error.planErrorCode,
    unresolvableItems: error.unresolvableItems ?? [],
    activePlanDate: error.activePlanDate,
  };
}

export function usePlanAccept(): UsePlanAccept {
  const { api, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const [accepting, setAccepting] = useState(false);
  const [failure, setFailure] = useState<PlanAcceptFailure | null>(null);
  const inFlightRef = useRef(false);

  const accept = useCallback(
    async (input: PlanAcceptInput): Promise<MealPlan | null> => {
      if (inFlightRef.current || userId === null) return null;
      inFlightRef.current = true;
      setAccepting(true);
      setFailure(null);
      try {
        const response = await api.acceptPlan(input);
        if (!response.ok) {
          setFailure(toFailure(response.error));
          return null;
        }
        storage.cacheMealPlan(userId, response.value);
        return response.value;
      } finally {
        setAccepting(false);
        inFlightRef.current = false;
      }
    },
    [api, storage, userId],
  );

  const reset = useCallback(() => setFailure(null), []);

  return { accepting, failure, accept, reset };
}
