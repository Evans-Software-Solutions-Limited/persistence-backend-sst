/**
 * Client-side streak derivation (06-progress-goals, Phase 06.7). Pure.
 *
 * When offline, the UI derives "current streak" from cached habit_completions
 * by walking back from today and counting consecutive satisfied periods. On
 * reconnect the server engine reconciles and the cache refreshes — **server
 * wins** (e.g. a freeze-token spend the client can't see). See
 * design.md § Offline behaviour.
 *
 * Day bucketing prefers each completion's authoritative `localCompletedDate`
 * (the user-local day the server counts it for) and falls back to the calendar
 * date of `completedAt` only when absent — slicing `completedAt` alone drops
 * tz ≥ +12 toggles the server clamped to a different UTC day. A "grace" rule
 * mirrors every
 * streak app: a period the user simply hasn't completed *yet today* doesn't
 * break a streak that was alive in the previous period — the walk starts one
 * period back when the current period has no completion.
 */

import type { HabitCompletion } from "@/domain/models/habit-completion";
import type {
  HabitCompletionRule,
  HabitConfig,
} from "@/domain/models/habit-config";

export type StreakDerivationPeriod = "daily" | "weekly";

export interface DeriveStreakCompletion {
  completedAt: string | Date;
  /** Authoritative user-local day (YYYY-MM-DD); preferred over `completedAt`. */
  localCompletedDate?: string;
}

/** YYYY-MM-DD (UTC calendar date) for an ISO string or Date. */
function toDayISO(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
}

function addDays(dayISO: string, delta: number): string {
  const d = new Date(`${dayISO}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Monday (UTC) of the week containing `dayISO`. */
function weekStart(dayISO: string): string {
  const weekday = new Date(`${dayISO}T00:00:00.000Z`).getUTCDay(); // 0=Sun..6=Sat
  const sinceMonday = (weekday + 6) % 7;
  return addDays(dayISO, -sinceMonday);
}

/**
 * Count of consecutive satisfied periods ending at (or just before) `today`.
 *
 * - `daily`  → a period is a day satisfied by ≥1 completion that day.
 * - `weekly` → a period is a Mon–Sun week satisfied by ≥1 completion that week.
 *
 * Future-dated completions are ignored (the walk never moves forward). An empty
 * set, or a current-and-previous-period gap, yields 0.
 */
export function deriveStreak(
  completions: readonly DeriveStreakCompletion[],
  today: Date,
  period: StreakDerivationPeriod,
): number {
  if (completions.length === 0) return 0;

  const keyOf =
    period === "daily"
      ? (dayISO: string) => dayISO
      : (dayISO: string) => weekStart(dayISO);
  const step = period === "daily" ? 1 : 7;

  // Set of satisfied period keys. Bucket by the authoritative user-local day
  // (localCompletedDate) when present; fall back to the UTC slice of
  // completedAt only for rows that predate it.
  const satisfied = new Set<string>();
  for (const c of completions) {
    satisfied.add(keyOf(c.localCompletedDate ?? toDayISO(c.completedAt)));
  }

  const todayISO = toDayISO(today);
  let cursorKey = keyOf(todayISO);

  // Grace: if the current period has no completion yet, start the walk at the
  // previous period (a not-yet-done today shouldn't zero a live streak).
  if (!satisfied.has(cursorKey)) {
    cursorKey = keyOf(
      addDays(period === "daily" ? todayISO : cursorKey, -step),
    );
  }

  let count = 0;
  while (satisfied.has(cursorKey)) {
    count += 1;
    cursorKey = keyOf(addDays(cursorKey, -step));
  }
  return count;
}

// ─────────────────────────────────────────────────────────────────────────
// Collection habit streak (18-habit-setup, Phase 18.7 — T-18.7.4).
//
// The offline mirror of the backend `application/streaks/collection.ts` +
// `habitCollectionCron.ts`. A single WEEKLY streak counts every enabled habit
// together: a week is satisfied when EVERY enabled habit meets its weekly
// target. We walk back from the current week counting satisfied weeks, scoring
// each week against the config that was EFFECTIVE at that week's Monday
// (`effectiveFrom` + any promoted pending edit), skipping holiday weeks as
// neutral. Best-effort; the server engine reconciles on reconnect (server wins).
// ─────────────────────────────────────────────────────────────────────────

/** A planned all-habits pause (streak_holidays) — a week it covers is neutral. */
export interface StreakHolidayRange {
  /** YYYY-MM-DD inclusive. */
  startDate: string;
  endDate: string;
}

export interface DeriveCollectionStreakOptions {
  holidays?: readonly StreakHolidayRange[];
  /** Qualifying gym sessions keyed by YYYY-MM-DD (the local day logged). */
  gymSessionDays?: readonly string[];
}

/** The config as it applied to one scored week, after the effective-from gate. */
interface EffectiveConfig {
  completionRule: HabitCompletionRule;
  targetValue: number;
  daysPerWeek: number | null;
  tolerancePct: number | null;
}

/**
 * Whether a single habit's WEEK is met — mirrors `collection.ts weekMet`:
 *  - `count` (Gym): met when qualifying sessions `>= ceil(target)`.
 *  - `value_gte` / `within_tolerance`: met when qualifying days `>= daysPerWeek`.
 */
export function collectionWeekMet(
  cfg: EffectiveConfig,
  qualifyingDays: number,
  sessionCount: number,
): boolean {
  if (cfg.completionRule === "count") {
    return sessionCount >= Math.ceil(cfg.targetValue);
  }
  const need = cfg.daysPerWeek ?? 1;
  return qualifyingDays >= need;
}

/** Monday (UTC anchor) of the week containing `dayISO` — reuses `weekStart`. */
function mondayOf(dayISO: string): string {
  return weekStart(dayISO);
}

/**
 * The config effective at `weekStartISO` for a habit: the live config only if
 * `effectiveFrom <= weekStart` (a fresh enable in the future is loggable but
 * NOT yet scored → returns null so it's excluded from the requirement), with a
 * pending edit folded in when its `from <= weekStart` (§ 4.4 promotion). When
 * `effectiveFrom` is absent (older wire), the habit is treated as already
 * effective.
 */
function effectiveConfigForWeek(
  cfg: HabitConfig,
  weekStartISO: string,
): EffectiveConfig | null {
  if (cfg.effectiveFrom && cfg.effectiveFrom > weekStartISO) return null;

  let targetValue = cfg.targetValue;
  let daysPerWeek = cfg.daysPerWeek;
  let tolerancePct = cfg.tolerancePct;
  let enabled = true;

  const p = cfg.pending;
  if (p && p.from <= weekStartISO) {
    if (p.enabled === false) enabled = false;
    if (typeof p.targetValue === "number") targetValue = p.targetValue;
    if (p.daysPerWeek !== undefined) daysPerWeek = p.daysPerWeek;
    if (p.tolerancePct !== undefined) tolerancePct = p.tolerancePct;
  }
  if (!enabled) return null;

  return {
    completionRule: cfg.completionRule,
    targetValue,
    daysPerWeek,
    tolerancePct,
  };
}

/** Whether the Mon–Sun week starting `weekStartISO` intersects a holiday. */
function weekIsHoliday(
  weekStartISO: string,
  holidays: readonly StreakHolidayRange[],
): boolean {
  const weekEndISO = addDays(weekStartISO, 6);
  return holidays.some(
    (h) => h.startDate <= weekEndISO && h.endDate >= weekStartISO,
  );
}

/**
 * Client-side COLLECTION habit streak (STORY-004 AC 4.5, STORY-009 AC 9.4).
 *
 * @param habits    Cached configs (all five categories; disabled ones ignored).
 * @param completionsByGoal  Completions keyed by goalId (each carries a value +
 *                           `localCompletedDate` — preferred for bucketing).
 * @param today     User-local "now" (a Date; only its calendar day matters).
 * @param opts      Holidays (neutral weeks) + optional gym session days.
 *
 * Returns the number of consecutive satisfied weeks ending at (or, via the
 * grace rule, just before) the current week. A week with no enabled habit
 * effective is not satisfied. Holiday weeks are neutral: they neither advance
 * nor break the walk (skipped).
 */
export function deriveCollectionStreak(
  habits: readonly HabitConfig[],
  completionsByGoal: ReadonlyMap<string, readonly HabitCompletion[]>,
  today: Date,
  opts: DeriveCollectionStreakOptions = {},
): number {
  const holidays = opts.holidays ?? [];
  const gymSessionDays = new Set(opts.gymSessionDays ?? []);
  const enabled = habits.filter((h) => h.enabled);
  if (enabled.length === 0) return 0;

  const todayISO = toDayISO(today);

  // Per-goal set of days that HIT the target, resolved lazily per week against
  // the week-effective config (target can differ week-to-week via pending).
  const dayValuesByGoal = new Map<string, Map<string, number>>();
  for (const [goalId, rows] of completionsByGoal) {
    const byDay = new Map<string, number>();
    for (const c of rows) {
      const day = c.localCompletedDate ?? toDayISO(c.completedAt);
      // Sum values on a day (multiple logs) — mirrors the backend's daily sum.
      byDay.set(day, (byDay.get(day) ?? 0) + (c.value ?? 0));
    }
    dayValuesByGoal.set(goalId, byDay);
  }

  const weekSatisfied = (weekStartISO: string): boolean => {
    const weekDays = Array.from({ length: 7 }, (_, i) =>
      addDays(weekStartISO, i),
    );
    const scored: EffectiveConfig[] = [];
    for (const h of enabled) {
      const eff = effectiveConfigForWeek(h, weekStartISO);
      if (!eff) continue; // not yet effective this week (fresh enable)
      scored.push(eff);

      // within_tolerance (Calories) DIVERGES from the backend on purpose here.
      // The engine's real scoring source is `nutrition_entries` (design.md §
      // 4.1's M9-gate wording; collection.ts), never `habit_completions` — and
      // since the regression fix, the mobile grid no longer writes a
      // completion row for Calories at all (its tile is read-only, deep-
      // linking to Fuel). Without a reliable offline day-kcal total to check
      // against, this offline mirror treats every within_tolerance week as
      // MET (best-effort; server wins per design.md § 8) rather than reading
      // stale/absent habit_completions and reporting a false miss. Water/
      // Steps/Sleep (value_gte) and Gym (count) still mirror collection.ts
      // exactly — only this one rule is a deliberate divergence.
      if (eff.completionRule === "within_tolerance") continue;

      let qualifyingDays = 0;
      let sessionCount = 0;
      if (eff.completionRule === "count") {
        sessionCount = weekDays.filter((d) => gymSessionDays.has(d)).length;
      } else {
        const byDay = h.goalId
          ? (dayValuesByGoal.get(h.goalId) ?? new Map<string, number>())
          : new Map<string, number>();
        for (const d of weekDays) {
          const v = byDay.get(d);
          if (v === undefined) continue;
          if (v >= eff.targetValue) qualifyingDays += 1;
        }
      }
      if (!collectionWeekMet(eff, qualifyingDays, sessionCount)) {
        return false; // one enabled+effective habit missed → week not satisfied
      }
    }
    // Non-empty requirement: at least one enabled habit was effective this week.
    return scored.length > 0;
  };

  let cursorWeek = mondayOf(todayISO);

  // Grace: an in-progress current week that isn't satisfied YET shouldn't zero
  // a live streak — start the walk one week back (unless the current week is a
  // holiday, handled in the loop). Mirrors deriveStreak's grace rule.
  if (!weekIsHoliday(cursorWeek, holidays) && !weekSatisfied(cursorWeek)) {
    cursorWeek = addDays(cursorWeek, -7);
  }

  let count = 0;
  // Cap the walk so a pathological cache can't loop forever (≈10 years back).
  for (let i = 0; i < 520; i += 1) {
    if (weekIsHoliday(cursorWeek, holidays)) {
      // Neutral: skip the week without advancing or breaking the walk.
      cursorWeek = addDays(cursorWeek, -7);
      continue;
    }
    if (!weekSatisfied(cursorWeek)) break;
    count += 1;
    cursorWeek = addDays(cursorWeek, -7);
  }
  return count;
}
