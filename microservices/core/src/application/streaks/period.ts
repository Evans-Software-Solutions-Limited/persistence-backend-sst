/**
 * User-local period math for the streak engine (06-progress-goals, Phase 06.2).
 *
 * Per specs/_shared/cross-cuts.md § 3.4, streak periods are evaluated against
 * USER-LOCAL time (profiles.timezone, default Europe/London) — never raw UTC.
 *
 * Design choice: this module deals ONLY in local *calendar dates*
 * (YYYY-MM-DD strings). It never converts a local wall-clock time back to a
 * UTC instant — that conversion is brittle around DST and is unnecessary.
 * The repository's threshold queries instead push the timezone into Postgres
 * (`(event_ts AT TIME ZONE tz)::date BETWEEN $start AND $end`), where the
 * conversion is correct by construction. So everything here is pure,
 * dependency-free, and DST-irrelevant (date-only arithmetic).
 */

export type Period = "daily" | "weekly" | "monthly";

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * The user-local calendar date (YYYY-MM-DD) for an instant. `en-CA` renders
 * ISO-ordered Y-M-D, so no reassembly is needed.
 */
export function localDateISO(ts: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ts);
}

/** User-local weekday as 0=Sun … 6=Sat. */
export function localWeekday(ts: Date, tz: string): number {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).format(ts);
  const idx = WEEKDAY_INDEX[short];
  // Intl always yields one of the seven keys; the ?? is a typescript guard.
  return idx ?? 0;
}

/** Add (or subtract) whole days to a YYYY-MM-DD string. Date-only ⇒ UTC-safe. */
export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Compare two YYYY-MM-DD strings. Lexicographic order == chronological. */
export function compareISO(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The local-date on which the period CONTAINING the calendar date `dateISO`
 * ends. Date-only arithmetic — no timezone involved, so it is also the right
 * tool for date-only inputs (e.g. a habit grid cell's YYYY-MM-DD).
 *   daily   → that day
 *   weekly  → the upcoming (or current) Sunday (week is Mon–Sun per § 3.4)
 *   monthly → the last day of that month
 */
export function periodEndForDateISO(dateISO: string, period: Period): string {
  if (period === "daily") return dateISO;
  if (period === "weekly") {
    const wd = new Date(`${dateISO}T00:00:00.000Z`).getUTCDay(); // 0=Sun..6=Sat
    const daysToSunday = (7 - wd) % 7; // Sun→0, Mon→6, … Sat→1
    return addDaysISO(dateISO, daysToSunday);
  }
  // monthly
  const [y, m] = dateISO.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based
  return `${dateISO.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`;
}

/** The local-date on which the period CONTAINING `ts` (in `tz`) ends. */
export function periodEndISO(ts: Date, period: Period, tz: string): string {
  return periodEndForDateISO(localDateISO(ts, tz), period);
}

/** The local-date on which the period ending `endISO` started. */
export function periodStartFromEndISO(endISO: string, period: Period): string {
  if (period === "daily") return endISO;
  if (period === "weekly") return addDaysISO(endISO, -6); // Monday
  // monthly: first of that month
  return `${endISO.slice(0, 7)}-01`;
}

/** The end-date of the period immediately preceding the one ending `endISO`. */
export function previousPeriodEndISO(endISO: string, period: Period): string {
  if (period === "daily") return addDaysISO(endISO, -1);
  if (period === "weekly") return addDaysISO(endISO, -7);
  // monthly: last day of previous month
  const [y, m] = endISO.split("-").map(Number);
  const lastDayPrev = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  const prevMonth = m === 1 ? 12 : m - 1;
  const prevYear = m === 1 ? y - 1 : y;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(
    lastDayPrev,
  ).padStart(2, "0")}`;
}

/**
 * The end-date of the most recently COMPLETED period as of `now` (user-local).
 * The period containing `now` is still in progress, so this is the one before
 * it. Used by the nightly cron to decide whether a streak fell behind.
 */
export function lastCompletedPeriodEndISO(
  now: Date,
  period: Period,
  tz: string,
): string {
  const currentEnd = periodEndISO(now, period, tz);
  const localDate = localDateISO(now, tz);
  if (period === "weekly") {
    // If today *is* the Sunday end, the current week is still in progress
    // until midnight, so the last completed week ended the prior Sunday.
    return previousPeriodEndISO(currentEnd, period);
  }
  if (period === "monthly") {
    return previousPeriodEndISO(currentEnd, period);
  }
  // daily: yesterday relative to today-local
  return addDaysISO(localDate, -1);
}

/**
 * The number of COMPLETED periods strictly after `fromEndISO` up to and
 * including `toEndISO` — i.e. how many periods elapsed since a streak's
 * `last_period_end`. Both arguments must be period-end dates of the same
 * grain (Sundays for weekly, last-of-month for monthly, any day for daily).
 * Returns 0 when `fromEndISO >= toEndISO`. Used by the cron to spend one freeze
 * token PER missed period (cross-cuts § 3.5), not one regardless of the gap.
 */
export function periodsBetween(
  fromEndISO: string,
  toEndISO: string,
  period: Period,
): number {
  if (compareISO(fromEndISO, toEndISO) >= 0) return 0;
  if (period === "monthly") {
    const [fy, fm] = fromEndISO.split("-").map(Number);
    const [ty, tm] = toEndISO.split("-").map(Number);
    return ty * 12 + tm - (fy * 12 + fm);
  }
  const fromMs = new Date(`${fromEndISO}T00:00:00.000Z`).getTime();
  const toMs = new Date(`${toEndISO}T00:00:00.000Z`).getTime();
  const dayDiff = Math.round((toMs - fromMs) / 86400000);
  return period === "weekly" ? Math.round(dayDiff / 7) : dayDiff;
}
