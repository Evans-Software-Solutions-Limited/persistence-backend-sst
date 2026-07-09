/**
 * Shared notification-tap route resolution for the two dispatch sites
 * (`useNotificationDeepLink` push taps + `NotificationsListContainer` row
 * taps), so route-specific priming can't drift between them.
 *
 * A train-bound tap (M17 Send-brief → athlete Training page) must land on
 * the Training segment even when the user's persisted segment is Workouts /
 * Exercises, so it primes the same one-shot + live write pair as the Home
 * "View all" cross-tab navigation (`HomeContainer.onOpenWorkoutsList`):
 * `setPendingSegment` covers a hub frozen on its last-rendered frame by
 * react-native-screens (consumed in the hub's focus effect), `setSegment`
 * covers a live hub.
 */

import {
  resolveNotificationRoute,
  TRAIN_ROUTE,
} from "@/application/notifications/deep-link";
import { useTrainSegment } from "@/ui/hooks/useTrainSegment";

export function resolveAndPrimeNotificationRoute(
  deepLink: string | null | undefined,
): string {
  const route = resolveNotificationRoute(deepLink);
  if (route === TRAIN_ROUTE) {
    const train = useTrainSegment.getState();
    train.setPendingSegment("Training");
    train.setSegment("Training");
  }
  return route;
}
