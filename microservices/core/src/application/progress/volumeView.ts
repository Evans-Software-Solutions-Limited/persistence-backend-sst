/**
 * Pure response-shaping for the volume endpoints (06-progress-goals, Phase
 * 06.4). Keeping these out of the handlers makes the bar-fill / delta /
 * adherence maths unit-testable without a DB.
 */

import { addDaysISO } from "../streaks/period";
import type {
  DailyVolume,
  MuscleVolume,
} from "../repositories/volumeRepository";

export interface WeeklyVolumeDay {
  date: string;
  volumeKg: number;
  isToday: boolean;
  isRest: boolean;
}

/**
 * Expand a sparse daily-volume list into a dense [startISO..endISO] array,
 * filling gaps with 0. `isToday` marks the row whose date === `todayISO`;
 * `isRest` marks a zero-volume non-today day (the prototype dims + shrinks
 * those bars).
 *
 * `todayISO` is explicit because the window is the calendar week (Mon–Sun), so
 * the trailing day is Sunday — NOT today on Mon–Sat. Defaulting it to `endISO`
 * preserves the old behaviour only for callers that genuinely end on today.
 */
export function fillWeekDays(
  rows: DailyVolume[],
  startISO: string,
  endISO: string,
  todayISO: string = endISO,
): WeeklyVolumeDay[] {
  const byDate = new Map(rows.map((r) => [r.date, r.volumeKg]));
  const out: WeeklyVolumeDay[] = [];
  let cursor = startISO;
  // Guard against a malformed range (cap at 366 iterations).
  for (let i = 0; i < 366; i += 1) {
    const volumeKg = byDate.get(cursor) ?? 0;
    const isToday = cursor === todayISO;
    out.push({
      date: cursor,
      volumeKg,
      isToday,
      isRest: volumeKg === 0 && !isToday,
    });
    if (cursor === endISO) break;
    cursor = addDaysISO(cursor, 1);
  }
  return out;
}

/** Percentage change this-vs-last; null when there is no prior baseline. */
export function computeDeltaPct(thisKg: number, lastKg: number): number | null {
  if (lastKg <= 0) return null;
  return Math.round(((thisKg - lastKg) / lastKg) * 100);
}

/** Attach a 0..1 bar fraction (relative to the largest muscle) to each row. */
export function withMusclePct(
  rows: MuscleVolume[],
): { muscle: string; kg: number; pct: number }[] {
  const max = rows.reduce((m, r) => Math.max(m, r.kg), 0);
  return rows.map((r) => ({
    muscle: r.muscle,
    kg: r.kg,
    pct: max > 0 ? Math.round((r.kg / max) * 100) / 100 : 0,
  }));
}

/**
 * Adherence % = completed sessions / planned sessions over the window, capped
 * at 100. Plan = weeklyTarget × weeks-in-window. Null for an unbounded window
 * (lifetime) or a non-positive plan.
 */
export function adherencePct(
  completedSessions: number,
  weeklyTarget: number,
  daysInWindow: number,
): number | null {
  if (daysInWindow <= 0 || weeklyTarget <= 0) return null;
  const weeks = daysInWindow / 7;
  const plan = weeklyTarget * weeks;
  if (plan <= 0) return null;
  return Math.min(100, Math.round((completedSessions / plan) * 100));
}

/** Inclusive day count between two YYYY-MM-DD strings. */
export function daysBetweenInclusive(startISO: string, endISO: string): number {
  const start = new Date(`${startISO}T00:00:00.000Z`).getTime();
  const end = new Date(`${endISO}T00:00:00.000Z`).getTime();
  return Math.floor((end - start) / 86400000) + 1;
}
