import { withTogetherWorkout } from "../withTogetherWorkout";
import { InMemoryStorageAdapter } from "./in-memory-storage.adapter";
import type { WorkoutSession } from "@/domain/models/session";
import type { TogetherWorkoutPort } from "@/domain/ports/togetherWorkout.port";

const draft = (): WorkoutSession => ({
  id: "local-1",
  userId: "u",
  workoutId: null,
  name: "Workout",
  status: "in_progress",
  startedAt: "2026-10-04T10:00:00Z",
  completedAt: null,
  notes: null,
  exercises: [],
});
function setup() {
  const base = new InMemoryStorageAdapter();
  base.cacheActiveSession("u", draft());
  let checkpoint: WorkoutSession | null = null;
  const workout: TogetherWorkoutPort = {
    promote: async (session) => {
      checkpoint = {
        ...session,
        together: { sessionId: "shared", executionId: "own" },
      };
    },
    getActive: (user) => (checkpoint?.userId === user ? checkpoint : null),
    read: (user, id) =>
      checkpoint?.userId === user && checkpoint.id === id ? checkpoint : null,
    save: (user, session) => {
      if (user !== "u") throw Error("account");
      checkpoint = { ...session, together: checkpoint!.together };
    },
    status: () => null,
    subscribe: () => () => {},
  };
  return { base, workout, storage: withTogetherWorkout(base, workout) };
}

describe("withTogetherWorkout", () => {
  it("preserves absent capability identity and binds other adapter methods", () => {
    const { base, storage } = setup();
    expect(withTogetherWorkout(base)).toBe(base);
    storage.invalidateDashboard("u");
    expect(storage.getActiveSession("missing")).toBeNull();
    expect(storage.getLatestSession("missing")).toBeNull();
    storage.cacheActiveSession("u", { ...draft(), name: "Personal" });
    expect(storage.getLatestSession("u")?.name).toBe("Personal");
    expect(storage.getSessionSets("u", "local-1", "exercise")).toEqual([]);
    storage.clearActiveSession("u");
    expect(base.getActiveSession("u")).toBeNull();
  });
  it("reads committed checkpoint despite a failed personal mirror and preserves full values", async () => {
    const { base, workout, storage } = setup();
    await workout.promote(draft());
    const mirror = jest
      .spyOn(base, "cacheActiveSession")
      .mockImplementation(() => {
        throw Error("disk");
      });
    const updated = {
      ...draft(),
      notes: "kept",
      exercises: [
        {
          id: "ex",
          sessionId: "local-1",
          exerciseId: "bench",
          exerciseName: "Bench",
          sortOrder: 0,
          supersetGroup: null,
          isSubstituted: false,
          originalExerciseId: null,
          notes: "note",
          sets: [
            {
              id: "set",
              sessionExerciseId: "ex",
              setNumber: 1,
              weightKg: 50,
              reps: null,
              rpe: 8,
              durationSeconds: null,
              distanceMeters: null,
              isCompleted: false,
              completedAt: null,
            },
          ],
        },
      ],
    };
    expect(() => storage.cacheActiveSession("u", updated)).not.toThrow();
    expect(mirror).toHaveBeenCalled();
    expect(storage.getActiveSession("u")).toMatchObject({
      notes: "kept",
      together: { executionId: "own" },
    });
    expect(storage.getLatestSession("u")?.exercises).toEqual(updated.exercises);
    expect(storage.getSessionSets("u", "local-1", "bench")).toEqual(
      updated.exercises[0].sets,
    );
    expect(storage.getSessionSets("u", "local-1", "other")).toEqual([]);
    expect(storage.getActiveSession("other")).toBeNull();
  });
  it("mirrors successful commits and prevents replacement or clear after restart", async () => {
    const { base, workout } = setup();
    await workout.promote(draft());
    const storage = withTogetherWorkout(base, workout);
    storage.cacheActiveSession("u", { ...draft(), notes: "durable" });
    expect(base.getActiveSession("u")?.notes).toBe("durable");
    expect(() =>
      storage.cacheActiveSession("u", { ...draft(), id: "new" }),
    ).toThrow("retained");
    expect(() => storage.clearActiveSession("u")).toThrow("retained");
    expect(storage.getActiveSession("u")?.id).toBe("local-1");
  });
  it("does not write the mirror if checkpoint save fails and refuses orphan markers", async () => {
    const { base, workout, storage } = setup();
    expect(() =>
      storage.cacheActiveSession("u", {
        ...draft(),
        together: { sessionId: "x", executionId: "y" },
      }),
    ).toThrow("unavailable");
    await workout.promote(draft());
    jest.spyOn(workout, "save").mockImplementation(() => {
      throw Error("full");
    });
    expect(() =>
      storage.cacheActiveSession("u", { ...draft(), notes: "lost" }),
    ).toThrow("full");
    expect(base.getActiveSession("u")?.notes).toBeNull();
    expect(storage.getActiveSession("u")?.notes).toBeNull();
  });
});

it("discovers the account checkpoint after sign-out clears every personal row", async () => {
  const { base, workout, storage } = setup();
  await workout.promote(draft());
  await storage.clearAll();
  expect(base.getActiveSession("u")).toBeNull();
  expect(storage.getActiveSession("other")).toBeNull();
  const reopened = withTogetherWorkout(base, workout);
  expect(reopened.getActiveSession("u")?.together?.executionId).toBe("own");
  expect(reopened.getLatestSession("u")?.id).toBe("local-1");
  expect(() =>
    reopened.cacheActiveSession("u", { ...draft(), id: "replacement" }),
  ).toThrow("retained");
  expect(() => reopened.clearActiveSession("u")).toThrow("retained");
  reopened.cacheActiveSession("u", {
    ...reopened.getActiveSession("u")!,
    notes: "after relogin",
  });
  expect(reopened.getActiveSession("u")?.notes).toBe("after relogin");
});
