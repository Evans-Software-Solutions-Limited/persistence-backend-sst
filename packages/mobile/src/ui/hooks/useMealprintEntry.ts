import { useCallback, useEffect, useMemo, useState } from "react";
import { router, type Href } from "expo-router";
import { useFuelSheets } from "@/state/fuel-sheets";
import {
  computePlanAdherence,
  nextUnloggedPlanMeal,
  type MealPlan,
} from "@/domain/models/mealprint";
import type {
  MealprintEntryState,
  MealprintPlanProgress,
} from "@/ui/presenters/mealprint/MealprintEntryCard";
import { useMealprintGate } from "./useMealprintGate";
import { useMealprintPreferences } from "./useMealprintPreferences";

/**
 * useMealprintEntry — everything the Fuel Mealprint card needs, in one hook.
 *
 * Extracted from `FuelContainer` rather than inlined because the four-state
 * resolution (see {@link MealprintEntryState}) has a timer, a retry that has to do
 * two things, and a first-run decision — and burying that in a 300-line screen
 * container is how the equivalent logic in `GymsSegmentContainer` became four
 * separate bugs.
 *
 * ## ⚠ Reads preferences from the CACHE ONLY
 *
 * `useMealprintPreferences()` is called with `enabled` defaulted to `false`, so
 * this issues **no network request**. That is deliberate: Fuel is a tab, so an
 * eager fetch here would land on every cold launch, and the launch fan-out that
 * produced ~28 requests inside 100 ms against a 10-concurrency Lambda quota
 * (≈16 of them 503s) was assembled from exactly this kind of individually
 * harmless mount fetch. The surfaces this card opens — the wizard route and the
 * suggest sheet — each fetch for themselves.
 *
 * The consequence is that `data === null` on a fresh install, which is
 * indistinguishable from "no preferences saved". Both resolve to `needsSetup`,
 * and that is the correct answer for both: the first tap should open the wizard
 * either way.
 *
 * ## ⚠ The stalled retry must do BOTH halves or it is decorative
 *
 * Clearing `stalled` alone neither reissues the request (`useMealprintGate` owns
 * the queries) nor re-arms the clock — the timer effect keys on `gate.isResolved`,
 * which has not changed — so one tap returned the user to an unbounded muted card
 * with no way back to the retry affordance. Hence `gate.refetch()` (which cancels
 * the hung attempt first — see that method's docstring for why a bare `refetch`
 * is a no-op) PLUS an `attempt` counter in the effect's dependencies.
 */

/** Long enough not to fire on a slow-but-working cold start. Matches `GymsSegmentContainer`. */
export const MEALPRINT_RESOLVE_TIMEOUT_MS = 8000;

export type MealprintEntry = {
  readonly state: MealprintEntryState;
  /** True when the first tap should open the wizard rather than the sheet. */
  readonly needsSetup: boolean;
  /**
   * Present + non-null ⇒ the viewed day has an active plan — the card renders
   * the ACTIVE variant and `onPress` opens the Today view instead of the
   * suggest sheet (spec-26 Phase 2, AC 5.1).
   */
  readonly planProgress: MealprintPlanProgress | null;
  /** Open the wizard / Today view / suggest sheet, as the state above dictates. */
  readonly onPress: () => void;
  /** "Plan my day" — opens the plan config sheet. */
  readonly onPlanMyDay: () => void;
  /**
   * Fuel-page-level "Preferences" entry (amendment 2026-08 § C) — pushes the
   * editor directly, bypassing the wizard framing. See
   * `MealprintEntryCard`'s docstring for why this needs to be a card-level
   * entry rather than a link inside a root-mounted sheet.
   */
  readonly onEditPreferences: () => void;
  readonly onUpgrade: () => void;
  readonly onRetry: () => void;
};

/**
 * `activePlan` is the caller's (`FuelContainer`'s) already-fetched active plan
 * for the VIEWED day — passed in rather than fetched here because it is
 * day-navigable state this hook has no other reason to know about, and
 * `FuelContainer` already owns `useGetActiveMealPlan(date)` for the ghost
 * rows. `null` covers both "no plan that day" and "not loaded yet" — either
 * way the card falls back to the offer/wizard shape, which is the correct
 * default (see `MealprintEntryCard`'s ACTIVE-variant docstring).
 */
export function useMealprintEntry(
  activePlan: MealPlan | null = null,
): MealprintEntry {
  const gate = useMealprintGate();
  // Cache-only — see the docstring. Do NOT pass `true` here.
  const preferences = useMealprintPreferences();
  const openMealprintSuggest = useFuelSheets((s) => s.openMealprintSuggest);
  const openMealprintPlan = useFuelSheets((s) => s.openMealprintPlan);

  const [stalled, setStalled] = useState(false);
  /** Bumped by the retry so the timer effect re-runs while `isResolved` is unchanged. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (gate.isResolved) {
      setStalled(false);
      return;
    }
    const timer = setTimeout(
      () => setStalled(true),
      MEALPRINT_RESOLVE_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [gate.isResolved, attempt]);

  const onRetry = useCallback(() => {
    setStalled(false);
    setAttempt((n) => n + 1);
    gate.refetch();
  }, [gate]);

  // `null` (never fetched on this device) and `isDefault` (no row server-side)
  // both mean "offer the first run" — see the docstring.
  const needsSetup =
    preferences.data === null || preferences.data.isDefault === true;

  const planProgress = useMemo<MealprintPlanProgress | null>(() => {
    if (activePlan === null) return null;
    const adherence = computePlanAdherence(activePlan);
    const next = nextUnloggedPlanMeal(activePlan);
    return {
      loggedCount: adherence.loggedCount,
      totalCount: adherence.totalCount,
      nextMealLabel: next?.label ?? null,
      nextMealKcal: next?.kcal ?? null,
    };
  }, [activePlan]);

  const onPress = useCallback(() => {
    // An active plan takes priority — a day already planned should open the
    // Today view, not the setup wizard or a duplicate suggest sheet.
    if (planProgress !== null) {
      router.push("/(app)/fuel/plan-today" as Href);
      return;
    }
    if (needsSetup) {
      router.push("/(app)/fuel/preferences?mode=wizard" as Href);
      return;
    }
    openMealprintSuggest();
  }, [planProgress, needsSetup, openMealprintSuggest]);

  const onPlanMyDay = useCallback(() => {
    openMealprintPlan();
  }, [openMealprintPlan]);

  const onEditPreferences = useCallback(() => {
    router.push("/(app)/fuel/preferences?mode=editor" as Href);
  }, []);

  const state: MealprintEntryState = !gate.isResolved
    ? stalled
      ? "stalled"
      : "pending"
    : gate.allowed
      ? "unlocked"
      : "locked";

  return {
    state,
    needsSetup,
    planProgress,
    onPress,
    onPlanMyDay,
    onEditPreferences,
    onUpgrade: gate.onUpgrade,
    onRetry,
  };
}
