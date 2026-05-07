/**
 * Pure unit tests for the picker-callback dispatcher pulled out of
 * ActiveSessionContainer. Exercises the substitute / add / no-op /
 * unresolved-row branches without rendering the picker tree.
 */

import {
  applyPickerSelection,
  resolveLegacyExercise,
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

  it("substitute mode: resolves first row, fires substitute command, calls onAfter", () => {
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
    // Old row marked substituted, new row inserted.
    expect(cached?.exercises[0].isSubstituted).toBe(true);
    expect(cached?.exercises.some((ex) => ex.exerciseId === "ex-incline")).toBe(
      true,
    );
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

describe("resolveLegacyExercise", () => {
  it("returns null when the exercise is not in the cache", () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    expect(
      resolveLegacyExercise(storage, api, { id: "missing", name: "Missing" }),
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

    const resolved = resolveLegacyExercise(storage, api, {
      id: "ex-bench",
      name: "Bench Press",
    });
    expect(resolved?.id).toBe("ex-bench");
    expect(resolved?.primaryMuscleGroupLabels).toEqual(["Chest"]);
    expect(enrichSpy).toHaveBeenCalledTimes(1);
  });
});
