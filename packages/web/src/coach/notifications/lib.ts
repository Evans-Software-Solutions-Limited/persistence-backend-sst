import { initials } from "../lib/people";
import type {
  Channel,
  CoachEvent,
  EventClient,
  PracticeAdherence,
  ScheduleSession,
  TodayItem,
  TodayPayload,
} from "./types";

/**
 * Pure helpers for Today (C2a), Notifications (C10e) and notification
 * settings (C6b) on the web (PER-131). Copy follows the canvas; where the API
 * has no data for a canvas line, the line is left out rather than invented.
 */

// ─── Text helpers ────────────────────────────────────────────────────────────

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const pad = (n: number) => String(n).padStart(2, "0");
export const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayMonth = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole calendar days from `iso`'s day to `now`'s day (viewer's clock). */
function daysAgo(iso: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(iso)) / 86_400_000);
}

/** The queue's right-hand time: "5m", "2h", "08:12", "Yest.", "Mon", "3 Nov". */
export function shortTime(isoString: string, now: Date): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  const mins = Math.floor((now.getTime() - d.getTime()) / 60_000);
  const ago = daysAgo(d, now);
  if (ago === 0) {
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    if (mins < 6 * 60) return `${Math.floor(mins / 60)}h`;
    return clock(d);
  }
  if (ago === 1) return "Yest.";
  if (ago > 1 && ago < 7) return WEEKDAYS[d.getDay()];
  return dayMonth(d);
}

/** A feed row's time: "Today 08:12", "Sun 10:14", "3 Nov". */
export function dayTime(isoString: string, now: Date): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  const ago = daysAgo(d, now);
  if (ago === 0) return `Today ${clock(d)}`;
  if (ago > 0 && ago < 7) return `${WEEKDAYS[d.getDay()]} ${clock(d)}`;
  return dayMonth(d);
}

/** "Wednesday 28 October" for Today's header. */
export function longDate(now: Date): string {
  const long = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${long[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]}`;
}

// ─── Who an event is about ───────────────────────────────────────────────────

export interface Who {
  /** Stable group key: the client, an invited profile, or the practice. */
  key: string;
  name: string;
  initials: string;
  clientId: string | null;
  profileId: string | null;
}

/** An expired invite has no client yet: it names the invited profile. */
export function whoOf(
  client: EventClient | null,
  payload: Record<string, unknown>,
): Who {
  if (client) {
    const name = client.name ?? "A client";
    return {
      key: `client:${client.id}`,
      name,
      initials: initials(name),
      clientId: client.id,
      profileId: null,
    };
  }
  const profileId = str(payload.profileId);
  const name = str(payload.displayName) ?? "Your practice";
  return {
    key: profileId ? `profile:${profileId}` : "practice",
    name,
    initials: initials(name),
    clientId: null,
    profileId,
  };
}

export const clientHref = (clientId: string) =>
  `/coach/clients/${encodeURIComponent(clientId)}`;
export const checkinsHref = (clientId: string) =>
  `${clientHref(clientId)}/check-ins`;
export const invitedHref = (profileId: string) =>
  `/coach/clients/invited/${encodeURIComponent(profileId)}`;

/** Where "Open client" goes for a group, when anywhere. */
export function whoHref(who: Who): string | null {
  if (who.clientId) return clientHref(who.clientId);
  if (who.profileId) return invitedHref(who.profileId);
  return null;
}

// ─── Feed (C10e) ─────────────────────────────────────────────────────────────

export type FeedTone = "done" | "outstanding" | "trained" | "record" | "info";

export interface EventView {
  title: string;
  detail: string;
  tone: FeedTone;
  /** Pill text on the right ("Done", "Outstanding"…), if any. */
  pill: string | null;
  action: { label: string; href: string } | null;
}

function recordsText(payload: Record<string, unknown>): {
  count: number;
  names: string;
} {
  const list = Array.isArray(payload.records) ? payload.records : [];
  const names = [
    ...new Set(
      list
        .map((r) => str((r as Record<string, unknown>)?.exerciseName))
        .filter((n): n is string => n !== null),
    ),
  ];
  return { count: Math.max(list.length, 1), names: names.join(" · ") };
}

const SESSION_KIND: Record<string, string> = {
  in_person: "In person",
  video: "Video call",
  check_in_call: "Check-in call",
  own_training: "Your training",
};

export function sessionKindLabel(kind: string): string {
  return SESSION_KIND[kind] ?? "Session";
}

/** What one feed event says, and where its action goes. */
export function describeEvent(e: CoachEvent, now: Date): EventView {
  const p = e.payload;
  const when = dayTime(e.occurredAt, now);
  const who = whoOf(e.client, p);
  const join = (...bits: (string | null | false)[]) =>
    bits.filter((b): b is string => !!b).join(" · ");
  switch (e.kind) {
    case "check_in_completed":
    case "form_completed":
      return {
        title: `${str(p.formTitle) ?? "A form"} done`,
        detail: join(when, p.late === true && "answered late"),
        tone: "done",
        pill: "Done",
        action: who.clientId
          ? {
              label: e.kind === "check_in_completed" ? "Review" : "Read",
              href: checkinsHref(who.clientId),
            }
          : null,
      };
    case "form_missed":
      return {
        title: `${str(p.formTitle) ?? "A form"} not done`,
        detail: when,
        tone: "outstanding",
        pill: "Outstanding",
        action: null,
      };
    case "workout_completed": {
      const rating = num(p.rating);
      const difficulty = num(p.difficulty);
      const note = str(p.note);
      return {
        title: `${str(p.workoutName) ?? "A workout"} done`,
        detail: join(
          when,
          rating !== null
            ? `rated ${rating}/5`
            : difficulty !== null && `difficulty ${difficulty}/10`,
          note && `“${note}”`,
        ),
        tone: "trained",
        pill: "Trained",
        action: null,
      };
    }
    case "record_hit": {
      const r = recordsText(p);
      return {
        title: r.count === 1 ? "New record" : `${r.count} new records`,
        detail: join(when, r.names || null),
        tone: "record",
        pill: "Record",
        action: null,
      };
    }
    case "client_accepted":
      return {
        title: "Accepted your invite",
        detail: when,
        tone: "info",
        pill: "Joined",
        action: null,
      };
    case "invite_expired":
      return {
        title: "Invite code expired",
        detail: join(when, "you can resend it"),
        tone: "outstanding",
        pill: "Expired",
        action: who.profileId
          ? { label: "Resend", href: invitedHref(who.profileId) }
          : null,
      };
    case "programme_ending": {
      const end = str(p.endDate);
      const left = num(p.remaining);
      return {
        title: `${str(p.programName) ?? "Programme"} ends soon`,
        detail: join(
          when,
          end && `ends ${dayMonth(new Date(end))}`,
          left !== null && `${left} workout${left === 1 ? "" : "s"} left`,
        ),
        tone: "info",
        pill: null,
        action: null,
      };
    }
    case "training_behind": {
      const done = num(p.done);
      const target = num(p.target);
      return {
        title: "Behind on training",
        detail: join(
          when,
          str(p.label) ??
            (done !== null && target !== null
              ? `${done} of ${target} sessions`
              : null),
        ),
        tone: "outstanding",
        pill: "Behind",
        action: null,
      };
    }
    case "session_booked": {
      const action = str(p.action);
      const starts = str(p.startsAt);
      const verb =
        action === "cancelled"
          ? "cancelled"
          : action === "moved"
            ? "moved"
            : "booked";
      return {
        title: `${sessionKindLabel(str(p.sessionKind) ?? "")} ${verb}`,
        detail: join(when, starts && `for ${dayTime(starts, now)}`),
        tone: "info",
        pill: null,
        action: null,
      };
    }
    case "message_received":
      return {
        title: "New message",
        detail: when,
        tone: "info",
        pill: null,
        action: null,
      };
    default:
      return {
        title: "A new update",
        detail: when,
        tone: "info",
        pill: null,
        action: null,
      };
  }
}

/** The C10e/C10l type filters. Kinds outside them show under All only. */
export const FEED_TYPES = [
  { id: "check-ins", label: "Check-ins", kinds: ["check_in_completed"] },
  { id: "forms", label: "Forms", kinds: ["form_completed"] },
  {
    id: "workouts",
    label: "Workouts",
    kinds: ["workout_completed", "record_hit"],
  },
  {
    id: "missed",
    label: "Missed and outstanding",
    kinds: ["form_missed", "training_behind"],
  },
] as const;
export type FeedTypeId = "all" | (typeof FEED_TYPES)[number]["id"];

export function kindsFor(type: FeedTypeId): readonly string[] | null {
  if (type === "all") return null;
  return FEED_TYPES.find((t) => t.id === type)?.kinds ?? null;
}

export interface FeedFilter {
  type: FeedTypeId;
  /** A `Who.key`, or null for every client. */
  who: string | null;
}

export function filterFeed(events: CoachEvent[], f: FeedFilter): CoachEvent[] {
  const kinds = kindsFor(f.type);
  return events.filter(
    (e) =>
      (!kinds || kinds.includes(e.kind)) &&
      (!f.who || whoOf(e.client, e.payload).key === f.who),
  );
}

/** Chip counts: unread events per type (C10e "All 9 · Check-ins 3…"). */
export function unreadByType(events: CoachEvent[]): Record<FeedTypeId, number> {
  const out = { all: 0 } as Record<FeedTypeId, number>;
  for (const t of FEED_TYPES) out[t.id] = 0;
  for (const e of events) {
    if (e.readAt) continue;
    out.all += 1;
    for (const t of FEED_TYPES) {
      if ((t.kinds as readonly string[]).includes(e.kind)) out[t.id] += 1;
    }
  }
  return out;
}

export interface FeedGroup {
  who: Who;
  events: CoachEvent[];
  unread: number;
  outstanding: number;
}

/** Group by person, newest person first; each keeps newest-first order. */
export function groupByClient(events: CoachEvent[]): FeedGroup[] {
  const groups = new Map<string, FeedGroup>();
  for (const e of events) {
    const who = whoOf(e.client, e.payload);
    let g = groups.get(who.key);
    if (!g) {
      g = { who, events: [], unread: 0, outstanding: 0 };
      groups.set(who.key, g);
    }
    g.events.push(e);
    if (!e.readAt) g.unread += 1;
    if (e.kind === "form_missed" && !e.readAt) g.outstanding += 1;
  }
  return [...groups.values()];
}

/** "3 new · 1 outstanding", "Nothing new". */
export function groupSummary(g: FeedGroup): string {
  const bits: string[] = [];
  if (g.unread > 0) bits.push(`${g.unread} new`);
  if (g.outstanding > 0) bits.push(`${g.outstanding} outstanding`);
  return bits.length > 0 ? bits.join(" · ") : "Nothing new";
}

/** The people in the feed, for the client filter, by name. */
export function feedPeople(events: CoachEvent[]): Who[] {
  const seen = new Map<string, Who>();
  for (const e of events) {
    const who = whoOf(e.client, e.payload);
    if (!seen.has(who.key)) seen.set(who.key, who);
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Today (C2a) ─────────────────────────────────────────────────────────────

export type TodayTone = "violet" | "ember";

export interface TodayRowView {
  label: string;
  tone: TodayTone;
  facts: string;
  /** A link action goes somewhere and marks the item done; "done" only marks. */
  action:
    | { kind: "link"; label: string; href: string }
    | { kind: "done"; label: string };
}

export function describeToday(item: TodayItem): TodayRowView {
  const f = item.facts;
  const who = whoOf(item.client, f);
  const formTitle = str(f.formTitle);
  let label: string;
  let tone: TodayTone = "violet";
  let facts: string;
  switch (item.kind) {
    case "check_in_completed":
    case "form_completed":
      label = formTitle ?? "Form completed";
      facts = f.late === true ? "Answered late" : "New answers to review";
      break;
    case "form_missed":
      label = `Missed ${formTitle ?? "a form"}`;
      tone = "ember";
      facts = "Not answered by the due time";
      break;
    case "training_behind": {
      label = "Behind on training";
      tone = "ember";
      const done = num(f.done);
      const target = num(f.target);
      facts =
        str(f.label) ??
        (done !== null && target !== null
          ? `${done} of ${target} sessions in the last 7 days`
          : "Fewer sessions than their target");
      break;
    }
    case "programme_ending": {
      const end = str(f.endDate);
      const left = num(f.remaining);
      label = end
        ? `Programme ends ${dayMonth(new Date(end))}`
        : "Programme ends soon";
      facts = [
        str(f.programName),
        left !== null ? `${left} workout${left === 1 ? "" : "s"} left` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      break;
    }
    case "client_accepted":
      label = "Accepted your invite";
      facts = "Now on your client list";
      break;
    case "invite_expired":
      label = "Invite code expired";
      tone = "ember";
      facts = "Their personal code ran out";
      break;
    case "message_received":
      label = "New message";
      facts = str(f.preview) ?? "";
      break;
    default:
      label = "Needs you";
      facts = "";
  }
  let action: TodayRowView["action"] = { kind: "done", label: "Done" };
  if (item.action === "review_response" && who.clientId) {
    action = {
      kind: "link",
      label: "Review",
      href: checkinsHref(who.clientId),
    };
  } else if (item.action === "resend_invite" && who.profileId) {
    action = {
      kind: "link",
      label: "Resend",
      href: invitedHref(who.profileId),
    };
  }
  return { label, tone, facts, action };
}

/** C2a chips. Records stay in Notifications: Today only holds actions. */
export const TODAY_FILTERS = [
  {
    id: "check-ins",
    label: "Check-ins",
    kinds: ["check_in_completed", "form_completed"],
  },
  {
    id: "flags",
    label: "Flags",
    kinds: ["form_missed", "training_behind", "programme_ending"],
  },
  { id: "messages", label: "Messages", kinds: ["message_received"] },
  {
    id: "clients",
    label: "Clients",
    kinds: ["client_accepted", "invite_expired"],
  },
] as const;
export type TodayFilterId = "all" | (typeof TODAY_FILTERS)[number]["id"];

export function todayFilterCounts(
  byKind: Record<string, number>,
  total: number,
): { id: TodayFilterId; label: string; count: number }[] {
  const out: { id: TodayFilterId; label: string; count: number }[] = [
    { id: "all", label: "All", count: total },
  ];
  for (const f of TODAY_FILTERS) {
    const count = f.kinds.reduce((n, k) => n + (byKind[k] ?? 0), 0);
    if (count > 0) out.push({ id: f.id, label: f.label, count });
  }
  return out;
}

export function filterToday(
  queue: TodayItem[],
  filter: TodayFilterId,
): TodayItem[] {
  if (filter === "all") return queue;
  const kinds = TODAY_FILTERS.find((f) => f.id === filter)?.kinds as
    | readonly string[]
    | undefined;
  return kinds ? queue.filter((i) => kinds.includes(i.kind)) : queue;
}

/** Today without one item, its counts lowered to match. */
export function withoutItem(
  today: TodayPayload,
  eventId: string,
): TodayPayload {
  const item = today.queue.find((i) => i.eventId === eventId);
  if (!item) return today;
  const byKind = { ...today.counts.byKind };
  byKind[item.kind] = Math.max(0, (byKind[item.kind] ?? 0) - 1);
  return {
    ...today,
    queue: today.queue.filter((i) => i.eventId !== eventId),
    counts: { total: Math.max(0, today.counts.total - 1), byKind },
  };
}

export interface StripCell {
  key: string;
  value: string;
  of: string | null;
  label: string;
}

/**
 * The C2a strip. Adherence is one cell per tracked area, never one blended
 * score (product rule, design B); an area no client tracks is left out.
 */
export function stripCells(
  total: number,
  activeClients: number | null,
  strip: PracticeAdherence,
): StripCell[] {
  const cells: StripCell[] = [
    { key: "need", value: String(total), of: null, label: "Need you" },
  ];
  if (activeClients !== null) {
    cells.push({
      key: "clients",
      value: String(activeClients),
      of: null,
      label: "Active clients",
    });
  }
  if (strip.training && strip.training.target > 0) {
    cells.push({
      key: "training",
      value: String(strip.training.done),
      of: `/${strip.training.target}`,
      label: "Training · sessions",
    });
  }
  if (strip.calories && strip.calories.daysCounted > 0) {
    cells.push({
      key: "calories",
      value: String(strip.calories.daysOnTarget),
      of: `/${strip.calories.daysCounted}`,
      label: "Calories · days on target",
    });
  }
  return cells;
}

export interface ScheduleRow {
  id: string;
  time: string;
  title: string;
  sub: string;
  own: boolean;
  state: "done" | "next" | null;
}

/** Today's schedule list (C2a), not cancelled, by start time. */
export function scheduleRows(
  sessions: ScheduleSession[],
  now: Date,
): ScheduleRow[] {
  let nextGiven = false;
  return sessions
    .filter((s) => !s.cancelledAt)
    .slice()
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map((s) => {
      const own = s.kind === "own_training";
      const people = s.attendees
        .filter((a) => a.status !== "declined" && a.status !== "cancelled")
        .map((a) => a.name ?? "A client");
      const title = own
        ? "Your training"
        : people.length > 0
          ? people.join(", ")
          : sessionKindLabel(s.kind);
      const sub = [
        own ? (s.workout?.name ?? null) : sessionKindLabel(s.kind),
        s.location ?? `${s.durationMin} min`,
      ]
        .filter(Boolean)
        .join(" · ");
      let state: ScheduleRow["state"] = null;
      if (new Date(s.endsAt).getTime() <= now.getTime()) state = "done";
      else if (!nextGiven) {
        state = "next";
        nextGiven = true;
      }
      return {
        id: s.id,
        time: clock(new Date(s.startsAt)),
        title,
        sub,
        own,
        state,
      };
    });
}

// ─── Settings (C6b) ──────────────────────────────────────────────────────────

/**
 * One row per event the server knows. The canvas lists a few events that have
 * no event yet (photos, meal plan not opened, habit streak, seat limit); they
 * are left out. A booking never pushes the coach (they made it), so it has no
 * row either.
 */
export const SETTINGS_ROWS: { kind: string; label: string }[] = [
  { kind: "check_in_completed", label: "Check-in submitted" },
  { kind: "form_missed", label: "Check-in or form overdue" },
  { kind: "workout_completed", label: "Workout completed" },
  { kind: "training_behind", label: "Behind on training" },
  { kind: "record_hit", label: "New record" },
  { kind: "message_received", label: "Message" },
  { kind: "form_completed", label: "Form completed" },
  { kind: "client_accepted", label: "Client joined" },
  { kind: "invite_expired", label: "Invite code expired" },
  { kind: "programme_ending", label: "Programme ending" },
];

export const CHANNEL_LABELS: Record<Channel, string> = {
  push: "Notification",
  email: "Email",
  both: "Notification and email",
  off: "Off",
};

/**
 * The dropdown's choices. Email stays hidden while the server says
 * `emailAvailable: false` (Brad, 20 Nov); a channel already stored is kept
 * in the list so the dropdown never misreports it.
 */
export function channelOptions(
  emailAvailable: boolean,
  current: Channel,
): Channel[] {
  const base: Channel[] = emailAvailable
    ? ["push", "email", "both", "off"]
    : ["push", "off"];
  return base.includes(current) ? base : [...base, current];
}
