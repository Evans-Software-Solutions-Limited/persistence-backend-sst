import { deleteExerciseCommand } from "../delete-exercise.command";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { Exercise } from "@/domain/models/exercise";

const buildExercise = (overrides: Partial<Exercise> = {}): Exercise => ({
  id: overrides.id ?? "ex-1",
  name: "Test Lift",
  description: null,
  instructions: null,
  category: "strength",
  difficulty: "beginner",
  primaryMuscleGroups: ["chest"],
  secondaryMuscleGroups: [],
  equipment: ["barbell"],
  videoUrl: null,
  thumbnailUrl: null,
  isCustom: true,
  createdBy: "user-1",
  ...overrides,
});

describe("deleteExerciseCommand", () => {
  let api: InMemoryApiAdapter;
  let storage: InMemoryStorageAdapter;

  beforeEach(() => {
    api = new InMemoryApiAdapter();
    storage = new InMemoryStorageAdapter();
  });

  it("removes the exercise from the local cache when the API call succeeds", async () => {
    storage.cacheExercises([
      buildExercise({ id: "ex-1" }),
      buildExercise({ id: "ex-2", name: "Other" }),
    ]);

    const result = await deleteExerciseCommand({ api, storage }, "ex-1");
    expect(result.ok).toBe(true);
    expect(storage.getCachedExercise("ex-1")).toBeNull();
    // Unrelated rows remain
    expect(storage.getCachedExercise("ex-2")).not.toBeNull();
  });

  it("leaves the cache untouched when the API call fails", async () => {
    storage.cacheExercises([buildExercise({ id: "ex-1" })]);
    api.shouldFail = true;
    api.failError = {
      kind: "api",
      code: "not_found",
      message: "Exercise not found",
    };

    const result = await deleteExerciseCommand({ api, storage }, "ex-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe("Exercise not found");
    }
    // Cache preserved — user sees the row remain with an error toast
    expect(storage.getCachedExercise("ex-1")).not.toBeNull();
  });

  it("is a no-op on the cache when the row wasn't cached locally", async () => {
    // API succeeds (returns void); cache has no matching row to remove.
    const result = await deleteExerciseCommand(
      { api, storage },
      "never-cached",
    );
    expect(result.ok).toBe(true);
    expect(storage.getCachedExercise("never-cached")).toBeNull();
  });
});
