import { ShoppingListContainer } from "@/ui/containers/ShoppingListContainer";

/**
 * Fuel → Mealprint shopping list for today's accepted plan (spec-26
 * amendment 2026-08 § B, STORY-006). Pushed from the basket icon in the
 * `PlanToday` header (`PlanTodayContainer`'s `onOpenShoppingList`), carrying
 * `planId` as a route param.
 *
 * Spec: specs/26-mealprint-meal-planning/AMENDMENT-2026-08-occasions-shopping.md § B
 */
export default function ShoppingListScreen() {
  return <ShoppingListContainer />;
}
