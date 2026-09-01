import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { reorderSessionExercisesCommand } from "../reorder-exercises.command";
import type { SessionExercise, WorkoutSession } from "@/domain/models/session";

const exercise = (
  id: string,
  sortOrder: number,
  supersetGroup: number | null,
): SessionExercise => ({
  id,
  sessionId: "session",
  exerciseId: `exercise-${id}`,
  exerciseName: id,
  sortOrder,
  supersetGroup,
  isSubstituted: false,
  originalExerciseId: null,
  notes: null,
  sets: [],
});

const session: WorkoutSession = {
  id: "session",
  userId: "user",
  workoutId: "workout",
  name: "Workout",
  status: "in_progress",
  startedAt: "2026-09-01T10:00:00Z",
  completedAt: null,
  notes: null,
  exercises: [exercise("A", 0, null), exercise("B", 1, 4), exercise("C", 2, 4)],
};

describe("reorderSessionExercisesCommand", () => {
  it("returns session_not_found when there is no active session", () => {
    const result = reorderSessionExercisesCommand(
      { storage: new InMemoryStorageAdapter(), userId: "user" },
      { sessionExerciseId: "A", direction: 1 },
    );
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "SESSION_NOT_FOUND" }),
      }),
    );
  });

  it("leaves the session unchanged for an unknown exercise or boundary move", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheActiveSession("user", session);
    const unknown = reorderSessionExercisesCommand(
      { storage, userId: "user" },
      { sessionExerciseId: "missing", direction: 1 },
    );
    const boundary = reorderSessionExercisesCommand(
      { storage, userId: "user" },
      { sessionExerciseId: "A", direction: -1 },
    );
    expect(unknown).toEqual({ ok: true, value: session });
    expect(boundary).toEqual({ ok: true, value: session });
  });

  it("persists active-session order only and moves a superset as one block", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheActiveSession("user", session);
    const result = reorderSessionExercisesCommand(
      { storage, userId: "user" },
      { sessionExerciseId: "B", direction: -1 },
    );
    expect(result.ok).toBe(true);
    expect(
      storage.getActiveSession("user")?.exercises.map((item) => item.id),
    ).toEqual(["B", "C", "A"]);
  });

  it("moves a standalone exercise after a superset block", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheActiveSession("user", session);
    const result = reorderSessionExercisesCommand(
      { storage, userId: "user" },
      { sessionExerciseId: "A", direction: 1 },
    );
    expect(result.ok).toBe(true);
    expect(
      storage.getActiveSession("user")?.exercises.map((item) => item.id),
    ).toEqual(["B", "C", "A"]);
  });
});
