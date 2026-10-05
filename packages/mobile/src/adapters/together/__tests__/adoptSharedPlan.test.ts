import { randomUUID } from "node:crypto";
import { adoptSharedPlan } from "../adoptSharedPlan";
import type { WorkoutSession } from "../../../domain/models/session";
import type { TogetherSharedPlan } from "../../../domain/ports/togetherShared.port";
const id = (n: number) =>
  `${n.toString().padStart(8, "0")}-1111-4111-8111-111111111111`;
const plan: TogetherSharedPlan = {
  name: "Host plan",
  exercises: [
    { planExerciseId: id(1), exerciseId: id(2), order: 0, targetSets: 2 },
  ],
};
function draft(): WorkoutSession {
  return {
    id: "personal",
    userId: id(3),
    name: "My workout",
    notes: "Keep my notes",
    workoutId: id(4),
    status: "in_progress",
    startedAt: "2026-10-05T10:00:00.000Z",
    completedAt: null,
    exercises: [
      {
        id: "existing-exercise",
        sessionId: "personal",
        exerciseId: id(5),
        exerciseName: "Bench",
        sortOrder: 0,
        supersetGroup: null,
        isSubstituted: false,
        originalExerciseId: null,
        notes: "Own cues",
        sets: [
          {
            id: "existing-set",
            sessionExerciseId: "existing-exercise",
            setNumber: 1,
            weightKg: 60,
            reps: 8,
            rpe: 7,
            durationSeconds: null,
            distanceMeters: null,
            isCompleted: true,
            completedAt: "2026-10-05T10:05:00.000Z",
          },
        ],
      },
    ],
  };
}
describe("explicit pre-promotion plan adoption", () => {
  it("appends independent empty rows while preserving every prelogged set and personal metadata", () => {
    const before = draft();
    const next = adoptSharedPlan(before, plan, "append", {
      randomUUID,
      exerciseName: () => "Squat",
    });
    expect(next.exercises[0]).toEqual(before.exercises[0]);
    expect(next.name).toBe("My workout");
    expect(next.notes).toBe(before.notes);
    expect(next.workoutId).toBe(before.workoutId);
    expect(next.exercises[1]).toMatchObject({
      exerciseId: id(2),
      exerciseName: "Squat",
      sortOrder: 1,
      notes: null,
    });
    expect(next.exercises[1].sets).toHaveLength(2);
    expect(
      next.exercises[1].sets.every(
        (s) => s.reps === null && s.weightKg === null && !s.isCompleted,
      ),
    ).toBe(true);
    next.exercises[0].sets[0].reps = 99;
    expect(before.exercises[0].sets[0].reps).toBe(8);
    expect(before.exercises).toHaveLength(1);
  });
  it("only replaces a truly empty set layout and never relabels existing work", () => {
    expect(() =>
      adoptSharedPlan(draft(), plan, "replace-empty", { randomUUID }),
    ).toThrow("would-discard");
    const empty = draft();
    empty.exercises[0].sets = [];
    const next = adoptSharedPlan(empty, plan, "replace-empty", { randomUUID });
    expect(next.exercises).toHaveLength(1);
    expect(next.exercises[0].exerciseName).toBe(id(2));
    expect(next.name).toBe(empty.name);
    expect(next.exercises[0].id).not.toBe(empty.exercises[0].id);
  });
  it("copies template order but not shared canonical IDs or peer set values", () => {
    const empty = draft();
    empty.exercises = [];
    const p = {
      ...plan,
      exercises: [
        { ...plan.exercises[0], order: 1 },
        {
          ...plan.exercises[0],
          planExerciseId: id(6),
          exerciseId: id(7),
          order: 0,
        },
      ],
    };
    const next = adoptSharedPlan(empty, p, "append", {
      randomUUID,
      exerciseName: () => " ",
    });
    expect(next.exercises.map((e) => e.exerciseId)).toEqual([id(7), id(2)]);
    expect(
      next.exercises.every((e) => e.id.startsWith("local-") && e.id !== id(1)),
    ).toBe(true);
  });
  it.each([
    { together: { sessionId: id(1), executionId: id(2) } },
    { status: "completed" },
    { withClient: { id: id(8), name: "Client", initials: "C" } },
    { retrospectiveCompletedAt: "2026-10-05T10:00:00Z" },
    { retrospectiveDurationSeconds: 60 },
  ])(
    "rejects adoption after authority is fixed or outside own current training %p",
    (change) => {
      expect(() =>
        adoptSharedPlan(
          { ...draft(), ...change } as WorkoutSession,
          plan,
          "append",
          { randomUUID },
        ),
      ).toThrow("unavailable");
    },
  );
  it.each([
    null,
    { ...plan, name: "" },
    { ...plan, name: "x".repeat(121) },
    { ...plan, exercises: [] },
    { ...plan, exercises: Array(101).fill(plan.exercises[0]) },
    { ...plan, exercises: [plan.exercises[0], plan.exercises[0]] },
    { ...plan, exercises: [{ ...plan.exercises[0], order: 100 }] },
    { ...plan, exercises: [{ ...plan.exercises[0], targetSets: 0 }] },
  ])("rejects malformed and excessive templates %p", (p) => {
    expect(() =>
      adoptSharedPlan(draft(), p as TogetherSharedPlan, "append", {
        randomUUID,
      }),
    ).toThrow("invalid-shared-plan");
  });
  it("bounds combined layout and rejects duplicate generated IDs without mutating the draft", () => {
    const full = draft();
    full.exercises = Array.from({ length: 100 }, (_, i) => ({
      ...full.exercises[0],
      id: `e${i}`,
      sortOrder: i,
    }));
    expect(() => adoptSharedPlan(full, plan, "append", { randomUUID })).toThrow(
      "exercise-limit",
    );
    const high = draft();
    high.exercises[0].sortOrder = 99;
    expect(() => adoptSharedPlan(high, plan, "append", { randomUUID })).toThrow(
      "exercise-limit",
    );
    expect(() =>
      adoptSharedPlan(draft(), plan, "append", { randomUUID: () => id(9) }),
    ).toThrow("local-identity");
    expect(() =>
      adoptSharedPlan(draft(), plan, "append", { randomUUID: () => "bad" }),
    ).toThrow("local-identity");
    expect(() =>
      adoptSharedPlan(draft(), plan, "other" as "append", { randomUUID }),
    ).toThrow("unavailable");
  });
});
