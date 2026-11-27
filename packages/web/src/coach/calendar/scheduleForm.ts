import { Type } from "@sinclair/typebox";
import { schemaResolver, type ServerFieldMap } from "@/lib/form";
import { clock, dayKey, parseDay } from "./lib";
import type {
  CoachSession,
  NewSession,
  SessionKind,
  SessionPatch,
} from "./types";

/**
 * The schedule sheet (C4c) as a react-hook-form with a TypeBox schema
 * (PER-147 rule). The limits mirror `POST /trainers/me/sessions` (#568):
 * 5–720 minutes, a 200-character place, an https video link, reminders of
 * 15 minutes to 7 days, up to 26 weekly occurrences and 50 clients. The server
 * keeps the final say; its 422/404 answers land on these fields.
 */

export const LOCATION_MAX = 200;
export const VIDEO_URL_MAX = 2000;
export const NOTES_MAX = 2000;
export const MAX_ATTENDEES = 50;
export const MAX_OCCURRENCES = 26;

export const LENGTH_OPTIONS = [15, 30, 45, 60, 75, 90, 120, 180];
/** 0 = no reminder. The scheduler runs every 15 minutes, so 15 is the least. */
export const REMINDER_OPTIONS = [0, 15, 30, 60, 120, 1440];
/** 1 = doesn't repeat. */
export const REPEAT_OPTIONS = [1, 2, 4, 6, 8, 12, MAX_OCCURRENCES];

export interface ScheduleValues {
  kind: SessionKind;
  clientIds: string[];
  date: string;
  time: string;
  durationMin: number;
  location: string;
  videoUrl: string;
  workoutId: string;
  repeatWeeks: number;
  reminderMinutes: number;
  notes: string;
}

const HTTPS = "^https://\\S+$";

export const scheduleSchema = Type.Object({
  kind: Type.Union([
    Type.Literal("in_person"),
    Type.Literal("video"),
    Type.Literal("check_in_call"),
    Type.Literal("own_training"),
  ]),
  clientIds: Type.Array(Type.String(), {
    maxItems: MAX_ATTENDEES,
    errorMessage: `Book up to ${MAX_ATTENDEES} clients.`,
  }),
  date: Type.String({
    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    errorMessage: "Pick a date.",
  }),
  time: Type.String({
    pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
    errorMessage: "Pick a time.",
  }),
  durationMin: Type.Integer({
    minimum: 5,
    maximum: 720,
    errorMessage: "Pick a length.",
  }),
  location: Type.String({
    maxLength: LOCATION_MAX,
    errorMessage: "Keep the place under 200 characters.",
  }),
  videoUrl: Type.Union(
    [
      Type.Literal(""),
      Type.String({ pattern: HTTPS, maxLength: VIDEO_URL_MAX }),
    ],
    { errorMessage: "Use an https:// link." },
  ),
  workoutId: Type.String(),
  repeatWeeks: Type.Integer({ minimum: 1, maximum: MAX_OCCURRENCES }),
  reminderMinutes: Type.Integer({ minimum: 0, maximum: 10080 }),
  notes: Type.String({
    maxLength: NOTES_MAX,
    errorMessage: "Keep notes under 2,000 characters.",
  }),
});

/** The server trims text before it checks it. */
const prepare = (v: ScheduleValues): ScheduleValues => ({
  ...v,
  // Only the place field for this kind is checked (and sent, see
  // placeFields). A hidden field's leftover value can't block Schedule; the
  // form keeps the raw values, so switching back shows what was typed.
  location: v.kind === "in_person" ? v.location.trim() : "",
  videoUrl:
    v.kind === "video" ? v.videoUrl.trim().replace(/^https:/i, "https:") : "",
  notes: v.notes.trim(),
});

/** The local date and time as an instant; null when they don't parse. */
export function startsAtOf(v: Pick<ScheduleValues, "date" | "time">) {
  const day = parseDay(v.date);
  const m = /^(\d{2}):(\d{2})$/.exec(v.time);
  if (!day || !m) return null;
  day.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return day;
}

/**
 * Cross-field rules: your own training has no clients; a client session
 * needs one; a new session can't start in the past.
 */
export function scheduleRules(
  v: ScheduleValues,
  { isNew, now = new Date() }: { isNew: boolean; now?: Date },
): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {};
  if (v.kind === "own_training" && v.clientIds.length > 0) {
    out.clientIds = "Your own training can't have clients booked on it.";
  }
  if (isNew && v.kind !== "own_training" && v.clientIds.length === 0) {
    out.clientIds = "Pick who this session is with.";
  }
  const start = startsAtOf(v);
  if (isNew && start && start.getTime() < now.getTime()) {
    out.time = "Pick a time that hasn't passed.";
  }
  return out;
}

export function scheduleResolver(isNew: boolean) {
  return schemaResolver<ScheduleValues>(scheduleSchema, {
    prepare,
    refine: (v: ScheduleValues) => scheduleRules(v, { isNew }),
  });
}

/** 404 `workout_not_found` and 422 `invalid_session` land on fields. */
export const SCHEDULE_SERVER_FIELDS: ServerFieldMap<ScheduleValues> = {
  videoUrl: { field: "videoUrl", message: "Use an https:// link." },
  startsAt: { field: "time", message: "Pick a valid date and time." },
  durationMin: { field: "durationMin", message: "Pick a length." },
  location: {
    field: "location",
    message: "Keep the place under 200 characters.",
  },
  notes: { field: "notes", message: "Keep notes under 2,000 characters." },
  reminderMinutes: { field: "reminderMinutes" },
  clientIds: { field: "clientIds" },
};

export const SCHEDULE_MESSAGE_FIELDS = ["videoUrl", "startsAt"] as const;

/** Next whole hour, as the sheet's starting point. */
export function nextHour(now: Date): Date {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

export function blankValues({
  kind = "in_person",
  clientIds = [],
  start,
}: {
  kind?: SessionKind;
  clientIds?: string[];
  start: Date;
}): ScheduleValues {
  return {
    kind,
    clientIds,
    date: dayKey(start),
    time: clock(start),
    durationMin: 60,
    location: "",
    videoUrl: "",
    workoutId: "",
    repeatWeeks: 1,
    reminderMinutes: kind === "own_training" ? 0 : 120,
    notes: "",
  };
}

/** The sheet filled from a session, for Edit. */
export function sessionValues(s: CoachSession): ScheduleValues {
  const start = new Date(s.startsAt);
  return {
    kind: s.kind,
    clientIds: s.attendees
      .filter((a) => a.status !== "cancelled")
      .map((a) => a.clientId),
    date: dayKey(start),
    time: clock(start),
    durationMin: s.durationMin,
    location: s.location ?? "",
    videoUrl: s.videoUrl ?? "",
    workoutId: s.workout?.id ?? "",
    repeatWeeks: 1,
    reminderMinutes: s.reminderMinutes ?? 0,
    notes: s.notes ?? "",
  };
}

/** Only the place field that fits the kind is sent. */
function placeFields(v: ScheduleValues) {
  const p = prepare(v);
  return {
    location: p.kind === "in_person" ? p.location || null : null,
    videoUrl: p.kind === "video" ? p.videoUrl || null : null,
  };
}

export function toNewSession(v: ScheduleValues): NewSession {
  const start = startsAtOf(v)!;
  const p = prepare(v);
  return {
    kind: v.kind,
    startsAt: start.toISOString(),
    durationMin: v.durationMin,
    ...placeFields(v),
    workoutId: v.workoutId || null,
    notes: p.notes || null,
    reminderMinutes:
      v.kind === "own_training" || v.reminderMinutes === 0
        ? null
        : v.reminderMinutes,
    clientIds: v.kind === "own_training" ? [] : v.clientIds,
    ...(v.repeatWeeks > 1
      ? { repeat: { frequency: "weekly" as const, count: v.repeatWeeks } }
      : {}),
  };
}

/** Only what changed is sent, so a series edit moves just those fields. */
export function toPatch(before: CoachSession, v: ScheduleValues): SessionPatch {
  const next = toNewSession({ ...v, repeatWeeks: 1 });
  const was = toNewSession({ ...sessionValues(before), repeatWeeks: 1 });
  const patch: SessionPatch = { expectedRevision: before.revision };
  const keys = [
    "kind",
    "startsAt",
    "durationMin",
    "location",
    "videoUrl",
    "workoutId",
    "notes",
    "reminderMinutes",
  ] as const;
  for (const k of keys) {
    if (next[k] !== was[k]) (patch as Record<string, unknown>)[k] = next[k];
  }
  return patch;
}

/** True when the patch has nothing to send. */
export function isEmptyPatch(p: SessionPatch): boolean {
  return Object.keys(p).every((k) => k === "expectedRevision");
}
