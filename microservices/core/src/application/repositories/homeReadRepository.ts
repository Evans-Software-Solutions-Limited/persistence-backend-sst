import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import {
  achievements,
  bodyMeasurements,
  dailyActivityData,
  exercises,
  personalRecords,
  profiles,
  userAchievements,
  userStreaks,
  workoutAssignments,
  workouts,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { localDateISO } from "../streaks/period";
import {
  ProgramAssignmentRepository,
  type ActiveProgrammeSummary,
} from "./programAssignmentRepository";
import {
  mapTrainerRoleToAssignedByType,
  type AssignedByType,
} from "./dashboardRepository";

export interface RecentPR {
  id: string;
  exerciseId: string;
  exerciseName: string;
  recordType: string;
  value: number;
  achievedAt: string | null;
}

export interface AchievementRow {
  id: string;
  achievementId: string;
  name: string;
  description: string | null;
  category: string;
  requirements: Record<string, unknown> | null;
  unlockedAt: string | null;
}

export interface BodyTrendPoint {
  date: string;
  weightKg: number | null;
  bodyFat: number | null;
}

/**
 * One occurrence in the Home "Today's training" section (specs/19-programs
 * STORY-005): an OPEN, plan-visible assigned workout, due-date ascending so
 * overdue → today → upcoming reads naturally. `assignedByType` drives the
 * trainer attribution badge.
 */
export interface TodaysTrainingItem {
  /** workout_assignments occurrence row id (stable list key). */
  assignmentId: string;
  workoutId: string;
  name: string | null;
  estimatedDurationMinutes: number | null;
  dueDate: string | null;
  assignedByType: AssignedByType | null;
  /**
   * The assigning trainer's display name (`profiles.full_name`) for the coach
   * attribution badge (Phase 11 / cross-cuts § 1.5). Null when the row has no
   * distinct assigner (self-assigned) or the trainer profile has no name.
   */
  assignedByName: string | null;
}

/**
 * Read-side composition for the Home + You screens (06-progress-goals, Phase
 * 06.5). Each method is JWT-scoped by `userId`. Volume comes from
 * VolumeRepository; this repo owns steps / PRs / achievements / body-trend /
 * the streak micro-count.
 */
export class HomeReadRepository {
  static readonly key = "HomeReadRepository";

  // Composed for the programme slices on the Home aggregate (specs/19-programs
  // STORY-005). Kept as a field so tests can substitute a stub. Mirrors
  // dashboardRepository's composition.
  private readonly programAssignmentRepository =
    new ProgramAssignmentRepository();

  /**
   * Roll indefinite-programme occurrences forward before the Home reads so the
   * "Today's training" list always has runway (specs/19-programs
   * § Materialisation). Error-tolerant by contract: the caller wraps this in a
   * try/catch — a top-up failure must never take down the Home render.
   */
  async ensureProgrammeMaterialized(
    userId: string,
    todayLocalISO: string,
  ): Promise<void> {
    await this.programAssignmentRepository.ensureMaterializedForClient(
      userId,
      todayLocalISO,
    );
  }

  /**
   * The client's live programme for the Home "Your programme" card, or null
   * when none is live + plan-visible. Delegates to the shared assignment repo
   * so the coach-side and athlete-side derivations can't drift.
   */
  async getActiveProgramme(
    userId: string,
    todayLocalISO: string,
  ): Promise<ActiveProgrammeSummary | null> {
    return this.programAssignmentRepository.getActiveProgrammeForClient(
      userId,
      todayLocalISO,
    );
  }

  /**
   * OPEN, plan-visible assigned occurrences for the Home "Today's training"
   * section, due-date ascending (nulls last). Mirrors the assigned slice of
   * dashboardRepository.getRecentWorkouts so both surfaces order + attribute
   * identically.
   *
   * QA-11 (device-QA sweep BRIEF-7): scoped to TODAY + OVERDUE + null-due
   * (do-anytime ad-hoc) rows via `today` — without this the programme-assign
   * materialisation (which writes every future occurrence up front / on the
   * indefinite-horizon top-up) meant this list showed every future occurrence
   * too, not just what's actually due. The coach-side mirror
   * (`ProgramAssignmentRepository.listOpenAssignmentsForClient`) stays
   * unfiltered on purpose — the coach legitimately needs to see the whole
   * plan.
   */
  async getTodaysTraining(
    userId: string,
    today: string,
    limit = 10,
  ): Promise<TodaysTrainingItem[]> {
    const db = getDb();
    const rows = await db
      .select({
        assignmentId: workoutAssignments.id,
        workoutId: workouts.id,
        name: workouts.name,
        estimatedDurationMinutes: workouts.estimatedDurationMinutes,
        dueDate: workoutAssignments.dueDate,
        trainerRole: profiles.role,
        trainerName: profiles.fullName,
      })
      .from(workoutAssignments)
      .innerJoin(workouts, eq(workoutAssignments.workoutId, workouts.id))
      .leftJoin(profiles, eq(workoutAssignments.trainerId, profiles.id))
      .where(
        and(
          eq(workoutAssignments.clientId, userId),
          eq(workoutAssignments.status, "assigned"),
          eq(workoutAssignments.showInPlan, true),
          or(
            isNull(workoutAssignments.dueDate),
            lte(workoutAssignments.dueDate, today),
          ),
        ),
      )
      .orderBy(sql`${workoutAssignments.dueDate} asc nulls last`)
      .limit(limit);

    return rows.map((r) => ({
      assignmentId: r.assignmentId,
      workoutId: r.workoutId,
      name: r.name,
      estimatedDurationMinutes: r.estimatedDurationMinutes,
      dueDate: r.dueDate ?? null,
      assignedByType: mapTrainerRoleToAssignedByType(r.trainerRole),
      assignedByName: r.trainerName ?? null,
    }));
  }

  /** Sum of today's (user-local) step count across health sources. */
  async getTodaySteps(userId: string, todayLocalISO: string): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({
        s: sql<number>`COALESCE(SUM(${dailyActivityData.steps}), 0)::int`,
      })
      .from(dailyActivityData)
      .where(
        and(
          eq(dailyActivityData.userId, userId),
          eq(dailyActivityData.activityDate, todayLocalISO),
        ),
      );
    return Number(rows[0]?.s) || 0;
  }

  /** Current active workout-streak count (the 🔥 micro-pill); 0 if none. */
  async getActiveWorkoutStreakCount(userId: string): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({ c: userStreaks.currentCount })
      .from(userStreaks)
      .where(
        and(
          eq(userStreaks.userId, userId),
          eq(userStreaks.streakType, "workout_streak"),
          eq(userStreaks.status, "active"),
        ),
      )
      .orderBy(desc(userStreaks.currentCount))
      .limit(1);
    return rows[0]?.c ?? 0;
  }

  /** Recent PRs joined to exercise name, newest-first. */
  async getRecentPRs(userId: string, limit: number): Promise<RecentPR[]> {
    const db = getDb();
    const rows = await db
      .select({
        id: personalRecords.id,
        exerciseId: personalRecords.exerciseId,
        exerciseName: exercises.name,
        recordType: personalRecords.recordType,
        value: personalRecords.value,
        achievedAt: personalRecords.achievedAt,
      })
      .from(personalRecords)
      .innerJoin(exercises, eq(personalRecords.exerciseId, exercises.id))
      .where(eq(personalRecords.userId, userId))
      .orderBy(desc(personalRecords.achievedAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      exerciseId: r.exerciseId,
      exerciseName: r.exerciseName,
      recordType: r.recordType,
      value: Number(r.value) || 0,
      achievedAt: r.achievedAt ? new Date(r.achievedAt).toISOString() : null,
    }));
  }

  /** All unlocked achievements joined to their lookup metadata. */
  async getAchievements(userId: string): Promise<AchievementRow[]> {
    const db = getDb();
    const rows = await db
      .select({
        id: userAchievements.id,
        achievementId: userAchievements.achievementId,
        name: achievements.name,
        description: achievements.description,
        category: achievements.category,
        requirements: achievements.requirements,
        unlockedAt: userAchievements.unlockedAt,
      })
      .from(userAchievements)
      .innerJoin(
        achievements,
        eq(userAchievements.achievementId, achievements.id),
      )
      .where(eq(userAchievements.userId, userId))
      .orderBy(desc(userAchievements.unlockedAt));
    return rows.map((r) => ({
      id: r.id,
      achievementId: r.achievementId,
      name: r.name,
      description: r.description ?? null,
      category: r.category,
      requirements: (r.requirements ?? null) as Record<string, unknown> | null,
      unlockedAt: r.unlockedAt ? new Date(r.unlockedAt).toISOString() : null,
    }));
  }

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
   * Body-measurement series within the window, oldest-first (for sparklines).
   * `date` is bucketed to the USER-LOCAL day (via `tz`), not UTC, so a weigh-in
   * logged late evening in a non-UTC zone lands on the right calendar day
   * (Inspector finding, PR #116).
   */
  async getBodyTrend(
    userId: string,
    windowDays: number,
    tz: string,
  ): Promise<BodyTrendPoint[]> {
    const db = getDb();
    const rows = await db
      .select({
        measuredAt: bodyMeasurements.measuredAt,
        weightKg: bodyMeasurements.weightKg,
        bodyFat: bodyMeasurements.bodyFatPercentage,
      })
      .from(bodyMeasurements)
      .where(
        and(
          eq(bodyMeasurements.userId, userId),
          gte(
            bodyMeasurements.measuredAt,
            sql`now() - make_interval(days => ${windowDays})`,
          ),
        ),
      )
      .orderBy(bodyMeasurements.measuredAt);
    return rows.map((r) => ({
      date: r.measuredAt ? localDateISO(new Date(r.measuredAt), tz) : "",
      weightKg: r.weightKg != null ? Number(r.weightKg) : null,
      bodyFat: r.bodyFat != null ? Number(r.bodyFat) : null,
    }));
  }
}
