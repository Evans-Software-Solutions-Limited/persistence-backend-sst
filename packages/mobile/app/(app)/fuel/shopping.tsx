import { ShoppingListContainer } from "@/ui/containers/ShoppingListContainer";
import { AdaptiveSuiteRouteGuard } from "@/ui/components/subscription/AdaptiveSuiteRouteGuard";
import { useMealprintGate } from "@/ui/hooks/useMealprintGate";

/**
 * Fuel → Mealprint shopping list for today's accepted plan (spec-26
 * amendment 2026-08 § B, STORY-006). Pushed from the basket icon in the
 * `PlanToday` header (`PlanTodayContainer`'s `onOpenShoppingList`), carrying
 * `planId` as a route param.
 *
 * Spec: specs/26-mealprint-meal-planning/AMENDMENT-2026-08-occasions-shopping.md § B
 */
export default function ShoppingListScreen() {
  const gate = useMealprintGate();
  return (
    <AdaptiveSuiteRouteGuard
      allowed={gate.allowed}
      isResolved={gate.isResolved}
      fallback="/(app)/(tabs)/fuel"
    >
      <ShoppingListContainer />
    </AdaptiveSuiteRouteGuard>
  );
}
