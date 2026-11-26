import type {
  AthleteFormRequest,
  LocalFormState,
} from "@/domain/models/athleteForms";
import { NO_LONGER_NEEDED } from "@/domain/models/athleteForms";
import type { Question } from "@/domain/models/coachForms";
import {
  WEEKDAYS_LONG,
  WEEKDAYS_SHORT,
  dayMonth,
  plural,
} from "./coachForms.service";

/**
 * PER-130 (APP-C2): the athlete's due forms on the Coach tab (C10p/r), the
 * joining forms page (C10q) and the fill-in screen (C4f). Pure: every date
 * is read in the phone's local time, against `now`.
 */

const DAY_MS = 86_400_000;

function isoWeekday(d: Date): number {
  return ((d.getDay() + 6) % 7) + 1;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole calendar days from `now` to `d` (negative in the past). */
function dayOffset(d: Date, now: Date): number {
  return Math.round((startOfDay(d) - startOfDay(now)) / DAY_MS);
}

/** "08:12" in local time. */
export function clockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

/** "Mon 12:00" within the coming or past week, else "26 Oct 12:00". */
export function dayTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.abs(dayOffset(d, now));
  const day = days < 7 ? WEEKDAYS_SHORT[isoWeekday(d) - 1] : dayMonth(iso, now);
  return `${day} ${clockTime(iso)}`;
}

// ── Size of a form ───────────────────────────────────────────────────────────

/** Rough seconds to answer each question type, for "about N min". */
const SECONDS: Record<Question["type"], number> = {
  short_text: 30,
  long_text: 60,
  number: 15,
  scale: 10,
  single_choice: 15,
  multiple_choice: 20,
  yes_no: 10,
  photo: 45,
};

/** "About N min" for a set of questions (at least 1). */
export function minutesFor(questions: readonly Question[]): number {
  const seconds = questions.reduce(
    (n, q) => n + SECONDS[q.type] + (q.detailsIfYes ? 20 : 0),
    0,
  );
  return Math.max(1, Math.ceil(seconds / 60));
}

/** C10p "12 questions · about 5 min · photos". */
export function sizeLine(questions: readonly Question[]): string {
  const parts = [
    plural(questions.length, "question"),
    `about ${minutesFor(questions)} min`,
  ];
  if (questions.some((q) => q.type === "photo")) parts.push("photos");
  return parts.join(" · ");
}

export function hasPhotoQuestion(questions: readonly Question[]): boolean {
  return questions.some((q) => q.type === "photo");
}

// ── Due line (C10p / C10r) ───────────────────────────────────────────────────

export type DueTone = "due" | "none" | "late";

export type DueLine = { text: string; tone: DueTone };

/**
 * C10p "Due tomorrow 12:00" / "No due date"; C10r "Late · was due Mon 12:00"
 * (a missed request still open, or one past its due time the server hasn't
 * marked yet).
 */
export function dueLine(
  request: Pick<AthleteFormRequest, "dueAt" | "status">,
  now: Date = new Date(),
): DueLine {
  const due = request.dueAt ? new Date(request.dueAt) : null;
  const valid = due !== null && !Number.isNaN(due.getTime());
  const late =
    request.status === "missed" || (valid && due.getTime() < now.getTime());
  if (late) {
    return {
      text: valid ? `Late · was due ${dayTime(request.dueAt!, now)}` : "Late",
      tone: "late",
    };
  }
  if (!valid) return { text: "No due date", tone: "none" };
  const days = dayOffset(due, now);
  const time = clockTime(request.dueAt!);
  if (days === 0) return { text: `Due today ${time}`, tone: "due" };
  if (days === 1) return { text: `Due tomorrow ${time}`, tone: "due" };
  return { text: `Due ${dayTime(request.dueAt!, now)}`, tone: "due" };
}

/**
 * C10r's second line for a late form. The server keeps a missed request
 * open for 7 days (`closesAt`), so the day it closes is what we can say.
 */
export function lateNote(
  request: Pick<AthleteFormRequest, "closesAt">,
  now: Date = new Date(),
): string | null {
  if (!request.closesAt) return null;
  const d = new Date(request.closesAt);
  if (Number.isNaN(d.getTime())) return null;
  const days = dayOffset(d, now);
  if (days <= 0)
    return `You can still send it until ${clockTime(request.closesAt)} today`;
  const day =
    days < 7
      ? WEEKDAYS_LONG[isoWeekday(d) - 1]
      : dayMonth(request.closesAt, now);
  return `You can still send it until ${day}`;
}

// ── Coach tab sections ───────────────────────────────────────────────────────

export type FormCard = {
  requestId: string;
  title: string;
  due: DueLine;
  /** C10p "12 questions · about 5 min · photos", or C10r's late note. */
  detail: string;
  /** A draft is saved on this phone. */
  started: boolean;
};

export type DoneRow = {
  requestId: string;
  title: string;
  subtitle: string;
  /** C10r "Waiting" pill while it hasn't reached the server. */
  waiting: boolean;
  closed: boolean;
};

export type CoachFormsView = {
  toFill: FormCard[];
  done: DoneRow[];
  /** Titles saved on this phone that haven't sent yet. */
  waitingTitles: string[];
};

/**
 * The local states as the screens see them. A form "waiting to send" whose
 * queue row can no longer send (retries used up, refused for good,
 * discarded on the sync-failed screen) is a draft again: it goes back to
 * "To fill in" with its answers (Inspector Brad, #571).
 */
export function withLiveQueue(
  locals: readonly LocalFormState[],
  liveIds: ReadonlySet<string>,
): LocalFormState[] {
  return locals.map((l) =>
    isWaiting(l) && !liveIds.has(l.requestId) ? { ...l, submittedAt: null } : l,
  );
}

/** Sent from this phone, not yet on the server, not closed. */
export function isWaiting(local: LocalFormState | undefined): boolean {
  return (
    !!local &&
    local.submittedAt !== null &&
    local.sentAt === null &&
    !local.closed &&
    !local.rejected
  );
}

/** A local state that has left the to-fill list. */
function isSubmitted(local: LocalFormState | undefined): boolean {
  return (
    !!local && (local.closed || (local.submittedAt !== null && !local.rejected))
  );
}

/** "today", "yesterday", "last Sunday" within the week, else "12 Oct". */
export function pastDay(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = -dayOffset(d, now);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `last ${WEEKDAYS_LONG[isoWeekday(d) - 1]}`;
  return dayMonth(iso, now);
}

function sentLabel(iso: string, now: Date): string {
  const days = -dayOffset(new Date(iso), now);
  return days <= 1 ? clockTime(iso) : dayTime(iso, now);
}

const DONE_LIMIT = 5;

/** The Coach tab's forms for one coach: to fill in (C10p), then done (C10r). */
export function coachFormsView(input: {
  requests: readonly AthleteFormRequest[];
  locals: readonly LocalFormState[];
  coachId: string;
  now?: Date;
}): CoachFormsView {
  const now = input.now ?? new Date();
  const byId = new Map(input.locals.map((l) => [l.requestId, l]));
  const toFill: FormCard[] = input.requests
    .filter((r) => r.coach.id === input.coachId && !isSubmitted(byId.get(r.id)))
    .map((r) => {
      const due = dueLine(r, now);
      const questions = r.version.questions;
      const local = byId.get(r.id);
      return {
        requestId: r.id,
        title: r.title,
        due,
        detail:
          due.tone === "late"
            ? (lateNote(r, now) ?? sizeLine(questions))
            : sizeLine(questions),
        started: !!local && Object.keys(local.answers).length > 0,
      };
    });
  const sent = input.locals
    .filter((l) => l.coachId === input.coachId && isSubmitted(l))
    .sort((a, b) =>
      (b.submittedAt ?? b.updatedAt).localeCompare(
        a.submittedAt ?? a.updatedAt,
      ),
    );
  const done: DoneRow[] = sent.slice(0, DONE_LIMIT).map((l) => {
    const at = l.submittedAt ?? l.updatedAt;
    const title = `${l.title} · ${pastDay(at, now)}`;
    if (l.closed) {
      return {
        requestId: l.requestId,
        title,
        subtitle: NO_LONGER_NEEDED,
        waiting: false,
        closed: true,
      };
    }
    if (l.sentAt === null) {
      return {
        requestId: l.requestId,
        title,
        subtitle: `Waiting to send · saved ${clockTime(at)}`,
        waiting: true,
        closed: false,
      };
    }
    return {
      requestId: l.requestId,
      title,
      subtitle: `Sent ${sentLabel(l.sentAt, now)}`,
      waiting: false,
      closed: false,
    };
  });
  return {
    toFill,
    done,
    waitingTitles: sent
      .filter((l) => !l.closed && l.sentAt === null)
      .map((l) => l.title),
  };
}

/** C10r offline note, naming what waits to send. */
export function offlineLine(waitingTitles: readonly string[]): string {
  if (waitingTitles.length === 1) {
    return `You’re offline. ${waitingTitles[0]} is saved on this phone and sends when you’re back.`;
  }
  if (waitingTitles.length > 1) {
    return `You’re offline. ${waitingTitles.length} forms are saved on this phone and send when you’re back.`;
  }
  return "You’re offline. Forms you fill in are saved on this phone and send when you’re back.";
}

/** Forms still to fill in across every coach (the Coach tab badge). */
export function dueCount(
  requests: readonly AthleteFormRequest[],
  locals: readonly LocalFormState[],
): number {
  const byId = new Map(locals.map((l) => [l.requestId, l]));
  return requests.filter((r) => !isSubmitted(byId.get(r.id))).length;
}

// ── Joining forms (C10q) ─────────────────────────────────────────────────────

/** One coach's "when they join" forms still to fill in, in the coach's order. */
export function joiningForms(
  requests: readonly AthleteFormRequest[],
  locals: readonly LocalFormState[],
  coachId: string,
): AthleteFormRequest[] {
  const byId = new Map(locals.map((l) => [l.requestId, l]));
  return requests.filter(
    (r) =>
      r.coach.id === coachId &&
      r.trigger === "on_join" &&
      !isSubmitted(byId.get(r.id)),
  );
}

/**
 * Open C10q by itself only while none of the joining forms has been seen on
 * that page or started.
 */
export function shouldShowJoinIntro(
  joining: readonly AthleteFormRequest[],
  locals: readonly LocalFormState[],
): boolean {
  if (joining.length === 0) return false;
  const byId = new Map(locals.map((l) => [l.requestId, l]));
  return joining.every((r) => {
    const local = byId.get(r.id);
    return (
      !local || (!local.introSeen && Object.keys(local.answers).length === 0)
    );
  });
}

const NUMBER_WORDS = [
  "No",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
];

/** C10q "Two forms to get started". */
export function joinHeadline(count: number): string {
  const n = NUMBER_WORDS[count] ?? String(count);
  return `${n} ${count === 1 ? "form" : "forms"} to get started`;
}

/** C10q strip: forms, questions, about N min. */
export function joinSummary(joining: readonly AthleteFormRequest[]): {
  forms: number;
  questions: number;
  minutes: number;
} {
  const all = joining.flatMap((r) => r.version.questions);
  return {
    forms: joining.length,
    questions: all.length,
    minutes: joining.reduce((n, r) => n + minutesFor(r.version.questions), 0),
  };
}

/** The next joining form after `afterId` (the one just sent), if any. */
export function nextJoiningForm(
  requests: readonly AthleteFormRequest[],
  locals: readonly LocalFormState[],
  coachId: string,
  afterId: string,
): AthleteFormRequest | null {
  return (
    joiningForms(requests, locals, coachId).find((r) => r.id !== afterId) ??
    null
  );
}
