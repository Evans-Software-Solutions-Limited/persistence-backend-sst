import { vi } from "vitest";
import type { NotificationsApi } from "../notifications/api";
import type {
  CoachEvent,
  FeedPage,
  NotificationSettings,
  TodayItem,
  TodayPayload,
} from "../notifications/types";

/** Fixtures and a fake API for the PER-131 screens (Today, Notifications, C6). */

export const NOW = new Date(2026, 10, 25, 14, 0); // Wed 25 Nov 2026, 14:00 local

const at = (dayOffset: number, h: number, m = 0) =>
  new Date(2026, 10, 25 + dayOffset, h, m).toISOString();

export const SAM = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Sam Patel",
  avatarUrl: null,
};
export const TOM = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Tom Reid",
  avatarUrl: null,
};
export const LENA_PROFILE = "11111111-1111-4111-8111-111111111111";

export function event(over: Partial<CoachEvent> = {}): CoachEvent {
  return {
    id: "e-1",
    kind: "check_in_completed",
    client: SAM,
    relationshipId: "rel-sam",
    entityType: "coach_form_response",
    entityId: "resp-1",
    payload: { formTitle: "Weekly check-in", trigger: "weekly", late: false },
    occurredAt: at(0, 12, 0),
    readAt: null,
    actionedAt: null,
    actionable: true,
    ...over,
  };
}

export const EVENTS: CoachEvent[] = [
  event(),
  event({
    id: "e-2",
    kind: "workout_completed",
    payload: {
      workoutName: "Upper B",
      rating: 4,
      note: "Bench felt heavy",
    },
    occurredAt: at(-1, 18, 30),
    actionable: false,
  }),
  event({
    id: "e-3",
    kind: "form_missed",
    client: TOM,
    relationshipId: "rel-tom",
    payload: { formTitle: "Weekly check-in", trigger: "weekly" },
    occurredAt: at(-2, 12, 0),
  }),
  event({
    id: "e-4",
    kind: "record_hit",
    client: TOM,
    relationshipId: "rel-tom",
    payload: {
      records: [
        { exerciseName: "Squat", value: 142.5 },
        { exerciseName: "Squat", value: 5 },
        { exerciseName: "Bench press", value: 100 },
      ],
    },
    occurredAt: at(-3, 9, 0),
    readAt: at(-3, 10, 0),
    actionable: false,
  }),
  event({
    id: "e-5",
    kind: "invite_expired",
    client: null,
    relationshipId: null,
    payload: { profileId: LENA_PROFILE, displayName: "Lena Ortiz" },
    occurredAt: at(-9, 8, 0),
    readAt: at(-8, 8, 0),
  }),
];

export function feedPage(over: Partial<FeedPage> = {}): FeedPage {
  return { data: EVENTS, nextCursor: null, unreadCount: 3, ...over };
}

export function todayItem(over: Partial<TodayItem> = {}): TodayItem {
  return {
    eventId: "e-1",
    kind: "check_in_completed",
    client: SAM,
    facts: { formTitle: "Weekly check-in", late: false },
    action: "review_response",
    occurredAt: at(0, 12, 0),
    readAt: null,
    ...over,
  };
}

export function todayPayload(over: Partial<TodayPayload> = {}): TodayPayload {
  return {
    queue: [
      todayItem(),
      todayItem({
        eventId: "e-3",
        kind: "form_missed",
        client: TOM,
        facts: { formTitle: "Weekly check-in" },
        action: "nudge_client",
        occurredAt: at(-2, 12, 0),
      }),
      todayItem({
        eventId: "e-5",
        kind: "invite_expired",
        client: null,
        facts: { profileId: LENA_PROFILE, displayName: "Lena Ortiz" },
        action: "resend_invite",
        occurredAt: at(-9, 8, 0),
      }),
    ],
    counts: {
      total: 3,
      byKind: { check_in_completed: 1, form_missed: 1, invite_expired: 1 },
    },
    schedule: [
      {
        id: "s-1",
        kind: "in_person",
        startsAt: at(0, 7, 0),
        endsAt: at(0, 8, 0),
        durationMin: 60,
        location: "Studio A",
        workout: null,
        cancelledAt: null,
        attendees: [
          { clientId: SAM.id, name: "Sam Patel", status: "accepted" },
        ],
      },
      {
        id: "s-2",
        kind: "own_training",
        startsAt: at(0, 18, 0),
        endsAt: at(0, 19, 0),
        durationMin: 60,
        location: null,
        workout: { id: "w-1", name: "Upper A" },
        cancelledAt: null,
        attendees: [],
      },
    ],
    strip: {
      training: { done: 9, target: 12, clients: 3 },
      calories: {
        daysOnTarget: 10,
        daysCounted: 14,
        daysNotLogged: 2,
        clients: 2,
      },
    },
    ...over,
  };
}

export function notificationSettings(
  over: Partial<NotificationSettings> = {},
): NotificationSettings {
  const channels = {
    form_completed: "push",
    check_in_completed: "push",
    workout_completed: "off",
    record_hit: "push",
    form_missed: "push",
    client_accepted: "push",
    invite_expired: "push",
    programme_ending: "push",
    training_behind: "push",
    message_received: "push",
    session_booked: "push",
  } as NotificationSettings["channels"];
  return {
    channels,
    defaults: { ...channels },
    quietHours: { enabled: false, from: null, until: null },
    timeZone: "Europe/London",
    emailAvailable: false,
    revision: 2,
    updatedAt: null,
    ...over,
  };
}

export type FakeNotificationsApi = {
  [K in keyof NotificationsApi]: ReturnType<typeof vi.fn>;
};

/** A quiet coach: nothing in the feed or Today, default settings. */
export function fakeNotificationsApi(
  over: Partial<FakeNotificationsApi> = {},
): FakeNotificationsApi {
  return {
    feed: vi
      .fn()
      .mockResolvedValue({ data: [], nextCursor: null, unreadCount: 0 }),
    markRead: vi.fn().mockResolvedValue(0),
    today: vi.fn().mockResolvedValue(
      todayPayload({
        queue: [],
        counts: { total: 0, byKind: {} },
        schedule: [],
        strip: {},
      }),
    ),
    actioned: vi.fn().mockResolvedValue({ eventId: "e", actionedAt: NOW }),
    settings: vi.fn().mockResolvedValue(notificationSettings()),
    putSettings: vi.fn(),
    ...over,
  };
}
