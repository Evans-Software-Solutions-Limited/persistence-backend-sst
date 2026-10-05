/** @jest-environment node */
import { randomUUID } from "node:crypto";
import { draft } from "./cloudDraft.fixture";
import {
  promoteCloudDraft,
  cloudProjection,
  cloudOperations,
  mergeCloudExecution,
} from "../cloudDraft";
import type { WorkoutSession } from "../../../domain/models/session";
describe("lossless supported cloud draft projection", () => {
  it.each<(s: WorkoutSession) => void>([
    (s) => {
      s.status = "completed";
    },
    (s) => {
      s.withClient = { id: "client", name: "Client", initials: "C" };
    },
    (s) => {
      s.retrospectiveCompletedAt = "date";
    },
    (s) => {
      s.retrospectiveDurationSeconds = 1;
    },
    (s) => {
      s.startedAt = "bad";
    },
    (s) => {
      s.name = "";
    },
    (s) => {
      s.name = "x".repeat(121);
    },
    (s) => {
      s.exercises = [];
    },
    (s) => {
      s.exercises = Array(101).fill(s.exercises[0]);
    },
    (s) => {
      s.restEndsAt = "bad";
    },
    (s) => {
      s.exercises[0].exerciseId = "local-unknown";
    },
    (s) => {
      s.exercises[0].id = "";
    },
    (s) => {
      s.exercises.push(s.exercises[0]);
    },
    (s) => {
      s.exercises[0].sessionId = "wrong";
    },
    (s) => {
      s.exercises[0].supersetGroup = 1;
    },
    (s) => {
      s.exercises[0].isSubstituted = true;
    },
    (s) => {
      s.exercises[0].category = "cardio";
    },
    (s) => {
      s.exercises[0].sets = Array(101).fill(s.exercises[0].sets[0]);
    },
    (s) => {
      s.exercises[0].sortOrder = -1;
    },
    (s) => {
      s.exercises[0].sortOrder = 100;
    },
    (s) => {
      s.exercises[0].sortOrder = 1.5;
    },
    (s) => {
      s.exercises[0].sets[0].id = "";
    },
    (s) => {
      s.exercises[0].sets.push(s.exercises[0].sets[0]);
    },
    (s) => {
      s.exercises[0].sets[0].sessionExerciseId = "wrong";
    },
    (s) => {
      s.exercises[0].sets[0].rpe = 8;
    },
    (s) => {
      s.exercises[0].sets[0].durationSeconds = 5;
    },
    (s) => {
      s.exercises[0].sets[0].distanceMeters = 10;
    },
    (s) => {
      s.exercises[0].sets[0].reps = -1;
    },
    (s) => {
      s.exercises[0].sets[0].reps = 10001;
    },
    (s) => {
      s.exercises[0].sets[0].reps = 1.5;
    },
    (s) => {
      s.exercises[0].sets[0].weightKg = NaN;
    },
    (s) => {
      s.exercises[0].sets[0].weightKg = -1;
    },
    (s) => {
      s.exercises[0].sets[0].weightKg = 10000;
    },
  ])(
    "refuses unsupported personal input without changing the original snapshot (%#)",
    (change) => {
      const s = draft();
      change(s);
      const before = structuredClone(s);
      expect(() => promoteCloudDraft(s, randomUUID)).toThrow(
        "cloud-workout-unsupported",
      );
      expect(s).toEqual(before);
    },
  );
  it("supports skip/rest/substitution operations and canonical removals while preserving partial rows", () => {
    const s = draft();
    const { draft: d, mapping } = promoteCloudDraft(s, randomUUID);
    const next = structuredClone(d.ownExecution);
    next.exercises[0].skipped = true;
    next.exercises[0].substituteExerciseId = randomUUID();
    next.restEndsAt = "2026-10-05T10:00:00.000Z";
    next.exercises[0].sets = [];
    expect(cloudOperations(d.ownExecution, next).map((o) => o.type)).toEqual([
      "substitute",
      "skip",
      "removeSet",
      "rest",
    ]);
    const catalog = {
      [d.plan.exercises[0].exerciseId]: {
        name: "Original",
        category: "strength",
        primaryMuscles: [],
      },
      [next.exercises[0].substituteExerciseId!]: {
        name: "Substitute",
        category: "strength",
        primaryMuscles: [],
      },
    };
    mergeCloudExecution(s, next, mapping, randomUUID, d.plan, catalog);
    expect(s.exercises[0].exerciseName).toBe("Substitute");
    expect(s.exercises[0].isSubstituted).toBe(true);
    expect(s.exercises[0].sets[0].reps).toBeNull();
    expect(s.notes).toBe("Keep notes");
    expect(
      cloudProjection(s, d.plan, mapping, randomUUID).exercises[0]
        .substituteExerciseId,
    ).toBe(next.exercises[0].substituteExerciseId);
    next.exercises[0].substituteExerciseId = null;
    mergeCloudExecution(s, next, mapping, randomUUID, d.plan, catalog);
    expect(s.exercises[0].exerciseName).toBe("Original");
    expect(s.exercises[0].exerciseId).toBe(d.plan.exercises[0].exerciseId);
    expect(s.exercises[0].isSubstituted).toBe(false);
    expect(s.exercises[0].originalExerciseId).toBeNull();
    expect(
      cloudOperations(next, cloudProjection(s, d.plan, mapping, randomUUID)),
    ).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "substitute" })]),
    );
    expect(() => cloudOperations(next, { exercises: [] })).toThrow(
      "cloud-plan-mismatch",
    );
  });
  it("rejects plan remapping, duplicate slots and second promotion while preserving empty/partial sets", () => {
    const s = draft();
    const { draft: d, mapping } = promoteCloudDraft(s, randomUUID);
    s.together = { sessionId: randomUUID(), executionId: randomUUID() };
    expect(() => promoteCloudDraft(s, randomUUID)).toThrow(
      "cloud-authority-conflict",
    );
    delete s.together;
    const wrong = structuredClone(d.plan);
    wrong.exercises[0].planExerciseId = randomUUID();
    expect(() => cloudProjection(s, wrong, mapping, randomUUID)).toThrow(
      "cloud-plan-mismatch",
    );
    expect(() =>
      cloudProjection(
        s,
        { name: "wrong", exercises: [] },
        { exercises: {}, sets: {} },
        randomUUID,
      ),
    ).toThrow("cloud-plan-mismatch");
    s.exercises[0].sets[0].weightKg = null;
    expect(
      cloudProjection(s, d.plan, mapping, randomUUID).exercises[0].sets,
    ).toEqual([]);
    s.exercises[0].sets = [];
    expect(
      promoteCloudDraft(s, randomUUID).draft.plan.exercises[0].targetSets,
    ).toBe(1);
  });
});
