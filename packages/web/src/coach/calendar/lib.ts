import type {
  AttendeeStatus,
  CoachSession,
  FormDue,
  SessionKind,
} from "./types";

/**
 * Calendar maths and wording for C4a / C4c (PER-144). Times show in the
 * browser's own time zone; the server works in instants.
 */

const DAY_MS = 86_400_000;

export const KIND_LABEL: Record<SessionKind, string> = {
  in_person: "In person",
  video: "Video call",
  check_in_call: "Check-in call",
  own_training: "Your training",
};

/** Legend colours from the canvas (C4a). */
export const KIND_TONE: Record<SessionKind | "forms", string> = {
  in_person: "#a78bfa",
  video: "#60a5fa",
  check_in_call: "#fb923c",
  own_training: "#22d3ee",
  forms: "#8a8a98",
};

export const LEGEND: { key: SessionKind | "forms"; label: string }[] = [
  { key: "in_person", label: "In person" },
  { key: "video", label: "Video call" },
  { key: "check_in_call", label: "Check-in call" },
  { key: "own_training", label: "Your training" },
  { key: "forms", label: "Forms due" },
];

export const STATUS_LABEL: Record<AttendeeStatus, string> = {
  invited: "Invited",
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Cancelled",
};

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = [
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

/** Local midnight on the Monday of `d`'s week. */
export function weekStart(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const back = (out.getDay() + 6) % 7;
  out.setDate(out.getDate() - back);
  return out;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** `YYYY-MM-DD` for the local day (the URL's `?week=` and date inputs). */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A `YYYY-MM-DD` as local midnight; null when it isn't a real date. */
export function parseDay(raw: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw ?? "");
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return dayKey(d) === raw ? d : null;
}

/** `HH:MM`, local. */
export function clock(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO week number (weeks start on Monday). */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - yearStart) / DAY_MS + 1) / 7);
}

/** "Week 44 · 27 Oct – 2 Nov". */
export function weekTitle(start: Date): string {
  const end = addDays(start, 6);
  return `Week ${isoWeek(start)} · ${start.getDate()} ${MONTH[start.getMonth()]} – ${end.getDate()} ${MONTH[end.getMonth()]}`;
}

/** "Mon 27" (C4a column heads). */
export function dayHead(d: Date): string {
  return `${WEEKDAY[d.getDay()]} ${d.getDate()}`;
}

/** "Thu 30 Oct". */
export function longDay(d: Date): string {
  return `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`;
}

export function weekdayName(d: Date): string {
  return WEEKDAY[d.getDay()]!;
}

export function sameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

/** "45 min", "1 h", "1 h 30 min". */
export function lengthLabel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "15 min", "2 h", "1 day". */
export function reminderLabel(min: number): string {
  if (min % 1440 === 0) {
    const d = min / 1440;
    return `${d} day${d === 1 ? "" : "s"}`;
  }
  return lengthLabel(min);
}

/** The booked people on a session (not cancelled by ending coaching). */
export function bookedAttendees(s: CoachSession) {
  return s.attendees.filter((a) => a.status !== "cancelled");
}

/** Block title: the client, a group, or "Your training". */
export function sessionTitle(s: CoachSession): string {
  if (s.kind === "own_training") return KIND_LABEL.own_training;
  const people = bookedAttendees(s);
  if (people.length === 1) return people[0]!.name;
  if (people.length > 1) return `Group · ${people.length} booked`;
  return KIND_LABEL[s.kind];
}

/** Block subtitle: "In person · Studio A", "Upper A", "Video call · declined". */
export function sessionSubtitle(s: CoachSession): string {
  if (s.cancelledAt) return `Cancelled · ${KIND_LABEL[s.kind].toLowerCase()}`;
  if (s.kind === "own_training") return s.workout?.name ?? "Training";
  const parts: string[] = [KIND_LABEL[s.kind]];
  if (s.kind === "in_person" && s.location) parts.push(s.location);
  const people = bookedAttendees(s);
  if (people.length === 1 && people[0]!.status === "declined") {
    parts.push("declined");
  }
  return parts.join(" · ");
}

/** Forms due on one day, one row per form (C4a "Weekly check-ins due"). */
export interface FormsDueGroup {
  key: string;
  formTitle: string;
  dueAt: Date;
  items: FormDue[];
  late: number;
}

export function groupFormsDue(forms: FormDue[]): FormsDueGroup[] {
  const groups = new Map<string, FormsDueGroup>();
  for (const f of forms) {
    const due = new Date(f.dueAt);
    const key = `${dayKey(due)}|${f.formId}`;
    const g = groups.get(key);
    if (g) {
      g.items.push(f);
      if (due < g.dueAt) g.dueAt = due;
      if (f.late) g.late += 1;
    } else {
      groups.set(key, {
        key,
        formTitle: f.formTitle,
        dueAt: due,
        items: [f],
        late: f.late ? 1 : 0,
      });
    }
  }
  return [...groups.values()].sort(
    (a, b) => a.dueAt.getTime() - b.dueAt.getTime(),
  );
}

export function clientsLabel(n: number): string {
  return `${n} client${n === 1 ? "" : "s"}`;
}

/** Hours shown on the grid: 06:00–21:00, widened to fit what's booked. */
export function hourRange(times: { start: Date; end: Date }[]): {
  first: number;
  last: number;
} {
  let first = 6;
  let last = 21;
  for (const t of times) {
    first = Math.min(first, t.start.getHours());
    const endHour = sameDay(t.start, t.end)
      ? t.end.getHours() + (t.end.getMinutes() > 0 ? 1 : 0)
      : 24;
    last = Math.max(last, endHour);
  }
  return { first, last: Math.max(last, first + 1) };
}

/** A block laid out in its day column, in minutes from the grid's top. */
export interface Placed<T> {
  item: T;
  top: number;
  height: number;
  lane: number;
  lanes: number;
}

/**
 * Lay out one day's blocks: overlapping ones sit side by side. Each block
 * keeps at least `minMinutes` of height so its name stays readable.
 */
export function placeDay<T>(
  items: { item: T; start: Date; end: Date }[],
  firstHour: number,
  minMinutes = 20,
): Placed<T>[] {
  const sorted = [...items].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  const out: Placed<T>[] = [];
  let cluster: Placed<T>[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;
  const close = () => {
    for (const p of cluster) p.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };
  for (const it of sorted) {
    const top =
      it.start.getHours() * 60 + it.start.getMinutes() - firstHour * 60;
    const span = Math.max(
      minMinutes,
      Math.round((it.end.getTime() - it.start.getTime()) / 60_000),
    );
    if (top >= clusterEnd) close();
    let lane = laneEnds.findIndex((end) => end <= top);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(top + span);
    } else {
      laneEnds[lane] = top + span;
    }
    const placed: Placed<T> = {
      item: it.item,
      top,
      height: span,
      lane,
      lanes: 1,
    };
    cluster.push(placed);
    out.push(placed);
    clusterEnd = Math.max(clusterEnd, top + span);
  }
  close();
  return out;
}
