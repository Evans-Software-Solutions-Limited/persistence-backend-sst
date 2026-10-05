import type { WorkoutSession } from "../../../domain/models/session";
const userId = "11111111-1111-4111-8111-111111111111",
  exerciseId = "22222222-2222-4222-8222-222222222222";
export function draft(): WorkoutSession {
  return {
    id: "local-own",
    userId,
    name: "Squat",
    status: "in_progress",
    startedAt: "2026-10-04T09:00:00.000Z",
    completedAt: null,
    notes: "Keep notes",
    workoutId: null,
    exercises: [
      {
        id: "local-exercise",
        sessionId: "local-own",
        exerciseId,
        exerciseName: "Squat",
        category: "strength",
        sortOrder: 0,
        supersetGroup: null,
        isSubstituted: false,
        originalExerciseId: null,
        notes: null,
        sets: [
          {
            id: "local-set",
            sessionExerciseId: "local-exercise",
            setNumber: 1,
            weightKg: 25,
            reps: 8,
            rpe: null,
            durationSeconds: null,
            distanceMeters: null,
            isCompleted: false,
            completedAt: null,
          },
        ],
      },
    ],
  };
}
