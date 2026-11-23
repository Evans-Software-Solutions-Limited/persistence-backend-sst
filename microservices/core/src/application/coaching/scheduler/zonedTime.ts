import {
  addDays,
  localDateIn,
  safeTimeZone,
  type LocalDate,
} from "../../adherence/computeAdherence";

/**
 * Wall-clock helpers for the coach scheduler (PER-117, design C D2/D4):
 * weekly and daily sends run at a local time in the ATHLETE's zone, and quiet
 * hours are in the COACH's zone. Pure: no clock is read here.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    partFormatters.set(tz, f);
  }
  return f;
}

/** The zone's offset from UTC at an instant, in ms (BST → +3 600 000). */
export function offsetMs(instant: number, tz: string): number {
  const parts = partsFormatter(safeTimeZone(tz)).formatToParts(
    new Date(instant),
  );
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** Minutes since local midnight at an instant. */
export function localMinutesIn(instant: Date, tz: string): number {
  const local = instant.getTime() + offsetMs(instant.getTime(), tz);
  const d = new Date(local);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** "18:00" or "18:00:00" → minutes since midnight. */
export function minutesOf(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

/**
 * The instant a local date and time happens in `tz`.
 *  - A time that happens twice (clocks go back) → the first one.
 *  - A time that never happens (clocks go forward) → moved forward by the
 *    gap, e.g. 01:30 on the London spring-forward night → 02:30 BST.
 */
export function zonedInstant(date: LocalDate, hhmm: string, tz: string): Date {
  const zone = safeTimeZone(tz);
  const minutes = minutesOf(hhmm);
  const naive = Date.parse(`${date}T00:00:00.000Z`) + minutes * MINUTE_MS;
  const before = offsetMs(naive - 14 * HOUR_MS, zone);
  const after = offsetMs(naive + 14 * HOUR_MS, zone);
  const candidates = [naive - before, naive - after]
    .filter((t) => t + offsetMs(t, zone) === naive)
    .sort((a, b) => a - b);
  // No candidate: the time falls in the spring-forward gap. Reading it with
  // the offset from before the change lands just after the gap.
  return new Date(candidates[0] ?? naive - before);
}

/** ISO weekday of a local date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: LocalDate): number {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The ISO week a local date is in, as a period key: "2026-W47". */
export function isoWeekKey(date: LocalDate): string {
  // The week's Thursday decides the ISO year.
  const thursday = addDays(date, 4 - isoWeekday(date));
  const year = Number(thursday.slice(0, 4));
  const jan1 = Date.parse(`${year}-01-01T00:00:00.000Z`);
  const week =
    Math.floor(
      (Date.parse(`${thursday}T00:00:00.000Z`) - jan1) / 86_400_000 / 7,
    ) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** The Monday of the ISO week a local date is in. */
export function mondayOf(date: LocalDate): LocalDate {
  return addDays(date, 1 - isoWeekday(date));
}

/**
 * True when `now` is inside the quiet window [from, until) in `tz`. A window
 * whose start is after its end wraps midnight (22:00 → 07:00). Equal ends
 * mean no window.
 */
export function isQuietAt(
  now: Date,
  tz: string,
  from: string | null,
  until: string | null,
): boolean {
  if (!from || !until) return false;
  const start = minutesOf(from);
  const end = minutesOf(until);
  if (start === end) return false;
  const m = localMinutesIn(now, tz);
  return start < end ? m >= start && m < end : m >= start || m < end;
}

export { addDays, localDateIn, safeTimeZone, type LocalDate };
