import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { USER_SUBSCRIPTION_QUERY_KEY_PREFIX } from "@/ui/hooks/useMySubscription";

/**
 * Re-validate the shared `['user-subscription']` React Query whenever the app
 * returns to the foreground (background → active).
 *
 * Why: the query client sets `refetchOnWindowFocus: false` and there is no
 * AppState→React-Query bridge, and the subscription query is read by three
 * PERMANENTLY-mounted trees (the profile drawer, `useUserModeEligibility` at
 * the root, and `useAutoRetryOnUpgrade`). If its cold-start fetch failed
 * (`retry: 1` then error), nothing re-triggered it except a subscription
 * mutation or a FULL app restart — so the drawer showed no plan / no
 * coach-switch, eligibility never settled, and feature gates read `unknown`
 * until the user force-quit and relaunched.
 *
 * Invalidating on foreground makes React Query refetch the active observers,
 * so the app self-heals on the next foreground rather than a restart. Mounted
 * ONCE at the authenticated layout root.
 */
export function useForegroundSubscriptionRefresh(): void {
  const queryClient = useQueryClient();
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      const prev = appState.current;
      const cameToForeground =
        (prev === "background" || prev === "inactive") && next === "active";
      appState.current = next;
      if (cameToForeground) {
        void queryClient.invalidateQueries({
          queryKey: [USER_SUBSCRIPTION_QUERY_KEY_PREFIX],
        });
      }
    });
    return () => sub.remove();
  }, [queryClient]);
}
