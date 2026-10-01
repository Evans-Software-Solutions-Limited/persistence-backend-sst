import {
  and,
  eq,
  inArray,
  isNotNull,
  gte,
  lte,
  lt,
  sql,
  desc,
} from "drizzle-orm";
import {
  exerciseSets,
  sessionExercises,
  workoutSessions,
  type TogetherPlan,
  type TogetherExecution,
} from "@persistence/db";
import type { TogetherTx } from "./shared";

/** Called only after the session/actor authorization guard, in the same transaction. */
export async function readPreviousValues(
  tx: TogetherTx,
  ownerId: string,
  plan: TogetherPlan,
  execution: TogetherExecution,
  before: Date,
) {
  const ids = [
    ...new Set(
      plan.exercises.flatMap((exercise) => {
        const own = execution.exercises.find(
          (e) => e.planExerciseId === exercise.planExerciseId,
        );
        return own?.skipped
          ? []
          : [own?.substituteExerciseId ?? exercise.exerciseId];
      }),
    ),
  ];
  if (!ids.length) return [];
  const recordedAt = sql<Date>`coalesce(${workoutSessions.completedAt}, ${workoutSessions.startedAt})`;
  const rows = await tx
    .selectDistinctOn([sessionExercises.exerciseId, exerciseSets.setNumber], {
      exerciseId: sessionExercises.exerciseId,
      setNumber: exerciseSets.setNumber,
      weightKg: exerciseSets.weightKg,
      reps: exerciseSets.reps,
      completedAt: workoutSessions.completedAt,
      startedAt: workoutSessions.startedAt,
    })
    .from(exerciseSets)
    .innerJoin(
      sessionExercises,
      eq(sessionExercises.id, exerciseSets.sessionExerciseId),
    )
    .innerJoin(
      workoutSessions,
      eq(workoutSessions.id, sessionExercises.sessionId),
    )
    .where(
      and(
        eq(workoutSessions.userId, ownerId),
        eq(workoutSessions.status, "completed"),
        eq(sessionExercises.isSubstituted, false),
        inArray(sessionExercises.exerciseId, ids),
        isNotNull(exerciseSets.weightKg),
        isNotNull(exerciseSets.reps),
        gte(exerciseSets.setNumber, 1),
        lte(exerciseSets.setNumber, 100),
        lt(recordedAt, before),
      ),
    )
    .orderBy(
      sessionExercises.exerciseId,
      exerciseSets.setNumber,
      sql`${recordedAt} desc nulls last`,
      desc(workoutSessions.id),
      desc(sessionExercises.id),
      desc(exerciseSets.id),
    );
  return rows.map((row) => ({
    exerciseId: row.exerciseId,
    setNumber: row.setNumber,
    weightKg: Number(row.weightKg),
    reps: row.reps as number,
    recordedAt: (row.completedAt ?? row.startedAt)!.toISOString(),
  }));
}
