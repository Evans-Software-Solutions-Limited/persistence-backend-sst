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
  addSupersetSet,
  calculateSummary,
  calculateVolume,
  completeSet,
  createEmptySession,
  createSessionFromWorkout,
  detectPersonalRecords,
  removeExerciseFromSession,
  removeSupersetSet,
  renumberSets,
  setExerciseNotes,
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

    // Second exercise: exercise field is null, falls back to id.
    // Session notes always start null — `wx.notes` (template / coach
    // guidance) is NOT carried through to the active session per legacy
    // `useActiveWorkout.initializeExercises`. The user adds session
    // notes via the popover.
    expect(ex2.exerciseName).toBe("ex-row");
    expect(ex2.sets).toHaveLength(2);
    expect(ex2.supersetGroup).toBe(1);
    expect(ex2.notes).toBeNull();
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

  it("falls back to exerciseId when wx.exercise is null (FK soft-cascade — library exercise was deleted)", () => {
    // This fallback only fires when the underlying library exercise
    // has been hard-deleted; optimistic workout-create + workout-update
    // commands hydrate `wx.exercise` from the local exercise cache so
    // a freshly-created workout starts a session with the readable
    // name immediately.
    const w = makeWorkout({
      exercises: [
        {
          ...makeWorkout().exercises[0],
          exerciseId: "ex-bench",
          exercise: null,
        },
      ],
    });
    const session = createSessionFromWorkout(w, ctx(), idFactory());
    expect(session.exercises[0].exerciseName).toBe("ex-bench");
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

  it("uses max(setNumber)+1 — no duplicate setNumber after a gap from removal", () => {
    // Mid-session remove → renumber: [1,2,3] → [1,3] simulates a
    // codepath that doesn't renumber. addSetToExercise must STILL
    // emit a unique setNumber (4), not 3 (length+1 would have).
    let session = baseSession();
    const targetExId = session.exercises[0].id;
    // Hand-craft a gap by stripping middle set from the in-memory model.
    session = {
      ...session,
      exercises: session.exercises.map((ex) =>
        ex.id === targetExId
          ? {
              ...ex,
              sets: [
                { ...ex.sets[0], setNumber: 1 },
                { ...ex.sets[2], setNumber: 3 },
              ],
            }
          : ex,
      ),
    };
    const updated = addSetToExercise(session, targetExId, {}, idFactory(900));
    const numbers = updated.exercises[0].sets.map((s) => s.setNumber);
    expect(numbers).toEqual([1, 3, 4]);
    expect(new Set(numbers).size).toBe(3); // no duplicates
  });
});

describe("renumberSets", () => {
  it("renumbers the target exercise's sets to a contiguous 1..n sequence", () => {
    let session = createSessionFromWorkout(makeWorkout(), ctx(), idFactory());
    const targetExId = session.exercises[0].id;
    // Synthesise a gap.
    session = {
      ...session,
      exercises: session.exercises.map((ex) =>
        ex.id === targetExId
          ? {
              ...ex,
              sets: [
                { ...ex.sets[0], setNumber: 1 },
                { ...ex.sets[2], setNumber: 5 },
              ],
            }
          : ex,
      ),
    };
    const updated = renumberSets(session, targetExId);
    expect(updated.exercises[0].sets.map((s) => s.setNumber)).toEqual([1, 2]);
  });

  it("leaves other exercises untouched", () => {
    const session = createSessionFromWorkout(makeWorkout(), ctx(), idFactory());
    const before = session.exercises[1].sets.map((s) => s.setNumber);
    const updated = renumberSets(session, session.exercises[0].id);
    expect(updated.exercises[1].sets.map((s) => s.setNumber)).toEqual(before);
  });

  it("is a no-op when sessionExerciseId is unknown", () => {
    const session = createSessionFromWorkout(makeWorkout(), ctx(), idFactory());
    const before = session.exercises.map((ex) =>
      ex.sets.map((s) => s.setNumber),
    );
    const updated = renumberSets(session, "missing");
    expect(
      updated.exercises.map((ex) => ex.sets.map((s) => s.setNumber)),
    ).toEqual(before);
  });

  it("is idempotent on already-contiguous sets", () => {
    const session = createSessionFromWorkout(makeWorkout(), ctx(), idFactory());
    const once = renumberSets(session, session.exercises[0].id);
    const twice = renumberSets(once, session.exercises[0].id);
    expect(twice.exercises[0].sets.map((s) => s.setNumber)).toEqual(
      once.exercises[0].sets.map((s) => s.setNumber),
    );
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
  it("replaces the row in place — same id, same sortOrder, no new row", () => {
    // Legacy parity (useActiveWorkout.swapExercise lines 964-980): the
    // existing row's id / sortOrder / supersetGroup / notes are
    // preserved; only the exercise pointer + name swap, and sets are
    // cleared to empties. The previous "lingering substituted row +
    // new row at oldSortOrder+1" semantic produced a "the swap doesn't
    // swap, it just adds the other one" bug on device — fixed here.
    const session = createSessionFromWorkout(makeWorkout(), ctx(), idFactory());
    const oldId = session.exercises[0].id;
    const oldExerciseId = session.exercises[0].exerciseId;
    const updated = substituteExercise(
      session,
      oldId,
      makeExercise({ id: "ex-incline", name: "Incline Press" }),
      idFactory(900),
    );

    // No new row inserted; downstream rows untouched.
    expect(updated.exercises).toHaveLength(2);
    expect(updated.exercises[1].sortOrder).toBe(1);

    // Source row mutated in place: same id, same sortOrder, exercise
    // pointer + name swapped, isSubstituted stays false (the row is
    // the active exercise now), originalExerciseId stamped.
    const swapped = updated.exercises[0];
    expect(swapped.id).toBe(oldId);
    expect(swapped.sortOrder).toBe(0);
    expect(swapped.exerciseId).toBe("ex-incline");
    expect(swapped.exerciseName).toBe("Incline Press");
    expect(swapped.isSubstituted).toBe(false);
    expect(swapped.originalExerciseId).toBe(oldExerciseId);
  });

  it("clears sets to empties matching the original count (legacy 'Clear all set data when swapping')", () => {
    const session = createSessionFromWorkout(makeWorkout(), ctx(), idFactory());
    const oldId = session.exercises[0].id;
    const updated = substituteExercise(
      session,
      oldId,
      makeExercise({ id: "ex-incline" }),
      idFactory(900),
    );
    const swapped = updated.exercises[0];
    expect(swapped.sets).toHaveLength(3); // matches the workout template's 3 sets
    for (let i = 0; i < 3; i++) {
      const set = swapped.sets[i];
      expect(set.setNumber).toBe(i + 1);
      expect(set.isCompleted).toBe(false);
      expect(set.weightKg).toBeNull();
      expect(set.reps).toBeNull();
      expect(set.rpe).toBeNull();
      expect(set.sessionExerciseId).toBe(oldId);
    }
  });

  it("preserves the supersetGroup of the swapped row", () => {
    const session = createSessionFromWorkout(makeWorkout(), ctx(), idFactory());
    // Second exercise has supersetGroup=1.
    const targetId = session.exercises[1].id;
    const updated = substituteExercise(
      session,
      targetId,
      makeExercise({ id: "ex-cable" }),
      idFactory(900),
    );
    const swapped = updated.exercises.find((e) => e.id === targetId);
    expect(swapped?.supersetGroup).toBe(1);
    expect(swapped?.exerciseId).toBe("ex-cable");
  });

  it("preserves the FIRST originalExerciseId across a chain of swaps (A→B→C still records A)", () => {
    const session = createSessionFromWorkout(makeWorkout(), ctx(), idFactory());
    const oldId = session.exercises[0].id;
    const aToB = substituteExercise(
      session,
      oldId,
      makeExercise({ id: "ex-incline" }),
      idFactory(900),
    );
    const bToC = substituteExercise(
      aToB,
      oldId,
      makeExercise({ id: "ex-decline" }),
      idFactory(950),
    );
    expect(bToC.exercises[0].exerciseId).toBe("ex-decline");
    expect(bToC.exercises[0].originalExerciseId).toBe("ex-bench");
  });

  it("does NOT block swapping to an exerciseId that only matches a stale substituted row (matches addExerciseToSession's guard)", () => {
    // Bugbot regression: substituteExercise's duplicate guard used to
    // catch substituted rows too, which made the swap silently no-op
    // when the picker UI (which filters substituted rows out of
    // `existingExerciseIds`) showed the target as available. Now both
    // guards skip substituted rows the same way.
    const session = createSessionFromWorkout(makeWorkout(), ctx(), idFactory());
    // Mark row 1 (ex-row) as substituted to simulate pre-2026-05
    // SQLite carryover. Try to swap row 0 → ex-row. Should succeed.
    const withStale: WorkoutSession = {
      ...session,
      exercises: session.exercises.map((ex, i) =>
        i === 1 ? { ...ex, isSubstituted: true } : ex,
      ),
    };
    const oldId = withStale.exercises[0].id;
    const updated = substituteExercise(
      withStale,
      oldId,
      makeExercise({ id: "ex-row" }),
      idFactory(900),
    );
    // Source row mutated in place to ex-row; the stale substituted row
    // sits untouched alongside it.
    expect(updated.exercises[0].exerciseId).toBe("ex-row");
    expect(updated.exercises[0].id).toBe(oldId);
    expect(updated.exercises[1].isSubstituted).toBe(true);
  });

  it("is a no-op when the new exercise is already in the session as a different row (legacy duplicate-guard)", () => {
    // Source row 0 = ex-bench, row 1 = ex-row. Try to swap row 0 → ex-row.
    // Should silently return the unchanged session (legacy lines
    // 949-954). Picker UI also disables this row, but the service
    // defends against cache-reread races.
    const session = createSessionFromWorkout(makeWorkout(), ctx(), idFactory());
    const oldId = session.exercises[0].id;
    const updated = substituteExercise(
      session,
      oldId,
      makeExercise({ id: "ex-row" }),
      idFactory(900),
    );
    expect(updated).toBe(session);
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

  it("is a no-op when the exercise already lives in the session as an active row (legacy duplicate-guard)", () => {
    // Picker UI disables already-in-session exercises (Brad's rule
    // after the in-place swap fix landed: no duplicates anywhere).
    // The service guards the same invariant so cache-reread races
    // and non-UI callers can't silently insert a duplicate row.
    const session = createSessionFromWorkout(makeWorkout(), ctx(), idFactory());
    const updated = addExerciseToSession(
      session,
      makeExercise({ id: "ex-bench" }),
      idFactory(900),
    );
    expect(updated).toBe(session);
    expect(updated.exercises).toHaveLength(2);
  });

  it("allows adding an exercise whose id only matches a substituted (stale) row", () => {
    // Substituted rows are pre-2026-05 carryover from the old swap
    // semantic; they shouldn't block re-adding the original exercise.
    const session = createSessionFromWorkout(makeWorkout(), ctx(), idFactory());
    // Manually mark row 0 as substituted to simulate cached SQLite
    // state from before the in-place rewrite landed.
    const withStale: WorkoutSession = {
      ...session,
      exercises: session.exercises.map((ex, i) =>
        i === 0 ? { ...ex, isSubstituted: true } : ex,
      ),
    };
    const updated = addExerciseToSession(
      withStale,
      makeExercise({ id: "ex-bench" }),
      idFactory(900),
    );
    expect(updated.exercises).toHaveLength(3);
    expect(updated.exercises[2].exerciseId).toBe("ex-bench");
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

  it("excludes substituted rows from totals (legacy stale-row carryover)", () => {
    // Post-in-place-swap, `substituteExercise` no longer produces
    // `isSubstituted: true` rows — the row is mutated in place instead.
    // This invariant defends pre-2026-05 cached SQLite sessions that
    // may still surface a stale substituted row at finalize.
    const session = createSessionFromWorkout(makeWorkout(), ctx(), idFactory());
    const withStale: WorkoutSession = {
      ...session,
      exercises: session.exercises.map((ex, i) =>
        i === 0 ? { ...ex, isSubstituted: true } : ex,
      ),
    };
    const summary = calculateSummary(withStale, "2026-05-05T10:30:00.000Z");
    // 2 exercises in the array, 1 substituted → totalExercises=1.
    expect(summary.totalExercises).toBe(1);
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

  /**
   * Seed priors covering all six computed record types for the bench
   * exercise. Tests that want a "first-occurrence" baseline pass `[]`
   * instead; tests that want to assert beating-a-prior pass the
   * relevant subset.
   */
  const priorsForBench = (overrides: {
    "1rm"?: number;
    "3rm"?: number;
    "5rm"?: number;
    "10rm"?: number;
    max_weight?: number;
    max_volume?: number;
  }): PersonalRecord[] => {
    const out: PersonalRecord[] = [];
    for (const [recordType, value] of Object.entries(overrides)) {
      if (value === undefined) continue;
      out.push({
        id: `pr-${recordType}`,
        userId: "user-1",
        exerciseId: "ex-bench",
        exerciseName: "Bench Press",
        recordType: recordType as PersonalRecord["recordType"],
        value,
        achievedAt: "2026-04-01T00:00:00.000Z",
        sessionId: "old",
        setId: null,
      });
    }
    return out;
  };

  it("emits 5rm + max_weight + max_volume PRs when a 5-rep set beats every prior", () => {
    // 120 kg × 5 reps. Priors: 5rm=100, max_weight=100, max_volume=400.
    // Candidates: 5rm=120, max_weight=120, max_volume=600. All beat.
    const session = sessionWithBench(120, 5);
    const previous = priorsForBench({
      "5rm": 100,
      max_weight: 100,
      max_volume: 400,
    });
    const records = detectPersonalRecords(
      session,
      previous,
      ctx(),
      idFactory(900),
    );
    expect(records).toHaveLength(3);
    const byType = new Map(records.map((r) => [r.recordType, r]));
    expect(byType.get("5rm")?.value).toBe(120);
    expect(byType.get("max_weight")?.value).toBe(120);
    expect(byType.get("max_volume")?.value).toBe(600);
    // Local-prefixed id, exercise + setId carried through.
    expect(byType.get("5rm")?.id).toMatch(/^local-/);
    expect(byType.get("max_weight")?.setId).not.toBeNull();
  });

  it("emits 1rm + max_weight + max_volume for a 1-rep set", () => {
    const session = sessionWithBench(150, 1);
    const previous = priorsForBench({
      "1rm": 140,
      max_weight: 140,
      max_volume: 100,
    });
    const records = detectPersonalRecords(
      session,
      previous,
      ctx(),
      idFactory(900),
    );
    expect(records).toHaveLength(3);
    expect(records.map((r) => r.recordType).sort()).toEqual(
      ["1rm", "max_volume", "max_weight"].sort(),
    );
  });

  it("emits 10rm + max_weight + max_volume for a 10-rep set, but NOT 1rm (Epley parity guard)", () => {
    // 100 kg × 10 reps. Pre-PR-3 code would Epley this to a "1rm" of
    // 133.33 and surface a card titled "1 Rep Max: 133.3 kg" — the
    // exact UX bug PR-3 exists to fix. Post-PR-3 the local predictor
    // emits a 10rm card (value = 100) instead, matching what the
    // server will compute when the bulk-record POST lands.
    const session = sessionWithBench(100, 10);
    const previous = priorsForBench({
      "10rm": 90,
      max_weight: 90,
      max_volume: 900,
    });
    const records = detectPersonalRecords(
      session,
      previous,
      ctx(),
      idFactory(900),
    );
    expect(records).toHaveLength(3);
    const types = records.map((r) => r.recordType);
    expect(types).toContain("10rm");
    expect(types).toContain("max_weight");
    expect(types).toContain("max_volume");
    expect(types).not.toContain("1rm");
  });

  it("emits ONLY max_weight + max_volume for a 7-rep set (no Xrm — exact-rep ladder)", () => {
    // 100 kg × 7 reps. 7 isn't on the legacy 1/3/5/10 ladder. No Xrm
    // candidate emitted — the user lifted 100 kg for 7 reps, calling
    // it any kind of rep-max would be the same bug we just fixed.
    const session = sessionWithBench(100, 7);
    const previous = priorsForBench({
      max_weight: 90,
      max_volume: 600,
    });
    const records = detectPersonalRecords(
      session,
      previous,
      ctx(),
      idFactory(900),
    );
    expect(records).toHaveLength(2);
    const types = records.map((r) => r.recordType);
    expect(types).toContain("max_weight");
    expect(types).toContain("max_volume");
    expect(types).not.toContain("1rm");
    expect(types).not.toContain("3rm");
    expect(types).not.toContain("5rm");
    expect(types).not.toContain("10rm");
  });

  it("emits NO PRs on the first workout for an exercise (no priors → skip-first-occurrence)", () => {
    // Brad's rule: a baseline workout shouldn't surface a card titled
    // "PR!" — there's no "previously" to beat. The server-side
    // `recordPRsForSession` mirrors this; if local emits anything
    // here, the Summary screen flashes a phantom PR card that
    // disappears as soon as the server response lands.
    const session = sessionWithBench(100, 5);
    const records = detectPersonalRecords(session, [], ctx(), idFactory(900));
    expect(records).toEqual([]);
  });

  it("emits no record when no candidate beats any prior", () => {
    // 80 kg × 5 reps vs prior 5rm=200, max_weight=200, max_volume=1000.
    // Every candidate undershoots its floor.
    const session = sessionWithBench(80, 5);
    const previous = priorsForBench({
      "5rm": 200,
      max_weight: 200,
      max_volume: 1000,
    });
    const records = detectPersonalRecords(
      session,
      previous,
      ctx(),
      idFactory(900),
    );
    expect(records).toEqual([]);
  });

  it("per-type partition: only the record types that improve surface, not all-or-nothing", () => {
    // 100 kg × 5 reps. Priors: 5rm=200 (NOT beaten by 100), max_weight=50
    // (beaten by 100), max_volume=900 (NOT beaten by 500). Exactly
    // ONE PR surfaces: max_weight.
    const session = sessionWithBench(100, 5);
    const previous = priorsForBench({
      "5rm": 200,
      max_weight: 50,
      max_volume: 900,
    });
    const records = detectPersonalRecords(
      session,
      previous,
      ctx(),
      idFactory(900),
    );
    expect(records).toHaveLength(1);
    expect(records[0].recordType).toBe("max_weight");
    expect(records[0].value).toBe(100);
  });

  it("normalises value to 2dp precision so the local prediction matches the server's stored value", () => {
    // 99.99 kg × 10 reps. Without `toFixed(2) → parseFloat`,
    // max_volume's raw JS multiplication yields 999.9000000000001
    // and the Summary screen renders "999.9000000000001 kg" for ~500
    // ms before the server response swaps in "999.9 kg". The
    // backend's recordPRsForSession applies the same round-trip;
    // both sides agree to 999.9 byte-for-byte.
    const session = sessionWithBench(99.99, 10);
    const previous = priorsForBench({ max_volume: 900 });
    const records = detectPersonalRecords(
      session,
      previous,
      ctx(),
      idFactory(900),
    );
    expect(records).toHaveLength(1);
    expect(records[0].recordType).toBe("max_volume");
    expect(records[0].value).toBe(999.9);
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

  it("picks the heaviest weight per exercise across multiple completed sets (best per record type)", () => {
    // Two completed sets at 100 kg × 5 and 150 kg × 5. Priors:
    // 5rm=120, max_weight=120, max_volume=600. Best candidates per
    // type: 5rm=150 (from set 2), max_weight=150, max_volume=750.
    // All three beat their priors → 3 PRs surface.
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
    const records = detectPersonalRecords(
      stamped,
      priorsForBench({ "5rm": 120, max_weight: 120, max_volume: 600 }),
      ctx(),
      idFactory(900),
    );
    const byType = new Map(records.map((r) => [r.recordType, r]));
    expect(byType.get("5rm")?.value).toBe(150);
    expect(byType.get("max_weight")?.value).toBe(150);
    expect(byType.get("max_volume")?.value).toBe(750);
  });

  it("uses the highest prior per (exercise, recordType) as the comparison floor when history has multiple rows", () => {
    // Two cached 5rm rows for the same exercise: 50 and 999. The
    // predictor must pick 999 as the floor — otherwise a 60 kg set
    // would falsely surface as a 5rm PR. With the new ladder applies
    // per-type, so we seed 5rm history specifically.
    const session = sessionWithBench(60, 5);
    const previous: PersonalRecord[] = [
      {
        id: "pr-old",
        userId: "user-1",
        exerciseId: "ex-bench",
        exerciseName: "Bench Press",
        recordType: "5rm",
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
        recordType: "5rm",
        value: 999,
        achievedAt: "2026-04-01T00:00:00.000Z",
        sessionId: "old-2",
        setId: null,
      },
    ];
    const records = detectPersonalRecords(
      session,
      previous,
      ctx(),
      idFactory(900),
    );
    // No 5rm PR (60 < 999). No max_weight / max_volume PR either
    // (skip-first-occurrence — no priors for those types).
    expect(records).toEqual([]);
  });

  it("keeps the higher prior when iteration encounters a lower one second", () => {
    // Order-independence guard: pre-PR-3 the predictor's
    // `current != null && rec.value > current` branch could be
    // tricked by record order; assert the same comparison works on
    // both forward and reverse orderings.
    const session = sessionWithBench(120, 5);
    const previous: PersonalRecord[] = [
      {
        id: "pr-high",
        userId: "user-1",
        exerciseId: "ex-bench",
        exerciseName: "Bench Press",
        recordType: "5rm",
        value: 200,
        achievedAt: "2026-04-01T00:00:00.000Z",
        sessionId: "old-1",
        setId: null,
      },
      {
        id: "pr-low",
        userId: "user-1",
        exerciseId: "ex-bench",
        exerciseName: "Bench Press",
        recordType: "5rm",
        value: 50,
        achievedAt: "2026-03-01T00:00:00.000Z",
        sessionId: "old-2",
        setId: null,
      },
    ];
    // 200 stays as the 5rm floor; 120 < 200 → no 5rm PR. No
    // max_weight / max_volume priors → first-occurrence skip.
    expect(
      detectPersonalRecords(session, previous, ctx(), idFactory(900)),
    ).toEqual([]);
  });

  it("ignores non-computed record types in prior history (e.g. `max_reps`, `best_time`)", () => {
    // The six computed types are 1rm/3rm/5rm/10rm/max_weight/
    // max_volume. Other valid `RecordType` values (max_reps, best_time,
    // longest_distance) should be ignored entirely on the prior side
    // — they don't share a key with any candidate, so they neither
    // satisfy nor block the first-occurrence skip. A 5-rep set vs a
    // `max_reps` prior should behave exactly as if priors were empty.
    const session = sessionWithBench(120, 5);
    const previous: PersonalRecord[] = [
      {
        id: "pr-reps",
        userId: "user-1",
        exerciseId: "ex-bench",
        exerciseName: "Bench Press",
        recordType: "max_reps",
        value: 999,
        achievedAt: "2026-04-01T00:00:00.000Z",
        sessionId: "old",
        setId: null,
      },
    ];
    // No relevant priors → first-occurrence skip for every candidate
    // type → no PRs surface. Same outcome as `previousRecords=[]`.
    expect(
      detectPersonalRecords(session, previous, ctx(), idFactory(900)),
    ).toEqual([]);
  });
});

describe("removeExerciseFromSession", () => {
  const seedSession = (
    exercises: WorkoutSession["exercises"],
  ): WorkoutSession =>
    addExerciseToSession.bind(null) as unknown as WorkoutSession & never;
  const mkSession = (
    exercises: WorkoutSession["exercises"],
  ): WorkoutSession => ({
    ...createEmptySession(ctx(), idFactory()),
    exercises,
  });
  const mkExercise = (
    id: string,
    supersetGroup: number | null = null,
  ): WorkoutSession["exercises"][number] => ({
    id,
    sessionId: "local-1",
    exerciseId: id,
    exerciseName: id,
    sortOrder: 0,
    supersetGroup,
    isSubstituted: false,
    originalExerciseId: null,
    notes: null,
    sets: [],
  });

  void seedSession;

  it("returns the same session when the id doesn't match", () => {
    const session = mkSession([mkExercise("se-1")]);
    expect(removeExerciseFromSession(session, "missing")).toBe(session);
  });

  it("drops the targeted exercise", () => {
    const session = mkSession([mkExercise("se-1"), mkExercise("se-2")]);
    const updated = removeExerciseFromSession(session, "se-1");
    expect(updated.exercises.map((e) => e.id)).toEqual(["se-2"]);
  });

  it("ungroups the survivor when only one peer remains in the superset", () => {
    const session = mkSession([mkExercise("se-1", 1), mkExercise("se-2", 1)]);
    const updated = removeExerciseFromSession(session, "se-1");
    expect(updated.exercises[0].supersetGroup).toBeNull();
  });

  it("keeps the supersetGroup intact when 2+ peers remain", () => {
    const session = mkSession([
      mkExercise("se-1", 1),
      mkExercise("se-2", 1),
      mkExercise("se-3", 1),
    ]);
    const updated = removeExerciseFromSession(session, "se-1");
    expect(updated.exercises.map((e) => e.supersetGroup)).toEqual([1, 1]);
  });
});

describe("setExerciseNotes", () => {
  it("sets notes on the matching exercise", () => {
    const session: WorkoutSession = {
      ...createEmptySession(ctx(), idFactory()),
      exercises: [
        {
          id: "se-1",
          sessionId: "local-1",
          exerciseId: "ex",
          exerciseName: "ex",
          sortOrder: 0,
          supersetGroup: null,
          isSubstituted: false,
          originalExerciseId: null,
          notes: null,
          sets: [],
        },
      ],
    };
    const updated = setExerciseNotes(session, "se-1", "go heavy");
    expect(updated.exercises[0].notes).toBe("go heavy");
  });

  it("is a no-op when the id doesn't match", () => {
    const session: WorkoutSession = {
      ...createEmptySession(ctx(), idFactory()),
      exercises: [],
    };
    const updated = setExerciseNotes(session, "missing", "go heavy");
    expect(updated.exercises).toEqual([]);
  });
});

describe("addSupersetSet", () => {
  const mkSession = (
    exercises: WorkoutSession["exercises"],
  ): WorkoutSession => ({
    ...createEmptySession(ctx(), idFactory()),
    exercises,
  });

  it("returns the same session when sessionExerciseIds is empty", () => {
    const session = mkSession([]);
    expect(addSupersetSet(session, [], idFactory(900))).toBe(session);
  });

  it("returns the same session when no exercises match", () => {
    const session = mkSession([
      {
        id: "se-1",
        sessionId: "local-1",
        exerciseId: "ex-1",
        exerciseName: "ex-1",
        sortOrder: 0,
        supersetGroup: 1,
        isSubstituted: false,
        originalExerciseId: null,
        notes: null,
        sets: [],
      },
    ]);
    expect(addSupersetSet(session, ["nope"], idFactory(900))).toBe(session);
  });
});

describe("removeSupersetSet", () => {
  const mkSession = (
    exercises: WorkoutSession["exercises"],
  ): WorkoutSession => ({
    ...createEmptySession(ctx(), idFactory()),
    exercises,
  });

  it("returns the same session when sessionExerciseIds is empty", () => {
    const session = mkSession([]);
    expect(removeSupersetSet(session, [], 1)).toBe(session);
  });
});
