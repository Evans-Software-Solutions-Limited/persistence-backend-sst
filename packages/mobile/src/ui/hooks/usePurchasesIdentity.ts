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
  const inFlightUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (purchases === null) return;

    if (userId !== null) {
      // Already bound, or an attempt for this user is already in flight.
      if (boundUserIdRef.current === userId) return;
      if (inFlightUserIdRef.current === userId) return;
      inFlightUserIdRef.current = userId;
      void purchases.logIn(userId).then((result) => {
        inFlightUserIdRef.current = null;
        // Latch ONLY on success. A transient failure must not strand the ref —
        // otherwise we'd never re-attempt and RevenueCat would stay on the
        // anonymous App User ID, mis-attributing the purchase and breaking the
        // cross-rail merge. Leaving the ref unset lets a later effect run (e.g.
        // a re-auth) retry. RevenueCat also retries the network call itself.
        if (result.ok) boundUserIdRef.current = userId;
      });
      return;
    }

    // Signed out — reset and log out if we'd bound (or were binding) a user.
    if (boundUserIdRef.current !== null || inFlightUserIdRef.current !== null) {
      boundUserIdRef.current = null;
      inFlightUserIdRef.current = null;
      void purchases.logOut();
    }
  }, [purchases, userId]);
}
