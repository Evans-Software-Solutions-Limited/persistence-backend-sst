import { create } from "zustand";
import { localIdFactory } from "@/application/commands/localId";
import type {
  MealPlan,
  PlanDraft,
  PlanGenerateResult,
  PlanGeneratedMeal,
  PlanSwapMeal,
} from "@/domain/models/mealprint";
import {
  planDraftFromResult,
  planDraftMealsAffectedBy,
  removePlanDraftMeal,
  replacePlanDraftMeal,
  setPlanItemServings,
  unresolvableCandidateIds,
} from "@/domain/models/mealprint";

/**
 * usePlanFlow — the draft-review state behind Mealprint's "Plan my day" sheet
 * (spec-26 Phase 2, AC 4.1–4.6). Mirrors `useLoadoutFlow`'s shape (design § 4:
 * "Zustand for the draft-review state … mirror of the Loadout review-flow
 * store shape") for the same reason that store exists: the sheet's own
 * generate/accept/swap network calls are imperative hooks
 * (`usePlanGenerate`/`usePlanAccept`/`usePlanSwap`, mirroring `useMealSuggest`),
 * but the REVIEWED DRAFT — several independently editable meals, surviving a
 * per-meal swap round trip — is exactly the kind of multi-step working state a
 * single sheet-local `useState` starts to strain under (see
 * `MealprintSuggestSheetContainer`'s docstring on why ITS single-selection
 * draft does NOT need a store: a plan's is not single-selection).
 *
 * ## What this store is and is not
 *
 * UI-STATE ONLY, same as `useLoadoutFlow` — nothing here is persisted, and an
 * abandoned flow costs nothing to restart. `draft` holds the one in-flight
 * reviewed plan; it is cleared on `reset()`. The ACCEPTED plan this flow
 * produces is NOT cached here — accept writes through `storage.cacheMealPlan`
 * (via `usePlanAccept`), and the Fuel card / Today view read THAT, not this
 * store, so they still work after the sheet closes and this store resets.
 *
 * ## Why `flaggedIds` exists separately from the server flags
 *
 * A meal can become "needs a swap" two ways: the SERVER flagged it at
 * generation time (`meal.flaggedUnsafe` or `meal.flaggedPortion`), or the
 * client's accept attempt came back `unresolvable_items` naming this meal's
 * candidate ids (the `kind`-
 * ambiguity gap — see the domain model's file docstring). Both render
 * identically (the same "needs a swap" card state), so `flaggedIds` is the
 * UNION, computed once via {@link markUnresolvable} rather than forcing every
 * reader to check two different signals.
 *
 * ## Why `swappingId` is a single id, not a set
 *
 * Only one meal's Swap button can be pressed before its own request settles —
 * the whole sheet is that meal's card mid-request, and a second tap on a
 * DIFFERENT card while one swap is in flight would need two independent
 * ceiling-counted requests in the same breath, which the design never asks
 * for. A lone id keeps "is THIS card swapping" a simple equality check.
 */

export type PlanFlowStep = "config" | "generating" | "draft" | "saved" | null;

export type PlanFlowEmptyReason = "no_targets" | "no_candidates";

export interface PlanFlowState {
  /** Null when the flow is closed. Opening always starts at `config`. */
  step: PlanFlowStep;
  /** The device-local day this plan targets — set once, at `open()`. */
  planDate: string;
  draft: PlanDraft | null;
  /** Set when a generate call answered EMPTY (design § "empty is an answer"). */
  emptyReason: PlanFlowEmptyReason | null;
  /** Draft `localId`s that need a swap before Accept — see the docstring. */
  flaggedIds: ReadonlySet<string>;
  /** The meal currently mid-swap-request, if any. */
  swappingId: string | null;
  /** The plan `acceptPlan()` returned, rendered on the `saved` step. */
  acceptedPlan: MealPlan | null;
  /**
   * Bumped after a successful accept, so the Fuel card / meal log re-read
   * their cache without this store holding a reference to them (mirrors
   * `useFuelSheets().notifyMutated` / `useLoadoutFlow.rev`).
   */
  rev: number;

  open: (planDate: string) => void;
  close: () => void;
  generating: () => void;
  draftReady: (result: PlanGenerateResult) => void;
  empty: (reason: PlanFlowEmptyReason) => void;
  removeMeal: (localId: string) => void;
  /**
   * The serving stepper's write path (AC 4.4/gap 2) — sets one item's
   * servings within one draft meal and recomputes that meal's totals
   * deterministically, client-side (`setPlanItemServings`), so the day
   * totals card and the accept payload both reflect the edit with no round
   * trip.
   */
  updateItemServings: (
    localId: string,
    candidateId: string,
    servings: number,
  ) => void;
  beginSwap: (localId: string) => void;
  swapApplied: (localId: string, meal: PlanSwapMeal) => void;
  swapAbandoned: () => void;
  /** Accept 400 `unresolvable_items` — flag the affected meal(s), stay on `draft`. */
  markUnresolvable: (unresolvableItems: readonly string[]) => void;
  accepted: (plan: MealPlan) => void;
  reset: () => void;
}

const CLOSED = {
  step: null,
  planDate: "",
  draft: null,
  emptyReason: null,
  flaggedIds: new Set<string>(),
  swappingId: null,
  acceptedPlan: null,
} as const;

export const usePlanFlow = create<PlanFlowState>((set, get) => ({
  ...CLOSED,
  rev: 0,

  open: (planDate) => set({ ...CLOSED, step: "config", planDate }),

  close: () => set({ ...CLOSED }),

  generating: () => set({ step: "generating", draft: null, emptyReason: null }),

  draftReady: (result) => {
    const draft = planDraftFromResult(get().planDate, result, localIdFactory);
    if (draft === null) {
      // `target: null` — the generate call answered but had nothing to
      // measure against (shouldn't reach here once `empty()` is called first
      // for a declared emptyReason, but this is the safe fallback if it does).
      set({ step: "config", draft: null });
      return;
    }
    const flagged = new Set<string>();
    for (const { localId, meal } of draft.meals) {
      if (meal.flaggedUnsafe || meal.flaggedPortion) flagged.add(localId);
    }
    set({ step: "draft", draft, flaggedIds: flagged, emptyReason: null });
  },

  empty: (reason) => set({ step: "config", emptyReason: reason }),

  removeMeal: (localId) =>
    set((state) => {
      if (state.draft === null) return {};
      const nextFlagged = new Set(state.flaggedIds);
      nextFlagged.delete(localId);
      return {
        draft: removePlanDraftMeal(state.draft, localId),
        flaggedIds: nextFlagged,
      };
    }),

  updateItemServings: (localId, candidateId, servings) =>
    set((state) => {
      if (state.draft === null) return {};
      const target = state.draft.meals.find((m) => m.localId === localId);
      if (target === undefined) return {};
      const nextMeal = setPlanItemServings(target.meal, candidateId, servings);
      return { draft: replacePlanDraftMeal(state.draft, localId, nextMeal) };
    }),

  beginSwap: (localId) => set({ swappingId: localId }),

  swapApplied: (localId, meal) =>
    set((state) => {
      if (state.draft === null) return { swappingId: null };
      const newFlagged = new Set(state.flaggedIds);
      // A fresh swap is never itself server-flagged (see `PlanSwapMeal`); clear
      // this meal's flag whichever kind it was (server-flagged or
      // accept-unresolvable).
      newFlagged.delete(localId);
      const nextMeal: PlanGeneratedMeal = {
        ...meal,
        flaggedUnsafe: false,
        flaggedPortion: false,
      };
      return {
        draft: replacePlanDraftMeal(state.draft, localId, nextMeal),
        flaggedIds: newFlagged,
        swappingId: null,
      };
    }),

  swapAbandoned: () => set({ swappingId: null }),

  markUnresolvable: (unresolvableItems) =>
    set((state) => {
      if (state.draft === null) return {};
      const ids = unresolvableCandidateIds(unresolvableItems);
      const affected = planDraftMealsAffectedBy(state.draft, ids);
      const nextFlagged = new Set(state.flaggedIds);
      for (const id of affected) nextFlagged.add(id);
      return { flaggedIds: nextFlagged };
    }),

  accepted: (plan) =>
    set((state) => ({
      step: "saved",
      acceptedPlan: plan,
      rev: state.rev + 1,
    })),

  reset: () => set({ ...CLOSED }),
}));
