/** BE-H1 (PER-113) server answers for the phone's tests. */
import type {
  RemoteHistoryDay,
  RemoteHistoryWorkout,
} from "@/domain/models/trainingReads";

export const remoteTotals = {
  workouts: 1,
  durationSeconds: 600,
  volumeKg: 500,
  sets: 5,
};
export const remoteChestRow = {
  muscle: "chest" as const,
  label: "Chest",
  credit: 5,
  hardSets: 5,
  weeklyGuide: 10,
  ratio: 0.5,
  share: 100,
  level: 3 as const,
};

export const remoteWorkoutFixture: RemoteHistoryWorkout = {
  id: "srv-1",
  name: "Upper A",
  startedAt: "2026-09-14T07:10:00.000Z",
  completedAt: "2026-09-14T07:20:00.000Z",
  durationSeconds: 600,
  volumeKg: 500,
  sets: 5,
  records: 1,
  personalRecords: [
    {
      exerciseId: "bench",
      exerciseName: "Bench press",
      recordType: "1rm",
      value: 100,
      setId: "set-1",
    },
  ],
  exercises: [
    {
      exerciseId: "bench",
      name: "Bench press",
      isSubstituted: false,
      sets: [{ id: "set-1", isCompleted: true, reps: 5, weightKg: 100 }],
    },
  ],
};

export const remoteDayFixture: RemoteHistoryDay = {
  date: "2026-09-14",
  timezone: "Europe/London",
  workouts: [remoteWorkoutFixture],
  muscles: [remoteChestRow],
  totals: remoteTotals,
  calories: {
    kcal: 2150,
    targetKcal: 2000,
    result: "on",
    targetSource: "current",
  },
  steps: 9500,
  weightKg: 79.8,
  waterCups: 6,
  sleepHours: 7.5,
  habits: ["sleep"],
  asOf: "2026-11-21T10:00:00.000Z",
};
