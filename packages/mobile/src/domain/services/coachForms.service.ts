/**
 * PER-129 (APP-C1): pure rules behind the coach forms screens — the C10g
 * library grouping, rule and due/reminder wording, the C3.3b Check-ins rows,
 * answer formatting, and the C10b editor's question rules.
 */
import {
  MAX_DUE_HOURS,
  MAX_HELP,
  MAX_OPTIONS,
  MAX_PROMPT,
  MAX_QUESTIONS,
  MAX_REMINDER_HOURS,
  MAX_UNIT,
  MIN_OPTIONS,
  PREFILL_SOURCES,
  TITLE_MAX,
  formConflictKey,
  type ClientForm,
  type ClientFormRule,
  type CoachForm,
  type CoachFormConflict,
  type CoachFormStats,
  type FormDraft,
  type FormResponse,
  type FormSchedule,
  type FormTrigger,
  type PrefillSource,
  type Question,
  type QuestionType,
  type RuleFields,
} from "@/domain/models/coachForms";

// ── Days and times ───────────────────────────────────────────────────────────

export const WEEKDAYS_SHORT = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;
export const WEEKDAYS_LONG = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;
/** Canvas day chips (C10h/C10j). */
export const DAY_CHIPS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;
const MONTHS_SHORT = [
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

const DAY_MINUTES = 24 * 60;
const WEEK_MINUTES = 7 * DAY_MINUTES;

/** "09:00" → 540; anything else → null. */
export function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)/.exec(value);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 540 → "09:00" (wraps past midnight). */
export function formatMinutes(minutes: number): string {
  const m = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Monday-first 1–7 for a JS date. */
function isoWeekday(d: Date): number {
  return ((d.getDay() + 6) % 7) + 1;
}

/** "26 Oct", with the year when it isn't this year. */
export function dayMonth(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const base = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear()
    ? base
    : `${base} ${d.getFullYear()}`;
}

/** "Sun 26 Oct" (canvas C3.3), with the year when it isn't this year. */
export function shortDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${WEEKDAYS_SHORT[isoWeekday(d) - 1]} ${dayMonth(iso, now)}`;
}

/** "Sat" within the last week (C10g "Sent Sat"), else "4 Aug". */
export function recentDay(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days >= 0 && days < 6) {
    if (d.toDateString() === now.toDateString()) return "today";
    return WEEKDAYS_SHORT[isoWeekday(d) - 1]!;
  }
  return dayMonth(iso, now);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ── Rules: when it goes out, due and reminders ───────────────────────────────

export type RuleTiming = {
  trigger: FormTrigger;
  weekday: number | null;
  timeLocal: string | null;
};

/** Minutes from the start of the cycle (Mon 00:00 or midnight) to the send. */
export function sendMinute(rule: RuleTiming): number | null {
  const time = parseTime(rule.timeLocal);
  if (rule.trigger === "weekly") {
    if (time === null || !rule.weekday) return null;
    return (rule.weekday - 1) * DAY_MINUTES + time;
  }
  if (rule.trigger === "daily") return time;
  return null;
}

/** A due date or reminder, as the phone shows and edits it. */
export type Moment = {
  /** weekly: 1–7; daily: days after the send (0 = same day). */
  day: number;
  /** Minutes after midnight. */
  minutes: number;
};

/** Hours from the send → the day and time they land on. */
export function momentFromHours(
  rule: RuleTiming,
  hours: number,
): Moment | null {
  const send = sendMinute(rule);
  if (send === null) return null;
  const at = send + hours * 60;
  if (rule.trigger === "weekly") {
    const inWeek = ((at % WEEK_MINUTES) + WEEK_MINUTES) % WEEK_MINUTES;
    return {
      day: Math.floor(inWeek / DAY_MINUTES) + 1,
      minutes: inWeek % DAY_MINUTES,
    };
  }
  return { day: Math.floor(at / DAY_MINUTES), minutes: at % DAY_MINUTES };
}

/**
 * The day and time → whole hours from the send (BRIEF: Sun 09:00 send →
 * Mon 12:00 due = 27 h). Always later than the send; null when the rule has
 * no send time. Minutes snap to the send's own minute (hours are whole).
 */
export function hoursFromMoment(
  rule: RuleTiming,
  moment: Moment,
): number | null {
  const send = sendMinute(rule);
  if (send === null) return null;
  if (rule.trigger === "weekly") {
    let diff = (moment.day - 1) * DAY_MINUTES + moment.minutes - send;
    while (diff <= 0) diff += WEEK_MINUTES;
    return Math.max(1, Math.round(diff / 60));
  }
  let diff = moment.day * DAY_MINUTES + moment.minutes - send;
  while (diff <= 0) diff += DAY_MINUTES;
  return Math.max(1, Math.round(diff / 60));
}

/** "N hours after it's sent" / "N days after it's sent" (join/once/end). */
export function hoursAfterLabel(hours: number): string {
  if (hours % 24 === 0) return `${plural(hours / 24, "day")} after it's sent`;
  return `${plural(hours, "hour")} after it's sent`;
}

/**
 * How a due time or reminder reads: "Mon 12:00" / "Monday 12:00" (weekly),
 * "Next day 12:00" (daily), "27 hours after it's sent" (no send time).
 */
export function momentLabel(
  rule: RuleTiming,
  hours: number,
  opts: { long?: boolean } = {},
): string {
  const moment = momentFromHours(rule, hours);
  if (moment === null) return hoursAfterLabel(hours);
  const time = formatMinutes(moment.minutes);
  if (rule.trigger === "weekly") {
    const names = opts.long ? WEEKDAYS_LONG : WEEKDAYS_SHORT;
    return `${names[moment.day - 1]} ${time}`;
  }
  return `${dailyDayLabel(moment.day)} ${time}`;
}

/** Daily due/reminder day: "Same day", "Next day", "In 3 days". */
export function dailyDayLabel(day: number): string {
  if (day <= 0) return "Same day";
  if (day === 1) return "Next day";
  return `In ${day} days`;
}

export function clampDueHours(hours: number): number {
  return Math.min(MAX_DUE_HOURS, Math.max(1, Math.round(hours)));
}

export function clampReminderHours(hours: number): number {
  return Math.min(MAX_REMINDER_HOURS, Math.max(1, Math.round(hours)));
}

/** Sorted, de-duplicated, clamped reminders (≤ 5), as the server keeps them. */
export function normaliseReminders(
  reminders: readonly { afterHours: number }[],
): { afterHours: number }[] {
  const hours = [
    ...new Set(reminders.map((r) => clampReminderHours(r.afterHours))),
  ];
  return hours
    .sort((a, b) => a - b)
    .slice(0, 5)
    .map((afterHours) => ({ afterHours }));
}

/** Sensible defaults when the coach picks a cadence (canvas C10h values). */
export function defaultRule(trigger: FormTrigger): RuleFields {
  if (trigger === "weekly") {
    // Sun 09:00, due Mon 12:00 (27 h), reminders Sun 18:00 and Mon 09:00.
    return {
      weekday: 7,
      timeLocal: "09:00",
      dueAfterHours: 27,
      reminders: [{ afterHours: 9 }, { afterHours: 24 }],
    };
  }
  if (trigger === "daily") {
    return {
      weekday: null,
      timeLocal: "08:00",
      dueAfterHours: 4,
      reminders: [],
    };
  }
  return { weekday: null, timeLocal: null, dueAfterHours: null, reminders: [] };
}

/**
 * Keep only the rule fields a cadence uses (weekday is weekly-only; time is
 * weekly/daily), filling a missing day or time from the defaults.
 */
export function fitRuleToTrigger(
  trigger: FormTrigger,
  rule: RuleFields,
): RuleFields {
  const d = defaultRule(trigger);
  return {
    weekday: trigger === "weekly" ? (rule.weekday ?? d.weekday) : null,
    timeLocal:
      trigger === "weekly" || trigger === "daily"
        ? (rule.timeLocal ?? d.timeLocal)
        : null,
    dueAfterHours: rule.dueAfterHours,
    reminders: normaliseReminders(rule.reminders),
  };
}

export const TRIGGER_LABELS: Record<FormTrigger, string> = {
  on_join: "When they join",
  once: "Once",
  weekly: "Weekly",
  daily: "Daily",
  on_end: "When coaching ends",
};

/** A rule as one client gets it: the override's fields win. */
export function effectiveRule(rule: ClientFormRule): RuleFields & {
  trigger: FormTrigger;
} {
  const o = rule.override ?? {};
  const pick = <T>(key: string, fallback: T): T =>
    o[key] !== undefined && o[key] !== null ? (o[key] as T) : fallback;
  return {
    trigger: pick<FormTrigger>("trigger", rule.trigger),
    weekday: pick("weekday", rule.weekday),
    timeLocal: pick("timeLocal", rule.timeLocal),
    dueAfterHours: pick("dueAfterHours", rule.dueAfterHours),
    reminders: pick("reminders", rule.reminders),
  };
}

// ── C10g library ─────────────────────────────────────────────────────────────

export type LibrarySectionKey =
  | "on_join"
  | "repeating"
  | "once"
  | "on_end"
  | "unsent";

export type LibraryRow = {
  key: string;
  formId: string;
  scheduleId: string | null;
  title: string;
  subtitle: string;
  /** "8/11", or "—" when nobody has it yet. */
  count: string;
  countMuted: boolean;
  /** A 409 took the server copy; the row says so until it's opened. */
  conflict: boolean;
};

export type LibrarySection = {
  key: LibrarySectionKey;
  title: string;
  /** C10g draws "+ Add" on Starter forms and Repeating only. */
  addable: boolean;
  rows: LibraryRow[];
};

const SECTION_TITLES: Record<LibrarySectionKey, string> = {
  on_join: "Starter forms · when they join",
  repeating: "Repeating",
  once: "Once",
  on_end: "When coaching ends",
  unsent: "Not sent yet",
};

function sectionFor(trigger: FormTrigger): LibrarySectionKey {
  if (trigger === "weekly" || trigger === "daily") return "repeating";
  return trigger;
}

export function questionCount(form: Pick<CoachForm, "version">): number {
  return form.version?.questions.length ?? 0;
}

/** Clients a rule reaches, as the row shows them. */
function clientsLabel(schedule: FormSchedule, reached: number | null): string {
  if (schedule.audience === "selected") {
    const n = schedule.clients.filter((c) => c.status !== "excluded").length;
    return plural(n, "client");
  }
  return reached ? plural(reached, "client") : "all clients";
}

/** C10g row subtitle for one live rule. */
export function scheduleSubtitle(
  form: CoachForm,
  schedule: FormSchedule,
  reached: number | null,
  now: Date = new Date(),
): string {
  const questions = plural(questionCount(form), "question");
  let text: string;
  switch (schedule.trigger) {
    case "weekly":
      text = `${
        schedule.weekday ? WEEKDAYS_SHORT[schedule.weekday - 1] : ""
      } ${schedule.timeLocal ?? ""} · ${clientsLabel(schedule, reached)}`;
      break;
    case "daily":
      text = `${schedule.timeLocal ?? ""} · ${clientsLabel(schedule, reached)}`;
      break;
    case "once":
      text = `Sent ${recentDay(schedule.createdAt, now)} · ${clientsLabel(
        schedule,
        reached,
      )}`;
      break;
    case "on_join":
      text = `${questions} · ${
        schedule.audience === "selected"
          ? clientsLabel(schedule, reached)
          : "all clients"
      }`;
      break;
    case "on_end":
      text = questions;
      break;
  }
  return schedule.status === "paused" ? `${text} · paused` : text;
}

/**
 * C10g: forms grouped by when they go out. A form appears once per live
 * rule; a form with no live rule sits in "Not sent yet". Starter forms and
 * Repeating are always shown (they carry "+ Add"); the rest only when used.
 */
export function groupLibrary(
  forms: readonly CoachForm[],
  schedules: readonly FormSchedule[],
  stats: CoachFormStats | null,
  conflicts: readonly CoachFormConflict[] = [],
  now: Date = new Date(),
): LibrarySection[] {
  const live = forms.filter((f) => f.archivedAt === null);
  const statsByForm = new Map((stats?.forms ?? []).map((s) => [s.formId, s]));
  const conflicted = new Set(conflicts.map((c) => c.key));
  const rows: Record<LibrarySectionKey, LibraryRow[]> = {
    on_join: [],
    repeating: [],
    once: [],
    on_end: [],
    unsent: [],
  };
  for (const form of live) {
    const s = statsByForm.get(form.id);
    const count = s && s.reached > 0 ? `${s.done}/${s.reached}` : "—";
    const base = {
      formId: form.id,
      title: form.title,
      count,
      countMuted: count === "—",
      conflict: conflicted.has(formConflictKey(form.id)),
    };
    const rules = schedules
      .filter((r) => r.formId === form.id && r.status !== "stopped")
      .sort(
        (a, b) =>
          FORM_TRIGGER_ORDER.indexOf(a.trigger) -
          FORM_TRIGGER_ORDER.indexOf(b.trigger),
      );
    if (rules.length === 0) {
      rows.unsent.push({
        ...base,
        key: form.id,
        scheduleId: null,
        subtitle: plural(questionCount(form), "question"),
      });
      continue;
    }
    for (const rule of rules) {
      rows[sectionFor(rule.trigger)].push({
        ...base,
        key: `${form.id}:${rule.id}`,
        scheduleId: rule.id,
        subtitle: scheduleSubtitle(form, rule, s?.reached ?? null, now),
      });
    }
  }
  const order: LibrarySectionKey[] = [
    "on_join",
    "repeating",
    "once",
    "on_end",
    "unsent",
  ];
  return order
    .filter((k) => k === "on_join" || k === "repeating" || rows[k].length > 0)
    .map((key) => ({
      key,
      title: SECTION_TITLES[key],
      addable: key === "on_join" || key === "repeating",
      rows: rows[key],
    }));
}

const FORM_TRIGGER_ORDER: FormTrigger[] = [
  "weekly",
  "daily",
  "once",
  "on_join",
  "on_end",
];

// ── Answers ──────────────────────────────────────────────────────────────────

const numberFormat = new Intl.NumberFormat("en-GB", {
  maximumFractionDigits: 2,
});

function formatNumber(value: number, unit?: string): string {
  const n = numberFormat.format(value);
  if (!unit) return n;
  return `${n} ${unit}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The numeric value of a number/scale answer, else null. */
export function numericAnswer(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (isRecord(raw) && typeof raw.value === "number") return raw.value;
  return null;
}

/**
 * One answer as the coach reads it (BRIEF): scale "4 / 5", number value +
 * unit, yes/no "Yes"/"No" (+ details), choices joined, photo "Photo".
 */
export function formatAnswer(question: Question, raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return "—";
  switch (question.type) {
    case "scale": {
      const n = numericAnswer(raw);
      return n === null ? "—" : `${n} / 5`;
    }
    case "number": {
      const n = numericAnswer(raw);
      return n === null ? "—" : formatNumber(n, question.unit);
    }
    case "yes_no": {
      const value = isRecord(raw) ? raw.value : raw;
      if (typeof value !== "boolean") return "—";
      const details =
        isRecord(raw) && typeof raw.details === "string"
          ? raw.details.trim()
          : "";
      if (!value) return "No";
      return details ? `Yes · ${details}` : "Yes";
    }
    case "single_choice":
    case "multiple_choice":
      if (Array.isArray(raw)) return raw.map(String).join(", ") || "—";
      return String(raw);
    case "photo":
      return "Photo";
    case "short_text":
      return typeof raw === "string" ? `“${raw}”` : "—";
    case "long_text":
      return typeof raw === "string" ? raw : "—";
  }
}

/** "↑" / "↓" for a number or scale that changed, else "". */
export function trendArrow(
  question: Question,
  latest: unknown,
  previous: unknown,
): "↑" | "↓" | "" {
  if (question.type !== "number" && question.type !== "scale") return "";
  const a = numericAnswer(latest);
  const b = numericAnswer(previous);
  if (a === null || b === null || a === b) return "";
  return a > b ? "↑" : "↓";
}

export function answerCount(response: FormResponse): number {
  return Object.values(response.answers).filter(
    (v) => v !== undefined && v !== null && v !== "",
  ).length;
}

/** The response before this one, for the same form. */
export function previousResponse(
  responses: readonly FormResponse[],
  response: FormResponse,
): FormResponse | null {
  return (
    responses
      .filter(
        (r) =>
          r.formId === response.formId &&
          r.id !== response.id &&
          r.submittedAt < response.submittedAt,
      )
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0] ?? null
  );
}

function shortLabel(prompt: string): string {
  return prompt.split(/[\s,]+/)[0] ?? prompt;
}

/**
 * C3.3b New card line: "Energy 4/5 ↑ · sleep 6.5 h ↓ · weight 82.4 kg".
 * The first three number/scale answers; otherwise the answer count.
 */
export function responseSummary(
  response: FormResponse,
  previous: FormResponse | null,
): string {
  const parts: string[] = [];
  for (const q of response.version.questions) {
    if (parts.length === 3) break;
    if (q.type !== "number" && q.type !== "scale") continue;
    const n = numericAnswer(response.answers[q.id]);
    if (n === null) continue;
    const value = q.type === "scale" ? `${n}/5` : formatNumber(n, q.unit);
    const prevQuestion = previous?.version.questions.find((p) => p.id === q.id);
    const arrow = prevQuestion
      ? trendArrow(q, response.answers[q.id], previous!.answers[q.id])
      : "";
    const label =
      parts.length === 0
        ? shortLabel(q.prompt)
        : shortLabel(q.prompt).toLowerCase();
    parts.push([label, value, arrow].filter(Boolean).join(" "));
  }
  return parts.length > 0
    ? parts.join(" · ")
    : plural(answerCount(response), "answer");
}

export type CompareRow = {
  id: string;
  prompt: string;
  latest: string;
  previous: string | null;
  arrow: "↑" | "↓" | "";
};

/** C3.3 compare table: this response against an earlier one. */
export function compareRows(
  response: FormResponse,
  previous: FormResponse | null,
): CompareRow[] {
  return response.version.questions.map((q) => {
    const prevQ = previous?.version.questions.find((p) => p.id === q.id);
    return {
      id: q.id,
      prompt: q.prompt,
      latest: formatAnswer(q, response.answers[q.id]),
      previous:
        previous === null
          ? null
          : prevQ
            ? formatAnswer(prevQ, previous.answers[q.id])
            : "—",
      arrow: prevQ
        ? trendArrow(q, response.answers[q.id], previous!.answers[q.id])
        : "",
    };
  });
}

// ── C3.3b Check-ins rows ─────────────────────────────────────────────────────

export type HistoryRow = {
  id: string;
  title: string;
  subtitle: string;
  toReview: boolean;
};

/** "Weekly · Sun 26 Oct", or "New client form · 4 Aug" for one-off forms. */
export function historyTitle(response: FormResponse, now = new Date()): string {
  if (response.trigger === "weekly") {
    return `Weekly · ${shortDate(response.submittedAt, now)}`;
  }
  if (response.trigger === "daily") {
    return `Daily · ${shortDate(response.submittedAt, now)}`;
  }
  return `${response.title} · ${dayMonth(response.submittedAt, now)}`;
}

export function historyRows(
  responses: readonly FormResponse[],
  now = new Date(),
): HistoryRow[] {
  return responses.map((r) => ({
    id: r.id,
    title: historyTitle(r, now),
    subtitle:
      r.reviewedAt === null
        ? `New · ${plural(answerCount(r), "answer")}`
        : r.replyText
          ? "Reviewed · you replied"
          : "Reviewed",
    toReview: r.reviewedAt === null,
  }));
}

export type SentToRow = {
  formId: string;
  title: string;
  subtitle: string;
  pill: { tone: "done" | "waiting" | "paused"; text: string };
};

/** "Sun 09:00", "Daily 08:00", "Once · sent Mon 27 Oct", … */
export function clientRuleSubtitle(form: ClientForm, now = new Date()): string {
  if (!form.rule) {
    return form.lastSentAt ? `Sent ${shortDate(form.lastSentAt, now)}` : "";
  }
  const rule = effectiveRule(form.rule);
  switch (rule.trigger) {
    case "weekly":
      return `${rule.weekday ? WEEKDAYS_SHORT[rule.weekday - 1] : ""} ${
        rule.timeLocal ?? ""
      }`.trim();
    case "daily":
      return `Daily ${rule.timeLocal ?? ""}`.trim();
    case "once":
      return form.lastSentAt
        ? `Once · sent ${shortDate(form.lastSentAt, now)}`
        : "Once";
    case "on_join":
      return "When they join";
    case "on_end":
      return "When coaching ends";
  }
}

export function sentToRows(
  forms: readonly ClientForm[],
  now = new Date(),
): SentToRow[] {
  return forms.map((f) => ({
    formId: f.form.id,
    title: f.form.title,
    subtitle: clientRuleSubtitle(f, now),
    pill:
      f.state === "paused"
        ? { tone: "paused", text: "Paused" }
        : f.state === "done" && f.lastDoneAt
          ? { tone: "done", text: `Last done ${shortDate(f.lastDoneAt, now)}` }
          : { tone: "waiting", text: "Not done yet" },
  }));
}

// ── C10b editor ──────────────────────────────────────────────────────────────

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  short_text: "Short text",
  long_text: "Long text",
  number: "Number",
  scale: "Scale 1–5",
  single_choice: "Single choice",
  multiple_choice: "Multiple choice",
  photo: "Photo",
  yes_no: "Yes / no",
};

export const PREFILL_LABELS: Record<PrefillSource, string> = {
  sessions_done: "Sessions done · from Train",
  meal_plan_followed: "Meal plan followed · from Fuel",
  steps: "Steps · from Health",
  weight: "Weight · from Body",
  progress_photos: "Progress photos · from Photos",
};

const PREFILL_FROM: Record<PrefillSource, string> = {
  sessions_done: "Filled from Train",
  meal_plan_followed: "Filled from Fuel",
  steps: "Filled from Health",
  weight: "Filled from Body",
  progress_photos: "Filled from Photos",
};

/** "Filled for them" sources that fit a question type. */
export function prefillSourcesFor(type: QuestionType): PrefillSource[] {
  return (Object.keys(PREFILL_SOURCES) as PrefillSource[]).filter(
    (s) => PREFILL_SOURCES[s] === type,
  );
}

/** C10b question row subtitle: "Number · hours", "Yes / no · details if yes". */
export function questionSubtitle(q: Question): string {
  if (q.prefill) return PREFILL_FROM[q.prefill];
  const parts: string[] = [QUESTION_TYPE_LABELS[q.type]];
  if (q.type === "number" && q.unit) parts.push(q.unit);
  if (q.type === "yes_no" && q.detailsIfYes) parts.push("details if yes");
  if (
    (q.type === "single_choice" || q.type === "multiple_choice") &&
    q.options
  ) {
    parts.push(plural(q.options.length, "option"));
  }
  return parts.join(" · ");
}

function newId(): string {
  return `q_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function newQuestion(type: QuestionType = "short_text"): Question {
  return retypeQuestion(
    { id: newId(), type, prompt: "", required: true },
    type,
  );
}

/**
 * Change a question's answer type, dropping what the new type can't carry
 * (the server rejects options on a number, a unit on a scale, …).
 */
export function retypeQuestion(q: Question, type: QuestionType): Question {
  const next: Question = {
    id: q.id,
    type,
    prompt: q.prompt,
    required: q.required,
  };
  if (q.help) next.help = q.help;
  if (type === "single_choice" || type === "multiple_choice") {
    next.options = q.options ? [...q.options] : ["Option 1", "Option 2"];
  }
  if (type === "number") {
    if (q.min !== undefined) next.min = q.min;
    if (q.max !== undefined) next.max = q.max;
    if (q.unit) next.unit = q.unit;
  }
  if (type === "yes_no" && q.detailsIfYes) next.detailsIfYes = true;
  if (q.prefill && PREFILL_SOURCES[q.prefill] === type) {
    next.prefill = q.prefill;
  }
  return next;
}

export function duplicateQuestion(q: Question): Question {
  return {
    ...q,
    id: newId(),
    ...(q.options ? { options: [...q.options] } : {}),
  };
}

/** Move a question up (-1) or down (+1); out of range is a no-op. */
export function moveQuestion(
  questions: readonly Question[],
  index: number,
  dir: -1 | 1,
): Question[] {
  const to = index + dir;
  if (index < 0 || index >= questions.length) return [...questions];
  if (to < 0 || to >= questions.length) return [...questions];
  const next = [...questions];
  const [q] = next.splice(index, 1);
  next.splice(to, 0, q!);
  return next;
}

/** The question as the server wants it: trimmed, no empty extras. */
export function cleanQuestion(q: Question): Question {
  const base = retypeQuestion(q, q.type);
  const out: Question = { ...base, prompt: base.prompt.trim() };
  const help = base.help?.trim();
  if (help) out.help = help;
  else delete out.help;
  if (out.options) out.options = out.options.map((o) => o.trim());
  if (out.unit !== undefined) {
    const unit = out.unit.trim();
    if (unit) out.unit = unit;
    else delete out.unit;
  }
  return out;
}

/** The first thing stopping a save, in the coach's words; null when fine. */
export function draftProblem(draft: FormDraft): string | null {
  const title = draft.title.trim();
  if (!title) return "Give the form a title.";
  if (title.length > TITLE_MAX)
    return `Keep the title to ${TITLE_MAX} characters.`;
  if (draft.questions.length === 0) return "Add at least one question.";
  if (draft.questions.length > MAX_QUESTIONS) {
    return `A form can have up to ${MAX_QUESTIONS} questions.`;
  }
  for (const [i, raw] of draft.questions.entries()) {
    const q = cleanQuestion(raw);
    const n = i + 1;
    if (!q.prompt) return `Question ${n} needs a question.`;
    if (q.prompt.length > MAX_PROMPT) {
      return `Question ${n} is over ${MAX_PROMPT} characters.`;
    }
    if ((q.help?.length ?? 0) > MAX_HELP) {
      return `Question ${n}'s help text is over ${MAX_HELP} characters.`;
    }
    if (q.options) {
      if (q.options.length < MIN_OPTIONS || q.options.length > MAX_OPTIONS) {
        return `Question ${n} needs ${MIN_OPTIONS}–${MAX_OPTIONS} options.`;
      }
      if (q.options.some((o) => !o))
        return `Question ${n} has an empty option.`;
      if (new Set(q.options).size !== q.options.length) {
        return `Question ${n} has the same option twice.`;
      }
    }
    if (q.min !== undefined && q.max !== undefined && q.min > q.max) {
      return `Question ${n}: the lowest value is above the highest.`;
    }
    if ((q.unit?.length ?? 0) > MAX_UNIT) {
      return `Question ${n}'s unit is over ${MAX_UNIT} characters.`;
    }
  }
  return null;
}
