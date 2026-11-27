/**
 * Shapes of the coach notifications routes (PER-117, design C D4):
 * `GET /trainers/me/notifications`, `GET /trainers/me/today` and
 * `GET/PUT /trainers/me/notification-settings`. Kept beside the screens that
 * use them (PER-131), so `api/types.ts` stays as other tickets left it.
 */

export type Channel = "push" | "email" | "both" | "off";

export interface EventClient {
  id: string;
  name: string | null;
  avatarUrl: string | null;
}

/** One row of the feed. `kind` stays a string: the server may add kinds. */
export interface CoachEvent {
  id: string;
  kind: string;
  client: EventClient | null;
  relationshipId: string | null;
  entityType: string | null;
  entityId: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
  readAt: string | null;
  actionedAt: string | null;
  actionable: boolean;
}

export interface FeedPage {
  data: CoachEvent[];
  nextCursor: string | null;
  unreadCount: number;
  deletedIds?: string[];
  asOf?: string;
}

export type TodayAction =
  | "review_response"
  | "nudge_client"
  | "welcome_client"
  | "resend_invite"
  | "plan_next_programme"
  | "check_in_with_client"
  | "reply";

export interface TodayItem {
  eventId: string;
  kind: string;
  client: EventClient | null;
  facts: Record<string, unknown>;
  action: string;
  occurredAt: string;
  readAt: string | null;
}

/** Design B's practice-level adherence: per area, never blended. */
export interface PracticeAdherence {
  training?: { done: number; target: number; clients: number };
  calories?: {
    daysOnTarget: number;
    daysCounted: number;
    daysNotLogged: number;
    clients: number;
  };
}

export interface ScheduleAttendee {
  clientId: string;
  name: string | null;
  status: string;
}

/** Today's bookings (design I, PER-123): the calendar's session shape. */
export interface ScheduleSession {
  id: string;
  kind: string;
  startsAt: string;
  endsAt: string;
  durationMin: number;
  location: string | null;
  workout: { id: string; name: string } | null;
  cancelledAt: string | null;
  attendees: ScheduleAttendee[];
}

export interface TodayPayload {
  queue: TodayItem[];
  counts: { total: number; byKind: Record<string, number> };
  schedule: ScheduleSession[];
  strip: PracticeAdherence;
}

export interface QuietHours {
  enabled: boolean;
  from: string | null;
  until: string | null;
}

export interface NotificationSettings {
  channels: Record<string, Channel>;
  defaults: Record<string, Channel>;
  quietHours: QuietHours;
  timeZone: string;
  emailAvailable: boolean;
  revision: number;
  updatedAt: string | null;
}

export interface NotificationSettingsInput {
  channels?: Record<string, Channel>;
  quietHours?: QuietHours;
  expectedRevision?: number;
}
