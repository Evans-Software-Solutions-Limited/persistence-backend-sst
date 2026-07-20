import { useQuery } from "@tanstack/react-query";
import type { PurchasesError } from "@/domain/ports/purchases.port";
import { usePurchases } from "@/ui/hooks/usePurchases";

/**
 * Per-product introductory-offer (free-trial) eligibility for the current
 * Apple Account, read on-device from RevenueCat (M12, iOS rail).
 *
 * This is the single source of truth for whether the paywall shows a
 * "free trial" banner. It reflects Apple's real per-Apple-ID / per-group
 * decision — unlike the backend `has_used_*` flags, which are only ever set by
 * the Stripe rail and so would always read "eligible" on iOS and falsely
 * advertise a trial the user can't get.
 *
 * Disabled when no purchases adapter is present (web / Android) or when there
 * are no product ids to check yet (offering still loading). Keyed on the
 * sorted product ids so a changed offering re-checks. Short stale-time —
 * eligibility only flips when the user actually consumes/refunds an offer.
 */
export const INTRO_ELIGIBILITY_STALE_TIME_MS = 5 * 60 * 1000;

export function introEligibilityQueryKey(productIds: string[]) {
  return ["intro-eligibility", [...productIds].sort()] as const;
}

export function useIntroEligibility(productIds: string[]) {
  const purchases = usePurchases();
  return useQuery<Record<string, boolean>, PurchasesError>({
    queryKey: introEligibilityQueryKey(productIds),
    enabled: purchases !== null && productIds.length > 0,
    staleTime: INTRO_ELIGIBILITY_STALE_TIME_MS,
    queryFn: async () => {
      // `enabled` guarantees a non-null adapter + non-empty ids here.
      const result = await purchases!.getIntroEligibility(productIds);
      if (!result.ok) throw result.error;
      return result.value;
    },
  });
}
