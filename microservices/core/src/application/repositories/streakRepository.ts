import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  achievements,
  bodyMeasurements,
  habitCompletions,
  habitConfigs,
  nutritionEntries,
  nutritionTargets,
  profiles,
  streakHolidays,
  userAchievements,
  userGoals,
  userStreaks,
  workoutSessions,
  type HabitCompletion,
  type UserStreak,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type {
  StreakAdvanceFields,
  StreakDataPort,
  StreakType,
} from "../streaks/engine";
import type { StreakCronDataPort } from "../streaks/cron";
import {
  lastCompletedPeriodEndISO,
  localDateISO,
  periodsBetween,
  periodEndForDateISO,
  periodStartFromEndISO,
  previousPeriodEndISO,
  type Period,
} from "../streaks/period";
import { PERIODS_PER_FREEZE_TOKEN } from "../streaks/milestones";
import {
  collectionSatisfied,
  type HabitWeekAggregate,
} from "../streaks/collection";
import type { HabitCompletionRule } from "../habits/habitCategories";
import { resolveCalorieHabitTarget } from "../habits/habitCategories";
import type { HabitGridRow } from "../habits/habitsView";
import { HabitConfigRepository } from "./habitConfigRepository";

/** Normalise a Postgres `::date` cell: postgres-js returns a JS `Date` for the
 * real driver, but the vitest mocks stub plain strings — both must collapse
 * to the same YYYY-MM-DD key (Inspector note, mirrors
 * VolumeRepository.dailyVolume / ClientDetailRepository.dailyKcalTotals). */
function normalizeDateCell(cell: unknown): string {
  return cell instanceof Date
    ? cell.toISOString().slice(0, 10)
    : String(cell).slice(0, 10);
}

/**
 * DB-backed implementation of the streak engine + cron data ports
 * (06-progress-goals, Phase 06.2). All user-local time handling is pushed
 * into Postgres via `AT TIME ZONE` so the JS side only deals in instants and
 * calendar-date strings (see streaks/period.ts).
 *
 * Ownership: every query is scoped by `user_id`. Streak rows carry their own
 * userId, so the engine reads it from the row, never from a request body.
 */
export class StreakRepository implements StreakDataPort, StreakCronDataPort {
  static readonly key = "StreakRepository";

  async getUserTimezone(userId: string): Promise<string> {
    const db = getDb();
    const rows = await db
      .select({ tz: profiles.timezone })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    return rows[0]?.tz ?? "Europe/London";
  }

  /**
   * Streaks the on-write engine should evaluate: `active` AND `broken`.
   * Broken streaks are included so the next satisfied period RESTARTS them at
   * count 1 (persistBreak zeroes current_count, so the engine's `+1` lands on
   * 1 and persistAdvance flips status back to 'active') — without this a
   * broken streak was a terminal dead end, since nothing else creates or
   * revives user_streaks rows (Inspector finding, PR #116). `paused` stays
   * excluded — pause semantics are explicit user intent (cross-cuts § 3.5).
   */
  async getActiveStreaksByType(
    userId: string,
    streakType: StreakType,
  ): Promise<UserStreak[]> {
    const db = getDb();
    return db
      .select()
      .from(userStreaks)
      .where(
        and(
          eq(userStreaks.userId, userId),
          eq(userStreaks.streakType, streakType),
          sql`${userStreaks.status} IN ('active','broken')`,
        ),
      );
  }

  async getActiveStreaks(): Promise<UserStreak[]> {
    const db = getDb();
    return db
      .select()
      .from(userStreaks)
      .where(eq(userStreaks.status, "active"));
  }

  /** All of a user's active streaks (You/Progress StreakHero, 06.10). */
  async getActiveStreaksForUser(userId: string): Promise<UserStreak[]> {
    const db = getDb();
    return db
      .select()
      .from(userStreaks)
      .where(
        and(eq(userStreaks.userId, userId), eq(userStreaks.status, "active")),
      );
  }

  /**
   * Distinct user ids with an active-or-broken `nutrition_streak` — the set the
   * nightly nutrition advance pass evaluates (M9). Includes `broken` so a
   * satisfied day can restart a broken streak via the engine's restart path.
   */
  async getNutritionStreakUserIds(): Promise<string[]> {
    const db = getDb();
    const rows = await db
      .selectDistinct({ userId: userStreaks.userId })
      .from(userStreaks)
      .where(
        and(
          eq(userStreaks.streakType, "nutrition_streak"),
          sql`${userStreaks.status} IN ('active','broken')`,
        ),
      );
    return rows.map((r) => r.userId);
  }

  async isPeriodSatisfied(
    streak: UserStreak,
    startDate: string,
    endDate: string,
    tz: string,
  ): Promise<boolean> {
    const db = getDb();

    if (streak.streakType === "workout_streak") {
      // ≥ N completed sessions in the window; N = source goal's target_value
      // (default 1 for ad-hoc / unset goals).
      const n = await this.resolveWorkoutThreshold(streak.sourceGoalId);
      const rows = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.userId, streak.userId),
            eq(workoutSessions.status, "completed"),
            sql`(${workoutSessions.completedAt} AT TIME ZONE ${tz})::date BETWEEN ${startDate} AND ${endDate}`,
          ),
        );
      return (rows[0]?.c ?? 0) >= n;
    }

    if (streak.streakType === "habit_streak") {
      // The COLLECTION habit streak (source_goal_id NULL, weekly): satisfied
      // when EVERY enabled habit's week is met (design.md § 4.2). Each habit is
      // scored against the config effective at the week's Monday — the
      // aggregate builder applies the `effective_from <= startDate` gate.
      if (streak.sourceGoalId === null) {
        const aggregates = await this.getCollectionHabitAggregates(
          streak.userId,
          startDate,
          endDate,
          tz,
        );
        return collectionSatisfied(aggregates);
      }

      // Legacy per-goal habit streak (pre-collection model): ≥ 1 completion for
      // the source goal in the window. Buckets by the STORED
      // local_completed_date (written from the user's tz at insert time).
      const rows = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(habitCompletions)
        .where(
          and(
            eq(habitCompletions.userId, streak.userId),
            eq(habitCompletions.goalId, streak.sourceGoalId),
            sql`${habitCompletions.localCompletedDate} BETWEEN ${startDate} AND ${endDate}`,
          ),
        );
      return (rows[0]?.c ?? 0) >= 1;
    }

    if (streak.streakType === "measurement_streak") {
      // ≥ 1 body measurement in the window.
      const rows = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(bodyMeasurements)
        .where(
          and(
            eq(bodyMeasurements.userId, streak.userId),
            sql`(${bodyMeasurements.measuredAt} AT TIME ZONE ${tz})::date BETWEEN ${startDate} AND ${endDate}`,
          ),
        );
      return (rows[0]?.c ?? 0) >= 1;
    }

    // nutrition_streak (M9, 13-nutrition-tracking) — the day's total kcal must
    // fall within the user's target ± 10% (cross-cuts § 3.1). Needs a target
    // set; with none we can't evaluate "in range", so the day can't satisfy.
    const targetRows = await db
      .select({ daily: nutritionTargets.dailyKcal })
      .from(nutritionTargets)
      .where(eq(nutritionTargets.userId, streak.userId))
      .limit(1);
    const target = targetRows[0]?.daily;
    if (target == null) return false;
    const t = Number(target);
    if (!Number.isFinite(t) || t <= 0) return false;

    const sumRows = await db
      .select({
        total: sql<number>`coalesce(sum(${nutritionEntries.kcal}), 0)::float8`,
      })
      .from(nutritionEntries)
      .where(
        and(
          eq(nutritionEntries.userId, streak.userId),
          sql`(${nutritionEntries.loggedAt} AT TIME ZONE ${tz})::date BETWEEN ${startDate} AND ${endDate}`,
        ),
      );
    const total = Number(sumRows[0]?.total ?? 0);
    // A day with no logging totals 0 → below 90% of any positive target → not
    // satisfied (correctly counts as a miss the cron then sweeps).
    return total >= t * 0.9 && total <= t * 1.1;
  }

  /**
   * The per-habit week aggregates for the user's COLLECTION streak over the
   * window [startDate, endDate] (design.md § 4.1). Only habits that are active
   * AND already effective (`effective_from <= startDate` — the anti-gaming gate,
   * § 4.4) are included; a fresh enable whose effective_from is next week is
   * loggable but not yet part of the requirement.
   *
   * For each habit we compute the aggregate its rule needs:
   *  - `value_gte` → count of DAYS whose summed value >= target;
   *  - `within_tolerance` → count of DAYS whose kcal total is within
   *    target ± tolerance_pct% (M9 nutrition is live, so evaluated for real);
   *  - `count` (Gym) → count of completed workout_sessions in the window.
   *
   * The two day-count queries use `db.execute` with a GROUP-BY-ordinal
   * subquery, NOT a reused parameterized sql`` expr in SELECT+GROUP BY (that
   * throws Postgres 42803 — reference_drizzle_groupby_param_bug). Rendered SQL
   * is asserted in the repository test.
   */
  async getCollectionHabitAggregates(
    userId: string,
    startDate: string,
    endDate: string,
    tz: string,
  ): Promise<HabitWeekAggregate[]> {
    const db = getDb();

    const enabled = await db
      .select({
        goalId: habitConfigs.goalId,
        completionRule: habitConfigs.completionRule,
        targetValue: habitConfigs.targetValue,
        daysPerWeek: habitConfigs.daysPerWeek,
        tolerancePct: habitConfigs.tolerancePct,
      })
      .from(habitConfigs)
      .innerJoin(userGoals, eq(habitConfigs.goalId, userGoals.id))
      .where(
        and(
          eq(habitConfigs.userId, userId),
          eq(userGoals.isActive, true),
          sql`${habitConfigs.effectiveFrom} <= ${startDate}`,
        ),
      );

    // Calories (within_tolerance) is scored against the user's Nutrition
    // Fuel-Target (daily_kcal), NOT the habit-config snapshot — that's the
    // single source of truth, so this collection streak agrees with the
    // nutrition streak above (both band off the same daily_kcal). Fetched once,
    // and only when a calorie habit is actually enabled.
    const hasCalorieHabit = enabled.some(
      (h) => h.completionRule === "within_tolerance",
    );
    const dailyKcal = hasCalorieHabit
      ? await this.getUserDailyKcal(userId)
      : null;

    const out: HabitWeekAggregate[] = [];
    for (const h of enabled) {
      const rule = h.completionRule as HabitCompletionRule;
      const target =
        rule === "within_tolerance"
          ? resolveCalorieHabitTarget(dailyKcal)
          : Number(h.targetValue);
      let qualifyingDays = 0;
      let sessionCount = 0;

      if (rule === "value_gte") {
        qualifyingDays = await this.countValueGteDays(
          userId,
          h.goalId,
          startDate,
          endDate,
          target,
        );
      } else if (rule === "within_tolerance") {
        const tol = h.tolerancePct != null ? Number(h.tolerancePct) : 0;
        qualifyingDays = await this.countCalorieToleranceDays(
          userId,
          startDate,
          endDate,
          tz,
          target,
          tol,
        );
      } else {
        // count (Gym): completed sessions in the window.
        const rows = await db
          .select({ c: sql<number>`count(*)::int` })
          .from(workoutSessions)
          .where(
            and(
              eq(workoutSessions.userId, userId),
              eq(workoutSessions.status, "completed"),
              sql`(${workoutSessions.completedAt} AT TIME ZONE ${tz})::date BETWEEN ${startDate} AND ${endDate}`,
            ),
          );
        sessionCount = rows[0]?.c ?? 0;
      }

      out.push({
        goalId: h.goalId,
        completionRule: rule,
        targetValue: target,
        daysPerWeek: h.daysPerWeek ?? null,
        tolerancePct: h.tolerancePct != null ? Number(h.tolerancePct) : null,
        qualifyingDays,
        sessionCount,
      });
    }
    return out;
  }

  /**
   * Count DAYS in [startDate, endDate] whose SUMMED habit_completions.value for
   * `goalId` clears `target` (value_gte, design.md § 4.1). Buckets on the stored
   * `local_completed_date` (same grain as the dedup index + the grid). Grouped
   * by ordinal in a subquery so the parameterized sum expr is never reused
   * across SELECT and GROUP BY (Postgres 42803 guard).
   */
  private async countValueGteDays(
    userId: string,
    goalId: string,
    startDate: string,
    endDate: string,
    target: number,
  ): Promise<number> {
    const db = getDb();
    const rows = (await db.execute(sql`
      SELECT count(*)::int AS days FROM (
        SELECT ${habitCompletions.localCompletedDate}
        FROM ${habitCompletions}
        WHERE ${habitCompletions.userId} = ${userId}
          AND ${habitCompletions.goalId} = ${goalId}
          AND ${habitCompletions.localCompletedDate} BETWEEN ${startDate} AND ${endDate}
        GROUP BY 1
        HAVING coalesce(sum(${habitCompletions.value}), 0) >= ${target}
      ) d
    `)) as unknown as Array<{ days: number }>;
    return Number(rows[0]?.days ?? 0);
  }

  /**
   * The user's current Nutrition Fuel-Target `daily_kcal`, or null when none is
   * set. Used to score the Calories habit against the same target as the
   * nutrition streak (single source of truth) rather than the habit-config
   * snapshot, which could drift after the user edits their Fuel target.
   */
  private async getUserDailyKcal(userId: string): Promise<number | null> {
    const db = getDb();
    const rows = await db
      .select({ daily: nutritionTargets.dailyKcal })
      .from(nutritionTargets)
      .where(eq(nutritionTargets.userId, userId))
      .limit(1);
    const v = rows[0]?.daily;
    return v == null ? null : Number(v);
  }

  /**
   * Count DAYS in [startDate, endDate] whose kcal total falls within
   * `target ± tolerancePct%` (within_tolerance / Calories, design.md § 4.1).
   * Buckets nutrition_entries by user-local day (`AT TIME ZONE tz`) — M9's
   * nutrition_entries table is live, so this is the REAL evaluation, not the
   * spec's M9-gated treated-as-met fallback. Grouped by ordinal in a subquery
   * (42803 guard). A tolerance of 0 collapses to an exact-target day.
   */
  private async countCalorieToleranceDays(
    userId: string,
    startDate: string,
    endDate: string,
    tz: string,
    target: number,
    tolerancePct: number,
  ): Promise<number> {
    const db = getDb();
    const factor = tolerancePct / 100;
    const lower = target * (1 - factor);
    const upper = target * (1 + factor);
    const rows = (await db.execute(sql`
      SELECT count(*)::int AS days FROM (
        SELECT (${nutritionEntries.loggedAt} AT TIME ZONE ${tz})::date AS d
        FROM ${nutritionEntries}
        WHERE ${nutritionEntries.userId} = ${userId}
          AND (${nutritionEntries.loggedAt} AT TIME ZONE ${tz})::date BETWEEN ${startDate} AND ${endDate}
        GROUP BY 1
        HAVING coalesce(sum(${nutritionEntries.kcal}), 0) BETWEEN ${lower} AND ${upper}
      ) t
    `)) as unknown as Array<{ days: number }>;
    return Number(rows[0]?.days ?? 0);
  }

  /**
   * DERIVED per-day Home-grid rows for Gym (`count`) + Calories
   * (`within_tolerance`) — the two habit categories `buildHabitsGrid` can
   * never fill from `habit_completions` because neither ever writes a
   * completion row (BRIEF-7 QA-1..QA-4, device-QA sweep; design.md § 1.1).
   * This computes the SAME per-day qualification the collection streak scores
   * (`getCollectionHabitAggregates`), just resolved to actual qualifying DAYS
   * within the grid's own rolling window instead of a weekly count, and over
   * whatever window the caller passes — the Home grid's window is [today-6 …
   * today] (`habitsGridWindow`), which is NOT the Mon–Sun collection week, so
   * this deliberately takes `window` as data rather than recomputing it.
   *
   * Every ACTIVE Gym/Calories `habit_configs` row gets a row here regardless
   * of `effective_from` or whether it has any qualifying days yet (an
   * all-false row) — unlike the collection streak, the grid is a completion
   * *history* render, not a streak-eligibility gate, so a freshly-enabled
   * habit still needs its tile to show up. Calories is scored against the
   * user's live Nutrition Fuel-Target (`getUserDailyKcal` +
   * `resolveCalorieHabitTarget`), never the `habit_configs` snapshot, for the
   * same single-source-of-truth reason `getCollectionHabitAggregates` does —
   * so the grid and the streak can never disagree on a given day.
   */
  async getDerivedHabitGridRows(
    userId: string,
    window: string[],
    tz: string,
  ): Promise<HabitGridRow[]> {
    if (window.length === 0) return [];
    const db = getDb();
    const startDate = window[0];
    const endDate = window[window.length - 1];

    const enabled = await db
      .select({
        goalId: habitConfigs.goalId,
        category: habitConfigs.category,
        tolerancePct: habitConfigs.tolerancePct,
      })
      .from(habitConfigs)
      .innerJoin(userGoals, eq(habitConfigs.goalId, userGoals.id))
      .where(
        and(
          eq(habitConfigs.userId, userId),
          eq(userGoals.isActive, true),
          inArray(habitConfigs.category, ["gym", "calories"]),
        ),
      );
    if (enabled.length === 0) return [];

    const hasCalorieHabit = enabled.some((h) => h.category === "calories");
    const dailyKcal = hasCalorieHabit
      ? await this.getUserDailyKcal(userId)
      : null;
    const calorieTarget = resolveCalorieHabitTarget(dailyKcal);

    const rows: HabitGridRow[] = [];
    for (const h of enabled) {
      const qualifyingDays =
        h.category === "gym"
          ? await this.getCompletedWorkoutDaysInWindow(
              userId,
              startDate,
              endDate,
              tz,
            )
          : await this.getCalorieToleranceDaysInWindow(
              userId,
              startDate,
              endDate,
              tz,
              calorieTarget,
              h.tolerancePct != null ? Number(h.tolerancePct) : 0,
            );
      rows.push({
        goalId: h.goalId,
        days: window.map((d) => qualifyingDays.has(d)),
      });
    }
    return rows;
  }

  /**
   * DERIVED synthetic `habit_completions`-shaped rows for Gym + Calories, for
   * `GET /habit-completions?includeDerived=true` (BRIEF-7 QA-1..QA-4 mobile
   * half). The mobile Home grid reads `GET /habit-completions` directly (not
   * `GET /users/me/home`), so it needs the same derived qualifying days
   * `getDerivedHabitGridRows` computes for the web/home aggregate, surfaced
   * as completion-shaped rows it can bucket exactly like a real one
   * (`buildHabitGrid` on mobile buckets by `goalId` + `localCompletedDate`).
   *
   * Reuses `getDerivedHabitGridRows` verbatim (no re-querying) so the two
   * endpoints can never disagree on which days qualify. Computed fresh every
   * request (derive-on-read) — NEVER persisted. The synthetic id
   * (`derived-<goalId>-<date>`) is a caller-side signal: mobile must treat
   * any `derived-`-prefixed row as read-only and never route it through the
   * toggle mutation / sync-queue path.
   */
  async getDerivedHabitCompletions(
    userId: string,
    window: string[],
    tz: string,
  ): Promise<HabitCompletion[]> {
    const rows = await this.getDerivedHabitGridRows(userId, window, tz);
    const completions: HabitCompletion[] = [];
    for (const row of rows) {
      row.days.forEach((met, i) => {
        if (!met) return;
        const date = window[i];
        completions.push({
          id: `derived-${row.goalId}-${date}`,
          userId,
          goalId: row.goalId,
          completedAt: new Date(`${date}T12:00:00.000Z`),
          localCompletedDate: date,
          value: null,
        });
      });
    }
    return completions;
  }

  /**
   * The set of local days in [startDate, endDate] with >= 1 completed
   * `workout_session` (Gym `count` rule). Bucketed identically to
   * `getCollectionHabitAggregates`' session-count query (same `AT TIME ZONE`
   * expr + `completed` status filter) so the grid and the collection streak
   * can never disagree on which days count.
   */
  private async getCompletedWorkoutDaysInWindow(
    userId: string,
    startDate: string,
    endDate: string,
    tz: string,
  ): Promise<Set<string>> {
    const db = getDb();
    const dayExpr = sql<string>`(${workoutSessions.completedAt} AT TIME ZONE ${tz})::date`;
    const rows = await db
      .select({ day: dayExpr })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.status, "completed"),
          sql`(${workoutSessions.completedAt} AT TIME ZONE ${tz})::date BETWEEN ${startDate} AND ${endDate}`,
        ),
      )
      // Ordinal GROUP BY — a second render of `dayExpr` here would bind a NEW
      // parameter than the one in SELECT, tripping Postgres 42803
      // (reference_drizzle_groupby_param_bug; mirrors VolumeRepository.dailyVolume).
      .groupBy(sql`1`);
    return new Set(rows.map((r) => normalizeDateCell(r.day)));
  }

  /**
   * The set of local days in [startDate, endDate] whose summed
   * `nutrition_entries` kcal falls within `target ± tolerancePct%` (Calories
   * `within_tolerance` rule). Mirrors `countCalorieToleranceDays`'s bucketing
   * + inclusivity exactly (same `HAVING ... BETWEEN lower AND upper`), so the
   * grid tile and the collection streak's day-count agree bound-for-bound —
   * including the deliberately non-monotonic upper bound (design.md § 1.1:
   * eating past it un-completes the day; this is not "fixed" to `>= target`).
   */
  private async getCalorieToleranceDaysInWindow(
    userId: string,
    startDate: string,
    endDate: string,
    tz: string,
    target: number,
    tolerancePct: number,
  ): Promise<Set<string>> {
    const db = getDb();
    const factor = tolerancePct / 100;
    const lower = target * (1 - factor);
    const upper = target * (1 + factor);
    const rows = (await db.execute(sql`
      SELECT (${nutritionEntries.loggedAt} AT TIME ZONE ${tz})::date AS d
      FROM ${nutritionEntries}
      WHERE ${nutritionEntries.userId} = ${userId}
        AND (${nutritionEntries.loggedAt} AT TIME ZONE ${tz})::date BETWEEN ${startDate} AND ${endDate}
      GROUP BY 1
      HAVING coalesce(sum(${nutritionEntries.kcal}), 0) BETWEEN ${lower} AND ${upper}
    `)) as unknown as Array<{ d: unknown }>;
    return new Set(rows.map((r) => normalizeDateCell(r.d)));
  }

  /**
   * Whether the user has an active/any streak_holiday intersecting the week
   * [startDate, endDate] (design.md § 4.2 step 1). A holiday with `goal_id`
   * NULL covers ALL habits (the only kind the setup flow declares); a
   * per-goal holiday would still pause the collection since the collection is
   * "all habits". Ranges intersect when `start_date <= endDate AND end_date >=
   * startDate`.
   */
  async weekIntersectsHoliday(
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<boolean> {
    const db = getDb();
    const rows = await db
      .select({ id: streakHolidays.id })
      .from(streakHolidays)
      .where(
        and(
          eq(streakHolidays.userId, userId),
          sql`${streakHolidays.startDate} <= ${endDate}`,
          sql`${streakHolidays.endDate} >= ${startDate}`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * The user's collection habit-streak row (source_goal_id NULL, weekly), or
   * null. Used by the mid-week at-risk pass + the holiday-pause cron step.
   */
  async getCollectionHabitStreak(userId: string): Promise<UserStreak | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(userStreaks)
      .where(
        and(
          eq(userStreaks.userId, userId),
          eq(userStreaks.streakType, "habit_streak"),
          isNull(userStreaks.sourceGoalId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Distinct user ids owning a collection habit streak (source_goal_id NULL,
   * habit_streak) in ANY status — the set the nightly collection pass sweeps
   * (holiday pause/resume, pending-config promotion, satisfied-week advance,
   * mid-week at-risk). Includes `paused`/`broken` so a resume or restart can
   * fire.
   */
  async getCollectionHabitStreakUserIds(): Promise<string[]> {
    const db = getDb();
    const rows = await db
      .selectDistinct({ userId: userStreaks.userId })
      .from(userStreaks)
      .where(
        and(
          eq(userStreaks.streakType, "habit_streak"),
          isNull(userStreaks.sourceGoalId),
        ),
      );
    return rows.map((r) => r.userId);
  }

  /**
   * Pause a collection streak for a holiday week (design.md § 4.2 step 1):
   * status → `paused`, `last_period_end` advanced over the holiday week so the
   * generic sweep won't later treat it as missed, NO count/token change. Pinned
   * to the snapshot `last_period_end` for race safety. Returns the row or null.
   */
  async persistHolidayPause(
    streakId: string,
    fields: { lastPeriodEnd: string; snapshotLastPeriodEnd: string },
  ): Promise<UserStreak | null> {
    const db = getDb();
    const rows = await db
      .update(userStreaks)
      .set({
        status: "paused",
        lastPeriodEnd: fields.lastPeriodEnd,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userStreaks.id, streakId),
          eq(userStreaks.lastPeriodEnd, fields.snapshotLastPeriodEnd),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Resume a paused collection streak once the holiday range has passed
   * (design.md § 4.3 — the existing M4 resume path). status → `active`, no
   * count/token change. The next satisfied week advances it normally.
   */
  /**
   * Promote a user's pending habit-config edits due today (delegates to
   * {@link HabitConfigRepository.promotePendingEdits}). Exposed on the streak
   * repository so the collection cron's single data port carries every method
   * the pass needs (§ 4.3 / T-18.5.3). Returns the count promoted.
   */
  async promoteHabitPendingEdits(userId: string, now: Date): Promise<number> {
    return new HabitConfigRepository().promotePendingEdits(userId, now);
  }

  async persistHolidayResume(streakId: string): Promise<UserStreak | null> {
    const db = getDb();
    const rows = await db
      .update(userStreaks)
      .set({ status: "active", updatedAt: new Date() })
      .where(
        and(eq(userStreaks.id, streakId), eq(userStreaks.status, "paused")),
      )
      .returning();
    return rows[0] ?? null;
  }

  private async resolveWorkoutThreshold(
    sourceGoalId: string | null,
  ): Promise<number> {
    if (!sourceGoalId) return 1;
    const db = getDb();
    const rows = await db
      .select({ tv: userGoals.targetValue })
      .from(userGoals)
      .where(eq(userGoals.id, sourceGoalId))
      .limit(1);
    const tv = rows[0]?.tv != null ? Number(rows[0].tv) : NaN;
    return Number.isFinite(tv) && tv > 0 ? Math.ceil(tv) : 1;
  }

  /**
   * Conditional advance — pinned to the EXACT snapshot `last_period_end` the
   * engine read, like every other streak writer (Inspector findings, PR #116).
   *
   * The engine SETs ABSOLUTE snapshot-derived values (currentCount =
   * snapshot.count + 1, etc.), so the write is only correct if the row is still
   * exactly as the engine SELECTed it. A `last_period_end < target` guard was
   * too lenient: it bails when a concurrent writer raced PAST the target, but
   * NOT when one moved the row elsewhere within `(-∞, target)`. Two real races
   * slipped through that gap:
   *   - a concurrent `rollbackHabitAdvance` (tap-untap) regresses lpe AND
   *     current_count; `lpe < target` still matched, so the engine wrote its
   *     stale absolute count back over the rollback — drifting current_count
   *     and permanently inflating longest_count (never decremented); and
   *   - a cron `persistFreezeSpend` that covered PART of the same gap leaves an
   *     intermediate `lpe` still `< target`, so the engine advanced anyway and
   *     emitted a SECOND `freeze_token_applied` for the period the cron already
   *     notified (02:00 UTC is peak logging time across Asia/Oceania).
   * Pinning to `= snapshotLastPeriodEnd` makes ANY concurrent writer a clean
   * no-op null; the triggering event is durable, so the cron or the user's next
   * event re-evaluates against the fresh row.
   *
   * No status filter: the engine legitimately advances BOTH active and broken
   * rows (broken-revive restarts at 1), and `status: "active"` in the SET is
   * the revive itself — the lpe pin alone is the race guard.
   */
  async persistAdvance(
    streakId: string,
    fields: StreakAdvanceFields,
    snapshotLastPeriodEnd: string,
  ): Promise<UserStreak | null> {
    const db = getDb();
    const rows = await db
      .update(userStreaks)
      .set({
        currentCount: fields.currentCount,
        longestCount: fields.longestCount,
        lastPeriodEnd: fields.lastPeriodEnd,
        freezeTokens: fields.freezeTokens,
        status: "active",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userStreaks.id, streakId),
          eq(userStreaks.lastPeriodEnd, snapshotLastPeriodEnd),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  async unlockAchievement(
    userId: string,
    streakType: StreakType,
    threshold: number,
  ): Promise<{ achievementId: string; newlyUnlocked: boolean } | null> {
    const db = getDb();

    // Resolve the seeded achievement by (category, requirements) jsonb equality
    // — order-insensitive because jsonb is stored normalised.
    const requirements = JSON.stringify({ streak_type: streakType, threshold });
    const found = await db
      .select({ id: achievements.id })
      .from(achievements)
      .where(
        and(
          eq(achievements.category, "streak"),
          sql`${achievements.requirements} = ${requirements}::jsonb`,
        ),
      )
      .limit(1);

    const achievementId = found[0]?.id;
    if (!achievementId) return null;

    // Idempotent unlock — UNIQUE (user_id, achievement_id). A duplicate
    // returns no rows, so newlyUnlocked=false (the milestone already fired).
    const inserted = await db
      .insert(userAchievements)
      .values({ userId, achievementId })
      .onConflictDoNothing()
      .returning({ id: userAchievements.id });

    return { achievementId, newlyUnlocked: inserted.length > 0 };
  }

  /**
   * Cron freeze-spend. Conditional + relative: the cron sweeps a snapshot
   * taken at run start, so by the time it reaches a row the on-write engine
   * may already have spent the gap tokens and advanced `last_period_end`
   * (02:00 UTC is late morning across Asia/Oceania — peak logging time).
   *
   * The guard pins the row to the EXACT snapshot `last_period_end` the cron
   * computed `tokensSpent` against — not merely `last_period_end < target`. A
   * `< target` guard only catches the engine racing PAST the target; it misses
   * the engine advancing PARTWAY into the gap (snapshot < new < target), where
   * the stale `tokensSpent` would over-spend (e.g. a 1-period gap charged 2
   * tokens) — and on a streak at the freeze-token cap that lost token is real,
   * uncapped earnings can't make it back. Pinning to the snapshot turns any
   * concurrent advance into a clean no-op null; the next cron run sweeps the
   * fresh row (Inspector finding, PR #116).
   */
  async persistFreezeSpend(
    streakId: string,
    fields: {
      tokensSpent: number;
      lastPeriodEnd: string;
      snapshotLastPeriodEnd: string;
    },
  ): Promise<UserStreak | null> {
    const db = getDb();
    const rows = await db
      .update(userStreaks)
      .set({
        freezeTokens: sql`${userStreaks.freezeTokens} - ${fields.tokensSpent}`,
        lastPeriodEnd: fields.lastPeriodEnd,
        status: "active",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userStreaks.id, streakId),
          eq(userStreaks.status, "active"),
          sql`${userStreaks.freezeTokens} >= ${fields.tokensSpent}`,
          eq(userStreaks.lastPeriodEnd, fields.snapshotLastPeriodEnd),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Break a streak that fell behind. Pinned to the snapshot `last_period_end`
   * for the same reason as persistFreezeSpend — and the partial-race case is
   * even sharper here: if the engine advanced PARTWAY into the gap (e.g. a
   * just-revived streak that restarted at count 1 mid-sweep), a `< target`
   * guard would still match and zero a streak the user actively kept alive,
   * silently (the on-write run is fire-and-forget, so nothing surfaces the
   * loss). Pinning to the exact snapshot makes any concurrent advance a no-op
   * null; the next cron run re-evaluates the fresh row (Inspector finding,
   * PR #116).
   */
  async persistBreak(
    streakId: string,
    fields: { lastPeriodEnd: string; snapshotLastPeriodEnd: string },
  ): Promise<UserStreak | null> {
    const db = getDb();
    const rows = await db
      .update(userStreaks)
      .set({
        status: "broken",
        currentCount: 0,
        lastPeriodEnd: fields.lastPeriodEnd,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userStreaks.id, streakId),
          eq(userStreaks.status, "active"),
          eq(userStreaks.lastPeriodEnd, fields.snapshotLastPeriodEnd),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Conditionally roll back a habit-streak advance after a completion is
   * untoggled (DELETE /habit-completions). Fires only when (a) the streak's
   * `last_period_end` is exactly the period the deleted completion satisfied
   * and (b) no OTHER completion still satisfies that period — then decrements
   * `current_count` and regresses `last_period_end` one period. Without this,
   * tap-untap left a permanently advanced streak with zero completion rows
   * behind it — an empty grid next to a climbing counter (Inspector finding,
   * PR #116).
   *
   * The freeze token the rolled-back advance EARNED is clawed back too. An
   * advance mints a token whenever it lands `current_count` on a multiple of
   * PERIODS_PER_FREEZE_TOKEN (see freezeTokensAfterAdvance), so the rolled-back
   * period earned one exactly when the pre-rollback `current_count` is such a
   * multiple — decremented in a CASE on the column so it's atomic with the
   * count regress. Without this, tap-untap-tap re-runs the advance each time
   * and re-earns at the boundary, minting free tokens to the cap on demand
   * (Inspector finding, PR #116). Edge case: if the user was already AT the cap
   * when the boundary advance ran, the mint was a no-op, so this over-claws by
   * one — an acceptable conservative loss (a single legitimate advance re-earns
   * it) and the only way to fully avoid it would be to persist the pre-advance
   * balance. Returns the rolled-back row or null (nothing to do).
   */
  async rollbackHabitAdvance(
    userId: string,
    goalId: string,
    localDay: string,
  ): Promise<UserStreak | null> {
    const db = getDb();

    // The period grain (daily vs weekly) lives on the streak row.
    const streaks = await db
      .select()
      .from(userStreaks)
      .where(
        and(
          eq(userStreaks.userId, userId),
          eq(userStreaks.sourceGoalId, goalId),
          eq(userStreaks.streakType, "habit_streak"),
          eq(userStreaks.status, "active"),
        ),
      )
      .limit(1);
    const streak = streaks[0];
    if (!streak) return null;

    const period = streak.period as Period;
    const periodEnd = periodEndForDateISO(localDay, period);
    // Only the MOST RECENTLY counted period can be rolled back — earlier
    // periods are already locked into current_count history.
    if (streak.lastPeriodEnd !== periodEnd) return null;

    const periodStart = periodStartFromEndISO(periodEnd, period);
    const prevPeriodEnd = previousPeriodEndISO(periodEnd, period);

    const rows = await db
      .update(userStreaks)
      .set({
        currentCount: sql`GREATEST(${userStreaks.currentCount} - 1, 0)`,
        // Claw back the token this advance earned (only at a token-earning
        // boundary), bounded at 0. CASE on the column → atomic with the regress.
        freezeTokens: sql`CASE WHEN ${userStreaks.currentCount} % ${PERIODS_PER_FREEZE_TOKEN} = 0 THEN GREATEST(${userStreaks.freezeTokens} - 1, 0) ELSE ${userStreaks.freezeTokens} END`,
        lastPeriodEnd: prevPeriodEnd,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userStreaks.id, streak.id),
          eq(userStreaks.status, "active"),
          // Re-checked in the WHERE for race safety vs a concurrent advance.
          eq(userStreaks.lastPeriodEnd, periodEnd),
          sql`NOT EXISTS (
            SELECT 1 FROM habit_completions hc
            WHERE hc.user_id = ${userId}
              AND hc.goal_id = ${goalId}
              AND hc.local_completed_date BETWEEN ${periodStart} AND ${periodEnd}
          )`,
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Manual freeze-token spend (06.5 — the You/Progress "Use" button). Spends one
   * token PER missed period to PROTECT a behind streak: it decrements
   * `freeze_tokens` by `missed` AND fast-forwards `last_period_end` to the last
   * completed user-local period (mirroring the cron's `persistFreezeSpend` cost
   * exactly — cross-cuts § 3.5). Without the `last_period_end` advance the
   * nightly cron would re-detect the miss and break the streak; without the
   * per-period cost the manual path would be strictly cheaper than the cron
   * (Inspector findings, PR #116).
   *
   * Returns null (→ handler 400) when: the streak isn't owned by `userId`, is
   * not `active` (a broken/paused streak keeps its leftover tokens, but reviving
   * it would just mint a zombie active/count=0 streak), isn't actually behind
   * (no token wasted), OR doesn't have enough tokens to cover every missed
   * period (the cron will break it — manual can't partially protect).
   *
   * `now` is injectable for deterministic tests.
   */
  async spendTokenManually(
    userId: string,
    streakId: string,
    now: Date = new Date(),
  ): Promise<UserStreak | null> {
    const db = getDb();
    const existing = await db
      .select()
      .from(userStreaks)
      .where(
        and(
          eq(userStreaks.id, streakId),
          eq(userStreaks.userId, userId),
          eq(userStreaks.status, "active"),
        ),
      )
      .limit(1);
    const streak = existing[0];
    if (!streak) return null;

    const tz = await this.getUserTimezone(userId);
    const period = streak.period as Period;
    const lastCompletedEnd = lastCompletedPeriodEndISO(now, period, tz);
    // One token shields ONE missed period (cross-cuts § 3.5), matching the cron
    // — so a manual spend costs `missed` tokens, not a flat 1. Bail (→ 400)
    // when nothing's missed (no token wasted) OR there aren't enough tokens to
    // cover every missed period (the cron will break it; manual can't partially
    // protect). This keeps the manual + automatic paths symmetric.
    const missed = periodsBetween(
      streak.lastPeriodEnd,
      lastCompletedEnd,
      period,
    );
    if (missed <= 0 || streak.freezeTokens < missed) return null;

    const rows = await db
      .update(userStreaks)
      .set({
        freezeTokens: sql`${userStreaks.freezeTokens} - ${missed}`,
        lastPeriodEnd: lastCompletedEnd,
        status: "active",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userStreaks.id, streakId),
          eq(userStreaks.userId, userId),
          eq(userStreaks.status, "active"),
          sql`${userStreaks.freezeTokens} >= ${missed}`,
          // Conditional write pinned to the EXACT snapshot last_period_end (not
          // `< lastCompletedEnd`). `missed` was computed from the SELECTed row,
          // so the spend is only correct if the row is unchanged. A `<` guard
          // catches an advance racing PAST the target but not one landing
          // PARTWAY into the gap (snapshot < new < target): there the engine's
          // own gap was 0 (it didn't decrement tokens), so `freezeTokens >=
          // missed` still passes and the stale `missed` over-debits the user
          // (e.g. a real 1-period gap charged 2). Pinning to the snapshot turns
          // any concurrent advance into a clean no-op null (→ handler 400); the
          // user retries against the fresh row with the correct `missed`. Same
          // discipline as persistFreezeSpend/persistBreak (Inspector finding).
          eq(userStreaks.lastPeriodEnd, streak.lastPeriodEnd),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Proactive "skip this week" (18-habit-setup, T-18.5.4 / STORY-003 AC 3.4;
   * design.md § 3.1/§ 4.2). Spend ONE freeze token to pre-emptively cover the
   * CURRENT in-progress period so it can't break at rollover: advance
   * `last_period_end` OVER the current period, decrement one token, and DO NOT
   * change `current_count` (unlike the retroactive `spendTokenManually`, which
   * covers weeks ALREADY missed). Only for a weekly streak that is up to date
   * (`last_period_end == last completed period`) — a streak already behind must
   * use the retroactive path first, and skipping a period the engine already
   * advanced would double-count.
   *
   * Returns null (→ handler 400) when: not owned / not `active` / no token /
   * already skipped this period (last_period_end is at or beyond the current
   * period) / actually behind (must retro-spend instead). Pinned to the snapshot
   * `last_period_end` for the same race discipline as every other writer.
   */
  async skipCurrentPeriod(
    userId: string,
    streakId: string,
    now: Date = new Date(),
  ): Promise<UserStreak | null> {
    const db = getDb();
    const existing = await db
      .select()
      .from(userStreaks)
      .where(
        and(
          eq(userStreaks.id, streakId),
          eq(userStreaks.userId, userId),
          eq(userStreaks.status, "active"),
        ),
      )
      .limit(1);
    const streak = existing[0];
    if (!streak) return null;
    if (streak.freezeTokens < 1) return null;

    const tz = await this.getUserTimezone(userId);
    const period = streak.period as Period;
    const lastCompletedEnd = lastCompletedPeriodEndISO(now, period, tz);
    const currentEnd = periodEndForDateISO(localDateISO(now, tz), period);

    // Must be up to date: last_period_end == the last completed period. Behind
    // → the retroactive path owns it; ahead (already advanced/skipped the
    // current period) → nothing to skip.
    if (streak.lastPeriodEnd !== lastCompletedEnd) return null;

    const rows = await db
      .update(userStreaks)
      .set({
        freezeTokens: sql`${userStreaks.freezeTokens} - 1`,
        lastPeriodEnd: currentEnd,
        status: "active",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userStreaks.id, streakId),
          eq(userStreaks.userId, userId),
          eq(userStreaks.status, "active"),
          sql`${userStreaks.freezeTokens} >= 1`,
          eq(userStreaks.lastPeriodEnd, streak.lastPeriodEnd),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }
}
