/**
 * Pure occurrence-scheduling functions for programmes
 * (specs/19-programs/design.md § Materialisation).
 *
 * A programme is an ordered CYCLE of workouts; assigning it turns the cycle
 * into dated `workout_assignments` occurrences:
 *
 *   occurrence k (0-based), daysPerWeek d:
 *     week(k)      = floor(k / d)
 *     slot(k)      = k mod d
 *     dayOffset(k) = week(k) * 7 + round(slot(k) * 7 / d)
 *     dueDate(k)   = startDate + dayOffset(k)
 *     workout(k)   = cycle[k mod cycle.length]
 *
 * All dates are YYYY-MM-DD strings (the `date`/text convention used across
 * `workout_assignments`); arithmetic is done in UTC so device/server
 * timezones can't shift a due date across midnight.
 *
 * Nothing here reads the clock — callers pass "today" in. That keeps the
 * module deterministic for tests and for workflow-style replay.
 */

/** Rolling materialisation horizon for INDEFINITE programmes (D1/D2). */
export const INDEFINITE_HORIZON_DAYS = 28;

/** A single materialisable occurrence of a programme assignment. */
export interface Occurrence {
  occurrenceIndex: number;
  workoutId: string;
  /** YYYY-MM-DD */
  dueDate: string;
}

/** Parse YYYY-MM-DD to a UTC-midnight Date. Throws on malformed input. */
function parseIsoDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Invalid ISO date: ${iso}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** Add whole days to a YYYY-MM-DD string (UTC-safe). */
export function addDays(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Day offset from the start date for occurrence k: d sessions spread evenly
 * across each 7-day week (e.g. d=3 → offsets 0,2,5 within the week).
 */
export function dayOffset(k: number, daysPerWeek: number): number {
  const week = Math.floor(k / daysPerWeek);
  const slot = k % daysPerWeek;
  return week * 7 + Math.round((slot * 7) / daysPerWeek);
}

/**
 * Stored end date for a finite assignment: the last day of the final week
 * (start + weeks*7 - 1). Returns null for indefinite programmes.
 */
export function endDateFor(
  startDate: string,
  durationWeeks: number | null,
): string | null {
  if (durationWeeks === null) return null;
  return addDays(startDate, durationWeeks * 7 - 1);
}

/**
 * Calendar-derived 1-based week number for progress display ("Week N / M").
 * Clamped to [1, durationWeeks] for finite programmes; unbounded below by 1
 * for indefinite ones (a future start date still reads "Week 1").
 */
export function currentWeek(
  startDate: string,
  today: string,
  durationWeeks: number | null,
): number {
  const elapsedDays = Math.floor(
    (parseIsoDate(today).getTime() - parseIsoDate(startDate).getTime()) /
      86_400_000,
  );
  const week = Math.floor(Math.max(elapsedDays, 0) / 7) + 1;
  if (durationWeeks === null) return week;
  return Math.min(week, durationWeeks);
}

/**
 * Build the occurrences for a programme assignment.
 *
 * Finite (`durationWeeks` set): all `durationWeeks × daysPerWeek` occurrences
 * from `fromIndex` (0 at assign time; higher never happens for finite — the
 * full set is written up front).
 *
 * Indefinite (`durationWeeks` null): every occurrence from `fromIndex` whose
 * due date is on/before `horizonDate` — the rolling top-up window. Callers
 * pass `horizonDate = addDays(today, INDEFINITE_HORIZON_DAYS)`.
 */
export function buildOccurrences(params: {
  startDate: string;
  daysPerWeek: number;
  /** workoutIds ordered by position — the cycle. */
  cycle: string[];
  durationWeeks: number | null;
  fromIndex: number;
  /** Required when durationWeeks is null. */
  horizonDate?: string;
}): Occurrence[] {
  const { startDate, daysPerWeek, cycle, durationWeeks, fromIndex } = params;
  if (cycle.length === 0) return [];

  const out: Occurrence[] = [];
  if (durationWeeks !== null) {
    const total = durationWeeks * daysPerWeek;
    for (let k = Math.max(fromIndex, 0); k < total; k++) {
      out.push({
        occurrenceIndex: k,
        workoutId: cycle[k % cycle.length],
        dueDate: addDays(startDate, dayOffset(k, daysPerWeek)),
      });
    }
    return out;
  }

  const horizon = params.horizonDate;
  if (!horizon) {
    throw new Error("horizonDate is required for indefinite programmes");
  }
  for (let k = Math.max(fromIndex, 0); ; k++) {
    const dueDate = addDays(startDate, dayOffset(k, daysPerWeek));
    if (dueDate > horizon) break;
    out.push({
      occurrenceIndex: k,
      workoutId: cycle[k % cycle.length],
      dueDate,
    });
  }
  return out;
}
