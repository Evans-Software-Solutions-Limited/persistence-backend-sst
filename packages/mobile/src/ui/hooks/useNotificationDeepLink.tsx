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

import { useEffect, useRef } from "react";
import { useRouter } from "expo-router";

import { resolveNotificationRoute } from "@/application/notifications/deep-link";
import { useAdapters } from "./useAdapters";

export function useNotificationDeepLink(enabled = true): void {
  const { notifications } = useAdapters();
  const router = useRouter();
  const handledColdStartRef = useRef(false);

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
      // resolver, which sends a tap-with-no-deepLink to Home (AC 5.5).
      if (response !== null) {
        router.push(resolveNotificationRoute(response.deepLink) as never);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, notifications, router]);

  // Background / foreground tap dispatch.
  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = notifications.addNotificationResponseListener(
      (deepLink) => {
        router.push(resolveNotificationRoute(deepLink) as never);
      },
    );
    return unsubscribe;
  }, [enabled, notifications, router]);
}
