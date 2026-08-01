/**
 * Pure unit tests for the picker-callback dispatcher pulled out of
 * ActiveSessionContainer. Exercises the substitute / add / no-op /
 * unresolved-row branches without rendering the picker tree.
 */

import {
  applyPickerSelection,
  resolvePickerExercise,
  resolveSubstituteSourceRef,
} from "@/ui/containers/active-session-picker";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { Exercise } from "@/domain/models/exercise";

const buildExercise = (overrides: Partial<Exercise> = {}): Exercise => ({
  id: overrides.id ?? "ex-bench",
  name: overrides.name ?? "Bench Press",
  description: null,
  instructions: null,
  category: "strength",
  difficulty: "intermediate",
  primaryMuscleGroups: [],
  secondaryMuscleGroups: [],
  equipment: [],
  primaryMuscleGroupLabels: [],
  secondaryMuscleGroupLabels: [],
  equipmentLabels: [],
  videoUrl: null,
  thumbnailUrl: null,
  isCustom: false,
  createdBy: null,
  ...overrides,
});

const seedSession = (storage: InMemoryStorageAdapter) => {
  storage.cacheActiveSession("user-1", {
    id: "local-1",
    userId: "user-1",
    workoutId: null,
    name: "Quick Workout",
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

describe("applyPickerSelection", () => {
  it("no-ops + no callback when rows is empty", () => {
    const storage = new InMemoryStorageAdapter();
    seedSession(storage);
    const onAfter = jest.fn();
    applyPickerSelection({
      rows: [],
      mode: { kind: "add" },
      resolveExercise: () => buildExercise(),
      storage,
      generateId: () => "id-1",
      userId: "user-1",
      onAfter,
    });
    expect(onAfter).not.toHaveBeenCalled();
  });

  it("substitute mode: resolves first row, fires substitute command in-place, calls onAfter", () => {
    const storage = new InMemoryStorageAdapter();
    seedSession(storage);
    const onAfter = jest.fn();
    applyPickerSelection({
      rows: [{ id: "ex-incline", name: "Incline" }],
      mode: { kind: "substitute", oldSessionExerciseId: "se-1" },
      resolveExercise: (row) => buildExercise({ id: row.id, name: row.name }),
      storage,
      generateId: () => "id-1",
      userId: "user-1",
      onAfter,
    });
    const cached = storage.getActiveSession("user-1");
    // In-place swap (post-2026-05): row count unchanged, source row's
    // exerciseId mutated, originalExerciseId stamped, isSubstituted
    // stays false.
    expect(cached?.exercises).toHaveLength(1);
    expect(cached?.exercises[0].id).toBe("se-1");
    expect(cached?.exercises[0].exerciseId).toBe("ex-incline");
    expect(cached?.exercises[0].isSubstituted).toBe(false);
    expect(cached?.exercises[0].originalExerciseId).toBe("ex-bench");
    expect(onAfter).toHaveBeenCalledTimes(1);
  });

  it("substitute mode: skips command when resolveExercise returns null", () => {
    const storage = new InMemoryStorageAdapter();
    seedSession(storage);
    const onAfter = jest.fn();
    applyPickerSelection({
      rows: [{ id: "missing", name: "Missing" }],
      mode: { kind: "substitute", oldSessionExerciseId: "se-1" },
      resolveExercise: () => null,
      storage,
      generateId: () => "id-1",
      userId: "user-1",
      onAfter,
    });
    expect(onAfter).not.toHaveBeenCalled();
    expect(storage.getActiveSession("user-1")?.exercises[0].isSubstituted).toBe(
      false,
    );
  });

  it("add mode: appends every resolved exercise, calls onAfter once", () => {
    const storage = new InMemoryStorageAdapter();
    seedSession(storage);
    const onAfter = jest.fn();
    applyPickerSelection({
      rows: [
        { id: "ex-row", name: "Row" },
        { id: "ex-pull", name: "Pulldown" },
      ],
      mode: { kind: "add" },
      resolveExercise: (row) => buildExercise({ id: row.id, name: row.name }),
      storage,
      generateId: (() => {
        let n = 0;
        return () => `id-${++n}`;
      })(),
      userId: "user-1",
      onAfter,
    });
    const cached = storage.getActiveSession("user-1");
    expect(cached?.exercises).toHaveLength(3);
    expect(cached?.exercises.map((ex) => ex.exerciseId)).toEqual(
      expect.arrayContaining(["ex-bench", "ex-row", "ex-pull"]),
    );
    expect(onAfter).toHaveBeenCalledTimes(1);
  });

  it("add mode: silently skips unresolved rows", () => {
    const storage = new InMemoryStorageAdapter();
    seedSession(storage);
    const onAfter = jest.fn();
    applyPickerSelection({
      rows: [
        { id: "ex-row", name: "Row" },
        { id: "missing", name: "Missing" },
      ],
      mode: { kind: "add" },
      resolveExercise: (row) =>
        row.id === "missing" ? null : buildExercise({ id: row.id }),
      storage,
      generateId: () => "id-1",
      userId: "user-1",
      onAfter,
    });
    expect(storage.getActiveSession("user-1")?.exercises).toHaveLength(2);
    expect(onAfter).toHaveBeenCalledTimes(1);
  });

  it("add mode with all rows unresolved: skips onAfter", () => {
    const storage = new InMemoryStorageAdapter();
    seedSession(storage);
    const onAfter = jest.fn();
    applyPickerSelection({
      rows: [{ id: "x", name: "X" }],
      mode: { kind: "add" },
      resolveExercise: () => null,
      storage,
      generateId: () => "id-1",
      userId: "user-1",
      onAfter,
    });
    expect(onAfter).not.toHaveBeenCalled();
  });

  it("add-to-superset mode: appends each resolved exercise into the target supersetGroup", () => {
    const storage = new InMemoryStorageAdapter();
    seedSession(storage);
    const onAfter = jest.fn();
    applyPickerSelection({
      rows: [
        { id: "ex-row", name: "Row" },
        { id: "ex-pull", name: "Pulldown" },
      ],
      mode: { kind: "add-to-superset", supersetGroup: 7 },
      resolveExercise: (row) => buildExercise({ id: row.id, name: row.name }),
      storage,
      generateId: (() => {
        let n = 0;
        return () => `id-${++n}`;
      })(),
      userId: "user-1",
      onAfter,
    });
    const cached = storage.getActiveSession("user-1");
    const added = cached?.exercises.filter(
      (ex) => ex.exerciseId === "ex-row" || ex.exerciseId === "ex-pull",
    );
    expect(added).toHaveLength(2);
    expect(added?.every((ex) => ex.supersetGroup === 7)).toBe(true);
    // Original (non-superset) row stays untouched.
    expect(cached?.exercises[0].supersetGroup).toBeNull();
    expect(onAfter).toHaveBeenCalledTimes(1);
  });

  it("add-to-superset mode: skips onAfter when every row is unresolved", () => {
    const storage = new InMemoryStorageAdapter();
    seedSession(storage);
    const onAfter = jest.fn();
    applyPickerSelection({
      rows: [{ id: "missing", name: "Missing" }],
      mode: { kind: "add-to-superset", supersetGroup: 3 },
      resolveExercise: () => null,
      storage,
      generateId: () => "id-1",
      userId: "user-1",
      onAfter,
    });
    expect(onAfter).not.toHaveBeenCalled();
  });

  it("create-superset mode: allocates a fresh supersetGroup and groups every resolved row under it", () => {
    // Surfaces Brad's device bug: tapping "Superset" on the multi-
    // select picker used to delegate to plain add (supersetGroup: null),
    // so the picked rows landed as standalone exercises with no
    // grouping. Now allocates a new group (max+1 of existing groups).
    const storage = new InMemoryStorageAdapter();
    storage.cacheActiveSession("user-1", {
      id: "local-1",
      userId: "user-1",
      workoutId: null,
      name: "Quick Workout",
      status: "in_progress",
      startedAt: "2026-05-05T10:00:00.000Z",
      completedAt: null,
      notes: null,
      exercises: [
        {
          id: "se-1",
          sessionId: "local-1",
          exerciseId: "ex-pre-existing",
          exerciseName: "Pre-existing",
          sortOrder: 0,
          // Already-in-session row WITH a superset of 2 → the new
          // group should be 3 (max+1), not collide with 2 and not
          // reset to 1.
          supersetGroup: 2,
          isSubstituted: false,
          originalExerciseId: null,
          notes: null,
          sets: [],
        },
      ],
    });
    const onAfter = jest.fn();
    applyPickerSelection({
      rows: [
        { id: "ex-bench", name: "Bench" },
        { id: "ex-row", name: "Row" },
      ],
      mode: { kind: "create-superset" },
      resolveExercise: (row) => buildExercise({ id: row.id, name: row.name }),
      storage,
      generateId: () => "id-1",
      userId: "user-1",
      onAfter,
    });
    const cached = storage.getActiveSession("user-1");
    const added = cached?.exercises.filter((ex) =>
      ["ex-bench", "ex-row"].includes(ex.exerciseId),
    );
    expect(added).toHaveLength(2);
    expect(added?.[0].supersetGroup).toBe(3);
    expect(added?.[1].supersetGroup).toBe(3);
    expect(onAfter).toHaveBeenCalledTimes(1);
  });

  it("create-superset mode: starts allocation at 1 when no existing supersetGroups", () => {
    const storage = new InMemoryStorageAdapter();
    seedSession(storage); // se-1 has supersetGroup: null + exerciseId: ex-bench
    applyPickerSelection({
      // Use exerciseIds that don't collide with seedSession's `ex-bench`
      // so the post-filter only picks up the newly-added rows.
      rows: [
        { id: "ex-incline", name: "Incline" },
        { id: "ex-row", name: "Row" },
      ],
      mode: { kind: "create-superset" },
      resolveExercise: (row) => buildExercise({ id: row.id, name: row.name }),
      storage,
      generateId: () => "id-1",
      userId: "user-1",
      onAfter: jest.fn(),
    });
    const cached = storage.getActiveSession("user-1");
    const added = cached?.exercises.filter((ex) =>
      ["ex-incline", "ex-row"].includes(ex.exerciseId),
    );
    expect(added).toHaveLength(2);
    expect(added?.[0].supersetGroup).toBe(1);
    expect(added?.[1].supersetGroup).toBe(1);
  });

  it("create-superset mode: skips onAfter when every row is unresolved", () => {
    const storage = new InMemoryStorageAdapter();
    seedSession(storage);
    const onAfter = jest.fn();
    applyPickerSelection({
      rows: [{ id: "missing", name: "Missing" }],
      mode: { kind: "create-superset" },
      resolveExercise: () => null,
      storage,
      generateId: () => "id-1",
      userId: "user-1",
      onAfter,
    });
    expect(onAfter).not.toHaveBeenCalled();
  });

  it("null mode: no-op, no callback", () => {
    const storage = new InMemoryStorageAdapter();
    seedSession(storage);
    const onAfter = jest.fn();
    applyPickerSelection({
      rows: [{ id: "ex-row", name: "Row" }],
      mode: null,
      resolveExercise: (row) => buildExercise({ id: row.id }),
      storage,
      generateId: () => "id-1",
      userId: "user-1",
      onAfter,
    });
    expect(onAfter).not.toHaveBeenCalled();
    expect(storage.getActiveSession("user-1")?.exercises).toHaveLength(1);
  });
});

describe("resolvePickerExercise", () => {
  it("returns null when the exercise is not in the cache", () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    expect(
      resolvePickerExercise(storage, api, { id: "missing", name: "Missing" }),
    ).toBeNull();
  });

  it("returns the api-enriched exercise when the cache has it", () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    const cached = buildExercise({ id: "ex-bench", name: "Bench Press" });
    storage.cacheExercises([cached]);
    const enrichSpy = jest
      .spyOn(api, "enrichExerciseLabels")
      .mockImplementation((ex: Exercise) => ({
        ...ex,
        primaryMuscleGroupLabels: ["Chest"],
      }));

    const resolved = resolvePickerExercise(storage, api, {
      id: "ex-bench",
      name: "Bench Press",
    });
    expect(resolved?.id).toBe("ex-bench");
    expect(resolved?.primaryMuscleGroupLabels).toEqual(["Chest"]);
    expect(enrichSpy).toHaveBeenCalledTimes(1);
  });
});

describe("resolveSubstituteSourceRef", () => {
  it("returns null when mode is null (no picker open)", () => {
    const storage = new InMemoryStorageAdapter();
    expect(resolveSubstituteSourceRef(null, [], storage)).toBeNull();
  });

  it("returns null for every non-substitute mode", () => {
    const storage = new InMemoryStorageAdapter();
    expect(resolveSubstituteSourceRef({ kind: "add" }, [], storage)).toBeNull();
    expect(
      resolveSubstituteSourceRef(
        { kind: "add-to-superset", supersetGroup: 2 },
        [],
        storage,
      ),
    ).toBeNull();
    expect(
      resolveSubstituteSourceRef({ kind: "create-superset" }, [], storage),
    ).toBeNull();
  });

  it("returns null when the source row has fallen out of the session", () => {
    const storage = new InMemoryStorageAdapter();
    expect(
      resolveSubstituteSourceRef(
        { kind: "substitute", oldSessionExerciseId: "missing" },
        [{ id: "se-1", exerciseId: "ex-bench" }],
        storage,
      ),
    ).toBeNull();
  });

  // The id is what the ranking endpoint needs, and it comes off the SESSION row,
  // not the cache. A cache miss must therefore still yield a usable ref — this is
  // the case the deleted `resolveSubstituteMuscleFilter` returned undefined for,
  // which under the new picker would have meant no ranking at all.
  it("still resolves the id on a cache miss, with a null display name", () => {
    const storage = new InMemoryStorageAdapter();
    expect(
      resolveSubstituteSourceRef(
        { kind: "substitute", oldSessionExerciseId: "se-1" },
        [{ id: "se-1", exerciseId: "ex-bench" }],
        storage,
      ),
    ).toEqual({ id: "ex-bench", name: null });
  });

  it("resolves the display name from the cache when present", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([
      buildExercise({ id: "ex-bench", name: "Barbell Bench Press" }),
    ]);
    expect(
      resolveSubstituteSourceRef(
        { kind: "substitute", oldSessionExerciseId: "se-1" },
        [{ id: "se-1", exerciseId: "ex-bench" }],
        storage,
      ),
    ).toEqual({ id: "ex-bench", name: "Barbell Bench Press" });
  });

  /**
   * `forExerciseId` is validated `format: "uuid"` on `GET /exercises/substitutes`,
   * so a `local-…` id is rejected 422 before the handler runs and the sheet
   * blames the network for a row the server has never heard of.
   *
   * Reachable, and it is the mirror of the not-yet-synced group on the picker:
   * create an exercise offline → swap it in → `substituteExerciseCommand` writes
   * the `local-…` id onto the session row → tap Substitute on that row.
   */
  it("nulls the id — but keeps the name — for a source that has not synced yet", () => {
    const storage = new InMemoryStorageAdapter();
    storage.saveCustomExercise(
      buildExercise({ id: "local-abc", name: "Cable Fly", isCustom: true }),
    );
    expect(
      resolveSubstituteSourceRef(
        { kind: "substitute", oldSessionExerciseId: "se-1" },
        [{ id: "se-1", exerciseId: "local-abc" }],
        storage,
      ),
    ).toEqual({ id: null, name: "Cable Fly" });
  });
});
