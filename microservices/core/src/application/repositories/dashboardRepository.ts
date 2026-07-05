import { and, desc, eq, gte, isNotNull, or, sql } from "drizzle-orm";
import {
  bodyMeasurements,
  exercises,
  goalTypes,
  personalRecords,
  profiles,
  recordTypeEnum,
  subscriptionTiers,
  userGoals,
  userSubscriptions,
  workoutAssignments,
  workoutSessions,
  workouts,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { SYSTEM_USER_ID } from "./exerciseRepository";
import { ProgramAssignmentRepository } from "./programAssignmentRepository";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Derived from the Postgres `record_type` enum at
 * `packages/db/src/schema.ts:60`. Anchoring this to the schema means
 * a future additive enum migration (e.g. `max_volume`, landed
 * alongside the broadened PR detection in PR #61) breaks the
 * exhaustive `Record<RecordType, number>` / switch coverage below at
 * compile time — instead of silently widening the cast at
 * `mapPersonalRecord` and producing `NaN` ranks for unhandled values
 * (Inspector Brad finding on PR #61).
 */
export type RecordType = (typeof recordTypeEnum.enumValues)[number];

export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "cancelled"
  | "past_due";

export type AssignedByType = "personal_trainer" | "physiotherapist";

export interface DashboardProfile {
  id: string;
  fullName: string | null;
  firstName: string | null;
  preferredUnits: "metric" | "imperial";
}

export interface DashboardSubscription {
  tierName: string | null;
  isFreeTier: boolean;
  isTrainerTier: boolean;
  status: SubscriptionStatus | null;
}

export interface DashboardRecentWorkout {
  id: string;
  name: string | null;
  description: string | null;
  estimatedDurationMinutes: number | null;
  createdBy: string;
  isAssigned: boolean;
  assignedByType: AssignedByType | null;
  /**
   * The open occurrence's due date (YYYY-MM-DD) for assigned rows — lets
   * Home label "Today's training" (specs/19-programs). Null for own /
   * default workouts and undated ad-hoc assignments.
   */
  dueDate?: string | null;
}

export interface DashboardRecentActivity {
  workoutSessionId: string;
  workoutId: string | null;
  workoutName: string;
  completedAt: string;
  durationSeconds: number | null;
}

export interface DashboardActiveGoal {
  id: string;
  title: string;
  current: number;
  target: number;
  unit: string;
  priority: number;
  targetDate: string | null;
}

export interface DashboardProgress {
  workoutsThisMonth: number;
  workoutsLastMonth: number;
  streak: number;
  personalRecordsCount: number;
}

export interface DashboardPROfTheWeek {
  exerciseId: string;
  exerciseName: string;
  recordType: RecordType;
  value: number;
  unit: string;
  achievedAt: string;
}

export interface DashboardLatestMeasurement {
  id: string;
  weightKg: number | null;
  bodyFatPercentage: number | null;
  measuredAt: string;
}

/**
 * The client's live programme for the Home "Your programme" card
 * (specs/19-programs STORY-005). `totalWeeks`/`endDate` null = indefinite
 * programme ("Ongoing").
 */
export interface DashboardActiveProgramme {
  assignmentId: string;
  programId: string;
  name: string;
  week: number;
  totalWeeks: number | null;
  endDate: string | null;
  startDate: string;
}

/**
 * Full `/dashboard` payload. Matches the `DashboardPayload` contract
 * in specs/06-progress-goals/design.md § Dashboard backend contract (M1),
 * extended with `activeProgramme` (specs/19-programs — additive).
 */
export interface DashboardData {
  profile: DashboardProfile;
  subscription: DashboardSubscription;
  recentWorkouts: DashboardRecentWorkout[];
  recentActivity: DashboardRecentActivity[];
  activeGoals: DashboardActiveGoal[];
  progress: DashboardProgress;
  prOfTheWeek: DashboardPROfTheWeek | null;
  latestMeasurement: DashboardLatestMeasurement | null;
  activeProgramme: DashboardActiveProgramme | null;
}

// ─── Internal row shapes (typed for pure-function helpers) ────────────────────

export interface SubscriptionRow {
  tierName: string | null;
  paymentStatus: string | null;
  expiresAt: Date | null;
  cancelledAt: Date | null;
  isTrainerTier: boolean | null;
  tierDbName: string | null; // subscription_tiers.tier_name (joined)
}

export interface PersonalRecordRow {
  id: string;
  exerciseId: string;
  recordType: RecordType;
  value: string | number;
  achievedAt: Date | string | null;
}

// ─── Pure helpers (exported for unit testing) ─────────────────────────────────

/**
 * Derive the greeting-friendly first name from the stored `full_name`.
 * Splits on any whitespace (including non-ASCII) and returns the first
 * non-empty token, or `null` when nothing useful is present.
 */
export function deriveFirstName(fullName: string | null): string | null {
  if (fullName === null) return null;
  const trimmed = fullName.trim();
  if (trimmed.length === 0) return null;
  const tokens = trimmed.split(/\s+/);
  return tokens[0] && tokens[0].length > 0 ? tokens[0] : null;
}

/**
 * Legacy `isFreeTier` rule:
 *   - no subscription row → true
 *   - tier_name = 'free' (either side of the join) → true
 *   - payment_status = 'cancelled' AND expires_at <= now → true
 *   - payment_status = 'trialing' AND expires_at <= now → true (M6)
 *   - otherwise → false
 *
 * `now` is injected so the cancellation-grace branch is testable.
 *
 * The trialing-past-expiry branch is a belt-and-braces guard against
 * missed Stripe webhooks: V2 backend doesn't yet handle the
 * `customer.subscription.*` events that move a row out of `trialing`
 * (still served by the legacy Supabase Edge Functions, which can
 * silently fail). Without this rule, a trial whose expiry has passed
 * still renders as a Trial badge with a stale "renew on DD/MM/YYYY"
 * date — confusing for the user and gating premium features off a
 * subscription they no longer have. Treating expired trials as free
 * tier means the user sees the correct upgrade CTA + workout limits
 * even when the upstream payment state hasn't been synced. Active /
 * past_due rows are intentionally NOT included: an `active` row past
 * expiry is the classic "renewal in flight" window where Stripe
 * extends the period before the next invoice — kicking the user out
 * of premium there would be hostile.
 */
export function computeIsFreeTier(
  row: SubscriptionRow | null,
  now: Date = new Date(),
): boolean {
  if (row === null) return true;
  const tier = row.tierDbName ?? row.tierName;
  if (tier === "free") return true;
  if (
    (row.paymentStatus === "cancelled" || row.paymentStatus === "trialing") &&
    row.expiresAt !== null &&
    row.expiresAt.getTime() <= now.getTime()
  ) {
    return true;
  }
  return false;
}

/**
 * Map the raw `user_subscriptions.payment_status` to the payload's
 * `SubscriptionStatus`. Collapses the internal `"pending"` state to
 * `null` — nothing meaningful for the client to render.
 */
export function normaliseSubscriptionStatus(
  paymentStatus: string | null,
): SubscriptionStatus | null {
  switch (paymentStatus) {
    case "active":
    case "trialing":
    case "cancelled":
    case "past_due":
      return paymentStatus;
    default:
      return null;
  }
}

// Rank for the `prOfTheWeek` tie-break. Higher = more impactful;
// `pickPROfTheWeek` prefers higher-rank rows when same-day PRs collide.
//
// `max_volume` (introduced alongside the broadened PR detection in PR
// #61) slots between `max_weight` and `max_reps` — heavier weight ×
// reps is a balanced strength metric, more impactful than pure rep
// count but less iconic than max_weight. Every value below it shifted
// down by 1; relative ordering of pre-existing pairs is preserved.
//
// `Record<RecordType, number>` makes this exhaustive against the
// schema-derived `RecordType`, so the next enum addition will fail
// typecheck here until a rank is chosen.
const RECORD_TYPE_RANK: Record<RecordType, number> = {
  "1rm": 9,
  "3rm": 8,
  "5rm": 7,
  "10rm": 6,
  max_weight: 5,
  max_volume: 4,
  max_reps: 3,
  best_time: 2,
  longest_distance: 1,
};

/**
 * Numeric rank used to break `prOfTheWeek` ties. Higher = more impactful.
 * Extracted so the ordering is unit-testable without seeding a DB.
 */
export function rankPersonalRecord(recordType: RecordType): number {
  return RECORD_TYPE_RANK[recordType];
}

/**
 * Sort the PR window by (achievedAt DESC, recordType rank DESC, id ASC)
 * and return the winner or null.
 */
export function pickPROfTheWeek(
  rows: PersonalRecordRow[],
): PersonalRecordRow | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => {
    const aTime = toEpochMs(a.achievedAt);
    const bTime = toEpochMs(b.achievedAt);
    if (bTime !== aTime) return bTime - aTime;
    const rankDiff =
      rankPersonalRecord(b.recordType) - rankPersonalRecord(a.recordType);
    if (rankDiff !== 0) return rankDiff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return sorted[0] ?? null;
}

function toEpochMs(value: Date | string | null): number {
  if (value === null) return 0;
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

/**
 * Convert a Drizzle `numeric`-typed field (returned as string) to `number`.
 * Accepts numeric inputs as a pass-through for test ergonomics.
 */
export function coerceNumeric(value: string | number | null): number | null {
  if (value === null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoString(value: Date | string | null): string {
  if (value === null) return "";
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString();
}

function monthKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

// ─── Repository ───────────────────────────────────────────────────────────────

export class DashboardRepository {
  static readonly key = "DashboardRepository";

  // Composed for the programme slices (top-up + Home card). Kept as a
  // field so tests can substitute a stub.
  private readonly programAssignmentRepository =
    new ProgramAssignmentRepository();

  /**
   * Assembles the full `DashboardPayload` in a single `Promise.all` so Lambda
   * cold-start latency stays bounded (AC 7.8). Each sub-query is a private
   * method with its own test seams.
   */
  async getDashboard(userId: string): Promise<DashboardData> {
    const today = new Date().toISOString().slice(0, 10);

    // Rolling top-up for indefinite programmes BEFORE the reads below so
    // the assigned list always has ~28 days of runway (specs/19-programs
    // § Materialisation). Error-tolerant: a top-up failure must not take
    // down the Home screen — the already-materialised window still renders.
    try {
      await this.programAssignmentRepository.ensureMaterializedForClient(
        userId,
        today,
      );
    } catch (err) {
      console.error("dashboard programme top-up failed", err);
    }

    const [
      profile,
      subscription,
      recentWorkouts,
      recentActivity,
      activeGoals,
      prOfTheWeek,
      progress,
      latestMeasurement,
      activeProgramme,
    ] = await Promise.all([
      this.getProfileSlice(userId),
      this.getSubscriptionSlice(userId),
      this.getRecentWorkouts(userId),
      this.getRecentActivity(userId),
      this.getActiveGoalsWithProgress(userId),
      this.getPROfTheWeek(userId),
      this.getProgressStats(userId),
      this.getLatestMeasurement(userId),
      this.programAssignmentRepository.getActiveProgrammeForClient(
        userId,
        today,
      ),
    ]);

    return {
      profile,
      subscription,
      recentWorkouts,
      recentActivity,
      activeGoals,
      progress,
      prOfTheWeek,
      latestMeasurement,
      activeProgramme,
    };
  }

  async getProfileSlice(userId: string): Promise<DashboardProfile> {
    const db = getDb();
    const rows = await db
      .select({
        id: profiles.id,
        fullName: profiles.fullName,
        preferredUnits: profiles.preferredUnits,
      })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return {
        id: userId,
        fullName: null,
        firstName: null,
        preferredUnits: "metric",
      };
    }

    const preferredUnits =
      row.preferredUnits === "imperial" ? "imperial" : "metric";

    return {
      id: row.id,
      fullName: row.fullName,
      firstName: deriveFirstName(row.fullName),
      preferredUnits,
    };
  }

  async getSubscriptionSlice(userId: string): Promise<DashboardSubscription> {
    const db = getDb();
    const rows = await db
      .select({
        tierName: userSubscriptions.tierName,
        paymentStatus: userSubscriptions.paymentStatus,
        expiresAt: userSubscriptions.expiresAt,
        cancelledAt: userSubscriptions.cancelledAt,
        isTrainerTier: subscriptionTiers.isTrainerTier,
        tierDbName: subscriptionTiers.tierName,
      })
      .from(userSubscriptions)
      .leftJoin(
        subscriptionTiers,
        eq(userSubscriptions.tierName, subscriptionTiers.tierName),
      )
      .where(eq(userSubscriptions.userId, userId))
      .orderBy(desc(userSubscriptions.createdAt))
      .limit(1);

    const row = rows[0] ?? null;

    if (row === null) {
      return {
        tierName: null,
        isFreeTier: true,
        isTrainerTier: false,
        status: null,
      };
    }

    const isFreeTier = computeIsFreeTier(row);
    return {
      tierName: row.tierName ?? null,
      isFreeTier,
      // Gate on the EFFECTIVE tier: a lapsed trainer (cancelled/trialing past
      // expiry) is on free-tier semantics, so it must not still report as a
      // trainer — `isFreeTier: true, isTrainerTier: true` was a contradictory
      // state that left coach mode enabled after the subscription lapsed.
      isTrainerTier: !isFreeTier && row.isTrainerTier === true,
      status: normaliseSubscriptionStatus(row.paymentStatus),
    };
  }

  async getRecentWorkouts(
    userId: string,
    limit = 10,
  ): Promise<DashboardRecentWorkout[]> {
    const db = getDb();

    // The three fetches are independent (no data dependency between them),
    // so run them in parallel. `getDashboard` gates its eight sub-queries on
    // a single Promise.all — serialising these three here would make this
    // method the round-trip bottleneck.
    const [own, assigned, defaults] = await Promise.all([
      // 1. Own workouts (most recent first).
      db
        .select({
          id: workouts.id,
          name: workouts.name,
          description: workouts.description,
          estimatedDurationMinutes: workouts.estimatedDurationMinutes,
          createdBy: workouts.createdBy,
          createdAt: workouts.createdAt,
        })
        .from(workouts)
        .where(eq(workouts.createdBy, userId))
        .orderBy(desc(workouts.createdAt))
        .limit(limit),
      // 2. Assigned workouts — OPEN plan-visible occurrences, due-date
      //    ascending (overdue → today → upcoming), so Home reads as
      //    "Today's training" (specs/19-programs STORY-005). The join
      //    surfaces the trainer's role so we can derive `assignedByType`
      //    without a second query.
      db
        .select({
          id: workouts.id,
          name: workouts.name,
          description: workouts.description,
          estimatedDurationMinutes: workouts.estimatedDurationMinutes,
          createdBy: workouts.createdBy,
          dueDate: workoutAssignments.dueDate,
          trainerRole: profiles.role,
        })
        .from(workoutAssignments)
        .innerJoin(workouts, eq(workoutAssignments.workoutId, workouts.id))
        .leftJoin(profiles, eq(workoutAssignments.trainerId, profiles.id))
        .where(
          and(
            eq(workoutAssignments.clientId, userId),
            eq(workoutAssignments.status, "assigned"),
            eq(workoutAssignments.showInPlan, true),
          ),
        )
        .orderBy(sql`${workoutAssignments.dueDate} asc nulls last`)
        .limit(limit),
      // 3. Default templates — system-authored or public library entries.
      db
        .select({
          id: workouts.id,
          name: workouts.name,
          description: workouts.description,
          estimatedDurationMinutes: workouts.estimatedDurationMinutes,
          createdBy: workouts.createdBy,
          createdAt: workouts.createdAt,
        })
        .from(workouts)
        .where(
          or(
            eq(workouts.createdBy, SYSTEM_USER_ID),
            eq(workouts.visibility, "public"),
          ),
        )
        .orderBy(desc(workouts.createdAt))
        .limit(limit),
    ]);

    const seen = new Set<string>();
    const combined: DashboardRecentWorkout[] = [];

    for (const row of own) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      combined.push({
        id: row.id,
        name: row.name,
        description: row.description,
        estimatedDurationMinutes: row.estimatedDurationMinutes,
        createdBy: row.createdBy ?? SYSTEM_USER_ID,
        isAssigned: false,
        assignedByType: null,
      });
      if (combined.length >= limit) return combined;
    }

    for (const row of assigned) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      combined.push({
        id: row.id,
        name: row.name,
        description: row.description,
        estimatedDurationMinutes: row.estimatedDurationMinutes,
        createdBy: row.createdBy ?? SYSTEM_USER_ID,
        isAssigned: true,
        assignedByType: mapTrainerRoleToAssignedByType(row.trainerRole),
        dueDate: row.dueDate ?? null,
      });
      if (combined.length >= limit) return combined;
    }

    for (const row of defaults) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      combined.push({
        id: row.id,
        name: row.name,
        description: row.description,
        estimatedDurationMinutes: row.estimatedDurationMinutes,
        createdBy: row.createdBy ?? SYSTEM_USER_ID,
        isAssigned: false,
        assignedByType: null,
      });
      if (combined.length >= limit) return combined;
    }

    return combined;
  }

  async getRecentActivity(
    userId: string,
    windowDays = 7,
  ): Promise<DashboardRecentActivity[]> {
    const db = getDb();
    const threshold = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const rows = await db
      .select({
        workoutSessionId: workoutSessions.id,
        workoutId: workoutSessions.workoutId,
        sessionName: workoutSessions.name,
        completedAt: workoutSessions.completedAt,
        durationSeconds: workoutSessions.totalDurationSeconds,
        workoutName: workouts.name,
      })
      .from(workoutSessions)
      .leftJoin(workouts, eq(workoutSessions.workoutId, workouts.id))
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.status, "completed"),
          isNotNull(workoutSessions.completedAt),
          gte(workoutSessions.completedAt, threshold),
        ),
      )
      .orderBy(desc(workoutSessions.completedAt));

    return rows.map((row) => ({
      workoutSessionId: row.workoutSessionId,
      workoutId: row.workoutId ?? null,
      workoutName: row.sessionName ?? row.workoutName ?? "Workout",
      completedAt: toIsoString(row.completedAt),
      durationSeconds: row.durationSeconds,
    }));
  }

  async getActiveGoalsWithProgress(
    userId: string,
  ): Promise<DashboardActiveGoal[]> {
    const db = getDb();
    const rows = await db
      .select({
        id: userGoals.id,
        priority: userGoals.priority,
        targetDate: userGoals.targetDate,
        goalTypeName: goalTypes.name,
        goalTypeDescription: goalTypes.description,
        goalTypeCategory: goalTypes.category,
      })
      .from(userGoals)
      .leftJoin(goalTypes, eq(userGoals.goalTypeId, goalTypes.id))
      .where(and(eq(userGoals.userId, userId), eq(userGoals.isActive, true)));

    const mapped = rows.map((row) => ({
      id: row.id,
      // Schema gap: user_goals has no title column; derive from goal_types.
      title: row.goalTypeDescription ?? row.goalTypeName ?? "Goal",
      // Schema gap: user_goals has no target / current / unit columns.
      // Emit defensive zeros so the mobile progress bar renders gracefully.
      current: 0,
      target: 0,
      unit: row.goalTypeCategory ?? "",
      priority: row.priority ?? 1,
      targetDate: row.targetDate ?? null,
    }));

    // Priority ascending (lower number = higher priority, legacy convention).
    mapped.sort((a, b) => a.priority - b.priority);
    return mapped;
  }

  async getPROfTheWeek(
    userId: string,
    windowDays = 7,
  ): Promise<DashboardPROfTheWeek | null> {
    const db = getDb();
    const threshold = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const rows = await db
      .select({
        id: personalRecords.id,
        exerciseId: personalRecords.exerciseId,
        recordType: personalRecords.recordType,
        value: personalRecords.value,
        achievedAt: personalRecords.achievedAt,
      })
      .from(personalRecords)
      .where(
        and(
          eq(personalRecords.userId, userId),
          gte(personalRecords.achievedAt, threshold),
        ),
      );

    const winner = pickPROfTheWeek(
      rows.map((row) => ({
        id: row.id,
        exerciseId: row.exerciseId,
        recordType: row.recordType as RecordType,
        value: row.value,
        achievedAt: row.achievedAt ?? null,
      })),
    );

    if (winner === null) return null;

    // Second hop for exercise display name. We keep this separate from the
    // window scan so the main PR fetch stays filter-only (smaller plan).
    const exerciseRows = await db
      .select({
        id: exercises.id,
        name: exercises.name,
      })
      .from(exercises)
      .where(eq(exercises.id, winner.exerciseId))
      .limit(1);

    const exerciseName = exerciseRows[0]?.name ?? "Exercise";
    const value = coerceNumeric(winner.value) ?? 0;
    const unit = unitForRecordType(winner.recordType);

    return {
      exerciseId: winner.exerciseId,
      exerciseName,
      recordType: winner.recordType,
      value,
      unit,
      achievedAt: toIsoString(winner.achievedAt),
    };
  }

  async getProgressStats(userId: string): Promise<DashboardProgress> {
    const db = getDb();

    // Only the current and previous calendar months contribute to
    // workoutsThisMonth / workoutsLastMonth. Filter in SQL so users with
    // long histories don't transfer and iterate over unbounded rows on
    // every dashboard load.
    const now = new Date();
    const startOfLastMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );

    // `personal_records` previously selected every row just for `.length`.
    // A SQL COUNT(*) is constant-size on the wire regardless of history.
    const [completedSessions, recordsCountRows, streak] = await Promise.all([
      db
        .select({
          id: workoutSessions.id,
          completedAt: workoutSessions.completedAt,
        })
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.userId, userId),
            eq(workoutSessions.status, "completed"),
            isNotNull(workoutSessions.completedAt),
            gte(workoutSessions.completedAt, startOfLastMonth),
          ),
        ),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(personalRecords)
        .where(eq(personalRecords.userId, userId)),
      this.calculateStreak(userId),
    ]);

    const thisMonth = monthKey(now);
    const lastMonth = monthKey(startOfLastMonth);

    let workoutsThisMonth = 0;
    let workoutsLastMonth = 0;
    for (const row of completedSessions) {
      if (!row.completedAt) continue;
      const completedDate =
        row.completedAt instanceof Date
          ? row.completedAt
          : new Date(row.completedAt);
      if (Number.isNaN(completedDate.getTime())) continue;
      const key = monthKey(completedDate);
      if (key === thisMonth) workoutsThisMonth++;
      else if (key === lastMonth) workoutsLastMonth++;
    }

    return {
      workoutsThisMonth,
      workoutsLastMonth,
      streak,
      personalRecordsCount: recordsCountRows[0]?.total ?? 0,
    };
  }

  async getLatestMeasurement(
    userId: string,
  ): Promise<DashboardLatestMeasurement | null> {
    const db = getDb();
    const rows = await db
      .select({
        id: bodyMeasurements.id,
        weightKg: bodyMeasurements.weightKg,
        bodyFatPercentage: bodyMeasurements.bodyFatPercentage,
        measuredAt: bodyMeasurements.measuredAt,
      })
      .from(bodyMeasurements)
      .where(eq(bodyMeasurements.userId, userId))
      .orderBy(desc(bodyMeasurements.measuredAt))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      weightKg: coerceNumeric(row.weightKg),
      bodyFatPercentage: coerceNumeric(row.bodyFatPercentage),
      measuredAt: toIsoString(row.measuredAt),
    };
  }

  /**
   * Legacy consecutive-day-streak algorithm. Preserved verbatim so behaviour
   * is unchanged post-refactor; `getProgressStats` wraps this unchanged.
   */
  async calculateStreak(userId: string): Promise<number> {
    const db = getDb();

    const sessions = await db
      .select({ startedAt: workoutSessions.startedAt })
      .from(workoutSessions)
      .where(eq(workoutSessions.userId, userId))
      .orderBy(desc(workoutSessions.startedAt));

    if (sessions.length === 0) return 0;

    let streak = 0;
    let currentDate: Date | null = null;

    for (const session of sessions) {
      if (!session.startedAt) continue;
      const sessionDate = new Date(session.startedAt);
      sessionDate.setHours(0, 0, 0, 0);

      if (!currentDate) {
        currentDate = new Date(sessionDate);
        streak = 1;
      } else {
        const prevDate = new Date(currentDate);
        prevDate.setDate(prevDate.getDate() - 1);

        if (sessionDate.getTime() === prevDate.getTime()) {
          streak++;
          currentDate = sessionDate;
        } else {
          break;
        }
      }
    }

    return streak;
  }
}

/**
 * Map a trainer's `profiles.role` to the payload's `assignedByType`.
 * Falls back to `null` for roles the mobile UI can't render
 * (e.g. `user`, `admin`, or a missing profile row on the left-join).
 */
export function mapTrainerRoleToAssignedByType(
  role: string | null,
): AssignedByType | null {
  if (role === "personal_trainer") return "personal_trainer";
  if (role === "physiotherapist") return "physiotherapist";
  return null;
}

/**
 * Human-readable unit for each record type, used in the `prOfTheWeek` card.
 * Keep in sync with the mobile presenter's unit pill.
 *
 * Exhaustive against the schema-derived `RecordType` — no `default`
 * branch. If a future migration adds a new enum value (or — as with
 * `max_volume` on PR #61 — broadens detection to cover one), TS will
 * flag this switch at compile time instead of silently returning an
 * empty string and rendering a unit-less PR card.
 */
function unitForRecordType(recordType: RecordType): string {
  switch (recordType) {
    case "1rm":
    case "3rm":
    case "5rm":
    case "10rm":
    case "max_weight":
    case "max_volume":
      // `max_volume` carries `kg` rather than e.g. `kg·reps` because
      // reps are dimensionless — volume in strength training is
      // conventionally reported as a kg total. Matches the mobile
      // presenter's pill.
      return "kg";
    case "max_reps":
      return "reps";
    case "best_time":
      return "s";
    case "longest_distance":
      return "m";
  }
}
