import type { PurchasesPort } from "@/domain/ports/purchases.port";
import { useAdapters } from "@/ui/hooks/useAdapters";

/**
 * Access the optional RevenueCat `PurchasesPort` (M12, iOS rail).
 *
 * Returns `null` on web / Android (and in tests that don't inject a purchases
 * adapter), where the Stripe rail handles subscriptions. The iOS purchase flow
 * is only mounted when this is non-null, so its child hooks can assume a port.
 */
export function usePurchases(): PurchasesPort | null {
  const { purchases } = useAdapters();
  return purchases ?? null;
}
