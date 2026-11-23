import { renderWithTheme } from "../../../../__tests__/test-utils";
import { mapApiNotification } from "../sst-api.adapter";
import {
  NotificationRowPresenter,
  notificationVisual,
} from "@/ui/components/notifications/NotificationRow/NotificationRow";
import { IconBell } from "@/ui/components/icons";
import {
  HOME_ROUTE,
  resolveNotificationRoute,
} from "@/application/notifications/deep-link";
import { isKnownNotificationType } from "@/domain/models/notification";

/**
 * PER-117 (design C D5 / D7 test 9): the backend now writes three
 * notification types 1.2.0 doesn't know — `coach_event` (a coach's push about
 * a client), `form_request` and `form_reminder` (an athlete's due form).
 *
 * The 1.2.0 store bundle (commit 3bad31e) has the same `mapApiNotification`,
 * `NotificationRow`, notification model and deep-link resolver as this
 * branch (checked with git diff), so these assertions hold for 1.2.0 phones:
 * the list parses the rows, renders them with the generic row, and a tap
 * never lands on an unknown route. No device-capability fallback is needed.
 *
 * The wire rows below are the ones the core API returns for these types
 * (asserted on the server side in
 * microservices/core/src/application/coaching/events/__tests__).
 */

const NOW = Date.parse("2026-11-23T12:00:00.000Z");

const wire = {
  formRequest: {
    id: "n1",
    userId: "athlete",
    type: "form_request",
    title: "Ellie sent you Goals",
    message: "Open the app to fill it in.",
    data: { requestId: "r1", formId: "f1", dueAt: null },
    isRead: false,
    readAt: null,
    relatedEntityType: "coach_form_request",
    relatedEntityId: "r1",
    createdAt: "2026-11-23T11:00:00.000Z",
  },
  formReminder: {
    id: "n2",
    userId: "athlete",
    type: "form_reminder",
    title: "Reminder: Goals",
    message: "Ellie is waiting for your answers.",
    data: { requestId: "r1", formId: "f1", reminder: 1, dueAt: null },
    isRead: false,
    readAt: null,
    relatedEntityType: "coach_form_request",
    relatedEntityId: "r1",
    createdAt: "2026-11-23T11:30:00.000Z",
  },
  coachEvent: {
    id: "n3",
    userId: "coach",
    type: "coach_event",
    title: "Chris: 3 updates",
    message: "",
    data: {
      eventIds: ["e1", "e2", "e3"],
      kind: "grouped",
      clientId: "c1",
      deepLink: "persistencemobile://clients",
    },
    isRead: false,
    readAt: null,
    relatedEntityType: "coach_event",
    relatedEntityId: "e1",
    createdAt: "2026-11-23T07:00:00.000Z",
  },
} as const;

describe("1.2.0 and the PER-117 notification types", () => {
  it.each(Object.entries(wire))("parses and renders %s", (_, row) => {
    const n = mapApiNotification(row as never);
    expect(isKnownNotificationType(n.type)).toBe(false);
    expect(n).toMatchObject({ id: row.id, title: row.title, readAt: null });
    expect(notificationVisual(n.type).Icon).toBe(IconBell);
    const { getByText } = renderWithTheme(
      <NotificationRowPresenter
        notification={n}
        onPress={jest.fn()}
        now={NOW}
      />,
    );
    expect(getByText(row.title)).toBeTruthy();
  });

  it("routes taps to existing screens only", () => {
    const athlete = mapApiNotification(wire.formRequest as never);
    expect(athlete.deepLink).toBeNull();
    expect(resolveNotificationRoute(athlete.deepLink, athlete.type)).toBe(
      HOME_ROUTE,
    );
    const coach = mapApiNotification(wire.coachEvent as never);
    expect(resolveNotificationRoute(coach.deepLink, coach.type)).toBe(
      "/(app)/(tabs)/clients",
    );
  });
});
