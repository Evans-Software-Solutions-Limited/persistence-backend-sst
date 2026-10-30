/**
 * Routes notification taps to their deep-link target (09.6).
 *
 * Mounted once in `app/(app)/_layout.tsx` (authenticated tree, so router
 * targets resolve). Handles two entry points:
 *   - Cold start: the app was launched by tapping a notification from a
 *     killed state — read the launching response's deepLink once and route.
 *   - Background / foreground tap: subscribe to response taps and route.
 *
 * Unknown / absent deep links fall back to Home via
 * `resolveNotificationRoute` (AC 5.5). The in-app row tap path lives in
 * `NotificationsListContainer` (also via the resolver).
 *
 * Spec: specs/09-notifications-social/requirements.md STORY-005
 *       design.md § Push notification listener
 */

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "expo-router";

import type { NotificationResponseInfo } from "@/domain/ports/notifications.port";
import { resolveAndPrimeNotificationRoute } from "@/ui/navigation/notificationRoute";
import { useAdapters } from "./useAdapters";

/**
 * Notification ids already routed, kept for the life of the JS process rather
 * than per hook instance (PER-96). The hook lives in `app/(app)/_layout.tsx`,
 * which unmounts whenever the root `<Slot/>` leaves the `(app)` group (the
 * +not-found screen, onboarding, sign-out). On remount a per-instance ref
 * started empty and `getLastNotificationResponse()` handed back the SAME
 * launching tap, so it was routed again — and a link that left `(app)` again
 * looped until React aborted with "Maximum update depth exceeded". A tap is
 * one navigation, however many times the layout mounts.
 */
const handledNotificationIds = new Set<string>();

/** Test-only: forget routed taps between test cases. */
export function resetHandledNotificationTaps(): void {
  handledNotificationIds.clear();
}

export function useNotificationDeepLink(enabled = true): void {
  const { notifications } = useAdapters();
  const router = useRouter();
  const handledColdStartRef = useRef(false);

  // Dedupe across the two entry points AND across remounts: `expo-notifications`
  // can surface the SAME launching tap via BOTH `getLastNotificationResponse()`
  // (cold start, and again on every later read) AND
  // `addNotificationResponseListener` (subscribed on mount). Keyed by the
  // notification id so whichever path fires first dispatches and every later
  // delivery is a no-op — preventing a double `router.push`.
  const dispatch = useCallback(
    (response: NotificationResponseInfo) => {
      if (handledNotificationIds.has(response.id)) return;
      handledNotificationIds.add(response.id);
      router.push(resolveAndPrimeNotificationRoute(response.deepLink) as never);
    },
    [router],
  );

  // Cold-start dispatch — read the launching notification once.
  useEffect(() => {
    if (!enabled) return;
    if (handledColdStartRef.current) return;
    handledColdStartRef.current = true;

    let cancelled = false;
    void (async () => {
      const response = await notifications.getLastNotificationResponse();
      if (cancelled) return;
      // `response === null` → normal cold launch (no tap) → do not redirect.
      // `response !== null` → the app WAS opened by a tap; route via the
      // resolver (a tap-with-no-deepLink resolves to Home, AC 5.5).
      if (response !== null) dispatch(response);
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, notifications, dispatch]);

  // Background / foreground tap dispatch.
  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = notifications.addNotificationResponseListener(dispatch);
    return unsubscribe;
  }, [enabled, notifications, dispatch]);
}
