import type {
  WorkoutSession,
  SessionExercise,
} from "../../domain/models/session";
import type { TogetherSharedPlan } from "../../domain/ports/togetherShared.port";
import { uuid } from "./security/schema";

/** Explicit pre-promotion template copy. Existing logged work is never remapped or discarded. */
export function adoptSharedPlan(
  draft: WorkoutSession,
  plan: TogetherSharedPlan,
  mode: "append" | "replace-empty",
  options: {
    randomUUID(): string;
    exerciseName?(exerciseId: string): string | undefined;
  },
): WorkoutSession {
  if (
    draft.together ||
    draft.status !== "in_progress" ||
    draft.withClient ||
    draft.retrospectiveCompletedAt != null ||
    draft.retrospectiveDurationSeconds != null
  )
    throw new Error("plan-adoption-unavailable");
  if (mode !== "append" && mode !== "replace-empty")
    throw new Error("plan-adoption-unavailable");
  if (
    mode === "replace-empty" &&
    draft.exercises.some((exercise) => exercise.sets.length > 0)
  )
    throw new Error("plan-adoption-would-discard-sets");
  if (
    !plan ||
    typeof plan.name !== "string" ||
    !plan.name.trim() ||
    plan.name.length > 120 ||
    !Array.isArray(plan.exercises) ||
    !plan.exercises.length ||
    plan.exercises.length > 100
  )
    throw new Error("invalid-shared-plan");
  const ids = new Set<string>(),
    orders = new Set<number>();
  for (const exercise of plan.exercises) {
    if (
      !uuid(exercise.planExerciseId) ||
      !uuid(exercise.exerciseId) ||
      ids.has(exercise.planExerciseId) ||
      !Number.isInteger(exercise.order) ||
      exercise.order < 0 ||
      exercise.order > 99 ||
      orders.has(exercise.order) ||
      !Number.isInteger(exercise.targetSets) ||
      exercise.targetSets < 1 ||
      exercise.targetSets > 100
    )
      throw new Error("invalid-shared-plan");
    ids.add(exercise.planExerciseId);
    orders.add(exercise.order);
  }
  const copy: WorkoutSession = JSON.parse(JSON.stringify(draft));
  const retained = mode === "append" ? copy.exercises : [];
  if (retained.length + plan.exercises.length > 100)
    throw new Error("workout-exercise-limit");
  const nextOrder = retained.length
    ? Math.max(...retained.map((exercise) => exercise.sortOrder)) + 1
    : 0;
  if (nextOrder + plan.exercises.length > 100)
    throw new Error("workout-exercise-limit");
  const used = new Set(
    retained.flatMap((exercise) => [
      exercise.id,
      ...exercise.sets.map((set) => set.id),
    ]),
  );
  const localId = () => {
    const value = options.randomUUID();
    if (!uuid(value) || used.has(`local-${value}`))
      throw new Error("invalid-local-identity");
    const id = `local-${value}`;
    used.add(id);
    return id;
  };
  const additions: SessionExercise[] = [...plan.exercises]
    .sort((a, b) => a.order - b.order)
    .map((exercise, index) => {
      const id = localId();
      return {
        id,
        sessionId: draft.id,
        exerciseId: exercise.exerciseId,
        exerciseName:
          options.exerciseName?.(exercise.exerciseId)?.trim() ||
          exercise.exerciseId,
        category: "strength",
        sortOrder: nextOrder + index,
        supersetGroup: null,
        isSubstituted: false,
        originalExerciseId: null,
        notes: null,
        sets: Array.from({ length: exercise.targetSets }, (_, setIndex) => ({
          id: localId(),
          sessionExerciseId: id,
          setNumber: setIndex + 1,
          weightKg: null,
          reps: null,
          rpe: null,
          durationSeconds: null,
          distanceMeters: null,
          isCompleted: false,
          completedAt: null,
        })),
      };
    });
  copy.exercises = [...retained, ...additions];
  return copy;
}
