import { buildTemplateMap } from "../active-session-template";
import type { Workout } from "@/domain/models/workout";
import type { SessionExercise } from "@/domain/models/session";

const buildSessionExercise = (
  overrides: Partial<SessionExercise> = {},
): SessionExercise => ({
  id: "se-1",
  sessionId: "s-1",
  exerciseId: "ex-bench",
  exerciseName: "Bench Press",
  sortOrder: 0,
  supersetGroup: null,
  isSubstituted: false,
  originalExerciseId: null,
  notes: null,
  sets: [],
  ...overrides,
});

const buildWorkoutWith = (overrides: Partial<Workout> = {}): Workout => ({
  id: "w-1",
  name: "Push Day",
  description: null,
  createdBy: "user-1",
  visibility: "private",
  estimatedDurationMinutes: 60,
  showInOwnerLibrary: overrides.showInOwnerLibrary ?? true,
  exercises: [],
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
  ...overrides,
});

describe("buildTemplateMap", () => {
  it("returns an empty map when sessionExercises is empty", () => {
    const result = buildTemplateMap({
      sessionExercises: [],
      workout: null,
      defaultRestSeconds: 90,
    });
    expect(result).toEqual({});
  });

  it("falls back to defaultRestSeconds for every exercise when workout is null (Quick Start)", () => {
    const result = buildTemplateMap({
      sessionExercises: [buildSessionExercise({ id: "se-A" })],
      workout: null,
      defaultRestSeconds: 90,
    });
    expect(result).toEqual({ "se-A": { restSeconds: 90 } });
  });

  it("falls back to defaultRestSeconds when workout is undefined", () => {
    const result = buildTemplateMap({
      sessionExercises: [buildSessionExercise({ id: "se-A" })],
      workout: undefined,
      defaultRestSeconds: 60,
    });
    expect(result).toEqual({ "se-A": { restSeconds: 60 } });
  });

  it("threads template metadata when a workout-exercise matches the session-exercise's exerciseId", () => {
    const workout = buildWorkoutWith({
      exercises: [
        {
          id: "we-1",
          exerciseId: "ex-bench",
          sortOrder: 0,
          supersetGroup: null,
          targetSets: 4,
          targetRepsMin: 6,
          targetRepsMax: 10,
          targetDurationSeconds: null,
          restSeconds: 75,
          notes: null,
          exercise: {
            id: "ex-bench",
            name: "Bench Press",
            category: "strength",
            difficultyLevel: "intermediate",
            videoUrl: null,
            thumbnailUrl: "https://cdn.example.com/bench.png",
          },
        },
      ],
    });
    const result = buildTemplateMap({
      sessionExercises: [buildSessionExercise()],
      workout,
      defaultRestSeconds: 90,
    });
    expect(result["se-1"]).toEqual({
      imageUrl: "https://cdn.example.com/bench.png",
      targetSets: 4,
      targetRepsMin: 6,
      targetRepsMax: 10,
      restSeconds: 75,
    });
  });

  it("coerces null targetSets / null restSeconds → undefined / defaultRestSeconds", () => {
    const workout = buildWorkoutWith({
      exercises: [
        {
          id: "we-1",
          exerciseId: "ex-bench",
          sortOrder: 0,
          supersetGroup: null,
          targetSets: null,
          targetRepsMin: 8,
          targetRepsMax: 12,
          targetDurationSeconds: null,
          restSeconds: null,
          notes: null,
          exercise: {
            id: "ex-bench",
            name: "Bench Press",
            category: "strength",
            difficultyLevel: "intermediate",
            videoUrl: null,
            thumbnailUrl: null,
          },
        },
      ],
    });
    const result = buildTemplateMap({
      sessionExercises: [buildSessionExercise()],
      workout,
      defaultRestSeconds: 90,
    });
    expect(result["se-1"]).toEqual({
      imageUrl: undefined,
      targetSets: undefined,
      targetRepsMin: 8,
      targetRepsMax: 12,
      restSeconds: 90,
    });
  });

  it("handles a missing exercise nested object (no thumbnailUrl access)", () => {
    const workout = buildWorkoutWith({
      exercises: [
        {
          id: "we-1",
          exerciseId: "ex-bench",
          sortOrder: 0,
          supersetGroup: null,
          targetSets: 3,
          targetRepsMin: 8,
          targetRepsMax: 12,
          targetDurationSeconds: null,
          restSeconds: 60,
          notes: null,
          exercise: null,
        },
      ],
    });
    const result = buildTemplateMap({
      sessionExercises: [buildSessionExercise()],
      workout,
      defaultRestSeconds: 90,
    });
    expect(result["se-1"]?.imageUrl).toBeUndefined();
    expect(result["se-1"]?.restSeconds).toBe(60);
  });

  it("falls back to default for session-exercises whose exerciseId isn't in the workout", () => {
    const workout = buildWorkoutWith({
      exercises: [
        {
          id: "we-1",
          exerciseId: "ex-bench",
          sortOrder: 0,
          supersetGroup: null,
          targetSets: 3,
          targetRepsMin: 8,
          targetRepsMax: 12,
          targetDurationSeconds: null,
          restSeconds: 60,
          notes: null,
          exercise: null,
        },
      ],
    });
    const result = buildTemplateMap({
      sessionExercises: [
        buildSessionExercise({ id: "se-A", exerciseId: "ex-bench" }),
        buildSessionExercise({ id: "se-B", exerciseId: "ex-row" }),
      ],
      workout,
      defaultRestSeconds: 90,
    });
    expect(result["se-A"]?.restSeconds).toBe(60);
    expect(result["se-B"]).toEqual({ restSeconds: 90 });
  });
});
