import { useQuery } from "@tanstack/react-query";
import type { SubscriptionTier } from "@/domain/models/subscription";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "@/ui/hooks/useAdapters";

/**
 * Fetch the active subscription-tier catalog via `ApiPort
 * .getSubscriptionTiers` (wraps `GET /subscription-tiers`).
 *
 * Spec: specs/11-payments-subscriptions/design.md § Subscription state
 *       (mobile) > Tanstack Query keys
 * Satisfies: requirements.md AC 1.7, 1.8
 *
 * Stale-time: 10 minutes. The backend is the fallback source of truth before
 * StoreKit returns an offering, so database price updates flow to clients
 * without an app release while avoiding a cold-start refetch on every visit.
 *
 * No auth required — the auth-flow Selection screen renders before
 * sign-in.
 */
export const SUBSCRIPTION_TIERS_QUERY_KEY = ["subscription-tiers"] as const;
export const SUBSCRIPTION_TIERS_STALE_TIME_MS = 10 * 60 * 1000;

export function useSubscriptionTiers() {
  const { api } = useAdapters();
  return useQuery<SubscriptionTier[], ApiError>({
    queryKey: SUBSCRIPTION_TIERS_QUERY_KEY,
    queryFn: async () => {
      const result = await api.getSubscriptionTiers();
      if (!result.ok) throw result.error;
      return result.value;
    },
    staleTime: SUBSCRIPTION_TIERS_STALE_TIME_MS,
  });
}
