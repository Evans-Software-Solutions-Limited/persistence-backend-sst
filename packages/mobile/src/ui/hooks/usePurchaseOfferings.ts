import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
 * Disabled when no purchases adapter is present (web / Android).
 * Storefront-localised prices can change when the device switches Apple or
 * Sandbox accounts. RevenueCat owns the SDK-level cache, so the query itself
 * is deliberately stale on each mount and asks the SDK for its current view.
 */
export const PURCHASE_OFFERINGS_QUERY_KEY = ["purchase-offerings"] as const;
export const PURCHASE_OFFERINGS_STALE_TIME_MS = 0;

export function usePurchaseOfferings() {
  const purchases = usePurchases();
  const queryClient = useQueryClient();
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      (next: AppStateStatus) => {
        const previous = appState.current;
        const cameToForeground =
          (previous === "background" || previous === "inactive") &&
          next === "active";
        appState.current = next;
        if (cameToForeground) {
          void queryClient.invalidateQueries({
            queryKey: PURCHASE_OFFERINGS_QUERY_KEY,
          });
        }
      },
    );
    return () => subscription?.remove();
  }, [queryClient]);

  return useQuery<PurchaseProduct[], PurchasesError>({
    queryKey: PURCHASE_OFFERINGS_QUERY_KEY,
    enabled: purchases !== null,
    staleTime: PURCHASE_OFFERINGS_STALE_TIME_MS,
    refetchOnMount: "always",
    queryFn: async () => {
      // `enabled` guarantees a non-null adapter by the time queryFn runs.
      const result = await purchases!.getPurchasablePackages();
      if (!result.ok) throw result.error;
      return result.value;
    },
  });
}
