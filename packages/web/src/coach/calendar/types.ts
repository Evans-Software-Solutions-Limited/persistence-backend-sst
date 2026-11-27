/**
 * Coach calendar shapes (PER-123 / #568, design I). Sessions are the only
 * things with times: assigned workouts stay dateless (product rule).
 */

export type SessionKind =
  | "in_person"
  | "video"
  | "check_in_call"
  | "own_training";

export type AttendeeStatus = "invited" | "accepted" | "declined" | "cancelled";

export interface SessionAttendee {
  clientId: string;
  relationshipId: string;
  name: string;
  avatarUrl: string | null;
  status: AttendeeStatus;
  remindedAt: string | null;
}

export interface CoachSession {
  id: string;
  kind: SessionKind;
  startsAt: string;
  endsAt: string;
  durationMin: number;
  location: string | null;
  videoUrl: string | null;
  workout: { id: string; name: string } | null;
  seriesId: string | null;
  notes: string | null;
  reminderMinutes: number | null;
  cancelledAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  attendees: SessionAttendee[];
}

export interface FormDue {
  requestId: string;
  formId: string;
  formTitle: string;
  client: { id: string; name: string; avatarUrl: string | null };
  dueAt: string;
  status: string;
  late: boolean;
}

export interface CalendarRange {
  from: string;
  to: string;
  sessions: CoachSession[];
  formsDue: FormDue[];
  asOf: string;
}

/** `POST /trainers/me/sessions` body. */
export interface NewSession {
  kind: SessionKind;
  startsAt: string;
  durationMin: number;
  location?: string | null;
  videoUrl?: string | null;
  workoutId?: string | null;
  notes?: string | null;
  reminderMinutes?: number | null;
  clientIds?: string[];
  repeat?: { frequency: "weekly"; count: number };
}

/** `PATCH /trainers/me/sessions/:id` body. */
export type SessionPatch = Partial<Omit<NewSession, "repeat">> & {
  expectedRevision?: number;
};

export type SessionScope = "this" | "series";

export interface SessionWrite {
  data: CoachSession;
  series: CoachSession[];
}

/** A workout the coach made, for the "Workout" field. */
export interface WorkoutOption {
  id: string;
  name: string;
}
