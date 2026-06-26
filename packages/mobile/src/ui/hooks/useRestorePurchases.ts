import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ActiveEntitlement,
  PurchasesError,
} from "@/domain/ports/purchases.port";
import { usePurchases } from "@/ui/hooks/usePurchases";

/**
 * Restore prior RevenueCat purchases (M12, iOS rail). Apple requires a restore
 * path for IAP.
 *
 * Spec: specs/milestones/M12-app-store-iap/FRONTEND_BRIEF.md § Deliverable 4
 *
 * On success invalidates the subscription query keys so `useMySubscription`
 * reconciles a restored entitlement, mirroring `usePurchasePackage`.
 */
export function useRestorePurchases() {
  const purchases = usePurchases();
  const queryClient = useQueryClient();

  return useMutation<ActiveEntitlement[], PurchasesError, void>({
    mutationFn: async () => {
      if (purchases === null) {
        throw {
          kind: "not_configured",
          code: null,
          message: "Purchases are unavailable on this device.",
        } satisfies PurchasesError;
      }
      const result = await purchases.restore();
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
