import { useEffect } from "react";

import { useUserMode } from "@/state/user-mode";
import { useMySubscription } from "@/ui/hooks/useMySubscription";

/**
 * useUserModeEligibility — bridges the subscription cache into the
 * `useUserMode` slice and enforces the mode/eligibility invariant.
 *
 * Spec: specs/14-navigation/design.md § Eligibility wiring
 *       specs/14-navigation/requirements.md STORY-003 (AC 3.2, 3.3, 3.5)
 *
 * Three responsibilities, run from the authenticated root:
 *   1. Rehydrate the persisted mode from AsyncStorage on mount (AC 3.2).
 *   2. Feed `useGetUserSubscription().isTrainerTier` → `setEligibility`
 *      whenever the subscription cache resolves — on success from the tier
 *      flag, and on a non-transient error as not-eligible (AC 3.3). A
 *      transient network/timeout error is left UNKNOWN so an offline trainer
 *      keeps coach mode; any other error settles not-eligible so a stale
 *      rehydrated coach mode gets reconciled rather than stranding the user.
 *   3. Invariant watchdog — once eligibility is KNOWN (network resolved),
 *      force a coach→athlete fall-back if the user is no longer eligible
 *      (AC 3.5). The `isEligibilityKnown` gate is critical: without it the
 *      effect fires on mount with the default `isTrainerEligible: false`
 *      and demotes legitimate trainers the instant rehydrate restores
 *      their `coach` mode (before the network answer arrives).
 *
 * `switchTo` handles its own disk write and only gates eligibility on coach
 * switches, so `switchTo("athlete")` is always safe + idempotent.
 *
 * In this codebase the canonical subscription hook is `useMySubscription`
 * (wraps `GET /subscriptions/me`); the design's `useGetUserSubscription`
 * name refers to the same capability.
 */
export function useUserModeEligibility(): void {
  const subQuery = useMySubscription();
  const isTrainerTier = subQuery.data?.isTrainerTier;
  const isError = subQuery.isError;
  const errorCode = subQuery.error?.code;

  const rehydrate = useUserMode((s) => s.rehydrate);
  const setEligibility = useUserMode((s) => s.setEligibility);
  const switchTo = useUserMode((s) => s.switchTo);
  const mode = useUserMode((s) => s.mode);
  const isTrainerEligible = useUserMode((s) => s.isTrainerEligible);
  const isEligibilityKnown = useUserMode((s) => s.isEligibilityKnown);

  // 1. Rehydrate persisted mode on mount.
  useEffect(() => {
    void rehydrate();
  }, [rehydrate]);

  // 2. Settle eligibility once the subscription query resolves — on SUCCESS
  //    from the tier flag, and on a non-transient ERROR as not-eligible.
  useEffect(() => {
    if (subQuery.data) {
      // Backend synthesises a `free` shape for no-subscription users, so a
      // resolved read always carries a definitive tier flag.
      setEligibility(subQuery.data.isTrainerTier ?? false);
      return;
    }
    // No data to trust. A TRANSIENT connectivity error (network/timeout)
    // leaves eligibility genuinely UNKNOWN — we must NOT demote a legitimate
    // trainer who's merely offline (their persisted coach mode is correct, and
    // the coach screens' strand-guard still offers a manual way out). Any other
    // error means the server answered (or auth failed) and there's no trainer
    // entitlement to confirm, so settle as not-eligible → the watchdog (effect
    // 3) reconciles a stale persisted coach mode. Without this, a failed
    // `/subscriptions/me` left `isEligibilityKnown` false forever, stranding a
    // non-trainer in a rehydrated coach mode ("trapped in coach").
    if (
      isError &&
      errorCode &&
      errorCode !== "network" &&
      errorCode !== "timeout"
    ) {
      setEligibility(false);
    }
    // Depend on the primitive `isTrainerTier` (+ the error primitives), not
    // `subQuery.data`'s object identity — React Query hands back a fresh `data`
    // reference on every refetch (~2min staleTime + refetch-on-focus/reconnect),
    // so keying on the object would re-fire on every refetch. `setEligibility`
    // is idempotent so that'd be harmless, but keying on primitives matches
    // design.md's `[subQuery.data?.isTrainerTier]` sample. `subQuery.data` is
    // read inside but intentionally NOT a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTrainerTier, isError, errorCode, setEligibility]);

  // 3. Invariant watchdog — re-assert once the network has resolved.
  useEffect(() => {
    if (isEligibilityKnown && mode === "coach" && !isTrainerEligible) {
      void switchTo("athlete");
    }
  }, [mode, isTrainerEligible, isEligibilityKnown, switchTo]);
}
