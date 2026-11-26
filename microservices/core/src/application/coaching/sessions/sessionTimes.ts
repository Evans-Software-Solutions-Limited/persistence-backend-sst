import {
  addDays,
  localDateIn,
  localMinutesIn,
  safeTimeZone,
  zonedInstant,
  type LocalDate,
} from "../scheduler/zonedTime";

/**
 * Wall-clock maths for coach sessions (PER-123, design I). A weekly repeat
 * keeps the coach's local time across a clock change: 09:00 London stays
 * 09:00 London after the clocks go back. Pure: no clock is read here.
 */

/** At most this many occurrences of a weekly repeat exist at once. */
export const MAX_OCCURRENCES = 26;

const DAY_MS = 86_400_000;

/** "09:05" — an instant's local time of day in `tz`. */
export function localHhmm(instant: Date, tz: string): string {
  const minutes = localMinutesIn(instant, tz);
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * The starts of a weekly repeat: `count` occurrences, a week apart in the
 * coach's zone, each at the first one's local time. The first is `start`
 * itself.
 */
export function weeklyStarts(start: Date, count: number, tz: string): Date[] {
  const zone = safeTimeZone(tz);
  const date = localDateIn(start, zone);
  const time = localHhmm(start, zone);
  const starts = [start];
  for (let i = 1; i < count; i += 1) {
    starts.push(zonedInstant(addDays(date, 7 * i), time, zone));
  }
  return starts;
}

/** Whole days from local date `a` to local date `b`. */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS,
  );
}

/**
 * A series edit that moves one occurrence from `from` to `to` moves another
 * occurrence (`other`) the same way in local terms: the same number of days,
 * to the new local time. So moving Tuesday 09:00 to Wednesday 10:00 moves
 * every later Tuesday 09:00 to that week's Wednesday 10:00, DST included.
 */
export function shiftLikeLocal(
  other: Date,
  from: Date,
  to: Date,
  tz: string,
): Date {
  const zone = safeTimeZone(tz);
  const shift = daysBetween(localDateIn(from, zone), localDateIn(to, zone));
  return zonedInstant(
    addDays(localDateIn(other, zone), shift),
    localHhmm(to, zone),
    zone,
  );
}

/** The instants today starts and ends in `tz`. */
export function localDayBounds(
  now: Date,
  tz: string,
): { start: Date; end: Date } {
  const zone = safeTimeZone(tz);
  const date = localDateIn(now, zone);
  return {
    start: zonedInstant(date, "00:00", zone),
    end: zonedInstant(addDays(date, 1), "00:00", zone),
  };
}
