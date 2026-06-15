/**
 * Habit `date` input classification (06-progress-goals; Inspector finding,
 * PR #116). The habit grid's contract is a user-local CALENDAR DAY, but the
 * wire value may be a date-only string ("2026-06-04") or a full ISO instant.
 * Parsing a date-only string as an instant (UTC midnight) lands it on the
 * PREVIOUS local day for every user west of UTC — so date-only input must be
 * detected and treated as the authoritative local day, never converted.
 */

import { localDateISO } from "../streaks/period";

export type HabitDayInput =
  | { kind: "none" } // no date supplied → "now"
  | { kind: "day"; localDate: string } // date-only → authoritative local day
  | { kind: "instant" } // full timestamp → convert via profiles.timezone
  | { kind: "invalid" };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function parseHabitDay(date: string | undefined): HabitDayInput {
  if (date === undefined) return { kind: "none" };
  if (DATE_ONLY.test(date)) {
    // Still validate it's a real calendar date (e.g. rejects 2026-13-40).
    if (Number.isNaN(new Date(`${date}T00:00:00.000Z`).getTime())) {
      return { kind: "invalid" };
    }
    return { kind: "day", localDate: date };
  }
  if (Number.isNaN(new Date(date).getTime())) return { kind: "invalid" };
  return { kind: "instant" };
}

/**
 * The latest "today" anywhere on Earth (UTC+14, Line Islands) — the upper
 * bound for a legitimate date-only habit day. Injectable clock for tests.
 */
export function latestLocalDateOnEarth(now: Date = new Date()): string {
  return localDateISO(now, "Pacific/Kiritimati");
}
