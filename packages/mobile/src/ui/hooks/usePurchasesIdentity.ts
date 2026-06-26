import { useEffect, useRef } from "react";
import { usePurchases } from "@/ui/hooks/usePurchases";
import { useAuth } from "@/ui/hooks/useAuth";

/**
 * THE load-bearing identity wiring (M12, iOS rail).
 *
 * Spec: specs/milestones/M12-app-store-iap/FRONTEND_BRIEF.md § Deliverable 2
 *
 * Binds the RevenueCat **App User ID to the Supabase user id** so a user's
 * purchases resolve to one customer (the cross-rail merge rule). Calls
 * `logIn(<supabaseUserId>)` once auth resolves and `logOut()` on sign-out.
 *
 * No-ops when no purchases adapter is present (web / Android), so it's safe to
 * mount as a global bootstrap sibling to the other `app/_layout` bootstraps.
 * A `useRef` guards against re-running `logIn` on every render and against a
 * spurious `logOut` before the user has ever signed in.
 */
export function usePurchasesIdentity(): void {
  const purchases = usePurchases();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const boundUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (purchases === null) return;

    if (userId !== null) {
      if (boundUserIdRef.current === userId) return;
      boundUserIdRef.current = userId;
      void purchases.logIn(userId);
      return;
    }

    // Signed out — only log out if we previously bound a user (avoids a
    // pointless anonymous churn on a cold, never-signed-in launch).
    if (boundUserIdRef.current !== null) {
      boundUserIdRef.current = null;
      void purchases.logOut();
    }
  }, [purchases, userId]);
}
