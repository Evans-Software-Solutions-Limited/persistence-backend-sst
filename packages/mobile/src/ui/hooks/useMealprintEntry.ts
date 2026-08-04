import { useCallback, useEffect, useState } from "react";
import { router, type Href } from "expo-router";
import { useFuelSheets } from "@/state/fuel-sheets";
import type { MealprintEntryState } from "@/ui/presenters/mealprint/MealprintEntryCard";
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
  /** Open the wizard or the suggest sheet, as `needsSetup` dictates. */
  readonly onPress: () => void;
  readonly onUpgrade: () => void;
  readonly onRetry: () => void;
};

export function useMealprintEntry(): MealprintEntry {
  const gate = useMealprintGate();
  // Cache-only — see the docstring. Do NOT pass `true` here.
  const preferences = useMealprintPreferences();
  const openMealprintSuggest = useFuelSheets((s) => s.openMealprintSuggest);

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

  const onPress = useCallback(() => {
    if (needsSetup) {
      router.push("/(app)/fuel/preferences?mode=wizard" as Href);
      return;
    }
    openMealprintSuggest();
  }, [needsSetup, openMealprintSuggest]);

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
    onPress,
    onUpgrade: gate.onUpgrade,
    onRetry,
  };
}
