import type { Notification } from "@/domain/models/notification";

/** Build a domain Notification with sensible defaults for tests. */
export function makeNotification(
  overrides: Partial<Notification> = {},
): Notification {
  return {
    id: "n-1",
    type: "workout_assigned",
    title: "Workout assigned",
    body: "Your trainer assigned Push Day",
    deepLink: "/(app)/(tabs)/index",
    data: {},
    relatedEntityType: null,
    relatedEntityId: null,
    readAt: null,
    createdAt: "2026-06-01T10:00:00.000Z",
    ...overrides,
  };
}
