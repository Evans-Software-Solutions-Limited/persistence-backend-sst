import { useCallback, useRef, useState } from "react";
import type {
  PlanGenerateInput,
  PlanGenerateResult,
} from "@/domain/models/mealprint";
import { useAdapters } from "./useAdapters";

/**
 * `POST /nutrition/ai/plan-generate` — the day-plan draft call (spec-26 Phase
 * 2, AC 4.1/4.2). Imperative, online-direct, NEVER queued — mirrors
 * `useMealSuggest` exactly: replaying an inference after a reconnect spends
 * one of the 5 daily plan-generates on a request the user has moved on from,
 * and there is no UI left to show the answer in (locked decision 9).
 *
 * Same failure taxonomy as `useMealSuggest` (402 entitlement / 429 ceiling /
 * 422 unreadable / 503 unavailable / transport), and the same "empty is an
 * answer" rule — `no_targets`/`no_candidates` come back as a normal `result`,
 * not a `failure`.
 */

export type PlanGenerateStage = "idle" | "generating" | "ready" | "error";

export type PlanGenerateFailure = {
  readonly message: string;
  readonly retryable: boolean;
  readonly entitlementDenied: boolean;
};

export type UsePlanGenerate = {
  readonly stage: PlanGenerateStage;
  readonly result: PlanGenerateResult | null;
  readonly failure: PlanGenerateFailure | null;
  readonly run: (input: PlanGenerateInput) => Promise<void>;
  readonly retry: () => Promise<void>;
  readonly reset: () => void;
};

function classify(status: number | undefined): PlanGenerateFailure {
  if (status === 402) {
    return {
      message: "Mealprint is a Premium+ feature.",
      retryable: false,
      entitlementDenied: true,
    };
  }
  if (status === 429) {
    return {
      message: "You've used all of today's plans — they reset tomorrow.",
      retryable: false,
      entitlementDenied: false,
    };
  }
  if (status === 422) {
    return {
      message: "Couldn't put together a plan that fits. Try again.",
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

export function usePlanGenerate(): UsePlanGenerate {
  const { api } = useAdapters();
  const [stage, setStage] = useState<PlanGenerateStage>("idle");
  const [result, setResult] = useState<PlanGenerateResult | null>(null);
  const [failure, setFailure] = useState<PlanGenerateFailure | null>(null);
  const inFlightRef = useRef(false);
  const lastInputRef = useRef<PlanGenerateInput | null>(null);

  const run = useCallback(
    async (input: PlanGenerateInput) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      lastInputRef.current = input;
      setStage("generating");
      setFailure(null);
      setResult(null);
      try {
        const response = await api.generatePlan(input);
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

  const retry = useCallback(async () => {
    const last = lastInputRef.current;
    if (!last) return;
    await run(last);
  }, [run]);

  const reset = useCallback(() => {
    // Same "an in-flight request still owns this hook's state" contract as
    // `useMealSuggest.reset` — see that hook's docstring for the failure mode
    // this guards against (a reopened sheet showing a live Generate button
    // that silently no-ops for up to 30s while the abandoned request is still
    // running).
    if (!inFlightRef.current) lastInputRef.current = null;
    setStage(inFlightRef.current ? "generating" : "idle");
    setResult(null);
    setFailure(null);
  }, []);

  return { stage, result, failure, run, retry, reset };
}
