import { useQuery } from "@tanstack/react-query";
import type {
  PurchaseProduct,
  PurchasesError,
} from "@/domain/ports/purchases.port";
import { usePurchases } from "@/ui/hooks/usePurchases";

/**
 * Fetch the `default` offering's purchasable packages from RevenueCat (M12,
 * iOS rail).
 *
 * Spec: specs/milestones/M12-app-store-iap/FRONTEND_BRIEF.md § Deliverable 3
 *
 * Disabled when no purchases adapter is present (web / Android). Stale-time of
 * 5 minutes — offerings rarely change mid-session and a cold paywall open
 * shouldn't re-hit the store every mount.
 */
export const PURCHASE_OFFERINGS_QUERY_KEY = ["purchase-offerings"] as const;
export const PURCHASE_OFFERINGS_STALE_TIME_MS = 5 * 60 * 1000;

export function usePurchaseOfferings() {
  const purchases = usePurchases();
  return useQuery<PurchaseProduct[], PurchasesError>({
    queryKey: PURCHASE_OFFERINGS_QUERY_KEY,
    enabled: purchases !== null,
    staleTime: PURCHASE_OFFERINGS_STALE_TIME_MS,
    queryFn: async () => {
      // `enabled` guarantees a non-null adapter by the time queryFn runs.
      const result = await purchases!.getPurchasablePackages();
      if (!result.ok) throw result.error;
      return result.value;
    },
  });
}
