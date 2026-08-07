import { useCallback, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import type { ApiError } from "@/shared/errors";
import { useShoppingList } from "@/ui/hooks/useShoppingList";
import { ShoppingListPresenter } from "@/ui/presenters/mealprint/ShoppingListPresenter";

/**
 * <ShoppingListContainer> — spec-26 amendment 2026-08 § B, STORY-006. Reads
 * the shopping list for the `planId` route param and owns the local
 * checked-state map — check-off is optimistic UI state only (decision B.2),
 * never written back to the server this slice, so a plain `useState` map
 * keyed by item id is the whole story. Unmounting the screen (navigating
 * away) intentionally forgets it, same as the prototype.
 */

function shoppingListErrorMessage(error: ApiError): string {
  if (error.code === "not_found") {
    return "This plan couldn't be found.";
  }
  return error.message;
}

export function ShoppingListContainer() {
  const { planId } = useLocalSearchParams<{ planId?: string }>();
  const query = useShoppingList(planId ?? null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const onBack = useCallback(() => {
    router.back();
  }, []);

  const onToggleItem = useCallback((itemId: string) => {
    setChecked((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
  }, []);

  return (
    <ShoppingListPresenter
      loading={query.isLoading}
      error={query.error ? shoppingListErrorMessage(query.error) : null}
      list={query.data ?? null}
      checked={checked}
      onToggleItem={onToggleItem}
      onBack={onBack}
    />
  );
}
