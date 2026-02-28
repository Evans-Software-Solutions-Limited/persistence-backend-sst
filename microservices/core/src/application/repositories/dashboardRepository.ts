import { eq, desc, and } from "drizzle-orm";
import {
  workoutSessions,
  userGoals,
  bodyMeasurements,
  personalRecords,
  type WorkoutSession,
  type UserGoal,
  type BodyMeasurement,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";

export interface DashboardData {
  recentWorkouts: Array<{
    id: string;
    name: string | null;
    status: string;
    startedAt: Date | null;
    completedAt: Date | null;
    totalDurationSeconds: number | null;
  }>;
  activeGoals: Array<{
    id: string;
    priority: number;
    isActive: boolean;
    targetDate: string | null;
  }>;
  latestMeasurements: {
    id: string;
    weightKg: string | null;
    bodyFatPercentage: string | null;
    measuredAt: Date | null;
  } | null;
  personalRecordsCount: number;
  streak: number;
  steps: null;
  energy: null;
}

export class DashboardRepository {
  static readonly key = "DashboardRepository";

  async getDashboard(userId: string): Promise<DashboardData> {
    const db = getDb();

    // Get last 5 workouts
    const recentWorkouts: WorkoutSession[] = await db
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.userId, userId))
      .orderBy(desc(workoutSessions.startedAt))
      .limit(5);

    // Get active goals
    const activeGoals: UserGoal[] = await db
      .select()
      .from(userGoals)
      .where(and(eq(userGoals.userId, userId), eq(userGoals.isActive, true)));

    // Get latest body measurements
    const latestMeasurement: BodyMeasurement[] = await db
      .select()
      .from(bodyMeasurements)
      .where(eq(bodyMeasurements.userId, userId))
      .orderBy(desc(bodyMeasurements.measuredAt))
      .limit(1);

    // Get personal records count
    const recordsCount = await db
      .select()
      .from(personalRecords)
      .where(eq(personalRecords.userId, userId));

    // Calculate streak
    const streak = await this.calculateStreak(userId);

    return {
      recentWorkouts: recentWorkouts.map((w) => ({
        id: w.id,
        name: w.name,
        status: w.status || "in_progress",
        startedAt: w.startedAt,
        completedAt: w.completedAt,
        totalDurationSeconds: w.totalDurationSeconds,
      })),
      activeGoals: activeGoals.map((g) => ({
        id: g.id,
        priority: g.priority ?? 1,
        isActive: g.isActive ?? true,
        targetDate: g.targetDate,
      })),
      latestMeasurements:
        latestMeasurement.length > 0
          ? {
              id: latestMeasurement[0].id,
              weightKg: latestMeasurement[0].weightKg,
              bodyFatPercentage: latestMeasurement[0].bodyFatPercentage,
              measuredAt: latestMeasurement[0].measuredAt,
            }
          : null,
      personalRecordsCount: recordsCount.length,
      streak,
      steps: null,
      energy: null,
    };
  }

  private async calculateStreak(userId: string): Promise<number> {
    const db = getDb();

    // Get all sessions ordered by date
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
