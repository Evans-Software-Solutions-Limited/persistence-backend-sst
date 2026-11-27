import {
  REPS_OUT_OF_RANGE,
  SETS_OUT_OF_RANGE,
  WORKOUT_EXERCISES_REQUIRED,
  WORKOUT_NAME_REQUIRED,
  prepareWorkoutSave,
  workoutSaveAccepts,
  workoutSaveErrors,
  workoutSaveResolver,
} from "@/ui/forms/workoutForms";
import type {
  WorkoutFormExercise,
  WorkoutFormState,
} from "@/ui/hooks/useWorkoutForm";

const exercise = (
  overrides: Partial<WorkoutFormExercise> = {},
): WorkoutFormExercise => ({
  id: "x",
  exercise_id: "ex-1",
  exercise_name: "Press",
  sort_order: 0,
  target_sets: 3,
  target_reps_min: 8,
  target_reps_max: 10,
  rest_seconds: 60,
  superset_group: null,
  set_reps: [10, 8, 8],
  ...overrides,
});

const state = (
  overrides: Partial<WorkoutFormState> = {},
): WorkoutFormState => ({
  name: "Push",
  description: "",
  visibility: "private",
  showInOwnerLibrary: true,
  exercises: [exercise()],
  ...overrides,
});

const resolve = (context: WorkoutFormState) =>
  workoutSaveResolver({}, context, {
    fields: {},
    shouldUseNativeValidation: false,
  });

describe("workout Save form (PER-139)", () => {
  it("copy names the shared limits", () => {
    expect(SETS_OUT_OF_RANGE).toBe("Use 1 to 20 sets.");
    expect(REPS_OUT_OF_RANGE).toBe("Reps go from 1 to 100.");
  });

  it("prepares the trimmed name and each exercise's per-set reps", () => {
    expect(
      prepareWorkoutSave(
        {},
        state({
          name: "  Push  ",
          exercises: [exercise(), exercise({ set_reps: null })],
        }),
      ),
    ).toEqual({
      name: "Push",
      exercises: [{ sets: 3, reps: [10, 8, 8] }, { reps: [] }],
    });
  });

  it("accepts a valid plan, including an old range left as saved", async () => {
    const valid = state({
      exercises: [exercise(), exercise({ set_reps: null, target_sets: 25 })],
    });
    expect(workoutSaveAccepts(valid)).toBe(true);
    expect(workoutSaveErrors(valid)).toEqual({ byExercise: {} });
    expect((await resolve(valid)).errors).toEqual({});
  });

  it("refuses a blank name and no exercises", async () => {
    const empty = state({ name: "   ", exercises: [] });
    expect(workoutSaveAccepts(empty)).toBe(false);
    expect(workoutSaveErrors(empty)).toEqual({
      name: WORKOUT_NAME_REQUIRED,
      exercises: WORKOUT_EXERCISES_REQUIRED,
      byExercise: {},
    });
    const { errors } = await resolve(empty);
    expect(errors.name?.message).toBe(WORKOUT_NAME_REQUIRED);
  });

  it("refuses more than 20 sets, and reps outside 1–100, per exercise", () => {
    const tooMany = Array.from({ length: 21 }, () => 5);
    const errors = workoutSaveErrors(
      state({
        exercises: [
          exercise({ set_reps: tooMany }),
          exercise(),
          exercise({ set_reps: [10, 101] }),
          exercise({ set_reps: [0] }),
        ],
      }),
    );
    expect(errors.byExercise).toEqual({
      0: SETS_OUT_OF_RANGE,
      2: REPS_OUT_OF_RANGE,
      3: REPS_OUT_OF_RANGE,
    });
  });
});
