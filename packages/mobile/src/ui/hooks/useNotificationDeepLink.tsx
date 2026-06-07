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
import { resolveNotificationRoute } from "@/application/notifications/deep-link";
import { useAdapters } from "./useAdapters";

export function useNotificationDeepLink(enabled = true): void {
  const { notifications } = useAdapters();
  const router = useRouter();
  const handledColdStartRef = useRef(false);
  // Dedupe across the two entry points: `expo-notifications` can surface
  // the SAME launching tap via BOTH `getLastNotificationResponse()` (cold
  // start) AND `addNotificationResponseListener` (subscribed on mount).
  // Keyed by the notification id so whichever path fires first dispatches
  // and the other is a no-op — preventing a double `router.push`.
  const handledIdsRef = useRef<Set<string>>(new Set());

  const dispatch = useCallback(
    (response: NotificationResponseInfo) => {
      if (handledIdsRef.current.has(response.id)) return;
      handledIdsRef.current.add(response.id);
      router.push(resolveNotificationRoute(response.deepLink) as never);
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
