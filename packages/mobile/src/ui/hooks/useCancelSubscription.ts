import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CancelSubscriptionInput } from "@/domain/ports/api.port";
import type { CancelSubscriptionResult } from "@/domain/models/subscription";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "@/ui/hooks/useAdapters";

/**
 * Cancel a subscription via `ApiPort.cancelSubscription` (wraps
 * `POST /subscriptions/:id/cancel`). Period-end cancel by default;
 * `cancelImmediately: true` opts into the immediate branch.
 *
 * Spec: specs/11-payments-subscriptions/design.md § Subscription state
 *       (mobile) > Hooks
 * Satisfies: requirements.md AC 3.5, 3.9, 5.6, 8.4
 *
 * Same invalidation matrix as `useCreateSubscription` — every cache
 * that depends on subscription state refreshes after the call.
 */
export function useCancelSubscription() {
  const { api } = useAdapters();
  const queryClient = useQueryClient();

  return useMutation<
    CancelSubscriptionResult,
    ApiError,
    { subscriptionId: string; input?: CancelSubscriptionInput }
  >({
    mutationFn: async ({ subscriptionId, input }) => {
      const result = await api.cancelSubscription(subscriptionId, input);
      if (!result.ok) throw result.error;
      return result.value;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-subscription"] });
      queryClient.invalidateQueries({ queryKey: ["user-profile"] });
      queryClient.invalidateQueries({ queryKey: ["profile-data"] });
    },
  });
}
