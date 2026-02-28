import { eq, desc, gte, lte, and } from "drizzle-orm";
import {
  workoutSessions,
  exerciseSets,
  personalRecords,
  bodyMeasurements,
  type PersonalRecord,
  type WorkoutSession,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";

export interface ProgressStats {
  workoutFrequency: number;
  volumeTrend: number[];
  personalRecordCount: number;
  bodyMeasurementTrend: {
    dates: string[];
    weights: (number | null)[];
    bodyFats: (number | null)[];
  };
}

export interface ProgressRecord {
  id: string;
  exerciseId: string;
  recordType: string;
  value: number;
  achievedAt: string;
}

export interface ProgressHistory {
  id: string;
  name: string | null;
  startedAt: string | null;
  completedAt: string | null;
  status: string;
  totalDurationSeconds: number | null;
}

export class ProgressRepository {
  static readonly key = "ProgressRepository";

  async getStats(
    userId: string,
    from: string,
    to: string,
  ): Promise<ProgressStats> {
    const db = getDb();

    const fromDate = new Date(from);
    const toDate = new Date(to);

    // Get sessions in period
    const sessions: WorkoutSession[] = await db
      .select()
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.userId, userId),
          gte(workoutSessions.startedAt, fromDate),
          lte(workoutSessions.startedAt, toDate),
        ),
      );

    // Calculate workout frequency per week
    const dayDiff =
      (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
    const weeks = Math.max(dayDiff / 7, 1);
    const workoutFrequency = Math.round((sessions.length / weeks) * 10) / 10;

    // Get volume trend (total volume per session)
    const volumeTrend: number[] = [];
    for (const session of sessions) {
      const sets = await db
        .select()
        .from(exerciseSets)
        .where(eq(exerciseSets.sessionExerciseId, session.id));

      let totalVolume = 0;
      for (const set of sets) {
        const reps = set.reps ? parseInt(set.reps.toString()) : 0;
        const weight = set.weightKg ? parseFloat(set.weightKg.toString()) : 0;
        totalVolume += reps * weight;
      }
      volumeTrend.push(totalVolume);
    }

    // Get personal records count
    const records: PersonalRecord[] = await db
      .select()
      .from(personalRecords)
      .where(
        and(
          eq(personalRecords.userId, userId),
          gte(personalRecords.achievedAt, fromDate),
          lte(personalRecords.achievedAt, toDate),
        ),
      );

    // Get body measurement trend
    const measurements = await db
      .select()
      .from(bodyMeasurements)
      .where(
        and(
          eq(bodyMeasurements.userId, userId),
          gte(bodyMeasurements.measuredAt, fromDate),
          lte(bodyMeasurements.measuredAt, toDate),
        ),
      )
      .orderBy(bodyMeasurements.measuredAt);

    return {
      workoutFrequency,
      volumeTrend,
      personalRecordCount: records.length,
      bodyMeasurementTrend: {
        dates: measurements.map((m) => {
          const date = m.measuredAt as Date | null;
          return date ? new Date(date).toISOString().split("T")[0] : "";
        }),
        weights: measurements.map((m) =>
          m.weightKg ? parseFloat(m.weightKg.toString()) : null,
        ),
        bodyFats: measurements.map((m) =>
          m.bodyFatPercentage
            ? parseFloat(m.bodyFatPercentage.toString())
            : null,
        ),
      },
    };
  }

  async getRecords(userId: string): Promise<ProgressRecord[]> {
    const db = getDb();
    const records: PersonalRecord[] = await db
      .select()
      .from(personalRecords)
      .where(eq(personalRecords.userId, userId))
      .orderBy(desc(personalRecords.achievedAt));

    return records.map((r) => ({
      id: r.id,
      exerciseId: r.exerciseId,
      recordType: r.recordType,
      value: parseFloat(r.value.toString()),
      achievedAt: new Date(r.achievedAt as Date).toISOString(),
    }));
  }

  async getHistory(
    userId: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<ProgressHistory[]> {
    const db = getDb();
    const sessions: WorkoutSession[] = await db
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.userId, userId))
      .orderBy(desc(workoutSessions.startedAt))
      .limit(limit)
      .offset(offset);

    return sessions.map((s) => ({
      id: s.id,
      name: s.name,
      startedAt: s.startedAt ? new Date(s.startedAt).toISOString() : null,
      completedAt: s.completedAt ? new Date(s.completedAt).toISOString() : null,
      status: s.status || "in_progress",
      totalDurationSeconds: s.totalDurationSeconds,
    }));
  }
}
