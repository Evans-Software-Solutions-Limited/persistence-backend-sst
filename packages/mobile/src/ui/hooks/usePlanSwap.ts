import { useCallback, useRef, useState } from "react";
import type { PlanSwapInput, PlanSwapResult } from "@/domain/models/mealprint";
import { useAdapters } from "./useAdapters";

/**
 * `POST /nutrition/ai/plan-meal-swap` — regenerate ONE meal, holding the rest
 * (spec-26 Phase 2, AC 4.4). Imperative, online-direct, never queued — same
 * posture and failure taxonomy as `usePlanGenerate`/`useMealSuggest`.
 *
 * Serves both the pre-accept draft ("Swap" on a card in
 * `MealprintPlanSheetContainer`) and a post-accept edit (the Today view calls
 * this then `useReplacePlanMeal` to persist the result) — the caller supplies
 * `heldTotals`/`dayTarget` either way, so this hook has no opinion on which.
 */

export type PlanSwapStage = "idle" | "swapping" | "ready" | "error";

export type PlanSwapFailure = {
  readonly message: string;
  readonly retryable: boolean;
  readonly entitlementDenied: boolean;
};

export type UsePlanSwap = {
  readonly stage: PlanSwapStage;
  readonly result: PlanSwapResult | null;
  readonly failure: PlanSwapFailure | null;
  readonly run: (input: PlanSwapInput) => Promise<void>;
  readonly reset: () => void;
};

function classify(status: number | undefined): PlanSwapFailure {
  if (status === 402) {
    return {
      message: "Mealprint is a Premium+ feature.",
      retryable: false,
      entitlementDenied: true,
    };
  }
  if (status === 429) {
    return {
      message: "You've used all of today's swaps — they reset tomorrow.",
      retryable: false,
      entitlementDenied: false,
    };
  }
  if (status === 422) {
    return {
      message: "Couldn't find a safe swap. Try again.",
      retryable: true,
      entitlementDenied: false,
    };
  }
  if (status === 503) {
    return {
      message:
        "Mealprint is unavailable right now. Try again in a few minutes.",
      retryable: true,
      entitlementDenied: false,
    };
  }
  return {
    message: "Couldn't reach Mealprint. Check your connection and try again.",
    retryable: true,
    entitlementDenied: false,
  };
}

export function usePlanSwap(): UsePlanSwap {
  const { api } = useAdapters();
  const [stage, setStage] = useState<PlanSwapStage>("idle");
  const [result, setResult] = useState<PlanSwapResult | null>(null);
  const [failure, setFailure] = useState<PlanSwapFailure | null>(null);
  // Ref guard: a swap is one meal card's own request — see this file's
  // docstring in `state/plan-flow.ts` on why only one meal can be mid-swap.
  const inFlightRef = useRef(false);

  const run = useCallback(
    async (input: PlanSwapInput) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setStage("swapping");
      setFailure(null);
      setResult(null);
      try {
        const response = await api.swapPlanMeal(input);
        if (!response.ok) {
          setFailure(classify(response.error.status));
          setStage("error");
          return;
        }
        setResult(response.value);
        setStage("ready");
      } finally {
        inFlightRef.current = false;
      }
    },
    [api],
  );

  const reset = useCallback(() => {
    if (inFlightRef.current) return;
    setStage("idle");
    setResult(null);
    setFailure(null);
  }, []);

  return { stage, result, failure, run, reset };
}
