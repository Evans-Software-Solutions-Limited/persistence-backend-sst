import { useQuery } from "@tanstack/react-query";
import type { MySubscription } from "@/domain/models/subscription";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";

/**
 * Fetch the signed-in user's current subscription via `ApiPort
 * .getMySubscription` (wraps `GET /subscriptions/me`).
 *
 * Spec: specs/11-payments-subscriptions/design.md § Subscription state
 *       (mobile) > Tanstack Query keys
 * Satisfies: requirements.md AC 5.1, 5.2, 5.4, 5.5
 *
 * Stale-time: 2 minutes. Short enough that the user's plan info
 * refreshes once they navigate back to a relevant screen after a
 * mutation, long enough that immediate consecutive reads (e.g. from
 * Selection + a child component on the same screen) hit the cache.
 *
 * The query key is `['user-subscription', userId]` per design.md.
 * Auth is required — the query is disabled until the auth context
 * surfaces a userId, mirroring the M1 dashboard / M2 workouts pattern
 * of "no userId, no fetch".
 *
 * Backend synthesises a `free`-tier shape when the user has no
 * subscription row, so the UI never has to handle null specially
 * (AC 5.4).
 */
export const USER_SUBSCRIPTION_QUERY_KEY_PREFIX = "user-subscription" as const;
export const USER_SUBSCRIPTION_STALE_TIME_MS = 2 * 60 * 1000;

export function userSubscriptionQueryKey(userId: string) {
  return [USER_SUBSCRIPTION_QUERY_KEY_PREFIX, userId] as const;
}

export function useMySubscription() {
  const { api } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  return useQuery<MySubscription, ApiError>({
    queryKey: userId
      ? userSubscriptionQueryKey(userId)
      : [USER_SUBSCRIPTION_QUERY_KEY_PREFIX, "anonymous"],
    enabled: userId !== null,
    queryFn: async () => {
      const result = await api.getMySubscription();
      if (!result.ok) throw result.error;
      return result.value;
    },
    staleTime: USER_SUBSCRIPTION_STALE_TIME_MS,
  });
}
