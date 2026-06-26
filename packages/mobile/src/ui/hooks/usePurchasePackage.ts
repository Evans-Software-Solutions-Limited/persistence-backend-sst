import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ActiveEntitlement,
  PurchasesError,
} from "@/domain/ports/purchases.port";
import { usePurchases } from "@/ui/hooks/usePurchases";

/**
 * Run a RevenueCat purchase for a package id and surface the resulting active
 * entitlements (M12, iOS rail).
 *
 * Spec: specs/milestones/M12-app-store-iap/FRONTEND_BRIEF.md § Deliverable 3
 *
 * Server truth lands via the RevenueCat webhook → `user_subscriptions`; on
 * success we invalidate the same query keys as `useCreateSubscription` so
 * `useMySubscription` (and the coach-mode switch) reconcile exactly as the
 * Stripe path does. User cancellation surfaces as a `PurchasesError` with kind
 * `cancelled` — the container suppresses the alert for it.
 */
export function usePurchasePackage() {
  const purchases = usePurchases();
  const queryClient = useQueryClient();

  return useMutation<ActiveEntitlement[], PurchasesError, string>({
    mutationFn: async (packageId) => {
      if (purchases === null) {
        throw {
          kind: "not_configured",
          code: null,
          message: "Purchases are unavailable on this device.",
        } satisfies PurchasesError;
      }
      const result = await purchases.purchase(packageId);
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
