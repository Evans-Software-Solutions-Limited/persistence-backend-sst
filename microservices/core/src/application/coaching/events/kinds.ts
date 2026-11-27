/**
 * Coach event kinds (PER-117, design C D4). Validated here rather than by a
 * database CHECK, so a later ticket adds a kind with no migration:
 * `message_received` is written by BE-E1b (PER-120) and `session_booked` by
 * BE-I2 (PER-123).
 */
export const COACH_EVENT_KINDS = [
  "form_completed",
  "check_in_completed",
  "workout_completed",
  "record_hit",
  "form_missed",
  "client_accepted",
  "invite_expired",
  "programme_ending",
  "training_behind",
  "message_received",
  "session_booked",
] as const;

export type CoachEventKind = (typeof COACH_EVENT_KINDS)[number];

export function isCoachEventKind(value: string): value is CoachEventKind {
  return (COACH_EVENT_KINDS as readonly string[]).includes(value);
}

export const CHANNELS = ["push", "email", "both", "off"] as const;
export type Channel = (typeof CHANNELS)[number];

/**
 * A kind's channel when the coach hasn't chosen one. A finished workout is
 * frequent, so it's in-app only until the coach turns its push on (or the
 * client is set to `everything`).
 */
export const DEFAULT_CHANNELS: Record<CoachEventKind, Channel> = {
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
};

/**
 * What Today offers for each actionable kind. A kind not listed here is
 * feed-only (a finished workout, a record): it never enters the queue.
 */
export const TODAY_ACTIONS: Partial<Record<CoachEventKind, string>> = {
  form_completed: "review_response",
  check_in_completed: "review_response",
  form_missed: "nudge_client",
  client_accepted: "welcome_client",
  invite_expired: "resend_invite",
  programme_ending: "plan_next_programme",
  training_behind: "check_in_with_client",
  message_received: "reply",
};

export const TODAY_KINDS = Object.keys(TODAY_ACTIONS) as CoachEventKind[];

/** Payload fields the push text reads. Everything is optional. */
interface PushPayload {
  formTitle?: unknown;
  workoutName?: unknown;
  records?: unknown;
  programName?: unknown;
  displayName?: unknown;
  label?: unknown;
  rating?: unknown;
  difficulty?: unknown;
  note?: unknown;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

/** One event's push title and body. `name` is the client's name. */
export function pushText(
  kind: string,
  name: string,
  payload: PushPayload,
): { title: string; body: string } {
  switch (kind) {
    // PER-120: the message text stays in Stream; the push never carries it.
    case "message_received":
      return { title: `${name} sent you a message`, body: "Tap to reply." };
    case "form_completed":
    case "check_in_completed":
      return {
        title: `${name} completed ${str(payload.formTitle) ?? "a form"}`,
        body: "Tap to review their answers.",
      };
    case "workout_completed": {
      const rating = typeof payload.rating === "number" ? payload.rating : null;
      const difficulty =
        typeof payload.difficulty === "number" ? payload.difficulty : null;
      const note = str(payload.note);
      const bits = [
        rating !== null
          ? `Rated ${rating}/5`
          : difficulty !== null
            ? `Difficulty ${difficulty}/10`
            : null,
        note ? `"${note.slice(0, 120)}"` : null,
      ].filter(Boolean);
      return {
        title: `${name} finished ${str(payload.workoutName) ?? "a workout"}`,
        body: bits.join(" · "),
      };
    }
    case "record_hit": {
      const n = Array.isArray(payload.records) ? payload.records.length : 1;
      return {
        title: `${name} hit ${n === 1 ? "a new record" : `${n} new records`}`,
        body: "",
      };
    }
    case "form_missed":
      return {
        title: `${name} missed ${str(payload.formTitle) ?? "a form"}`,
        body: "",
      };
    case "client_accepted":
      return { title: `${name} accepted your invite`, body: "" };
    case "invite_expired":
      return {
        title: `${str(payload.displayName) ?? name}'s invite expired`,
        body: "You can resend it.",
      };
    case "programme_ending":
      return {
        title: `${name}'s programme ends soon`,
        body: str(payload.programName) ?? "",
      };
    case "training_behind":
      return {
        title: `${name} is behind on training`,
        body: str(payload.label) ?? "",
      };
    default:
      return { title: `${name}: a new update`, body: "" };
  }
}

/**
 * Where a coach's push lands. 1.2.0 maps `persistencemobile://clients` to the
 * coach Clients tab; an unknown absolute path would land on the not-found
 * screen (PER-96), so every coach push uses this one.
 */
export const COACH_PUSH_DEEP_LINK = "persistencemobile://clients";
