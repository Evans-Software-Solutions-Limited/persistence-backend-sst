import {
  validateWorkoutInput,
  sanitizeCreateWorkoutInput,
  calculateEstimatedDuration,
  reorderExercises,
  groupAsSuperSet,
  ungroupSuperSet,
  propagateSupersetSharedFields,
} from "../workout.service";
import type {
  CreateWorkoutInput,
  WorkoutExercise,
} from "@/domain/models/workout";

const makeExercise = (
  overrides: Partial<WorkoutExercise> = {},
): WorkoutExercise => ({
  id: overrides.id ?? "we-1",
  exerciseId: overrides.exerciseId ?? "ex-1",
  sortOrder: overrides.sortOrder ?? 0,
  supersetGroup: overrides.supersetGroup ?? null,
  targetSets: overrides.targetSets ?? 3,
  targetRepsMin: overrides.targetRepsMin ?? 8,
  targetRepsMax: overrides.targetRepsMax ?? 12,
  targetDurationSeconds: null,
  restSeconds: overrides.restSeconds ?? 90,
  notes: null,
  exercise: null,
  ...overrides,
});

describe("validateWorkoutInput", () => {
  const baseInput: CreateWorkoutInput = {
    name: "Push Day",
    exercises: [{ exerciseId: "ex-1", sortOrder: 0 }],
  };

  it("returns ok(input) for a valid input", () => {
    const result = validateWorkoutInput(baseInput);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(baseInput);
  });

  it("rejects empty / whitespace-only name", () => {
    const r1 = validateWorkoutInput({ ...baseInput, name: "" });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error.fields.name).toBe("Workout name is required");

    const r2 = validateWorkoutInput({ ...baseInput, name: "   " });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.fields.name).toBeDefined();
  });

  it("rejects empty exercises array", () => {
    const result = validateWorkoutInput({ ...baseInput, exercises: [] });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.fields.exercises).toBe("Add at least one exercise");
  });

  it("rejects targetSets < 1", () => {
    const result = validateWorkoutInput({
      ...baseInput,
      exercises: [{ exerciseId: "ex-1", sortOrder: 0, targetSets: 0 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.fields["exercises[0].targetSets"]).toBe(
        "Sets must be at least 1",
      );
  });

  it("rejects targetRepsMin > targetRepsMax", () => {
    const result = validateWorkoutInput({
      ...baseInput,
      exercises: [
        {
          exerciseId: "ex-1",
          sortOrder: 0,
          targetRepsMin: 12,
          targetRepsMax: 8,
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.fields["exercises[0].targetRepsMin"]).toBe(
        "Min reps cannot exceed max reps",
      );
  });

  it("allows targetSets undefined or null", () => {
    const result = validateWorkoutInput({
      ...baseInput,
      exercises: [
        { exerciseId: "ex-1", sortOrder: 0, targetSets: undefined },
        { exerciseId: "ex-2", sortOrder: 1, targetSets: null },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("collects multiple errors per call", () => {
    const result = validateWorkoutInput({ name: "", exercises: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.error.fields).length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("sanitizeCreateWorkoutInput", () => {
  it("trims name and description", () => {
    const result = sanitizeCreateWorkoutInput({
      name: "  Push  ",
      description: "  detail  ",
      exercises: [],
    });
    expect(result.name).toBe("Push");
    expect(result.description).toBe("detail");
  });

  it("converts whitespace-only description to null", () => {
    const result = sanitizeCreateWorkoutInput({
      name: "X",
      description: "   ",
      exercises: [],
    });
    expect(result.description).toBeNull();
  });

  it("preserves null description as null", () => {
    const result = sanitizeCreateWorkoutInput({
      name: "X",
      description: null,
      exercises: [],
    });
    expect(result.description).toBeNull();
  });

  it("preserves undefined description as undefined (not transformed to null)", () => {
    const result = sanitizeCreateWorkoutInput({
      name: "X",
      exercises: [],
    });
    expect(result.description).toBeUndefined();
  });

  it("trims exercise notes", () => {
    const result = sanitizeCreateWorkoutInput({
      name: "X",
      exercises: [{ exerciseId: "ex-1", sortOrder: 0, notes: "  go heavy  " }],
    });
    expect(result.exercises[0].notes).toBe("go heavy");
  });
});

describe("calculateEstimatedDuration", () => {
  it("returns at least 1 minute for empty exercise list", () => {
    expect(calculateEstimatedDuration([])).toBe(1);
  });

  it("uses defaults when sets / rest unset", () => {
    const ex = makeExercise({ targetSets: null, restSeconds: null });
    // 3 sets * (35 + 90) = 375 sec = 6.25 min -> rounded to 6
    expect(calculateEstimatedDuration([ex])).toBe(6);
  });

  it("sums across exercises", () => {
    const exA = makeExercise({ id: "we-A", targetSets: 4, restSeconds: 60 });
    const exB = makeExercise({ id: "we-B", targetSets: 3, restSeconds: 120 });
    // A: 4 * (35 + 60) = 380
    // B: 3 * (35 + 120) = 465
    // total 845 / 60 = 14.08 -> 14
    expect(calculateEstimatedDuration([exA, exB])).toBe(14);
  });
});

describe("reorderExercises", () => {
  it("moves an exercise from fromIndex to toIndex and re-stamps sortOrder", () => {
    const items = [
      makeExercise({ id: "A", sortOrder: 0 }),
      makeExercise({ id: "B", sortOrder: 1 }),
      makeExercise({ id: "C", sortOrder: 2 }),
    ];
    const result = reorderExercises(items, 0, 2);
    expect(result.map((e) => e.id)).toEqual(["B", "C", "A"]);
    expect(result.map((e) => e.sortOrder)).toEqual([0, 1, 2]);
  });

  it("returns a copy when fromIndex is out of bounds", () => {
    const items = [makeExercise({ id: "A" })];
    expect(reorderExercises(items, 5, 0).map((e) => e.id)).toEqual(["A"]);
  });

  it("returns a copy when toIndex is out of bounds", () => {
    const items = [makeExercise({ id: "A" })];
    expect(reorderExercises(items, 0, 5).map((e) => e.id)).toEqual(["A"]);
  });
});

describe("groupAsSuperSet", () => {
  it("assigns a fresh group integer to all selected exercises", () => {
    const items = [
      makeExercise({ id: "A" }),
      makeExercise({ id: "B" }),
      makeExercise({ id: "C" }),
    ];
    const result = groupAsSuperSet(items, ["A", "B"]);
    expect(result.find((e) => e.id === "A")?.supersetGroup).toBe(1);
    expect(result.find((e) => e.id === "B")?.supersetGroup).toBe(1);
    expect(result.find((e) => e.id === "C")?.supersetGroup).toBeNull();
  });

  it("assigns max+1 when prior groups exist", () => {
    const items = [
      makeExercise({ id: "A", supersetGroup: 2 }),
      makeExercise({ id: "B" }),
      makeExercise({ id: "C" }),
    ];
    const result = groupAsSuperSet(items, ["B", "C"]);
    expect(result.find((e) => e.id === "B")?.supersetGroup).toBe(3);
  });

  it("returns a copy when ids list is empty", () => {
    const items = [makeExercise({ id: "A" })];
    expect(groupAsSuperSet(items, [])).toEqual(items);
  });

  it("ignores ids that don't match any exercise", () => {
    const items = [makeExercise({ id: "A" })];
    const result = groupAsSuperSet(items, ["nope"]);
    expect(result[0].supersetGroup).toBeNull();
  });
});

describe("ungroupSuperSet", () => {
  it("clears supersetGroup on all peers", () => {
    const items = [
      makeExercise({ id: "A", supersetGroup: 1 }),
      makeExercise({ id: "B", supersetGroup: 1 }),
      makeExercise({ id: "C", supersetGroup: 2 }),
    ];
    const result = ungroupSuperSet(items, 1);
    expect(result.find((e) => e.id === "A")?.supersetGroup).toBeNull();
    expect(result.find((e) => e.id === "B")?.supersetGroup).toBeNull();
    expect(result.find((e) => e.id === "C")?.supersetGroup).toBe(2);
  });
});

describe("propagateSupersetSharedFields", () => {
  it("applies shared fields to every peer", () => {
    const items = [
      makeExercise({
        id: "A",
        supersetGroup: 1,
        targetSets: 3,
        restSeconds: 90,
      }),
      makeExercise({
        id: "B",
        supersetGroup: 1,
        targetSets: 3,
        restSeconds: 90,
      }),
      makeExercise({ id: "C", supersetGroup: null }),
    ];
    const result = propagateSupersetSharedFields(items, 1, {
      targetSets: 5,
      restSeconds: 120,
    });
    expect(result.find((e) => e.id === "A")?.targetSets).toBe(5);
    expect(result.find((e) => e.id === "A")?.restSeconds).toBe(120);
    expect(result.find((e) => e.id === "B")?.targetSets).toBe(5);
    // Standalone exercise untouched
    expect(result.find((e) => e.id === "C")?.targetSets).toBe(3);
  });
});
