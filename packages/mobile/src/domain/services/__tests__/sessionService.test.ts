/**
 * Pure-function tests for `sessionService` (M3).
 *
 * Uses a deterministic `idFactory` (M2 learning #7) so id generation
 * is asserted against a counter sequence, not random UUIDs.
 *
 * Spec: specs/05-active-session/requirements.md STORY-001..009
 *       specs/milestones/M3-active-session/EXECUTION_PLAN.md § 2 Commit 1
 */

import {
  addExerciseToSession,
  addSetToExercise,
  calculateSummary,
  calculateVolume,
  completeSet,
  createEmptySession,
  createSessionFromWorkout,
  detectPersonalRecords,
  substituteExercise,
} from "../sessionService";
import type { Exercise } from "@/domain/models/exercise";
import type { PersonalRecord } from "@/domain/models/record";
import type { ExerciseSet, WorkoutSession } from "@/domain/models/session";
import type { Workout } from "@/domain/models/workout";

const ctx = (overrides: Partial<{ userId: string; now: string }> = {}) => ({
  userId: overrides.userId ?? "user-1",
  now: overrides.now ?? "2026-05-05T10:00:00.000Z",
});

const idFactory = (start = 1) => {
  let n = start;
  return () => `id${n++}`;
};

const makeExercise = (overrides: Partial<Exercise> = {}): Exercise => ({
  id: overrides.id ?? "ex-x",
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

const makeWorkout = (overrides: Partial<Workout> = {}): Workout => ({
  id: "wk-1",
  name: "Push Day",
  description: null,
  createdBy: "user-1",
  visibility: "private",
  estimatedDurationMinutes: 45,
  createdAt: "2026-05-04T10:00:00.000Z",
  updatedAt: "2026-05-04T10:00:00.000Z",
  exercises: [
    {
      id: "we-1",
      exerciseId: "ex-bench",
      sortOrder: 0,
      supersetGroup: null,
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetDurationSeconds: null,
      restSeconds: 90,
      notes: null,
      exercise: {
        id: "ex-bench",
        name: "Bench Press",
        category: "strength",
        difficultyLevel: "intermediate",
        videoUrl: null,
        thumbnailUrl: null,
      },
    },
    {
      id: "we-2",
      exerciseId: "ex-row",
      sortOrder: 1,
      supersetGroup: 1,
      targetSets: 2,
      targetRepsMin: 10,
      targetRepsMax: 12,
      targetDurationSeconds: null,
      restSeconds: 60,
      notes: "wide grip",
      exercise: null,
    },
  ],
  ...overrides,
});

describe("createSessionFromWorkout", () => {
  it("seeds local-prefixed ids, in_progress status, and pre-seeded sets", () => {
    const session = createSessionFromWorkout(makeWorkout(), ctx(), idFactory());
    expect(session.id).toBe("local-id1");
    expect(session.userId).toBe("user-1");
    expect(session.workoutId).toBe("wk-1");
    expect(session.name).toBe("Push Day");
    expect(session.status).toBe("in_progress");
    expect(session.startedAt).toBe("2026-05-05T10:00:00.000Z");
    expect(session.completedAt).toBeNull();
    expect(session.notes).toBeNull();
    expect(session.exercises).toHaveLength(2);

    const [ex1, ex2] = session.exercises;
    expect(ex1.id).toBe("local-id2");
    expect(ex1.sets).toHaveLength(3);
    expect(ex1.sets[0].setNumber).toBe(1);
    expect(ex1.sets[0].isCompleted).toBe(false);
    expect(ex1.sets[0].weightKg).toBeNull();
    expect(ex1.sortOrder).toBe(0);
    expect(ex1.exerciseName).toBe("Bench Press");

    // Second exercise: exercise field is null, falls back to id; preserves notes.
    expect(ex2.exerciseName).toBe("ex-row");
    expect(ex2.sets).toHaveLength(2);
    expect(ex2.supersetGroup).toBe(1);
    expect(ex2.notes).toBe("wide grip");
  });

  it("re-orders exercises by sortOrder before seeding", () => {
    const w = makeWorkout();
    const reversed = {
      ...w,
      exercises: [w.exercises[1], w.exercises[0]],
    };
    const session = createSessionFromWorkout(reversed, ctx(), idFactory());
    expect(session.exercises[0].exerciseId).toBe("ex-bench");
    expect(session.exercises[1].exerciseId).toBe("ex-row");
  });

  it("treats null targetSets as 0 (no pre-seeded rows)", () => {
    const w = makeWorkout({
      exercises: [{ ...makeWorkout().exercises[0], targetSets: null }],
    });
    const session = createSessionFromWorkout(w, ctx(), idFactory());
    expect(session.exercises[0].sets).toHaveLength(0);
  });
});

describe("createEmptySession", () => {
  it("creates an in_progress session with no exercises and Quick Workout name", () => {
    const session = createEmptySession(ctx(), idFactory());
    expect(session.id).toBe("local-id1");
    expect(session.workoutId).toBeNull();
    expect(session.name).toBe("Quick Workout");
    expect(session.status).toBe("in_progress");
    expect(session.exercises).toEqual([]);
  });
});

describe("addSetToExercise", () => {
  const baseSession = (): WorkoutSession =>
    createSessionFromWorkout(makeWorkout(), ctx(), idFactory());

  it("appends a set with the next setNumber and applies partial overrides", () => {
    const session = baseSession();
    const targetExId = session.exercises[0].id;
    const updated = addSetToExercise(
      session,
      targetExId,
      { weightKg: 80, reps: 8 },
      idFactory(100),
    );
    const ex = updated.exercises[0];
    expect(ex.sets).toHaveLength(4);
    expect(ex.sets[3].setNumber).toBe(4);
    expect(ex.sets[3].weightKg).toBe(80);
    expect(ex.sets[3].reps).toBe(8);
    expect(ex.sets[3].isCompleted).toBe(false);
    expect(ex.sets[3].id).toBe("local-id100");
  });

  it("is a no-op when exerciseId doesn't match (returns identical-shape session)", () => {
    const session = baseSession();
    const updated = addSetToExercise(session, "nope", {}, idFactory());
    expect(updated.exercises[0].sets).toHaveLength(3);
  });

  it("does not mutate the original session", () => {
    const session = baseSession();
    const targetExId = session.exercises[0].id;
    const before = session.exercises[0].sets.length;
    addSetToExercise(session, targetExId, {}, idFactory());
    expect(session.exercises[0].sets.length).toBe(before);
  });
});

describe("completeSet", () => {
  const sessionWithSet = (): {
    session: WorkoutSession;
    setId: string;
  } => {
    const s = createSessionFromWorkout(makeWorkout(), ctx(), idFactory());
    return { session: s, setId: s.exercises[0].sets[0].id };
  };

  it("flips isCompleted + stamps completedAt", () => {
    const { session, setId } = sessionWithSet();
    const ts = "2026-05-05T10:05:00.000Z";
    const updated = completeSet(session, setId, ts);
    const set = updated.exercises[0].sets[0];
    expect(set.isCompleted).toBe(true);
    expect(set.completedAt).toBe(ts);
  });

  it("is idempotent — already-completed sets pass through unchanged", () => {
    const { session, setId } = sessionWithSet();
    const first = completeSet(session, setId, "2026-05-05T10:05:00.000Z");
    const second = completeSet(first, setId, "2026-05-05T10:99:99.000Z");
    expect(second.exercises[0].sets[0].completedAt).toBe(
      "2026-05-05T10:05:00.000Z",
    );
  });

  it("ignores unknown setIds", () => {
    const { session } = sessionWithSet();
    const updated = completeSet(session, "missing", "ts");
    expect(updated.exercises[0].sets[0].isCompleted).toBe(false);
  });
});

describe("substituteExercise", () => {
  it("marks the old row substituted, inserts a new row at oldSortOrder+1, shifts downstream", () => {
    const session = createSessionFromWorkout(makeWorkout(), ctx(), idFactory());
    const oldId = session.exercises[0].id;
    const oldExerciseId = session.exercises[0].exerciseId;
    const updated = substituteExercise(
      session,
      oldId,
      makeExercise({ id: "ex-incline", name: "Incline Press" }),
      idFactory(900),
    );
    expect(updated.exercises).toHaveLength(3);
    expect(updated.exercises[0].id).toBe(oldId);
    expect(updated.exercises[0].isSubstituted).toBe(true);
    expect(updated.exercises[0].sets).toHaveLength(3); // sets preserved
    expect(updated.exercises[0].sortOrder).toBe(0);

    expect(updated.exercises[1].id).toBe("local-id900");
    expect(updated.exercises[1].exerciseName).toBe("Incline Press");
    expect(updated.exercises[1].originalExerciseId).toBe(oldExerciseId);
    expect(updated.exercises[1].sortOrder).toBe(1);
    expect(updated.exercises[1].isSubstituted).toBe(false);
    expect(updated.exercises[1].sets).toEqual([]);

    // Downstream row shifted from 1 → 2.
    expect(updated.exercises[2].sortOrder).toBe(2);
  });

  it("returns the session unchanged when the target id is not found", () => {
    const session = createSessionFromWorkout(makeWorkout(), ctx(), idFactory());
    const updated = substituteExercise(
      session,
      "missing",
      makeExercise(),
      idFactory(),
    );
    expect(updated).toBe(session);
  });

  it("preserves the supersetGroup of the substituted row", () => {
    const session = createSessionFromWorkout(makeWorkout(), ctx(), idFactory());
    // Second exercise has supersetGroup=1.
    const targetId = session.exercises[1].id;
    const updated = substituteExercise(
      session,
      targetId,
      makeExercise({ id: "ex-cable" }),
      idFactory(900),
    );
    const newRow = updated.exercises.find((e) => e.id === "local-id900");
    expect(newRow?.supersetGroup).toBe(1);
  });
});

describe("addExerciseToSession", () => {
  it("appends at max(sortOrder)+1", () => {
    const session = createSessionFromWorkout(makeWorkout(), ctx(), idFactory());
    const updated = addExerciseToSession(
      session,
      makeExercise({ id: "ex-pull" }),
      idFactory(900),
    );
    expect(updated.exercises).toHaveLength(3);
    expect(updated.exercises[2].sortOrder).toBe(2);
    expect(updated.exercises[2].exerciseId).toBe("ex-pull");
    expect(updated.exercises[2].id).toBe("local-id900");
  });

  it("starts at sortOrder 0 on an empty session", () => {
    const empty = createEmptySession(ctx(), idFactory());
    const updated = addExerciseToSession(empty, makeExercise(), idFactory(900));
    expect(updated.exercises[0].sortOrder).toBe(0);
  });
});

describe("calculateVolume", () => {
  const set = (overrides: Partial<ExerciseSet> = {}): ExerciseSet => ({
    id: "s",
    sessionExerciseId: "se",
    setNumber: 1,
    weightKg: 100,
    reps: 5,
    rpe: null,
    durationSeconds: null,
    distanceMeters: null,
    isCompleted: true,
    completedAt: "ts",
    ...overrides,
  });

  it("sums weight × reps across completed sets", () => {
    expect(
      calculateVolume([
        set({ weightKg: 100, reps: 5 }),
        set({ weightKg: 80, reps: 8 }),
      ]),
    ).toBe(100 * 5 + 80 * 8);
  });

  it("ignores incomplete sets", () => {
    expect(
      calculateVolume([
        set({ weightKg: 100, reps: 5, isCompleted: false }),
        set({ weightKg: 80, reps: 8, isCompleted: true }),
      ]),
    ).toBe(80 * 8);
  });

  it("skips bodyweight / cardio rows where weight or reps are null", () => {
    expect(
      calculateVolume([
        set({ weightKg: null, reps: 8 }),
        set({ weightKg: 80, reps: null }),
        set({ weightKg: 80, reps: 8 }),
      ]),
    ).toBe(80 * 8);
  });

  it("handles empty arrays", () => {
    expect(calculateVolume([])).toBe(0);
  });
});

describe("calculateSummary", () => {
  const built = (): WorkoutSession => {
    const s = createSessionFromWorkout(makeWorkout(), ctx(), idFactory());
    // Complete first 2 sets of exercise 1, leave 1 incomplete; complete
    // both sets of exercise 2.
    let next = s;
    for (const idx of [0, 1]) {
      const set = next.exercises[0].sets[idx];
      next = completeSet(next, set.id, "2026-05-05T10:10:00.000Z");
    }
    next = next.exercises[0].sets.slice(0, 2).reduce((acc, st) => {
      const swapped = acc.exercises.map((ex, i) =>
        i === 0
          ? {
              ...ex,
              sets: ex.sets.map((s2) =>
                s2.id === st.id ? { ...s2, weightKg: 80, reps: 8 } : s2,
              ),
            }
          : ex,
      );
      return { ...acc, exercises: swapped };
    }, next);
    for (const set of next.exercises[1].sets) {
      next = completeSet(next, set.id, "2026-05-05T10:20:00.000Z");
    }
    return next;
  };

  it("computes duration / completion / volume", () => {
    const session = built();
    const summary = calculateSummary(session, "2026-05-05T10:30:00.000Z");
    // 30 minutes = 1800s.
    expect(summary.duration).toBe(1800);
    expect(summary.totalExercises).toBe(2);
    expect(summary.exercisesCompleted).toBe(2);
    expect(summary.totalSets).toBe(5); // 3 + 2 pre-seeded
    expect(summary.setsCompleted).toBe(4); // 2 + 2 completed
    expect(summary.totalVolume).toBe(80 * 8 * 2); // only the two re-weighted sets contribute
    expect(summary.personalRecords).toEqual([]);
  });

  it("excludes substituted rows from totals", () => {
    const session = createSessionFromWorkout(makeWorkout(), ctx(), idFactory());
    const targetId = session.exercises[0].id;
    const swapped = substituteExercise(
      session,
      targetId,
      makeExercise({ id: "ex-incline" }),
      idFactory(900),
    );
    const summary = calculateSummary(swapped, "2026-05-05T10:30:00.000Z");
    // 3 exercises in the array, 1 substituted → totalExercises=2.
    expect(summary.totalExercises).toBe(2);
  });

  it("falls back to 0 duration when timestamps are unparsable", () => {
    const broken: WorkoutSession = {
      ...createEmptySession(ctx(), idFactory()),
      startedAt: "not-an-iso",
    };
    const summary = calculateSummary(broken, "also-not-iso");
    expect(summary.duration).toBe(0);
  });

  it("clamps negative duration to 0 (clock drift)", () => {
    const session = createSessionFromWorkout(
      makeWorkout(),
      ctx({ now: "2026-05-05T10:30:00.000Z" }),
      idFactory(),
    );
    const summary = calculateSummary(session, "2026-05-05T10:00:00.000Z");
    expect(summary.duration).toBe(0);
  });

  it("uses now() when no `now` is passed (live preview)", () => {
    const session = createSessionFromWorkout(makeWorkout(), ctx(), idFactory());
    const summary = calculateSummary(session);
    expect(summary.duration).toBeGreaterThanOrEqual(0);
  });
});

describe("detectPersonalRecords", () => {
  const sessionWithBench = (weightKg: number, reps: number): WorkoutSession => {
    const s = createSessionFromWorkout(makeWorkout(), ctx(), idFactory());
    const target = s.exercises[0];
    const setId = target.sets[0].id;
    const stamped = {
      ...s,
      exercises: s.exercises.map((ex, i) =>
        i === 0
          ? {
              ...ex,
              sets: ex.sets.map((set) =>
                set.id === setId
                  ? {
                      ...set,
                      weightKg,
                      reps,
                      isCompleted: true,
                      completedAt: "ts",
                    }
                  : set,
              ),
            }
          : ex,
      ),
    };
    return stamped;
  };

  it("emits a 1rm record when the session beats the previous best", () => {
    const session = sessionWithBench(120, 5);
    const previous: PersonalRecord[] = [
      {
        id: "pr-1",
        userId: "user-1",
        exerciseId: "ex-bench",
        exerciseName: "Bench Press",
        recordType: "1rm",
        value: 100,
        achievedAt: "2026-04-01T00:00:00.000Z",
        sessionId: "old",
        setId: null,
      },
    ];
    const records = detectPersonalRecords(
      session,
      previous,
      ctx(),
      idFactory(900),
    );
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe("local-id900");
    expect(records[0].exerciseId).toBe("ex-bench");
    expect(records[0].recordType).toBe("1rm");
    expect(records[0].setId).not.toBeNull();
    expect(records[0].value).toBeCloseTo(120 * (1 + 5 / 30));
  });

  it("emits no record when the session does not beat the previous best", () => {
    const session = sessionWithBench(80, 5);
    const previous: PersonalRecord[] = [
      {
        id: "pr-1",
        userId: "user-1",
        exerciseId: "ex-bench",
        exerciseName: "Bench Press",
        recordType: "1rm",
        value: 200,
        achievedAt: "2026-04-01T00:00:00.000Z",
        sessionId: "old",
        setId: null,
      },
    ];
    const records = detectPersonalRecords(
      session,
      previous,
      ctx(),
      idFactory(900),
    );
    expect(records).toEqual([]);
  });

  it("treats an unseen exercise as a fresh PR (previous best = 0)", () => {
    const session = sessionWithBench(100, 5);
    const records = detectPersonalRecords(session, [], ctx(), idFactory(900));
    expect(records).toHaveLength(1);
    expect(records[0].exerciseId).toBe("ex-bench");
  });

  it("ignores incomplete sets and zero-weight / zero-rep entries", () => {
    const s = createSessionFromWorkout(makeWorkout(), ctx(), idFactory());
    const stamped: WorkoutSession = {
      ...s,
      exercises: s.exercises.map((ex, i) =>
        i === 0
          ? {
              ...ex,
              sets: ex.sets.map((set, idx) => {
                if (idx === 0)
                  return { ...set, weightKg: 200, reps: 5, isCompleted: false };
                if (idx === 1)
                  return {
                    ...set,
                    weightKg: 0,
                    reps: 5,
                    isCompleted: true,
                    completedAt: "t",
                  };
                if (idx === 2)
                  return {
                    ...set,
                    weightKg: 100,
                    reps: 0,
                    isCompleted: true,
                    completedAt: "t",
                  };
                return set;
              }),
            }
          : ex,
      ),
    };
    expect(detectPersonalRecords(stamped, [], ctx(), idFactory(900))).toEqual(
      [],
    );
  });

  it("ignores substituted exercise rows", () => {
    const session = sessionWithBench(120, 5);
    const targetId = session.exercises[0].id;
    const swapped = substituteExercise(
      session,
      targetId,
      makeExercise({ id: "ex-incline" }),
      idFactory(800),
    );
    // Old row was the one with completed sets; swapped flag should
    // exclude it from PR consideration.
    const records = detectPersonalRecords(swapped, [], ctx(), idFactory(900));
    expect(records).toEqual([]);
  });

  it("picks the heaviest 1RM per exercise across multiple completed sets", () => {
    const s = createSessionFromWorkout(makeWorkout(), ctx(), idFactory());
    const stamped: WorkoutSession = {
      ...s,
      exercises: s.exercises.map((ex, i) =>
        i === 0
          ? {
              ...ex,
              sets: ex.sets.map((set, idx) => ({
                ...set,
                weightKg: idx === 1 ? 150 : 100,
                reps: 5,
                isCompleted: true,
                completedAt: "t",
              })),
            }
          : ex,
      ),
    };
    const [pr] = detectPersonalRecords(stamped, [], ctx(), idFactory(900));
    expect(pr.value).toBeCloseTo(150 * (1 + 5 / 30));
  });

  it("uses the highest 1rm across history rows for the same exercise as the comparison floor", () => {
    const session = sessionWithBench(120, 5);
    const previous: PersonalRecord[] = [
      {
        id: "pr-old",
        userId: "user-1",
        exerciseId: "ex-bench",
        exerciseName: "Bench Press",
        recordType: "1rm",
        value: 50,
        achievedAt: "2026-03-01T00:00:00.000Z",
        sessionId: "old-1",
        setId: null,
      },
      {
        id: "pr-new",
        userId: "user-1",
        exerciseId: "ex-bench",
        exerciseName: "Bench Press",
        recordType: "1rm",
        value: 999,
        achievedAt: "2026-04-01T00:00:00.000Z",
        sessionId: "old-2",
        setId: null,
      },
    ];
    expect(
      detectPersonalRecords(session, previous, ctx(), idFactory(900)),
    ).toEqual([]);
  });

  it("ignores non-1rm record types in previous history (M3 only writes 1rm)", () => {
    const session = sessionWithBench(120, 5);
    const previous: PersonalRecord[] = [
      {
        id: "pr-vol",
        userId: "user-1",
        exerciseId: "ex-bench",
        exerciseName: "Bench Press",
        recordType: "max_weight",
        value: 999,
        achievedAt: "2026-04-01T00:00:00.000Z",
        sessionId: "old",
        setId: null,
      },
    ];
    // Previous comparison floor is 0 (no 1rm history), so this counts as new.
    expect(
      detectPersonalRecords(session, previous, ctx(), idFactory(900)),
    ).toHaveLength(1);
  });
});
