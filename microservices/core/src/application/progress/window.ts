/**
 * Volume-aggregation window helpers (06-progress-goals, Phase 06.4). Pure —
 * reuses the streak engine's user-local date extraction so the You/Progress
 * VolumeStats window aligns to the user's calendar (cross-cuts § 3.4).
 */

import { localDateISO, addDaysISO } from "../streaks/period";

export type WindowKind = "month" | "quarter" | "year" | "lifetime";

/**
 * Default weekly workout target (the "/5" in the prototype) until goal wiring
 * lands. Shared by getHomeHandler / getWeeklyVolumeHandler (workouts target)
 * AND getVolumeStatsHandler (adherence %) so Home and You/Progress never
 * disagree on the same number (Inspector finding, PR #116). Goal wiring later
 * replaces this in exactly one place.
 */
export const DEFAULT_WORKOUTS_PER_WEEK = 5;

export function parseWindowKind(value: string | undefined): WindowKind {
  if (value === "quarter" || value === "year" || value === "lifetime") {
    return value;
  }
  return "month";
}

/** The user-local start date (YYYY-MM-DD) of the window containing `now`. */
export function windowStartISO(
  now: Date,
  kind: WindowKind,
  tz: string,
): string {
  const local = localDateISO(now, tz);
  const [y, m] = local.split("-").map(Number);
  switch (kind) {
    case "month":
      return `${local.slice(0, 7)}-01`;
    case "quarter": {
      const quarterStartMonth = Math.floor((m - 1) / 3) * 3 + 1; // 1,4,7,10
      return `${y}-${String(quarterStartMonth).padStart(2, "0")}-01`;
    }
    case "year":
      return `${y}-01-01`;
    case "lifetime":
      return "1970-01-01";
  }
}

/**
 * The Monday (user-local) of the week containing `now`. Mirrors the weekly
 * streak grain + the weekly_volume_per_user.week_start column.
 */
export function weekStartISO(now: Date, tz: string): string {
  const local = localDateISO(now, tz);
  const weekday = new Date(`${local}T00:00:00.000Z`).getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (weekday + 6) % 7; // Mon→0, Sun→6
  return addDaysISO(local, -daysSinceMonday);
}

/** Inclusive [start, end] local-date range for the last `days` days up to `now`. */
export function trailingRange(
  now: Date,
  days: number,
  tz: string,
): { start: string; end: string } {
  const end = localDateISO(now, tz);
  return { start: addDaysISO(end, -(days - 1)), end };
}
