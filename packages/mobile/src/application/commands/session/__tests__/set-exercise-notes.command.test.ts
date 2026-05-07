import { setExerciseNotesCommand } from "../set-exercise-notes.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";

const seed = (storage: InMemoryStorageAdapter) => {
  storage.cacheActiveSession("user-1", {
    id: "local-1",
    userId: "user-1",
    workoutId: null,
    name: "Push Day",
    status: "in_progress",
    startedAt: "2026-05-05T10:00:00.000Z",
    completedAt: null,
    notes: null,
    exercises: [
      {
        id: "se-1",
        sessionId: "local-1",
        exerciseId: "ex-bench",
        exerciseName: "Bench Press",
        sortOrder: 0,
        supersetGroup: null,
        isSubstituted: false,
        originalExerciseId: null,
        notes: null,
        sets: [],
      },
    ],
  });
};

describe("setExerciseNotesCommand", () => {
  it("trims and persists the notes onto the matching exercise", () => {
    const storage = new InMemoryStorageAdapter();
    seed(storage);
    setExerciseNotesCommand(
      { storage, userId: "user-1" },
      { sessionExerciseId: "se-1", notes: "  go heavy  " },
    );
    expect(storage.getActiveSession("user-1")?.exercises[0].notes).toBe(
      "go heavy",
    );
  });

  it("normalises empty / whitespace-only input to null", () => {
    const storage = new InMemoryStorageAdapter();
    seed(storage);
    setExerciseNotesCommand(
      { storage, userId: "user-1" },
      { sessionExerciseId: "se-1", notes: "   " },
    );
    expect(storage.getActiveSession("user-1")?.exercises[0].notes).toBeNull();
  });

  it("returns SESSION_NOT_FOUND when no active session", () => {
    const storage = new InMemoryStorageAdapter();
    const result = setExerciseNotesCommand(
      { storage, userId: "user-1" },
      { sessionExerciseId: "se-1", notes: "x" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("SESSION_NOT_FOUND");
  });
});
