import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { MySubscription } from "@/domain/models/subscription";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "@/ui/hooks/useAdapters";

/**
 * Force a server-side reconciliation of the caller's RevenueCat customer via
 * `ApiPort.syncSubscription` (wraps `POST /subscriptions/sync`).
 *
 * The RevenueCat→backend webhook that normally keeps `user_subscriptions`
 * current is async, so a just-completed IAP purchase or restore can leave
 * the DB reporting `free` for a window after RevenueCat/Apple already
 * granted the entitlement. The iOS purchase flow calls this mutation right
 * after a purchase/restore to confirm the entitlement server-side BEFORE
 * showing the "Activated!" screen, instead of trusting the on-device
 * RevenueCat snapshot alone.
 *
 * On success invalidates the same query keys as `useCreateSubscription` /
 * `usePurchasePackage` so `useMySubscription` (and the coach-mode switch)
 * reconcile against the confirmed tier.
 */
export function useSyncSubscription() {
  const { api } = useAdapters();
  const queryClient = useQueryClient();

  return useMutation<MySubscription, ApiError, void>({
    mutationFn: async () => {
      const result = await api.syncSubscription();
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
