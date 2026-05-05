import { addExerciseCommand } from "../add-exercise.command";
import { startSessionCommand } from "../start-session.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { Exercise } from "@/domain/models/exercise";
import type { Workout } from "@/domain/models/workout";

const buildExercise = (overrides: Partial<Exercise> = {}): Exercise => ({
  id: "ex-pull",
  name: "Pull-up",
  description: null,
  instructions: null,
  category: "strength",
  difficulty: "intermediate",
  primaryMuscleGroups: [],
  secondaryMuscleGroups: [],
  equipment: [],
  videoUrl: null,
  thumbnailUrl: null,
  isCustom: false,
  createdBy: null,
  ...overrides,
});

const buildWorkout = (): Workout => ({
  id: "wk-1",
  name: "Push Day",
  description: null,
  createdBy: "user-1",
  visibility: "private",
  estimatedDurationMinutes: 45,
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
      restSeconds: 90,
      notes: null,
      exercise: null,
    },
  ],
  createdAt: "2026-04-28T00:00:00Z",
  updatedAt: "2026-04-28T00:00:00Z",
});

describe("addExerciseCommand", () => {
  let storage: InMemoryStorageAdapter;
  let nextId = 0;
  const generateId = () => `id-${++nextId}`;
  const now = () => new Date("2026-05-05T10:00:00.000Z");

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    nextId = 0;
  });

  it("appends an exercise at max(sortOrder)+1", () => {
    startSessionCommand(
      { storage, generateId, userId: "user-1", now },
      { workout: buildWorkout() },
    );
    const result = addExerciseCommand(
      { storage, generateId, userId: "user-1" },
      { exercise: buildExercise() },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.exercises).toHaveLength(2);
    expect(result.value.exercises[1].sortOrder).toBe(1);
    expect(result.value.exercises[1].exerciseName).toBe("Pull-up");
  });

  it("appends to an empty Quick Start session at sortOrder 0", () => {
    startSessionCommand({ storage, generateId, userId: "user-1", now });
    const result = addExerciseCommand(
      { storage, generateId, userId: "user-1" },
      { exercise: buildExercise() },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.exercises).toHaveLength(1);
    expect(result.value.exercises[0].sortOrder).toBe(0);
  });

  it("returns SESSION_NOT_FOUND when no session exists", () => {
    const result = addExerciseCommand(
      { storage, generateId, userId: "user-1" },
      { exercise: buildExercise() },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("invalidates the dashboard cache", () => {
    startSessionCommand({ storage, generateId, userId: "user-1", now });
    const spy = jest.spyOn(storage, "invalidateDashboard");
    addExerciseCommand(
      { storage, generateId, userId: "user-1" },
      { exercise: buildExercise() },
    );
    expect(spy).toHaveBeenCalledWith("user-1");
  });

  it("does not enqueue any sync mutation", () => {
    startSessionCommand({ storage, generateId, userId: "user-1", now });
    addExerciseCommand(
      { storage, generateId, userId: "user-1" },
      { exercise: buildExercise() },
    );
    expect(storage.getPendingMutations()).toEqual([]);
  });
});
