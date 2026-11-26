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

// ─── Sequence mode (PER-112, design G part 2) ────────────────────────────────
//
// A `sequence` programme assignment has NO dates: its workouts are created
// once, with `due_date = NULL` and `sequence_index` = the position in
// programme order. Programme order is the occurrence order above (week, then
// the slot within the week, which is the cycle position), so sequence index k
// is occurrence k and runs `cycle[k mod cycle.length]`. Next = the lowest
// sequence index not yet completed.

/** How a programme assignment lays out its workouts. */
export type ScheduleMode = "dated" | "sequence";

/** How many weeks of workouts an INDEFINITE sequence programme keeps open. */
export const INDEFINITE_SEQUENCE_WEEKS = INDEFINITE_HORIZON_DAYS / 7;

/** One workout of a sequence programme assignment. */
export interface SequenceStep {
  sequenceIndex: number;
  workoutId: string;
}

/**
 * Build the workouts of a sequence assignment.
 *
 * Finite (`durationWeeks` set): every workout from `fromIndex` up to
 * `durationWeeks × daysPerWeek`, the same count as a dated assignment.
 *
 * Indefinite (`durationWeeks` null): enough to keep
 * `INDEFINITE_SEQUENCE_WEEKS × daysPerWeek` workouts open, given `openCount`
 * already open. It's the dateless twin of the dated 28-day horizon.
 */
export function buildSequence(params: {
  daysPerWeek: number;
  /** workoutIds ordered by position — the cycle. */
  cycle: string[];
  durationWeeks: number | null;
  fromIndex: number;
  /** Workouts already open (indefinite top-up only). */
  openCount?: number;
}): SequenceStep[] {
  const { daysPerWeek, cycle, durationWeeks } = params;
  if (cycle.length === 0) return [];
  const from = Math.max(params.fromIndex, 0);
  const end =
    durationWeeks !== null
      ? durationWeeks * daysPerWeek
      : from +
        Math.max(
          INDEFINITE_SEQUENCE_WEEKS * daysPerWeek - (params.openCount ?? 0),
          0,
        );
  const out: SequenceStep[] = [];
  for (let k = from; k < end; k++) {
    out.push({ sequenceIndex: k, workoutId: cycle[k % cycle.length] });
  }
  return out;
}

/** `weekOfProgramme` read field: where the athlete is, and out of how many. */
export interface WeekOfProgramme {
  /** 1-based. */
  week: number;
  /** Programme length in weeks; null = indefinite. */
  of: number | null;
}

/**
 * The one place `weekOfProgramme` is worked out, for every read that returns
 * it (Home card, coach active programme, athlete programme detail) and for the
 * AI weekly summary (PER-115).
 *
 * - `dated`: the calendar week since `startDate` (same as `currentWeek`).
 * - `sequence`: the week the Next workout belongs to,
 *   `floor(position / daysPerWeek) + 1`, where position is Next's sequence
 *   index, or the number of workouts created when every one is done. Clamped
 *   to the programme length, so a finished 8-week programme reads 8 of 8.
 */
export function weekOfProgramme(params: {
  scheduleMode: ScheduleMode;
  startDate: string;
  today: string;
  durationWeeks: number | null;
  daysPerWeek: number;
  /** Lowest open sequence index (sequence only); null when none is open. */
  nextSequenceIndex: number | null;
  /** Workouts created so far for the assignment (sequence only). */
  sequenceCount: number;
}): WeekOfProgramme {
  const of = params.durationWeeks;
  if (params.scheduleMode !== "sequence") {
    return { week: currentWeek(params.startDate, params.today, of), of };
  }
  const position = params.nextSequenceIndex ?? params.sequenceCount;
  const perWeek = Math.max(params.daysPerWeek, 1);
  const week = Math.floor(Math.max(position, 0) / perWeek) + 1;
  return { week: of === null ? week : Math.max(Math.min(week, of), 1), of };
}
