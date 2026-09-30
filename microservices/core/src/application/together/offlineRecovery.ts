import type { TogetherPlan, TogetherExecution } from "@persistence/db";
import type { TogetherCommand } from "./types";
import { requireTogether } from "./shared";
export interface RecoveryCommand {
  kind: "together-recovery-v1";
  userId: string;
  sessionId: string;
  executionId: string;
  commandId: string;
  planHash: string;
  startedAt: number;
  expectedVersion: number;
  operation: Exclude<TogetherCommand["operation"], { type: "replacePlan" }>;
}
/** Pure personal reconstruction. No history writes, delegated authors or shared-plan mutations. */
export function reconstructOwn(
  plan: TogetherPlan,
  previous: TogetherExecution,
  command: RecoveryCommand,
): TogetherExecution {
  const next = structuredClone(previous),
    op = command.operation;
  if (op.type === "rest") {
    next.restEndsAt = op.endsAt;
    return next;
  }
  requireTogether(
    plan.exercises.some((e) => e.planExerciseId === op.planExerciseId),
    "INVALID_SCHEMA",
    400,
  );
  let exercise = next.exercises.find(
    (e) => e.planExerciseId === op.planExerciseId,
  );
  if (!exercise) {
    exercise = {
      planExerciseId: op.planExerciseId,
      skipped: false,
      sets: [],
      everAcknowledged: false,
    };
    next.exercises.push(exercise);
  }
  if (op.type === "upsertSet") {
    const index = exercise.sets.findIndex((s) => s.setId === op.set.setId);
    requireTogether(
      index >= 0 || exercise.sets.length < 100,
      "INVALID_SCHEMA",
      400,
    );
    if (index >= 0) exercise.sets[index] = op.set;
    else exercise.sets.push(op.set);
    exercise.everAcknowledged = true;
  } else if (op.type === "removeSet")
    exercise.sets = exercise.sets.filter((s) => s.setId !== op.setId);
  else if (op.type === "skip") exercise.skipped = op.skipped;
  else {
    requireTogether(
      !exercise.everAcknowledged ||
        (exercise.substituteExerciseId ?? null) === op.exerciseId,
      "INVALID_STATE",
      409,
    );
    exercise.substituteExerciseId = op.exerciseId;
  }
  return next;
}
