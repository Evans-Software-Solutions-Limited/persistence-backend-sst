/**
 * The one adherence calculation (PER-114, Linear "Backend design B — Adherence
 * and the AI weekly summary", D2).
 *
 * Pure: no database, no clock. `AdherenceRepository` assembles the input; every
 * consumer (roster, client detail, overview, the adherence route, the AI
 * summary evidence, design C's Today flags) calls this and nothing else, so
 * every screen shows the same numbers.
 *
 * Rules (decided by Brad, 17–20 Nov 2026):
 *  - Per area, never blended, and only for the areas the coach tracks. An area
 *    key is present only when that area is tracked.
 *  - A rolling window, never a Monday-to-Sunday week.
 *  - Training: every completed workout the athlete logged today and the
 *    previous 6 days (27 for 28d), in the athlete's time zone, against the
 *    coach's sessions-per-week target (x4 for 28d). Every logged workout
 *    counts, not just this coach's.
 *  - Calories: days within ±10% of that day's own target over the last 7 (or
 *    28) COMPLETED days. Today never counts. An unlogged day is a miss and is
 *    also counted on its own. A day with no target in force is excluded.
 *  - Days before the coaching start date are excluded from both areas.
 */

/** A calendar day in the athlete's time zone, `YYYY-MM-DD`. */
export type LocalDate = string;

export type AdherenceWindowDays = 7 | 28;

export interface AdherenceSettings {
  trackTraining: boolean;
  trackCalories: boolean;
  sessionsPerWeek: number | null;
}

export interface AdherenceTarget {
  effectiveAt: Date;
  dailyKcal: number;
}

export interface AdherenceInput {
  /** The athlete's `profiles.timezone`. An unknown zone falls back to London. */
  timeZone: string;
  now: Date;
  /** `activated_at` as a day in the athlete's time zone; null = no limit. */
  coachingStart: LocalDate | null;
  settings: AdherenceSettings;
  /** Completed `workout_sessions`, by completion time. */
  sessions: { completedAt: Date }[];
  /** Summed `nutrition_entries.kcal` per local day. A day with entries is logged, even at 0 kcal. */
  dayKcal: Map<LocalDate, number>;
  /** `nutrition_target_history`, any order (sorted here, ties keep input order). */
  targets: AdherenceTarget[];
  windowDays: AdherenceWindowDays;
}

export type TrainingState = "met" | "behind" | "noTarget";

export interface TrainingAdherence {
  /** First day counted: the window start, or the coaching start if later. */
  from: LocalDate;
  /** Today. */
  to: LocalDate;
  /** sessions_per_week, x4 for the 28-day window. null = no target set. */
  target: number | null;
  done: number;
  /** e.g. "3 of 4 in the last 7 days". */
  label: string;
  state: TrainingState;
}

export type CalorieDayResult =
  | "on"
  | "over"
  | "under"
  | "notLogged"
  | "noTarget"
  | "beforeCoaching";

export interface CalorieDay {
  date: LocalDate;
  /** Summed kcal, or null when nothing was logged. */
  kcal: number | null;
  /** The target in force that day, or null. */
  targetKcal: number | null;
  result: CalorieDayResult;
}

export interface CalorieAdherence {
  /** First day of the window (yesterday back 6, or back 27 for 28d). */
  from: LocalDate;
  /** Yesterday. Today never counts. */
  to: LocalDate;
  daysOnTarget: number;
  /** on + over + under + notLogged. noTarget and beforeCoaching are excluded. */
  daysCounted: number;
  daysNotLogged: number;
  daysOver: number;
  daysUnder: number;
  /** Oldest first, one entry per day in the window. */
  perDay: CalorieDay[];
}

export interface AdherenceReport {
  asOf: string;
  windowDays: AdherenceWindowDays;
  training?: TrainingAdherence;
  calories?: CalorieAdherence;
}

export const DEFAULT_TIME_ZONE = "Europe/London";

/** ±10% of the day's target counts as on target. */
export const CALORIE_TOLERANCE = 0.1;

/** Float slack so 2200 against 2000 is on target (0.1 * 2000 rounding). */
const EPSILON = 1e-9;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** A known IANA zone, or the default (Europe/London, like the rest of core). */
export function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TIME_ZONE;
  if (formatters.has(tz)) return tz;
  try {
    formatters.set(
      tz,
      new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }),
    );
    return tz;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** The calendar day of an instant in a time zone. Formatters are cached. */
export function localDateIn(instant: Date, tz: string): LocalDate {
  const zone = safeTimeZone(tz);
  return formatters.get(zone)!.format(instant);
}

/** Add whole days to a `YYYY-MM-DD`. Date-only, so DST never shifts it. */
export function addDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The target in force on each day: the latest row with `effective_at` at or
 * before the end of that day in `tz`, i.e. whose local day is on or before it.
 * Exported so other day-by-day readers (PER-113's History) use the same rule.
 */
export function targetResolver(
  targets: AdherenceTarget[],
  tz: string,
): (date: LocalDate) => number | null {
  const dated = targets
    .map((t, i) => ({ t, i }))
    .sort(
      (a, b) =>
        a.t.effectiveAt.getTime() - b.t.effectiveAt.getTime() || a.i - b.i,
    )
    .map(({ t }) => ({
      day: localDateIn(t.effectiveAt, tz),
      kcal: t.dailyKcal,
    }));
  return (date) => {
    let found: number | null = null;
    for (const row of dated) {
      if (row.day > date) break;
      found = row.kcal;
    }
    return found;
  };
}

function laterOf(a: LocalDate, b: LocalDate | null): LocalDate {
  return b !== null && b > a ? b : a;
}

export function computeTraining(
  input: AdherenceInput,
  tz: string,
  today: LocalDate,
): TrainingAdherence {
  const windowStart = addDays(today, -(input.windowDays - 1));
  const from = laterOf(windowStart, input.coachingStart);
  let done = 0;
  for (const s of input.sessions) {
    const day = localDateIn(s.completedAt, tz);
    if (day >= from && day <= today) done += 1;
  }
  const weekly = input.settings.sessionsPerWeek;
  const target =
    weekly !== null && weekly > 0 ? weekly * (input.windowDays / 7) : null;
  const state: TrainingState =
    target === null ? "noTarget" : done >= target ? "met" : "behind";
  const span = `in the last ${input.windowDays} days`;
  const label =
    target === null ? `${done} ${span}` : `${done} of ${target} ${span}`;
  return { from, to: today, target, done, label, state };
}

export function judgeCalorieDay(
  kcal: number | null,
  targetKcal: number | null,
): Exclude<CalorieDayResult, "beforeCoaching"> {
  if (targetKcal === null || targetKcal <= 0) return "noTarget";
  if (kcal === null) return "notLogged";
  const diff = kcal - targetKcal;
  if (Math.abs(diff) <= CALORIE_TOLERANCE * targetKcal + EPSILON) return "on";
  return diff > 0 ? "over" : "under";
}

export function computeCalories(
  input: AdherenceInput,
  tz: string,
  today: LocalDate,
): CalorieAdherence {
  const to = addDays(today, -1);
  const from = addDays(today, -input.windowDays);
  const targetOn = targetResolver(input.targets, tz);

  const perDay: CalorieDay[] = [];
  const out = {
    daysOnTarget: 0,
    daysCounted: 0,
    daysNotLogged: 0,
    daysOver: 0,
    daysUnder: 0,
  };
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const logged = input.dayKcal.get(date);
    const kcal = logged === undefined ? null : logged;
    const targetKcal = targetOn(date);
    if (input.coachingStart !== null && date < input.coachingStart) {
      perDay.push({ date, kcal, targetKcal, result: "beforeCoaching" });
      continue;
    }
    const result = judgeCalorieDay(kcal, targetKcal);
    perDay.push({ date, kcal, targetKcal, result });
    if (result === "noTarget") continue;
    out.daysCounted += 1;
    if (result === "on") out.daysOnTarget += 1;
    else if (result === "over") out.daysOver += 1;
    else if (result === "under") out.daysUnder += 1;
    else out.daysNotLogged += 1;
  }
  return { from, to, ...out, perDay };
}

export function computeAdherence(input: AdherenceInput): AdherenceReport {
  const tz = safeTimeZone(input.timeZone);
  const today = localDateIn(input.now, tz);
  const report: AdherenceReport = {
    asOf: input.now.toISOString(),
    windowDays: input.windowDays,
  };
  if (input.settings.trackTraining) {
    report.training = computeTraining(input, tz, today);
  }
  if (input.settings.trackCalories) {
    report.calories = computeCalories(input, tz, today);
  }
  return report;
}

// ─── Compact shapes for the roster, detail and overview ──────────────────────

/** `adherenceByArea` on the roster and client detail (design B D3). */
export interface AdherenceByArea {
  training?: Pick<TrainingAdherence, "done" | "target" | "label" | "state">;
  calories?: Pick<
    CalorieAdherence,
    "daysOnTarget" | "daysCounted" | "daysNotLogged"
  >;
}

export function adherenceByArea(report: AdherenceReport): AdherenceByArea {
  const out: AdherenceByArea = {};
  if (report.training) {
    const { done, target, label, state } = report.training;
    out.training = { done, target, label, state };
  }
  if (report.calories) {
    const { daysOnTarget, daysCounted, daysNotLogged } = report.calories;
    out.calories = { daysOnTarget, daysCounted, daysNotLogged };
  }
  return out;
}

/**
 * Practice level (D2 rule 5: C2 Today strip, C2c You, the overview). Training
 * is the sum of `done` over the sum of `target`; calories the sum of
 * `daysOnTarget` over the sum of `daysCounted`. Each across the clients that
 * track that area, and never blended. A training client with no target adds
 * to neither sum (its sessions have nothing to be measured against).
 */
export interface PracticeAdherence {
  training?: { done: number; target: number; clients: number };
  calories?: {
    daysOnTarget: number;
    daysCounted: number;
    daysNotLogged: number;
    clients: number;
  };
}

export function practiceAdherence(
  reports: AdherenceReport[],
): PracticeAdherence {
  const out: PracticeAdherence = {};
  for (const r of reports) {
    if (r.training && r.training.target !== null) {
      const t = (out.training ??= { done: 0, target: 0, clients: 0 });
      t.done += r.training.done;
      t.target += r.training.target;
      t.clients += 1;
    }
    if (r.calories) {
      const c = (out.calories ??= {
        daysOnTarget: 0,
        daysCounted: 0,
        daysNotLogged: 0,
        clients: 0,
      });
      c.daysOnTarget += r.calories.daysOnTarget;
      c.daysCounted += r.calories.daysCounted;
      c.daysNotLogged += r.calories.daysNotLogged;
      c.clients += 1;
    }
  }
  return out;
}
