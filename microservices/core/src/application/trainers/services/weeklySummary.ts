import { addDays, type LocalDate } from "../../adherence/computeAdherence";
import type {
  AdherenceReport,
  TrainingState,
} from "../../adherence/computeAdherence";
import type { WeekOfProgramme } from "../../programs/scheduling";

/**
 * The AI weekly summary by area (PER-115, Linear "Backend design B —
 * Adherence and the AI weekly summary", D4). Pure: the first-week rule, the
 * evidence shapes the model is given, and the strict output parser. No
 * database and no clock.
 *
 * Evidence is the adherence report (tracked areas only), the programme week,
 * the latest form responses and plan meals logged. Never photos (Brad, 20 Nov)
 * and never the coach's private notes. It is kept small on purpose (Brad,
 * 26 Nov: keep AI calls efficient): counts, not per-day lists or food rows.
 */

/**
 * The parts of a coach-form question (PER-116 `Question`) the evidence reads.
 * Declared here rather than imported: the forms modules also handle photo
 * answers, and no module on an AI path may import photo code (PER-121,
 * design F test 6 — `media/__tests__/noAiPhotos.test.ts`).
 */
export interface EvidenceQuestion {
  id: string;
  type: string;
  prompt: string;
  max?: number;
  unit?: string;
}

/** PER-116 scales run 1–5 unless the question sets its own max. */
const SCALE_MAX = 5;

// ─── First week ──────────────────────────────────────────────────────────────

/**
 * The first summary is due on the Monday after the client's first complete
 * Monday-to-Sunday week that starts on or after the coaching start date.
 * Activated on a Monday → that week counts, so the first summary is 7 days
 * later. Any other day → the week starts the following Monday.
 * null start (relationships from before `activated_at`) → no first-week wait.
 */
export function firstSummaryOn(
  coachingStart: LocalDate | null,
): LocalDate | null {
  if (coachingStart === null) return null;
  const dow = new Date(`${coachingStart}T00:00:00.000Z`).getUTCDay(); // 0 = Sun
  const toMonday = dow === 1 ? 0 : (8 - dow) % 7;
  return addDays(coachingStart, toMonday + 7);
}

/** True while the client is still before their first summary day. */
export function isFirstWeek(today: LocalDate, due: LocalDate | null): boolean {
  return due !== null && today < due;
}

// ─── Evidence ────────────────────────────────────────────────────────────────

export const SUMMARY_AREAS = [
  "training",
  "calories",
  "checkIns",
  "mealPlan",
] as const;
export type SummaryArea = (typeof SUMMARY_AREAS)[number];

export const AREA_STATUSES = ["good", "check", "info"] as const;
export type AreaStatus = (typeof AREA_STATUSES)[number];

export interface FormAnswerEvidence {
  q: string;
  a: string;
}

export interface CheckInEvidence {
  title: string;
  submittedOn: LocalDate;
  late: boolean;
  answers: FormAnswerEvidence[];
}

export interface MealPlanEvidence {
  /** This coach's live plans for the client. */
  plans: number;
  /** Plan meals logged (one per plan meal per day) in the last 7 completed days. */
  mealsLogged: number;
  /** Days with at least one plan meal logged. */
  days: number;
}

/** What the model sees, and what the route returns as facts on ai_unavailable. */
export interface WeeklySummaryEvidence {
  training?: { done: number; target: number | null; state: TrainingState };
  calories?: {
    daysOnTarget: number;
    daysCounted: number;
    daysNotLogged: number;
    daysOver: number;
    daysUnder: number;
  };
  programme?: WeekOfProgramme;
  checkIns?: CheckInEvidence[];
  mealPlan?: MealPlanEvidence;
}

/** The adherence part of the evidence: counts only, tracked areas only. */
export function adherenceEvidence(
  report: AdherenceReport,
): Pick<WeeklySummaryEvidence, "training" | "calories"> {
  const out: Pick<WeeklySummaryEvidence, "training" | "calories"> = {};
  if (report.training) {
    out.training = {
      done: report.training.done,
      target: report.training.target,
      state: report.training.state,
    };
  }
  if (report.calories) {
    const c = report.calories;
    out.calories = {
      daysOnTarget: c.daysOnTarget,
      daysCounted: c.daysCounted,
      daysNotLogged: c.daysNotLogged,
      daysOver: c.daysOver,
      daysUnder: c.daysUnder,
    };
  }
  return out;
}

/** The areas that have evidence. The model may only write about these. */
export function availableAreas(evidence: WeeklySummaryEvidence): SummaryArea[] {
  const out: SummaryArea[] = [];
  if (evidence.training) out.push("training");
  if (evidence.calories) out.push("calories");
  if (evidence.checkIns && evidence.checkIns.length > 0) out.push("checkIns");
  if (evidence.mealPlan) out.push("mealPlan");
  return out;
}

export const MAX_CHECK_INS = 3;
export const MAX_ANSWERS_PER_CHECK_IN = 12;
const MAX_PROMPT_CHARS = 120;
const MAX_ANSWER_CHARS = 280;

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * One answer as short text, or null to leave it out. Photo questions are
 * always left out: the summary never sees or mentions photos.
 */
export function answerText(q: EvidenceQuestion, value: unknown): string | null {
  if (q.type === "photo" || value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") {
    if (q.type === "scale") return `${value}/${q.max ?? SCALE_MAX}`;
    return q.unit ? `${value} ${q.unit}` : String(value);
  }
  if (typeof value === "string") {
    const t = clip(value, MAX_ANSWER_CHARS);
    return t.length > 0 ? t : null;
  }
  if (Array.isArray(value)) {
    const parts = value.filter((v): v is string => typeof v === "string");
    return parts.length > 0 ? clip(parts.join(", "), MAX_ANSWER_CHARS) : null;
  }
  if (typeof value === "object") {
    // yes/no with details: {value: true, details: "..."}
    const v = value as { value?: unknown; details?: unknown };
    if (typeof v.value === "boolean") {
      const base = v.value ? "yes" : "no";
      return typeof v.details === "string" && v.details.trim()
        ? clip(`${base}: ${v.details}`, MAX_ANSWER_CHARS)
        : base;
    }
  }
  return null;
}

/** A form response as evidence: the questions in order, photos left out. */
export function checkInEvidence(response: {
  title: string;
  submittedOn: LocalDate;
  late: boolean;
  questions: EvidenceQuestion[];
  answers: Record<string, unknown>;
}): CheckInEvidence {
  const answers: FormAnswerEvidence[] = [];
  for (const q of response.questions) {
    if (answers.length >= MAX_ANSWERS_PER_CHECK_IN) break;
    const a = answerText(q, response.answers[q.id]);
    if (a !== null) answers.push({ q: clip(q.prompt, MAX_PROMPT_CHARS), a });
  }
  return {
    title: clip(response.title, MAX_PROMPT_CHARS),
    submittedOn: response.submittedOn,
    late: response.late,
    answers,
  };
}

/**
 * Plan meals logged in `[from, to]` (local days). A plan meal logged as
 * several entries (one per item) on one day counts once. An entry without a
 * plan meal id (a single item added from the plan) counts on its own.
 */
export function mealPlanEvidence(
  plans: number,
  entries: { id: string; day: LocalDate; sourcePlanMealId: string | null }[],
  from: LocalDate,
  to: LocalDate,
): MealPlanEvidence {
  const meals = new Set<string>();
  const days = new Set<LocalDate>();
  for (const e of entries) {
    if (e.day < from || e.day > to) continue;
    meals.add(`${e.day}|${e.sourcePlanMealId ?? `entry:${e.id}`}`);
    days.add(e.day);
  }
  return { plans, mealsLogged: meals.size, days: days.size };
}

// ─── Output ──────────────────────────────────────────────────────────────────

export interface SummaryAreaLine {
  area: SummaryArea;
  status: AreaStatus;
  text: string;
}

export interface WeeklySummary {
  headline: string;
  areas: SummaryAreaLine[];
  ask: string;
}

/** Anything longer is not what we asked for. */
export const MAX_FIELD_CHARS = 400;

function strictText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t.length === 0 || t.length > MAX_FIELD_CHARS) return null;
  return t;
}

/**
 * Strict parse of the model's `{headline, areas[], ask}`. Returns null on any
 * shape error (the route then answers ai_unavailable, never invented text).
 * An area the evidence doesn't cover is dropped, as is a repeated area.
 * Unknown area names and statuses are shape errors.
 */
export function parseWeeklySummary(
  raw: unknown,
  allowed: readonly SummaryArea[],
): WeeklySummary | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const input = raw as Record<string, unknown>;
  const headline = strictText(input.headline);
  const ask = strictText(input.ask);
  if (headline === null || ask === null || !Array.isArray(input.areas)) {
    return null;
  }
  const areas: SummaryAreaLine[] = [];
  const seen = new Set<SummaryArea>();
  for (const item of input.areas) {
    if (typeof item !== "object" || item === null) return null;
    const { area, status, text } = item as Record<string, unknown>;
    if (!SUMMARY_AREAS.includes(area as SummaryArea)) return null;
    if (!AREA_STATUSES.includes(status as AreaStatus)) return null;
    const line = strictText(text);
    if (line === null) return null;
    const key = area as SummaryArea;
    if (!allowed.includes(key) || seen.has(key)) continue;
    seen.add(key);
    areas.push({ area: key, status: status as AreaStatus, text: line });
  }
  return { headline, areas, ask };
}

/**
 * The paragraph 1.2.0 bundles show: the headline and the area lines joined
 * (design B D1).
 */
export function legacySummaryText(summary: WeeklySummary): string {
  return [summary.headline, ...summary.areas.map((a) => a.text)].join(" ");
}
