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
 * Stale-time: 10 minutes. Tier metadata changes are infrequent (the
 * backend is the source of truth and only ships price / feature
 * updates as part of a release), so a long stale-time keeps the cold-
 * start screen from re-fetching needlessly.
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
