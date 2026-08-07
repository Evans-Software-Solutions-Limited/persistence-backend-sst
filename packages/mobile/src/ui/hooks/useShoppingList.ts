import { useQuery } from "@tanstack/react-query";
import type { ShoppingList } from "@/domain/models/shoppingList";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";

/**
 * Fetch the day-scoped shopping list for an accepted Mealprint plan via
 * `ApiPort.getShoppingList` (wraps `GET /nutrition/plans/:id/shopping`,
 * spec-26 amendment 2026-08 § B, STORY-006).
 *
 * Mirrors `useMySubscription`/`useSubscriptionTiers`'s TanStack Query
 * posture rather than the `useCachedResource` pattern the rest of Mealprint
 * uses: this resource is derived fresh server-side on every call (decision
 * B.3 — nothing is stored), so there is no local SQLite cache table to read
 * offline-first from. `enabled` is `false` when `planId` is `null` — the
 * caller (the entry point, `PlanTodayContainer`) only knows a planId once
 * today's accepted plan has loaded.
 *
 * No stale-time override: an accepted plan's contents don't change once
 * shopped-for, so TanStack's default (always considered stale, refetch on
 * mount/focus) is the right posture rather than a long cache window that
 * could show a shopper someone else's just-completed plan swap.
 */
export const SHOPPING_LIST_QUERY_KEY_PREFIX = "shopping-list" as const;

export function shoppingListQueryKey(planId: string) {
  return [SHOPPING_LIST_QUERY_KEY_PREFIX, planId] as const;
}

export function useShoppingList(planId: string | null) {
  const { api } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  return useQuery<ShoppingList, ApiError>({
    queryKey: shoppingListQueryKey(planId ?? "none"),
    enabled: userId !== null && planId !== null,
    queryFn: async () => {
      const result = await api.getShoppingList(planId as string);
      if (!result.ok) throw result.error;
      return result.value;
    },
  });
}
