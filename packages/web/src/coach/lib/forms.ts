import type {
  ClientFormRule,
  CoachForm,
  FormQuestion,
  FormResponse,
  FormSchedule,
  FormStats,
  PrefillSource,
  QuestionType,
  RuleOverride,
} from "../api/types";
import {
  WEEKDAY_ABBR,
  WEEKDAY_LONG,
  dueLabel,
  effectiveRule,
  pointAfter,
  reminderLabel,
  type EffectiveRule,
} from "./schedule";

/**
 * Pure rules for the forms library, editor, send panel and Check-ins tab
 * (PER-129, canvas C10a–c, C10j, C3.3). The backend contract is
 * `coaching/forms` (questions.ts, scheduleRepository.ts, statsRepository.ts).
 */

/** 409 on a form or a send rule (ticket copy). */
export const EDITED_ELSEWHERE =
  "Edited on another device. You're seeing the latest.";

// ─── Questions (C10b) ────────────────────────────────────────────────────────

export const QUESTION_TYPES: { type: QuestionType; label: string }[] = [
  { type: "short_text", label: "Short text" },
  { type: "long_text", label: "Long text" },
  { type: "number", label: "Number" },
  { type: "scale", label: "Scale 1–5" },
  { type: "single_choice", label: "Single choice" },
  { type: "multiple_choice", label: "Multiple choice" },
  { type: "photo", label: "Photo" },
  { type: "yes_no", label: "Yes / no" },
];

export const MAX_QUESTIONS = 40;
export const MAX_PROMPT = 300;
export const MAX_HELP = 300;
export const MAX_OPTIONS = 12;
export const MAX_TITLE = 120;

export const PREFILL: Record<
  PrefillSource,
  { label: string; from: string; type: QuestionType; saves?: string }
> = {
  sessions_done: { label: "Sessions done", from: "Train", type: "number" },
  meal_plan_followed: {
    label: "Meal plan followed",
    from: "Fuel",
    type: "number",
  },
  steps: { label: "Steps, average", from: "Health", type: "number" },
  weight: { label: "Weight", from: "Body", type: "number", saves: "Body" },
  progress_photos: {
    label: "Progress photos",
    from: "Photos",
    type: "photo",
    saves: "Photos",
  },
};

export function typeLabel(type: QuestionType): string {
  return QUESTION_TYPES.find((t) => t.type === type)?.label ?? type;
}

/** The grey line under a question in the list: "Number · kg · saves to Body". */
export function questionLine(q: FormQuestion): string {
  if (q.prefill && q.prefill !== "weight" && q.prefill !== "progress_photos") {
    return `Filled from ${PREFILL[q.prefill].from}`;
  }
  const parts: string[] = [typeLabel(q.type)];
  if (q.type === "number" && q.unit) parts.push(q.unit);
  if (q.type === "yes_no" && q.detailsIfYes) parts.push("details if yes");
  if (
    (q.type === "single_choice" || q.type === "multiple_choice") &&
    q.options
  ) {
    parts.push(`${q.options.length} options`);
  }
  if (q.prefill && PREFILL[q.prefill].saves) {
    parts.push(`saves to ${PREFILL[q.prefill].saves}`);
  }
  return parts.join(" · ");
}

let counter = 0;
/** A question id the backend accepts (`[A-Za-z0-9_-]{1,64}`), unique in a form. */
export function newQuestionId(taken: Iterable<string>): string {
  const used = new Set(taken);
  for (;;) {
    counter += 1;
    const id = `q${Date.now().toString(36)}${counter.toString(36)}`;
    if (!used.has(id)) return id;
  }
}

export function newQuestion(
  taken: Iterable<string>,
  type: QuestionType = "short_text",
): FormQuestion {
  return withType(
    { id: newQuestionId(taken), type, prompt: "", required: false },
    type,
  );
}

/** Switch a question's type, keeping only the fields that type takes. */
export function withType(q: FormQuestion, type: QuestionType): FormQuestion {
  const next: FormQuestion = {
    id: q.id,
    type,
    prompt: q.prompt,
    required: q.required,
  };
  if (q.help) next.help = q.help;
  if (type === "single_choice" || type === "multiple_choice") {
    next.options =
      q.options && q.options.length >= 2 ? q.options : ["Option 1", "Option 2"];
  }
  if (type === "number") {
    if (q.min !== undefined) next.min = q.min;
    if (q.max !== undefined) next.max = q.max;
    if (q.unit) next.unit = q.unit;
  }
  if (type === "yes_no" && q.detailsIfYes) next.detailsIfYes = true;
  if (q.prefill && PREFILL[q.prefill].type === type) next.prefill = q.prefill;
  return next;
}

/** Prefill sources that fit this type ("Filled for them"). */
export function prefillFor(type: QuestionType): PrefillSource[] {
  return (Object.keys(PREFILL) as PrefillSource[]).filter(
    (k) => PREFILL[k].type === type,
  );
}

/** What the server would refuse, said in words, per question index. */
export function questionProblems(
  questions: FormQuestion[],
): Map<number, string> {
  const out = new Map<number, string>();
  questions.forEach((q, i) => {
    const prompt = q.prompt.trim();
    if (!prompt) out.set(i, "Write the question.");
    else if (prompt.length > MAX_PROMPT) {
      out.set(i, `Keep the question under ${MAX_PROMPT} characters.`);
    } else if ((q.help ?? "").trim().length > MAX_HELP) {
      out.set(i, `Keep the help text under ${MAX_HELP} characters.`);
    } else if (q.type === "single_choice" || q.type === "multiple_choice") {
      const opts = (q.options ?? []).map((o) => o.trim());
      if (opts.length < 2 || opts.length > MAX_OPTIONS) {
        out.set(i, `Give 2 to ${MAX_OPTIONS} options.`);
      } else if (opts.some((o) => !o)) out.set(i, "Fill in every option.");
      else if (new Set(opts).size !== opts.length) {
        out.set(i, "Options must be different.");
      }
    } else if (
      q.type === "number" &&
      q.min !== undefined &&
      q.max !== undefined &&
      q.min > q.max
    ) {
      out.set(i, "The lowest number must not be above the highest.");
    }
  });
  return out;
}

/** Trimmed questions in the shape the API stores. */
export function cleanQuestions(questions: FormQuestion[]): FormQuestion[] {
  return questions.map((q) => {
    const c: FormQuestion = { ...q, prompt: q.prompt.trim() };
    const help = (q.help ?? "").trim();
    if (help) c.help = help;
    else delete c.help;
    if (c.options) c.options = c.options.map((o) => o.trim());
    if (c.unit !== undefined && !c.unit.trim()) delete c.unit;
    if (!c.detailsIfYes) delete c.detailsIfYes;
    if (!c.prefill) delete c.prefill;
    return c;
  });
}

export function sameQuestions(a: FormQuestion[], b: FormQuestion[]): boolean {
  return (
    JSON.stringify(cleanQuestions(a)) === JSON.stringify(cleanQuestions(b))
  );
}

// ─── Library grouping (C10a, C10g) ───────────────────────────────────────────

export type LibraryGroup = "on_join" | "repeating" | "once" | "on_end" | "none";

export const GROUP_TITLES: Record<LibraryGroup, string> = {
  on_join: "Starter forms",
  repeating: "Repeating",
  once: "Once",
  on_end: "When coaching ends",
  none: "Not sent yet",
};

export interface LibraryRow {
  form: CoachForm;
  /** The form's live rules (not stopped), most important first. */
  schedules: FormSchedule[];
  group: LibraryGroup;
}

const GROUP_OF: Record<string, LibraryGroup> = {
  on_join: "on_join",
  weekly: "repeating",
  daily: "repeating",
  once: "once",
  on_end: "on_end",
};
const RANK: Record<string, number> = {
  weekly: 0,
  daily: 1,
  once: 2,
  on_join: 3,
  on_end: 4,
};

export function liveSchedules(
  schedules: FormSchedule[] | undefined,
): FormSchedule[] {
  return (schedules ?? []).filter((s) => s.status !== "stopped");
}

/** Forms grouped by when they go out; a form goes where its main rule is. */
export function groupLibrary(
  forms: CoachForm[],
  schedules: FormSchedule[] | undefined,
): Record<LibraryGroup, LibraryRow[]> {
  const live = liveSchedules(schedules);
  const out: Record<LibraryGroup, LibraryRow[]> = {
    on_join: [],
    repeating: [],
    once: [],
    on_end: [],
    none: [],
  };
  for (const form of forms) {
    if (form.archivedAt) continue;
    const mine = live
      .filter((s) => s.formId === form.id)
      .sort((a, b) => (RANK[a.trigger] ?? 9) - (RANK[b.trigger] ?? 9));
    const group = mine[0] ? (GROUP_OF[mine[0].trigger] ?? "none") : "none";
    out[group].push({ form, schedules: mine, group });
  }
  return out;
}

export function questionCount(form: CoachForm): number {
  return form.version?.questions.length ?? 0;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function reachLabel(s: FormSchedule): string {
  if (s.audience === "all_clients") return "all clients";
  const n = (s.clients ?? []).filter((c) => c.status === "active").length;
  return plural(n, "client");
}

/** "Weekly · Sun 09:00 · 11 clients · 2 reminders" (C10a row). */
export function rowLine(row: LibraryRow, sentAt?: string | null): string {
  const s = row.schedules[0];
  if (!s) return plural(questionCount(row.form), "question");
  if (s.trigger === "weekly" || s.trigger === "daily") {
    const r = effectiveRule(s, null);
    const when =
      s.trigger === "weekly" && r.weekday && r.timeLocal
        ? `Weekly · ${WEEKDAY_ABBR[r.weekday - 1]} ${r.timeLocal}`
        : `Daily · ${r.timeLocal ?? ""}`;
    const rem = s.reminders.length
      ? plural(s.reminders.length, "reminder")
      : null;
    return [when, reachLabel(s), rem].filter(Boolean).join(" · ");
  }
  if (s.trigger === "once") {
    return [sentAt ? `Sent ${shortDate(sentAt)}` : "Once", reachLabel(s)].join(
      " · ",
    );
  }
  return `${plural(questionCount(row.form), "question")} · ${reachLabel(s)}`;
}

/** "8 of 11 this week", "2 of 3 today", "13 of 14 done", or "—". */
export function doneLabel(
  row: LibraryRow,
  stats: FormStats["forms"][number] | undefined,
): string {
  if (!stats || stats.reached === 0) return "—";
  const s = row.schedules[0];
  const when =
    s?.trigger === "weekly"
      ? "this week"
      : s?.trigger === "daily"
        ? "today"
        : "done";
  return `${stats.done} of ${stats.reached} ${when}`;
}

/** "11 clients, and new clients" (C10a Schedule → Who). */
export function whoLabel(s: FormSchedule): string {
  if (s.audience === "all_clients") return "All clients, and new clients";
  return reachLabel(s).replace(/^./, (c) => c.toUpperCase());
}

/** "Weekly, Sunday 09:00" (C10a Schedule → Sent). */
export function sentLabel(s: FormSchedule): string {
  if (s.trigger === "weekly" && s.weekday && s.timeLocal) {
    return `Weekly, ${WEEKDAY_LONG[s.weekday - 1]} ${s.timeLocal}`;
  }
  if (s.trigger === "daily" && s.timeLocal) return `Daily, ${s.timeLocal}`;
  return TRIGGER_LABELS[s.trigger] ?? s.trigger;
}

// ─── Send rule (C10c, C10j) ──────────────────────────────────────────────────

export const TRIGGER_LABELS: Record<string, string> = {
  on_join: "When they join",
  once: "Once",
  weekly: "Weekly",
  daily: "Daily",
  on_end: "When coaching ends",
};
export const SEND_TRIGGERS = ["on_join", "once", "weekly", "daily", "on_end"];

/** After-the-send choices for forms without a send time (join, once, end). */
export const AFTER_CHOICES = [6, 12, 24, 48, 72, 168];

export function afterLabel(hours: number): string {
  if (hours % 24 === 0) {
    const d = hours / 24;
    return d === 7
      ? "1 week after it's sent"
      : `${plural(d, "day")} after it's sent`;
  }
  return `${plural(hours, "hour")} after it's sent`;
}

export function isTimed(trigger: string): boolean {
  return trigger === "weekly" || trigger === "daily";
}

/** Due and reminders in words: "Monday 12:00" or "1 day after it's sent". */
export function dueWords(rule: EffectiveRule): string | null {
  if (rule.dueAfterHours === null) return null;
  if (!isTimed(rule.trigger)) return afterLabel(rule.dueAfterHours);
  const p = pointAfter(rule, rule.dueAfterHours);
  if (!p) return null;
  return p.weekday === null
    ? nextDayWords(rule, rule.dueAfterHours, p.time)
    : `${WEEKDAY_LONG[p.weekday - 1]} ${p.time}`;
}

function nextDayWords(rule: EffectiveRule, hours: number, time: string) {
  const start = Number((rule.timeLocal ?? "00:00").slice(0, 2)) * 60;
  const days = Math.floor((start + hours * 60) / 1440);
  return days === 0
    ? `Same day at ${time}`
    : days === 1
      ? `Next day at ${time}`
      : `${days} days later at ${time}`;
}

export function reminderWords(rule: EffectiveRule, afterHours: number): string {
  if (!isTimed(rule.trigger)) return afterLabel(afterHours);
  if (rule.trigger === "daily") {
    const p = pointAfter(rule, afterHours);
    return p ? nextDayWords(rule, afterHours, p.time) : "";
  }
  return reminderLabel(rule, afterHours) ?? "";
}

function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * C10c summary: "5 clients get it every Sunday at 09:00, due Monday 12:00,
 * with reminders Sunday 18:00 and Monday 09:00 if it's not done."
 */
export function sendSentence(
  rule: EffectiveRule,
  who: { all: boolean; count: number },
): string {
  const subject = who.all
    ? "All your clients get it"
    : `${plural(who.count, "client")} ${who.count === 1 ? "gets" : "get"} it`;
  const when =
    rule.trigger === "weekly" && rule.weekday && rule.timeLocal
      ? `every ${WEEKDAY_LONG[rule.weekday - 1]} at ${rule.timeLocal}`
      : rule.trigger === "daily" && rule.timeLocal
        ? `every day at ${rule.timeLocal}`
        : rule.trigger === "on_join"
          ? "when they join"
          : rule.trigger === "on_end"
            ? "when coaching ends"
            : "once, straight away";
  const due = dueWords(rule);
  const reminders = rule.reminders.map((r) =>
    reminderWords(rule, r.afterHours),
  );
  let text = `${subject} ${when}`;
  if (due)
    text += `, due ${isTimed(rule.trigger) ? due : due.replace(" after it's sent", " after")}`;
  if (reminders.length) {
    text += `, with ${reminders.length === 1 ? "a reminder" : "reminders"} ${joinAnd(reminders)} if it's not done`;
  }
  return `${text}.`;
}

/** The rule fields the API takes for this trigger, nothing else. */
export function ruleBody(rule: EffectiveRule): {
  weekday: number | null;
  timeLocal: string | null;
  dueAfterHours: number | null;
  reminders: { afterHours: number }[];
} {
  return {
    weekday: rule.trigger === "weekly" ? rule.weekday : null,
    timeLocal: isTimed(rule.trigger) ? rule.timeLocal : null,
    dueAfterHours: rule.dueAfterHours,
    reminders: rule.reminders,
  };
}

/** Switching "When": keep what still applies, fill what's now needed. */
export function withTrigger(
  rule: EffectiveRule,
  trigger: string,
): EffectiveRule {
  const next: EffectiveRule = { ...rule, trigger };
  if (trigger === "weekly") {
    next.weekday = rule.weekday ?? 7;
    next.timeLocal = rule.timeLocal ?? "09:00";
  } else if (trigger === "daily") {
    next.weekday = null;
    next.timeLocal = rule.timeLocal ?? "08:00";
  } else {
    next.weekday = null;
    next.timeLocal = null;
  }
  return next;
}

/** C10c defaults: weekly Sunday 09:00, due Monday 12:00, one reminder 18:00. */
export function defaultRule(trigger = "weekly"): EffectiveRule {
  return withTrigger(
    {
      trigger,
      weekday: null,
      timeLocal: null,
      dueAfterHours: trigger === "weekly" ? 27 : null,
      reminders: trigger === "weekly" ? [{ afterHours: 9 }] : [],
    },
    trigger,
  );
}

export function ruleOf(s: FormSchedule): EffectiveRule {
  return effectiveRule(s, null);
}

// ─── Dates ───────────────────────────────────────────────────────────────────

/** "Sun 26 Oct". */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${WEEKDAY_ABBR[(d.getDay() + 6) % 7]} ${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })}`;
}

/** "Sun 10:14". */
export function dayTime(iso: string): string {
  const d = new Date(iso);
  return `${WEEKDAY_ABBR[(d.getDay() + 6) % 7]} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** The next local time a weekly or daily rule sends, as "Sun 2 Nov". */
export function nextSend(
  rule: { trigger: string; weekday: number | null; timeLocal: string | null },
  now = new Date(),
): string | null {
  if (!rule.timeLocal) return null;
  const [h, m] = rule.timeLocal.split(":").map(Number);
  const at = new Date(now);
  at.setHours(h ?? 0, m ?? 0, 0, 0);
  if (rule.trigger === "weekly" && rule.weekday) {
    const today = (now.getDay() + 6) % 7; // 0 = Mon
    let add = (rule.weekday - 1 - today + 7) % 7;
    if (add === 0 && at <= now) add = 7;
    at.setDate(at.getDate() + add);
  } else if (rule.trigger === "daily") {
    if (at <= now) at.setDate(at.getDate() + 1);
  } else {
    return null;
  }
  return shortDate(at.toISOString());
}

// ─── Responses (C3.3) ────────────────────────────────────────────────────────

const KIND: Record<string, string> = {
  weekly: "Weekly",
  daily: "Daily",
};

/** History row title: "Weekly · Sun 26 Oct" or "New client form · 4 Aug". */
export function responseTitle(r: FormResponse): string {
  const kind = KIND[r.trigger];
  return `${kind ?? r.title} · ${shortDate(r.submittedAt)}`;
}

/** History row line: "New · 12 answers", "Reviewed · you replied". */
export function responseLine(r: FormResponse): string {
  if (!r.reviewedAt) {
    return `New · ${plural(Object.keys(r.answers).length, "answer")}`;
  }
  return r.replyText ? "Reviewed · you replied" : "Reviewed";
}

/** An answer as the coach reads it. Unanswered → "". */
export function formatAnswer(q: FormQuestion, value: unknown): string {
  if (value === undefined || value === null) return "";
  switch (q.type) {
    case "scale":
      return `${String(value)} / 5`;
    case "number": {
      const n =
        typeof value === "number"
          ? value.toLocaleString("en-GB")
          : String(value);
      return q.unit ? `${n} ${q.unit}` : n;
    }
    case "yes_no": {
      if (typeof value === "object") {
        const v = value as { value?: boolean; details?: string };
        return v.details
          ? `${v.value ? "Yes" : "No"}: ${v.details}`
          : v.value
            ? "Yes"
            : "No";
      }
      return value ? "Yes" : "No";
    }
    case "multiple_choice":
      return Array.isArray(value) ? value.join(", ") : String(value);
    case "short_text":
    case "long_text":
      return `“${String(value)}”`;
    case "photo":
      return "Photo";
    default:
      return String(value);
  }
}

/** Number and scale answers: up, down or the same as the earlier one. */
export function trend(
  q: FormQuestion,
  now: unknown,
  before: unknown,
): "up" | "down" | null {
  if (q.type !== "number" && q.type !== "scale") return null;
  if (typeof now !== "number" || typeof before !== "number") return null;
  return now > before ? "up" : now < before ? "down" : null;
}

/** Rows for the compare grid: the latest version's questions, in order. */
export function compareRows(
  latest: FormResponse,
  earlier: FormResponse | null,
): {
  q: FormQuestion;
  now: string;
  before: string;
  trend: "up" | "down" | null;
}[] {
  return latest.version.questions.map((q) => {
    const prev = earlier?.version.questions.find((p) => p.id === q.id);
    const nowValue = latest.answers[q.id];
    const beforeValue = prev ? earlier!.answers[q.id] : undefined;
    return {
      q,
      now: formatAnswer(q, nowValue),
      before: prev ? formatAnswer(prev, beforeValue) : "",
      trend: prev ? trend(q, nowValue, beforeValue) : null,
    };
  });
}

/** Used by the Check-ins tab's "Last done Sun 26 Oct" pill. */
export function statusPill(
  state: string,
  lastDoneAt: string | null,
): {
  tone: "done" | "todo" | "paused";
  text: string;
} {
  if (state === "paused") return { tone: "paused", text: "Paused" };
  if (lastDoneAt)
    return { tone: "done", text: `Last done ${shortDate(lastDoneAt)}` };
  return { tone: "todo", text: "Not done yet" };
}

/** "Every Sun 09:00 · due Mon 12:00" / "Once · sent Mon 27 Oct". */
export function entryLine(
  rule: EffectiveRule | null,
  lastSentAt: string | null,
): string {
  if (!rule) return lastSentAt ? `Sent ${shortDate(lastSentAt)}` : "";
  if (rule.trigger === "weekly" && rule.weekday && rule.timeLocal) {
    const due = dueLabel(rule);
    return [
      `Every ${WEEKDAY_ABBR[rule.weekday - 1]} ${rule.timeLocal}`,
      due ? `due ${due}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (rule.trigger === "daily" && rule.timeLocal) {
    return `Daily ${rule.timeLocal}`;
  }
  const label = TRIGGER_LABELS[rule.trigger] ?? rule.trigger;
  return lastSentAt ? `${label} · sent ${shortDate(lastSentAt)}` : label;
}

// ─── One client (C10j) ───────────────────────────────────────────────────────

/** This client's rule: the send rule with their override on top. */
export function clientRule(rule: ClientFormRule): EffectiveRule {
  const o = rule.override ?? {};
  return {
    trigger: o.trigger ?? rule.trigger,
    weekday: o.weekday !== undefined ? o.weekday : rule.weekday,
    timeLocal: o.timeLocal !== undefined ? o.timeLocal : rule.timeLocal,
    dueAfterHours:
      o.dueAfterHours !== undefined ? o.dueAfterHours : rule.dueAfterHours,
    reminders: o.reminders ?? rule.reminders ?? [],
  };
}

/** Only what differs from the send rule; null when it's the same rule. */
export function clientOverride(
  rule: ClientFormRule,
  draft: EffectiveRule,
): RuleOverride | null {
  const o: RuleOverride = {};
  if (draft.trigger !== rule.trigger) {
    o.trigger = draft.trigger as RuleOverride["trigger"];
  }
  const body = ruleBody(draft);
  if (body.weekday !== rule.weekday) o.weekday = body.weekday;
  if (body.timeLocal !== rule.timeLocal) o.timeLocal = body.timeLocal;
  if (body.dueAfterHours !== rule.dueAfterHours) {
    o.dueAfterHours = body.dueAfterHours;
  }
  const same =
    body.reminders.length === rule.reminders.length &&
    body.reminders.every(
      (r, i) => r.afterHours === rule.reminders[i]?.afterHours,
    );
  if (!same) o.reminders = body.reminders;
  return Object.keys(o).length === 0 ? null : o;
}

/** The "When" choices for one client: a join or exit form stays as it is. */
export function clientTriggers(rule: ClientFormRule): string[] {
  return ["once", "weekly", "daily"].includes(rule.trigger)
    ? ["once", "weekly", "daily"]
    : [rule.trigger];
}
