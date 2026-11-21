import { and, asc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import {
  bodyMeasurements,
  dailyActivityData,
  exerciseSets,
  exercises,
  habitCompletions,
  habitConfigs,
  muscleGroups,
  nutritionEntries,
  nutritionTargets,
  personalRecords,
  profiles,
  sessionExercises,
  togetherParticipants,
  waterLog,
  workoutSessions,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import {
  muscleKeyFromCatalogueName,
  type TrainingSession,
} from "@persistence/training-metrics";

/**
 * Bounded reads behind the You page, History, Recap and the coach's
 * training review (PER-113, backend design H). Every method takes the
 * owner's `userId` first and filters every query by it: a self route passes
 * the signed-in user, the coach route the client its scope check allowed.
 *
 * Local days are the owner's `profiles.timezone`, bucketed in Postgres
 * (`AT TIME ZONE`), the same way `VolumeRepository` does it. Callers pass
 * inclusive `YYYY-MM-DD` bounds; no window here is longer than ~6 months.
 */

export type ProfileBasics = { timezone: string; bodyType: "male" | "female" };

export type WindowRecord = {
  exerciseId: string;
  exerciseName: string;
  recordType: string;
  value: number;
  achievedAt: string;
  /** The workout whose set holds the record, when the set still exists. */
  sessionId: string | null;
  setId: string | null;
};

/** Everything besides workouts that was logged on one local day. */
export type DayLog = {
  date: string;
  kcal: number;
  waterCups: number;
  steps: number | null;
  weightKg: number | null;
  habits: string[];
  sleepHours: number | null;
};

/** A numeric column (a string from the driver) as a number. */
const num = (v: string | number | null | undefined): number | null =>
  v == null ? null : Number(v);

/** postgres-js turns `::date` into a Date; PGlite gives a string. */
export const isoDay = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

export class TrainingReadRepository {
  async profileBasics(userId: string): Promise<ProfileBasics> {
    const rows = await getDb()
      .select({ timezone: profiles.timezone, gender: profiles.gender })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    const row = rows[0];
    return {
      timezone: row?.timezone || "Europe/London",
      // The figure follows the profile's sex, male by default (design H).
      bodyType: row?.gender === "female" ? "female" : "male",
    };
  }

  /**
   * Completed workouts that STARTED on a local day in [from, to], oldest
   * first, with their exercises, sets and muscles as app keys. Started, not
   * finished, so a day matches the phone's training log.
   */
  async sessions(
    userId: string,
    tz: string,
    from: string,
    to: string,
  ): Promise<TrainingSession[]> {
    const db = getDb();
    const localDay = sql`(${workoutSessions.startedAt} AT TIME ZONE ${tz})::date`;
    const rows = await db
      .select({
        id: workoutSessions.id,
        name: workoutSessions.name,
        startedAt: workoutSessions.startedAt,
        completedAt: workoutSessions.completedAt,
        durationSeconds: workoutSessions.totalDurationSeconds,
      })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.status, "completed"),
          isNotNull(workoutSessions.startedAt),
          sql`${localDay} BETWEEN ${from}::date AND ${to}::date`,
        ),
      )
      .orderBy(asc(workoutSessions.startedAt));
    if (rows.length === 0) return [];

    const exerciseRows = await db
      .select({
        id: sessionExercises.id,
        sessionId: sessionExercises.sessionId,
        exerciseId: sessionExercises.exerciseId,
        isSubstituted: sessionExercises.isSubstituted,
        name: exercises.name,
        primary: exercises.primaryMuscles,
        secondary: exercises.secondaryMuscles,
      })
      .from(sessionExercises)
      .innerJoin(exercises, eq(sessionExercises.exerciseId, exercises.id))
      .where(
        inArray(
          sessionExercises.sessionId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(sessionExercises.sortOrder));

    const setRows = exerciseRows.length
      ? await db
          .select({
            id: exerciseSets.id,
            sessionExerciseId: exerciseSets.sessionExerciseId,
            isCompleted: exerciseSets.isCompleted,
            reps: exerciseSets.reps,
            weightKg: exerciseSets.weightKg,
          })
          .from(exerciseSets)
          .where(
            inArray(
              exerciseSets.sessionExerciseId,
              exerciseRows.map((e) => e.id),
            ),
          )
          .orderBy(asc(exerciseSets.setNumber))
      : [];

    const muscleIds = [
      ...new Set(
        exerciseRows.flatMap((e) => [
          ...(e.primary ?? []),
          ...(e.secondary ?? []),
        ]),
      ),
    ];
    const keyById = new Map<string, string>();
    if (muscleIds.length) {
      const names = await db
        .select({ id: muscleGroups.id, name: muscleGroups.name })
        .from(muscleGroups)
        .where(inArray(muscleGroups.id, muscleIds));
      for (const n of names) {
        const key = muscleKeyFromCatalogueName(n.name);
        if (key) keyById.set(n.id, key);
      }
    }
    const keys = (ids: string[] | null) => [
      ...new Set(
        (ids ?? []).flatMap((id) => {
          const k = keyById.get(id);
          return k ? [k] : [];
        }),
      ),
    ];

    const setsBy = new Map<
      string,
      TrainingSession["exercises"][number]["sets"][number][]
    >();
    for (const s of setRows) {
      const list = setsBy.get(s.sessionExerciseId) ?? [];
      list.push({
        id: s.id,
        isCompleted: s.isCompleted,
        reps: s.reps,
        weightKg: num(s.weightKg),
      });
      setsBy.set(s.sessionExerciseId, list);
    }
    const exercisesBy = new Map<
      string,
      TrainingSession["exercises"][number][]
    >();
    for (const e of exerciseRows) {
      const list = exercisesBy.get(e.sessionId) ?? [];
      list.push({
        exerciseId: e.exerciseId,
        name: e.name,
        isSubstituted: e.isSubstituted,
        primary: keys(e.primary),
        secondary: keys(e.secondary),
        sets: setsBy.get(e.id) ?? [],
      });
      exercisesBy.set(e.sessionId, list);
    }
    return rows.map((r) => ({
      id: r.id,
      name: r.name ?? "Workout",
      // Filtered on IS NOT NULL above.
      startedAt: r.startedAt!.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      durationSeconds: r.durationSeconds,
      exercises: exercisesBy.get(r.id) ?? [],
    }));
  }

  /**
   * Personal records achieved on a local day in [from, to], newest first.
   * `personal_records` keeps each lift's current best only, so a record
   * that was beaten later no longer shows (the phone's per-workout records
   * cover the days it holds).
   */
  async records(
    userId: string,
    tz: string,
    from: string,
    to: string,
  ): Promise<WindowRecord[]> {
    const localDay = sql`(${personalRecords.achievedAt} AT TIME ZONE ${tz})::date`;
    const rows = await getDb()
      .select({
        exerciseId: personalRecords.exerciseId,
        exerciseName: exercises.name,
        recordType: personalRecords.recordType,
        value: personalRecords.value,
        achievedAt: personalRecords.achievedAt,
        sessionId: sessionExercises.sessionId,
        setId: personalRecords.setId,
      })
      .from(personalRecords)
      .innerJoin(exercises, eq(personalRecords.exerciseId, exercises.id))
      .leftJoin(exerciseSets, eq(personalRecords.setId, exerciseSets.id))
      .leftJoin(
        sessionExercises,
        eq(exerciseSets.sessionExerciseId, sessionExercises.id),
      )
      .where(
        and(
          eq(personalRecords.userId, userId),
          sql`${localDay} BETWEEN ${from}::date AND ${to}::date`,
        ),
      )
      .orderBy(sql`${personalRecords.achievedAt} DESC`);
    return rows.map((r) => ({
      exerciseId: r.exerciseId,
      exerciseName: r.exerciseName,
      recordType: r.recordType,
      value: Number(r.value),
      // Filtered on its local day above, so never null here.
      achievedAt: r.achievedAt!.toISOString(),
      sessionId: r.sessionId ?? null,
      setId: r.setId ?? null,
    }));
  }

  /**
   * Together workouts among `sessionIds` (the owner's history rows) and the
   * names of the people they trained with.
   */
  async together(
    userId: string,
    sessionIds: readonly string[],
  ): Promise<{ sessionIds: string[]; names: string[] }> {
    if (sessionIds.length === 0) return { sessionIds: [], names: [] };
    const db = getDb();
    const mine = await db
      .select({
        togetherId: togetherParticipants.sessionId,
        historyId: togetherParticipants.historyId,
      })
      .from(togetherParticipants)
      .where(
        and(
          eq(togetherParticipants.userId, userId),
          inArray(togetherParticipants.historyId, [...sessionIds]),
        ),
      );
    if (mine.length === 0) return { sessionIds: [], names: [] };
    const partners = await db
      .select({ name: profiles.fullName })
      .from(togetherParticipants)
      .innerJoin(profiles, eq(togetherParticipants.userId, profiles.id))
      .where(
        and(
          inArray(
            togetherParticipants.sessionId,
            mine.map((m) => m.togetherId),
          ),
          ne(togetherParticipants.userId, userId),
          eq(togetherParticipants.removedFromRoster, false),
        ),
      );
    return {
      // Matched on history_id above, so never null here.
      sessionIds: mine.map((m) => m.historyId!),
      names: [
        ...new Set(
          partners.flatMap((p) => (p.name?.trim() ? [p.name.trim()] : [])),
        ),
      ],
    };
  }

  /** Food, water, steps, weight and habits per local day in [from, to]. */
  async dayLogs(
    userId: string,
    tz: string,
    from: string,
    to: string,
  ): Promise<Map<string, DayLog>> {
    const db = getDb();
    const foodDay = sql`(${nutritionEntries.loggedAt} AT TIME ZONE ${tz})::date`;
    const weighDay = sql`(${bodyMeasurements.measuredAt} AT TIME ZONE ${tz})::date`;
    const [food, water, steps, weights, habits] = await Promise.all([
      db
        .select({
          day: foodDay,
          kcal: sql<number>`COALESCE(SUM(${nutritionEntries.kcal}), 0)::float`,
        })
        .from(nutritionEntries)
        .where(
          and(
            eq(nutritionEntries.userId, userId),
            sql`${foodDay} BETWEEN ${from}::date AND ${to}::date`,
          ),
        )
        // Positional, so the bind parameter isn't duplicated (see
        // VolumeRepository.dailyVolume).
        .groupBy(sql`1`),
      db
        .select({ day: waterLog.loggedDate, cups: waterLog.cups })
        .from(waterLog)
        .where(
          and(
            eq(waterLog.userId, userId),
            sql`${waterLog.loggedDate} BETWEEN ${from}::date AND ${to}::date`,
          ),
        ),
      db
        .select({
          day: dailyActivityData.activityDate,
          steps: sql<number>`MAX(${dailyActivityData.steps})`,
        })
        .from(dailyActivityData)
        .where(
          and(
            eq(dailyActivityData.userId, userId),
            sql`${dailyActivityData.activityDate} BETWEEN ${from} AND ${to}`,
          ),
        )
        .groupBy(dailyActivityData.activityDate),
      db
        .select({
          day: weighDay,
          weightKg: bodyMeasurements.weightKg,
          measuredAt: bodyMeasurements.measuredAt,
        })
        .from(bodyMeasurements)
        .where(
          and(
            eq(bodyMeasurements.userId, userId),
            isNotNull(bodyMeasurements.weightKg),
            sql`${weighDay} BETWEEN ${from}::date AND ${to}::date`,
          ),
        )
        .orderBy(asc(bodyMeasurements.measuredAt)),
      db
        .select({
          day: habitCompletions.localCompletedDate,
          category: habitConfigs.category,
          value: habitCompletions.value,
          target: habitConfigs.targetValue,
        })
        .from(habitCompletions)
        .innerJoin(
          habitConfigs,
          and(
            eq(habitConfigs.goalId, habitCompletions.goalId),
            eq(habitConfigs.userId, userId),
          ),
        )
        .where(
          and(
            eq(habitCompletions.userId, userId),
            sql`${habitCompletions.localCompletedDate} BETWEEN ${from}::date AND ${to}::date`,
          ),
        ),
    ]);

    const days = new Map<string, DayLog>();
    const day = (d: unknown): DayLog => {
      const key = isoDay(d);
      let log = days.get(key);
      if (!log) {
        log = {
          date: key,
          kcal: 0,
          waterCups: 0,
          steps: null,
          weightKg: null,
          habits: [],
          sleepHours: null,
        };
        days.set(key, log);
      }
      return log;
    };
    for (const f of food) day(f.day).kcal = Number(f.kcal);
    for (const w of water) day(w.day).waterCups = w.cups;
    for (const s of steps) {
      const n = num(s.steps);
      if (n != null && n > 0) day(s.day).steps = n;
    }
    // Oldest first, so the day's last weigh-in wins.
    for (const w of weights) day(w.day).weightKg = num(w.weightKg);
    for (const h of habits) {
      const log = day(h.day);
      if (!log.habits.includes(h.category)) log.habits.push(h.category);
      if (h.category === "sleep")
        log.sleepHours = num(h.value) ?? num(h.target);
    }
    return days;
  }

  /**
   * The calorie target a day is judged against. Until BE-B1 (PER-114)
   * ships `nutrition_target_history`, this is the CURRENT target for every
   * day, and the response says so (`targetSource: "current"`). Once the
   * history exists, look up the latest row with `effective_at` ≤ the end of
   * the day in the owner's time zone (design B), taking the day as a
   * second argument, and answer `"history"`.
   */
  async targetForDay(
    userId: string,
  ): Promise<{ dailyKcal: number | null; source: "current" }> {
    const rows = await getDb()
      .select({ dailyKcal: nutritionTargets.dailyKcal })
      .from(nutritionTargets)
      .where(eq(nutritionTargets.userId, userId))
      .limit(1);
    return { dailyKcal: num(rows[0]?.dailyKcal), source: "current" };
  }
}
