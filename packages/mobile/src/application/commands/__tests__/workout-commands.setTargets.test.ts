import { createWorkoutCommand } from "../create-workout.command";
import { updateWorkoutCommand } from "../update-workout.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { Workout } from "@/domain/models/workout";

/**
 * PER-139: offline, `setTargets` rides in the cached workout JSON and the
 * existing queued workout commands — no new SQLite table.
 */
describe("workout commands carry reps per set (PER-139)", () => {
  let storage: InMemoryStorageAdapter;
  let nextId = 0;
  const generateId = () => `id-${++nextId}`;
  const tenEightEight = [{ reps: 10 }, { reps: 8 }, { reps: 8 }];

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    nextId = 0;
  });

  it("create: setTargets ride in the cached workout JSON and the queued POST", () => {
    const result = createWorkoutCommand(
      { storage, generateId, userId: "user-1" },
      {
        name: "Push",
        exercises: [
          {
            exerciseId: "ex-1",
            sortOrder: 0,
            targetSets: 3,
            targetRepsMin: 8,
            targetRepsMax: 10,
            setTargets: tenEightEight,
          },
          { exerciseId: "ex-2", sortOrder: 1, targetSets: 3 },
        ],
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.exercises[0].setTargets).toEqual(tenEightEight);
    // An exercise without them keeps the old shape (no key at all).
    expect(result.value.exercises[1]).not.toHaveProperty("setTargets");
    const cached = storage.getCachedWorkoutDetail("user-1", result.value.id);
    expect(cached?.workout.exercises[0].setTargets).toEqual(tenEightEight);
    const payload = JSON.parse(storage.getPendingMutations()[0].payload) as {
      exercises: { setTargets?: unknown }[];
    };
    expect(payload.exercises[0].setTargets).toEqual(tenEightEight);
  });

  it("update: new setTargets replace; an exercise without them keeps matching stored ones", () => {
    const existing: Workout = {
      id: "w-1",
      name: "Push",
      description: null,
      createdBy: "user-1",
      visibility: "private",
      estimatedDurationMinutes: 30,
      showInOwnerLibrary: true,
      exercises: [
        {
          id: "we-1",
          exerciseId: "ex-1",
          sortOrder: 0,
          supersetGroup: null,
          targetSets: 3,
          targetRepsMin: 8,
          targetRepsMax: 10,
          targetDurationSeconds: null,
          restSeconds: 90,
          notes: null,
          setTargets: tenEightEight,
          exercise: null,
        },
      ],
      createdAt: "2026-04-27T00:00:00Z",
      updatedAt: "2026-04-27T00:00:00Z",
    };
    storage.cacheWorkoutDetail("user-1", existing);

    const kept = updateWorkoutCommand(
      { storage, generateId, userId: "user-1" },
      "w-1",
      {
        exercises: [
          {
            exerciseId: "ex-1",
            sortOrder: 0,
            targetSets: 3,
            targetRepsMin: 8,
            targetRepsMax: 10,
          },
        ],
      },
    );
    expect(kept.ok).toBe(true);
    if (!kept.ok) return;
    expect(kept.value.exercises[0].setTargets).toEqual(tenEightEight);

    const replaced = updateWorkoutCommand(
      { storage, generateId, userId: "user-1" },
      "w-1",
      {
        exercises: [
          {
            exerciseId: "ex-1",
            sortOrder: 0,
            targetSets: 2,
            targetRepsMin: 6,
            targetRepsMax: 12,
            setTargets: [{ reps: 12 }, { reps: 6 }],
          },
        ],
      },
    );
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect(replaced.value.exercises[0].setTargets).toEqual([
      { reps: 12 },
      { reps: 6 },
    ]);
    const lastPayload = JSON.parse(
      storage.getPendingMutations().at(-1)!.payload,
    ) as { exercises: { setTargets?: unknown }[] };
    expect(lastPayload.exercises[0].setTargets).toEqual([
      { reps: 12 },
      { reps: 6 },
    ]);
  });

  it("update without exercises leaves the cached per-set reps alone", () => {
    const existing: Workout = {
      id: "w-2",
      name: "Pull",
      description: null,
      createdBy: "user-1",
      visibility: "private",
      estimatedDurationMinutes: 30,
      showInOwnerLibrary: true,
      exercises: [
        {
          id: "we-1",
          exerciseId: "ex-1",
          sortOrder: 0,
          supersetGroup: null,
          targetSets: 3,
          targetRepsMin: 8,
          targetRepsMax: 10,
          targetDurationSeconds: null,
          restSeconds: 90,
          notes: null,
          setTargets: tenEightEight,
          exercise: null,
        },
      ],
      createdAt: "2026-04-27T00:00:00Z",
      updatedAt: "2026-04-27T00:00:00Z",
    };
    storage.cacheWorkoutDetail("user-1", existing);
    const renamed = updateWorkoutCommand(
      { storage, generateId, userId: "user-1" },
      "w-2",
      { name: "Pull v2" },
    );
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.value.exercises[0].setTargets).toEqual(tenEightEight);
  });
});
