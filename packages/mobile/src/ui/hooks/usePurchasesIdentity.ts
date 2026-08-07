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
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (purchases === null) return;

    if (userId !== null) {
      // Already bound, or an attempt for this user is already in flight.
      if (boundUserIdRef.current === userId) return;
      if (inFlightUserIdRef.current === userId) return;
      let cancelled = false;
      let retryCount = 0;
      const bind = async () => {
        inFlightUserIdRef.current = userId;
        const result = await purchases.logIn(userId);
        // Guard against a stale resolution after sign-out/user switching.
        if (cancelled || inFlightUserIdRef.current !== userId) return;
        inFlightUserIdRef.current = null;
        if (result.ok) {
          boundUserIdRef.current = userId;
          return;
        }
        // Keep retrying transient failures with a capped delay. The adapter
        // independently blocks purchase() until one attempt confirms the
        // Supabase user id, so no payment can land on an anonymous customer.
        const delayMs = Math.min(1_000 * 2 ** retryCount, 30_000);
        retryCount += 1;
        retryTimerRef.current = setTimeout(() => void bind(), delayMs);
      };
      void bind();
      return () => {
        cancelled = true;
        if (retryTimerRef.current !== null) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
      };
    }

    // Signed out — reset and log out if we'd bound (or were binding) a user.
    if (boundUserIdRef.current !== null || inFlightUserIdRef.current !== null) {
      boundUserIdRef.current = null;
      inFlightUserIdRef.current = null;
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      void purchases.logOut();
    }
  }, [purchases, userId]);
}
