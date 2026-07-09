import { and, eq, isNull, sql } from "drizzle-orm";
import {
  goalTypes,
  habitConfigs,
  profiles,
  ptClientRelationships,
  userGoals,
  userStreaks,
  type Db,
  type HabitConfig,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";

/**
 * A Drizzle connection OR a transaction handle — so the coach on-behalf write
 * can run `upsert` + the `goal_assigned` audit inside ONE transaction
 * (cross-cuts § 1.4.2). Methods default to the `getDb()` singleton when no
 * handle is passed (the self routes' behaviour is unchanged).
 */
type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
import {
  addDaysISO,
  lastCompletedPeriodEndISO,
  localDateISO,
  periodEndForDateISO,
} from "../streaks/period";
import {
  HABIT_CATEGORY_ORDER,
  type HabitCategory,
  type ValidatedHabitConfig,
} from "../habits/habitCategories";

/**
 * Habit configuration reads + writes (18-habit-setup, Phase 18.2).
 * Per specs/18-habit-setup/design.md § 3.1 + § 4.4. Every method is
 * JWT-scoped by `userId`.
 *
 * Edit timing is SYMMETRIC (locked decision 12): the FIRST enable of a habit
 * writes the live config with `effective_from = next Monday` (the habit is
 * loggable now but joins the collection streak next week); any later edit —
 * including a disable — is QUEUED into `pending_config`/`pending_from = next
 * Monday` and left for the weekly cron to promote, so an edit can never change
 * the in-progress week's bar (closes rescue / ratchet / disable-to-dodge).
 */
export interface HabitConfigView {
  category: HabitCategory;
  goalId: string;
  /** Effective-now active state (the streak engine's view this week). */
  enabled: boolean;
  /** Non-null when a coach assigned this habit (cross-cuts § 2). */
  assignedByUserId: string | null;
  /**
   * The assigning coach's display name (`profiles.full_name`) for the athlete
   * attribution badge (Phase 11 / cross-cuts § 1.5). Resolved only on the
   * canonical `listForUser` read; the write-path views return null (the
   * subsequent GET carries the name).
   */
  assignedByName: string | null;
  targetValue: number;
  unit: string;
  period: string;
  completionRule: string;
  daysPerWeek: number | null;
  tolerancePct: number | null;
  /** A queued edit awaiting the next week boundary, or null. */
  pending: {
    from: string;
    config: Record<string, unknown>;
  } | null;
}

export class HabitConfigRepository {
  static readonly key = "HabitConfigRepository";

  private async getUserTimezone(
    userId: string,
    conn: DbOrTx = getDb(),
  ): Promise<string> {
    const rows = await conn
      .select({ tz: profiles.timezone })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    return rows[0]?.tz ?? "Europe/London";
  }

  /** The Monday that starts the NEXT week (user-local) — when deferred edits land. */
  private nextMondayISO(now: Date, tz: string): string {
    const today = localDateISO(now, tz);
    const curWeekEnd = periodEndForDateISO(today, "weekly"); // upcoming Sunday
    return addDaysISO(curWeekEnd, 1);
  }

  private async resolveGoalTypeId(
    category: HabitCategory,
    conn: DbOrTx = getDb(),
  ): Promise<string | null> {
    const rows = await conn
      .select({ id: goalTypes.id })
      .from(goalTypes)
      .where(eq(goalTypes.name, category))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  private toView(
    category: HabitCategory,
    goalId: string,
    enabled: boolean,
    assignedByUserId: string | null,
    cfg: HabitConfig,
    assignedByName: string | null = null,
  ): HabitConfigView {
    return {
      category,
      goalId,
      enabled,
      assignedByUserId,
      assignedByName,
      targetValue: Number(cfg.targetValue),
      unit: cfg.unit,
      period: cfg.period,
      completionRule: cfg.completionRule,
      daysPerWeek: cfg.daysPerWeek ?? null,
      tolerancePct: cfg.tolerancePct != null ? Number(cfg.tolerancePct) : null,
      pending:
        cfg.pendingConfig && cfg.pendingFrom
          ? { from: cfg.pendingFrom, config: cfg.pendingConfig }
          : null,
    };
  }

  /** Every configured habit for the user (joined to its goal for active state). */
  async listForUser(userId: string): Promise<HabitConfigView[]> {
    const db = getDb();
    const rows = await db
      .select({
        config: habitConfigs,
        goal: userGoals,
        assignedByName: profiles.fullName,
      })
      .from(habitConfigs)
      .innerJoin(userGoals, eq(habitConfigs.goalId, userGoals.id))
      .leftJoin(profiles, eq(profiles.id, userGoals.assignedByUserId))
      .where(eq(habitConfigs.userId, userId));

    return rows
      .filter((r) => HABIT_CATEGORY_ORDER.includes(r.config.category))
      .map((r) =>
        this.toView(
          r.config.category,
          r.config.goalId,
          r.goal.isActive ?? false,
          r.goal.assignedByUserId ?? null,
          r.config,
          r.goal.assignedByUserId ? (r.assignedByName ?? null) : null,
        ),
      );
  }

  /**
   * Whether `goalId` is a habit the named coach may edit on the client's
   * behalf — i.e. it was assigned by that trainer. Used by the trainer routes;
   * the self routes use the inverse (a coach-assigned habit is locked to the
   * client). Returns the config row's `assignedByUserId` (or null).
   */
  async getAssigner(
    userId: string,
    category: HabitCategory,
  ): Promise<{
    goalId: string;
    assignedByUserId: string | null;
  } | null> {
    const db = getDb();
    const goalTypeId = await this.resolveGoalTypeId(category);
    if (!goalTypeId) return null;
    const rows = await db
      .select({
        id: userGoals.id,
        assignedByUserId: userGoals.assignedByUserId,
      })
      .from(userGoals)
      .where(
        and(eq(userGoals.userId, userId), eq(userGoals.goalTypeId, goalTypeId)),
      )
      .limit(1);
    const g = rows[0];
    return g
      ? { goalId: g.id, assignedByUserId: g.assignedByUserId ?? null }
      : null;
  }

  /**
   * Whether a habit is LOCKED to the client — i.e. a coach assigned it AND the
   * relationship is still active (cross-cuts § 2.2; design.md § 5). The lock is
   * conditioned on an *active* relationship, so when it ends the lock lifts
   * automatically and the habit transfers to the client (locked decision 6).
   * The self PUT/DELETE routes 403 when this is true.
   */
  async isHabitCoachLocked(
    userId: string,
    category: HabitCategory,
  ): Promise<boolean> {
    const assigner = await this.getAssigner(userId, category);
    if (!assigner || !assigner.assignedByUserId) return false;
    const db = getDb();
    const rows = await db
      .select({ id: ptClientRelationships.id })
      .from(ptClientRelationships)
      .where(
        and(
          eq(ptClientRelationships.trainerId, assigner.assignedByUserId),
          eq(ptClientRelationships.clientId, userId),
          eq(ptClientRelationships.status, "active"),
          eq(ptClientRelationships.isAiTrainer, false),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Ensure the single collection habit streak row exists for the user
   * (streak_type='habit_streak', source_goal_id NULL, weekly). Seeded
   * "up to date" (last_period_end = the last completed week) so it can't
   * immediately break. Nothing else seeds user_streaks (Inspector note).
   *
   * Race-safe: the SELECT is only a fast path. The M4 partial unique index
   * `(user_id, source_goal_id) WHERE source_goal_id IS NOT NULL` excludes the
   * collection row, so concurrent first-enables (a "set up all habits" screen
   * firing Water+Gym+Steps in parallel) would both miss the SELECT and both
   * INSERT, leaving duplicate collection streaks. The dedicated partial unique
   * index `user_streaks_collection_habit_uq` + `ON CONFLICT DO NOTHING` make
   * the loser a no-op (Inspector finding, PR #129).
   */
  private async ensureCollectionStreak(
    userId: string,
    now: Date,
    tz: string,
    conn: DbOrTx = getDb(),
  ): Promise<void> {
    const existing = await conn
      .select({ id: userStreaks.id })
      .from(userStreaks)
      .where(
        and(
          eq(userStreaks.userId, userId),
          eq(userStreaks.streakType, "habit_streak"),
          isNull(userStreaks.sourceGoalId),
        ),
      )
      .limit(1);
    if (existing.length > 0) return;

    await conn
      .insert(userStreaks)
      .values({
        userId,
        streakType: "habit_streak",
        sourceGoalId: null,
        period: "weekly",
        currentCount: 0,
        longestCount: 0,
        lastPeriodEnd: lastCompletedPeriodEndISO(now, "weekly", tz),
        freezeTokens: 0,
        status: "active",
      })
      .onConflictDoNothing();
  }

  /**
   * Enable + configure a habit (PUT). A first enable (no config yet, or the
   * goal was previously disabled) writes the live config with
   * `effective_from = next Monday` and ensures the collection streak. An edit
   * to an already-active habit is QUEUED (`pending_config`/`pending_from`),
   * leaving the live row — and therefore the in-progress week — untouched.
   *
   * `assignedByUserId` is set on a coach write (stamped on the goal). `now` is
   * injectable for deterministic tests.
   */
  async upsert(
    userId: string,
    category: HabitCategory,
    config: ValidatedHabitConfig,
    opts: {
      assignedByUserId?: string | null;
      now?: Date;
      tx?: DbOrTx;
    } = {},
  ): Promise<HabitConfigView | null> {
    const db = opts.tx ?? getDb();
    const now = opts.now ?? new Date();
    // Distinguish "coach write" (id supplied) from "self write" (omitted).
    // A self write must NEVER stamp/erase assigned_by_user_id — re-enabling a
    // habit a coach once set keeps that attribution as history (locked
    // decision 6 / design.md § 5). Only a coach write sets it.
    const coachId = opts.assignedByUserId; // string | null | undefined

    const goalTypeId = await this.resolveGoalTypeId(category, db);
    if (!goalTypeId) return null; // unknown category / unseeded goal_type

    const tz = await this.getUserTimezone(userId, db);
    const nextMonday = this.nextMondayISO(now, tz);

    const goalRows = await db
      .select()
      .from(userGoals)
      .where(
        and(eq(userGoals.userId, userId), eq(userGoals.goalTypeId, goalTypeId)),
      )
      .limit(1);
    let goal = goalRows[0];

    const isFreshEnable = !goal || goal.isActive !== true;

    if (!goal) {
      // A brand-new goal has no prior attribution: a coach write stamps the
      // coach, a self write is null.
      const inserted = await db
        .insert(userGoals)
        .values({
          userId,
          goalTypeId,
          isActive: true,
          assignedByUserId: coachId ?? null,
          targetValue: String(config.targetValue),
          unit: config.unit,
        })
        .returning();
      goal = inserted[0];
    } else if (isFreshEnable) {
      // Reactivate a previously-disabled goal. Only TOUCH assigned_by_user_id
      // when this is a coach write — a self re-enable must preserve whatever
      // is stored (incl. a past coach's id kept as history).
      const goalSet: Record<string, unknown> = {
        isActive: true,
        targetValue: String(config.targetValue),
        unit: config.unit,
        updatedAt: new Date(),
      };
      if (coachId !== undefined) goalSet.assignedByUserId = coachId;
      const reactivated = await db
        .update(userGoals)
        .set(goalSet)
        .where(eq(userGoals.id, goal.id))
        .returning();
      goal = reactivated[0];
    }

    const existingConfig = await db
      .select()
      .from(habitConfigs)
      .where(eq(habitConfigs.goalId, goal.id))
      .limit(1);
    const liveConfig = existingConfig[0];

    if (isFreshEnable || !liveConfig) {
      // First enable / re-enable → write live config, effective next Monday,
      // clear any stale pending, and ensure the collection streak row.
      const values = {
        userId,
        goalId: goal.id,
        category,
        targetValue: String(config.targetValue),
        unit: config.unit,
        period: config.period,
        completionRule: config.completionRule,
        daysPerWeek: config.daysPerWeek,
        tolerancePct:
          config.tolerancePct != null ? String(config.tolerancePct) : null,
        effectiveFrom: nextMonday,
        pendingConfig: null,
        pendingFrom: null,
      };
      const written = liveConfig
        ? await db
            .update(habitConfigs)
            .set({ ...values, updatedAt: new Date() })
            .where(eq(habitConfigs.goalId, goal.id))
            .returning()
        : await db.insert(habitConfigs).values(values).returning();

      await this.ensureCollectionStreak(userId, now, tz, db);
      return this.toView(
        category,
        goal.id,
        true,
        goal.assignedByUserId ?? null,
        written[0],
      );
    }

    // Edit to an already-active habit → defer to next Monday.
    const pendingConfig = {
      targetValue: config.targetValue,
      daysPerWeek: config.daysPerWeek,
      tolerancePct: config.tolerancePct,
    };
    const updated = await db
      .update(habitConfigs)
      .set({
        pendingConfig,
        pendingFrom: nextMonday,
        updatedAt: new Date(),
      })
      .where(eq(habitConfigs.goalId, goal.id))
      .returning();
    return this.toView(
      category,
      goal.id,
      true,
      goal.assignedByUserId ?? null,
      updated[0],
    );
  }

  /**
   * Disable a habit (DELETE) — DEFERRED to next Monday so a mid-week disable
   * can't drop a failing habit out of the current week's collection
   * requirement (disable-to-dodge, AC 8.2). Queues `{ enabled: false }` into
   * `pending_config`; the cron flips `user_goals.is_active` at the rollover.
   * Returns the disabled goal's id, or null when the habit isn't
   * configured/active. (The goal id is what the coach path audits.)
   */
  async disable(
    userId: string,
    category: HabitCategory,
    opts: { now?: Date; tx?: DbOrTx } = {},
  ): Promise<string | null> {
    const db = opts.tx ?? getDb();
    const now = opts.now ?? new Date();
    const goalTypeId = await this.resolveGoalTypeId(category, db);
    if (!goalTypeId) return null;

    const tz = await this.getUserTimezone(userId, db);
    const nextMonday = this.nextMondayISO(now, tz);

    const goalRows = await db
      .select({ id: userGoals.id, isActive: userGoals.isActive })
      .from(userGoals)
      .where(
        and(eq(userGoals.userId, userId), eq(userGoals.goalTypeId, goalTypeId)),
      )
      .limit(1);
    const goal = goalRows[0];
    if (!goal || goal.isActive !== true) return null;

    const updated = await db
      .update(habitConfigs)
      .set({
        pendingConfig: { enabled: false },
        pendingFrom: nextMonday,
        updatedAt: new Date(),
      })
      .where(
        and(eq(habitConfigs.userId, userId), eq(habitConfigs.goalId, goal.id)),
      )
      .returning({ id: habitConfigs.id });
    return updated.length > 0 ? goal.id : null;
  }

  /**
   * Promote pending config edits whose `pending_from <= today`
   * (user-local) — the weekly-rollover step called by the streak cron.
   * Copies queued `targetValue`/`daysPerWeek`/`tolerancePct` into the live
   * columns, applies a queued `enabled:false` to `user_goals.is_active`, and
   * clears the pending slot. Idempotent. Returns the count promoted.
   */
  async promotePendingEdits(userId: string, now: Date): Promise<number> {
    const db = getDb();
    const tz = await this.getUserTimezone(userId);
    const today = localDateISO(now, tz);

    const due = await db
      .select()
      .from(habitConfigs)
      .where(
        and(
          eq(habitConfigs.userId, userId),
          sql`${habitConfigs.pendingFrom} IS NOT NULL`,
          sql`${habitConfigs.pendingFrom} <= ${today}`,
        ),
      );

    let promoted = 0;
    for (const row of due) {
      const pending = (row.pendingConfig ?? {}) as Record<string, unknown>;
      if (pending.enabled === false) {
        await db
          .update(userGoals)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(userGoals.id, row.goalId));
      } else {
        await db
          .update(habitConfigs)
          .set({
            targetValue:
              pending.targetValue != null
                ? String(pending.targetValue)
                : row.targetValue,
            daysPerWeek:
              pending.daysPerWeek !== undefined
                ? (pending.daysPerWeek as number | null)
                : row.daysPerWeek,
            tolerancePct:
              pending.tolerancePct != null
                ? String(pending.tolerancePct)
                : row.tolerancePct,
            updatedAt: new Date(),
          })
          .where(eq(habitConfigs.goalId, row.goalId));
      }
      await db
        .update(habitConfigs)
        .set({ pendingConfig: null, pendingFrom: null, updatedAt: new Date() })
        .where(eq(habitConfigs.goalId, row.goalId));
      promoted += 1;
    }
    return promoted;
  }
}
