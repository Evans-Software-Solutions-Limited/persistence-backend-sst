import { useCallback, useRef, useState } from "react";
import type {
  MealSuggestInput,
  MealSuggestResult,
} from "@/domain/models/mealprint";
import { useAdapters } from "./useAdapters";

/**
 * `POST /nutrition/ai/meal-suggest` — the fill-my-macros call (spec-26
 * STORY-003).
 *
 * Imperative, online-direct, and **never queued**: replaying an inference after a
 * reconnect spends one of the user's 20 daily suggestions on a request they long
 * since abandoned, and there is no UI left to show the answer in (locked
 * decision 9, same posture as Snap and the Loadout preview).
 *
 * ## The failure taxonomy is the reason this hook exists
 *
 * Every status means something different to the user, and collapsing them into
 * "something went wrong" is a real product regression here — three of the five are
 * states the user can act on and one of them ("try again") is actively wrong
 * advice for the rest of the day:
 *
 * | status | meaning | what the sheet says |
 * | --- | --- | --- |
 * | 402 | not entitled | the upgrade surface (should be unreachable — the caller gates on `useMealprintGate`) |
 * | 429 | 20/day ceiling spent | names the cap and that it resets tomorrow — NOT "try again" |
 * | 422 | the model answered and every suggestion failed server-side verification | retry is genuinely the right action |
 * | 503 | Bedrock is down, and there is deliberately no deterministic fallback | say it is unavailable; do NOT say "try rephrasing" — there is a steer, but a provider outage is not a prompt problem |
 * | timeout / network | transport | check your connection |
 *
 * ⚠ **An `ok` result can still be EMPTY, and that is an answer rather than a
 * failure.** `no_targets`, `budget_exhausted` and `no_candidates` are 200s that
 * consumed no inference and no ceiling. They are returned as a normal `result`,
 * not an `error`, precisely so the sheet renders a specific explanation — see
 * `MealSuggestEmptyReason`, and note that `no_candidates` is the EXPECTED state
 * for any user with an allergen chip set until the Open Food Facts re-seed lands.
 *
 * ## ⚠ Concurrency
 *
 * A second `run` while one is in flight is REJECTED rather than queued or
 * superseded. Each call that reaches the provider writes a usage row, so letting
 * an impatient double-tap fire twice bills two of twenty. The guard is a ref, not
 * state, so the second tap is rejected synchronously — a state flag leaves a
 * window in which both taps pass it.
 */

export type MealSuggestStage = "idle" | "generating" | "ready" | "error";

/** A user-facing failure, already classified. `retryable` drives the button. */
export type MealSuggestFailure = {
  readonly message: string;
  /**
   * False for the ceiling and the entitlement denial — the two states where a
   * retry button would be a lie, because nothing the user can do in the next
   * minute changes the answer.
   */
  readonly retryable: boolean;
  /** True only for 402, so the caller can surface the upgrade sheet instead. */
  readonly entitlementDenied: boolean;
};

export type UseMealSuggest = {
  readonly stage: MealSuggestStage;
  readonly result: MealSuggestResult | null;
  readonly failure: MealSuggestFailure | null;
  /** Fire the call. Resolves when the stage has settled. No-op while in flight. */
  readonly run: (input: MealSuggestInput) => Promise<void>;
  /** Re-fire the last input. No-op when there has not been one. */
  readonly retry: () => Promise<void>;
  /** Back to `idle` with no result — used when the sheet reopens. */
  readonly reset: () => void;
};

/**
 * Copy for each classified failure. Kept beside the taxonomy so the mapping is
 * reviewable in one place rather than spread across a container's branches.
 */
function classify(status: number | undefined): MealSuggestFailure {
  if (status === 402) {
    return {
      message: "Mealprint is a Premium+ feature.",
      retryable: false,
      entitlementDenied: true,
    };
  }
  if (status === 429) {
    return {
      message:
        "You've used all of today's Mealprint suggestions — they reset tomorrow.",
      retryable: false,
      entitlementDenied: false,
    };
  }
  if (status === 422) {
    return {
      message: "Couldn't put together anything that fits. Try again.",
      retryable: true,
      entitlementDenied: false,
    };
  }
  if (status === 503) {
    // ⚠ NOT "try rephrasing your steer". A provider outage is not a prompt
    // problem, and that exact mis-copy already exists twice in this codebase
    // (`QuickAddSheetContainer`, `SnapAISheetContainer`) — do not add a third.
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

export function useMealSuggest(): UseMealSuggest {
  const { api } = useAdapters();
  const [stage, setStage] = useState<MealSuggestStage>("idle");
  const [result, setResult] = useState<MealSuggestResult | null>(null);
  const [failure, setFailure] = useState<MealSuggestFailure | null>(null);
  // Ref, not state: rejects a double-tap synchronously (see the docstring).
  const inFlightRef = useRef(false);
  // Retained so "Try again" re-sends the same shape/steer without making the
  // user re-enter it.
  const lastInputRef = useRef<MealSuggestInput | null>(null);

  const run = useCallback(
    async (input: MealSuggestInput) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      lastInputRef.current = input;
      setStage("generating");
      setFailure(null);
      setResult(null);
      try {
        const response = await api.suggestMeals(input);
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
    // ⚠ Deliberately does NOT clear `inFlightRef`: a reset while a request is in
    // flight must not open the door to a second one, or closing and reopening the
    // sheet mid-generation would bill two of the user's twenty daily suggestions.
    // The in-flight call's `finally` clears it.
    //
    // ⚠ But the stage must then stay `generating`, not go `idle`. Going idle put
    // the sheet back to a setup body with a LIVE Generate button that `run`
    // silently no-opped for up to 30 s (the client timeout), after which the
    // original request landed and rendered results for the shape and steer the
    // reset had already wiped off the screen. Keeping the spinner tells the truth:
    // a request is still out, and its answer is the one that will arrive.
    //
    // ⚠ And for the same reason the LAST INPUT has to survive too. Nulling it
    // unconditionally left the arriving result with nothing to retry from, so after
    // a mid-generation reopen both "Show me something else" and the error stage's
    // "Try again" called `retry()`, hit `if (!last) return`, and did nothing —
    // silently, forever. On the error stage that is the sheet's ONLY button, so the
    // user's sole escape was swiping it down. The two guards are one decision: the
    // in-flight request still owns this hook's state, including its input.
    //
    // ⚠ **This makes the hook's `lastInputRef` and the container's `shape`/`steer`
    // diverge after a mid-generation reopen, ON PURPOSE.** The container's open
    // effect blanks its inputs to `either`/`""` while this keeps the pre-close pair,
    // and that is the right semantics: "Show me something else" means *re-run what
    // produced this result*, not *run whatever the inputs now say*. It is invisible
    // (no stage that offers a retry renders the setup body), so the only way it
    // surfaces is someone "tidying up" the divergence by re-nulling the input here —
    // which is the bug above. Don't.
    if (!inFlightRef.current) lastInputRef.current = null;
    setStage(inFlightRef.current ? "generating" : "idle");
    setResult(null);
    setFailure(null);
  }, []);

  return { stage, result, failure, run, retry, reset };
}
