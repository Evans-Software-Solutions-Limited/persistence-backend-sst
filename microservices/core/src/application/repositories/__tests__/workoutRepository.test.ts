/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { WorkoutRepository } from "../workoutRepository";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    inArray: vi.fn().mockReturnValue({ type: "inArray_stub" }),
  };
});

import { getDb } from "@persistence/db/client";

const baseWorkout = {
  id: "wo-1",
  name: "Full Body",
  description: null,
  createdBy: "user-1",
  visibility: "private" as const,
  estimatedDurationMinutes: 45,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockExercises = [
  {
    id: "we-1",
    exerciseId: "ex-1",
    sortOrder: 1,
    supersetGroup: null,
    targetSets: 3,
    targetRepsMin: 8,
    targetRepsMax: 10,
    targetDurationSeconds: null,
    restSeconds: 90,
    notes: null,
    exercise: {
      id: "ex-1",
      name: "Squat",
      category: "strength",
      difficultyLevel: "intermediate",
      videoUrl: null,
      thumbnailUrl: null,
    },
  },
];

const mockExercisesWithWorkoutId = mockExercises.map((e) => ({
  ...e,
  workoutId: "wo-1",
}));

function makeSelectChain(resolvedValue: any) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(resolvedValue),
      }),
    }),
  };
}

function makeListChain(resolvedValue: any) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            offset: vi.fn().mockResolvedValue(resolvedValue),
          }),
        }),
      }),
    }),
  };
}

function makeCountChain(value: number) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ value }]),
    }),
  };
}

function makeExercisesByWorkoutChain(resolvedValue: any) {
  return {
    from: vi.fn().mockReturnValue({
      leftJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue(resolvedValue),
        }),
      }),
    }),
  };
}

function makeQuotaUsedChain(value: number) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ value }]),
    }),
  };
}

function makeQuotaTierChain(workoutLimit: number | null) {
  return {
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi
            .fn()
            .mockResolvedValue(workoutLimit === null ? [] : [{ workoutLimit }]),
        }),
      }),
    }),
  };
}

describe("WorkoutRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("list", () => {
    it("should return own workouts with nested exercises and quota when type=mine", async () => {
      const mockDb = {
        select: vi
          .fn()
          // 1: paginated workouts query
          .mockReturnValueOnce(makeListChain([baseWorkout]))
          // 2: count query
          .mockReturnValueOnce(makeCountChain(1))
          // 3: nested exercises fetch (inArray on workoutIds)
          .mockReturnValueOnce(
            makeExercisesByWorkoutChain(mockExercisesWithWorkoutId),
          )
          // 4: quota used count
          .mockReturnValueOnce(makeQuotaUsedChain(1))
          // 5: quota tier limit lookup
          .mockReturnValueOnce(makeQuotaTierChain(50)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.list("user-1", { type: "mine" });

      expect(result.workouts).toHaveLength(1);
      expect(result.workouts[0].id).toBe("wo-1");
      expect(result.workouts[0].exercises).toEqual(mockExercises);
      expect(result.total).toBe(1);
      expect(result.quota).toEqual({ used: 1, limit: 50 });
    });

    it("should omit quota and skip the quota queries when type=default", async () => {
      const publicWorkout = { ...baseWorkout, visibility: "public" as const };
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeListChain([publicWorkout]))
          .mockReturnValueOnce(makeCountChain(1))
          .mockReturnValueOnce(makeExercisesByWorkoutChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.list("user-1", { type: "default" });

      expect(result.workouts).toHaveLength(1);
      expect(result.quota).toBeUndefined();
      expect(result.total).toBe(1);
      // 3 queries: list, count, exercises — no quota
      expect(mockDb.select).toHaveBeenCalledTimes(3);
    });

    it("type=default should include null-creator (system-seeded) public workouts", async () => {
      // Regression: pre-fix the default filter was `ne(createdBy, userId)`,
      // which in SQL evaluates to NULL (falsy) for rows where createdBy
      // is NULL — silently excluding system seeds. Spec contract is
      // `createdBy IS NULL OR createdBy != userId`. The repository mock
      // here can't introspect the actual SQL, but the test exists so a
      // future regression reverting to a plain `ne` shows up against the
      // spec language in the helper's where-builder.
      const seededWorkout = {
        ...baseWorkout,
        id: "wo-seed",
        createdBy: null,
        visibility: "public" as const,
      };
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeListChain([seededWorkout]))
          .mockReturnValueOnce(makeCountChain(1))
          .mockReturnValueOnce(makeExercisesByWorkoutChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.list("user-1", { type: "default" });

      expect(result.workouts).toHaveLength(1);
      expect(result.workouts[0].createdBy).toBeNull();
    });

    it("should query assigned workouts when type=assigned", async () => {
      const assignedWorkout = { ...baseWorkout, createdBy: "trainer-1" };
      const mockDb = {
        select: vi
          .fn()
          // Subquery for workoutAssignments inside buildListWhereClause
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({ subquery: true }),
            }),
          })
          // Main paginated query
          .mockReturnValueOnce(makeListChain([assignedWorkout]))
          // Count
          .mockReturnValueOnce(makeCountChain(1))
          // Exercises
          .mockReturnValueOnce(makeExercisesByWorkoutChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.list("user-1", { type: "assigned" });

      expect(result.workouts).toEqual([{ ...assignedWorkout, exercises: [] }]);
      expect(result.quota).toBeUndefined();
      // 4 queries because of the assigned subquery
      expect(mockDb.select).toHaveBeenCalledTimes(4);
    });

    it("should default to type=mine when type is undefined", async () => {
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeListChain([baseWorkout]))
          .mockReturnValueOnce(makeCountChain(1))
          .mockReturnValueOnce(
            makeExercisesByWorkoutChain(mockExercisesWithWorkoutId),
          )
          .mockReturnValueOnce(makeQuotaUsedChain(1))
          .mockReturnValueOnce(makeQuotaTierChain(null)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.list("user-1", {});

      expect(result.workouts).toHaveLength(1);
      expect(result.quota).toEqual({ used: 1, limit: null });
    });

    it("should return empty workouts and total=0 with no exercises fetch when no rows match", async () => {
      // fetchExercisesForWorkouts short-circuits on empty ids without
      // calling db.select, so only 4 selects fire: list, count, quota-used,
      // quota-tier.
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeListChain([]))
          .mockReturnValueOnce(makeCountChain(0))
          .mockReturnValueOnce(makeQuotaUsedChain(0))
          .mockReturnValueOnce(makeQuotaTierChain(null)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.list("user-1", { type: "mine" });

      expect(result.workouts).toEqual([]);
      expect(result.total).toBe(0);
      expect(mockDb.select).toHaveBeenCalledTimes(4);
    });
  });

  describe("getById", () => {
    it("should allow owner to access their own private workout", async () => {
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeSelectChain([baseWorkout]))
          .mockReturnValueOnce(
            makeExercisesByWorkoutChain(mockExercisesWithWorkoutId),
          ),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.getById("wo-1", "user-1");

      expect(result).not.toBeNull();
      expect(result?.exercises).toEqual(mockExercises);
    });

    it("should grant access to friends-visibility workout when friendship exists", async () => {
      const friendsWorkout = {
        ...baseWorkout,
        createdBy: "owner-id",
        visibility: "friends" as const,
      };
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeSelectChain([friendsWorkout]))
          .mockReturnValueOnce(makeSelectChain([{ id: "friendship-1" }]))
          .mockReturnValueOnce(
            makeExercisesByWorkoutChain(mockExercisesWithWorkoutId),
          ),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.getById("wo-1", "user-2");

      expect(result).not.toBeNull();
      expect(result?.exercises).toEqual(mockExercises);
    });

    it("should deny access to friends-visibility workout when no friendship exists", async () => {
      const friendsWorkout = {
        ...baseWorkout,
        createdBy: "owner-id",
        visibility: "friends" as const,
      };
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeSelectChain([friendsWorkout]))
          .mockReturnValueOnce(makeSelectChain([])) // no friendship
          .mockReturnValueOnce(makeSelectChain([])), // no assignment either
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.getById("wo-1", "stranger-id");

      expect(result).toBeNull();
      expect(mockDb.select).toHaveBeenCalledTimes(3);
    });

    it("should deny access to private workout for non-owner", async () => {
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeSelectChain([baseWorkout]))
          .mockReturnValueOnce(makeSelectChain([])), // no assignment grant
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.getById("wo-1", "not-the-owner");

      expect(result).toBeNull();
    });

    it("grants a client access to an assigned private workout (specs/19-programs AC 5.5)", async () => {
      const privateWorkout = {
        ...baseWorkout,
        createdBy: "coach-id",
        visibility: "private" as const,
      };
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeSelectChain([privateWorkout]))
          .mockReturnValueOnce(makeSelectChain([{ id: "wa-1" }])) // assignment row
          .mockReturnValueOnce(
            makeExercisesByWorkoutChain(mockExercisesWithWorkoutId),
          ),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.getById("wo-1", "client-id");

      expect(result).not.toBeNull();
      expect(result?.id).toBe("wo-1");
    });

    it("grants access to a friends-visibility workout via assignment when not a friend", async () => {
      const friendsWorkout = {
        ...baseWorkout,
        createdBy: "coach-id",
        visibility: "friends" as const,
      };
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeSelectChain([friendsWorkout]))
          .mockReturnValueOnce(makeSelectChain([])) // no friendship
          .mockReturnValueOnce(makeSelectChain([{ id: "wa-1" }])) // assignment
          .mockReturnValueOnce(
            makeExercisesByWorkoutChain(mockExercisesWithWorkoutId),
          ),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.getById("wo-1", "client-id");

      expect(result).not.toBeNull();
    });

    it("should grant access to public workout for any user", async () => {
      const publicWorkout = {
        ...baseWorkout,
        createdBy: "owner-id",
        visibility: "public" as const,
      };
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeSelectChain([publicWorkout]))
          .mockReturnValueOnce(
            makeExercisesByWorkoutChain(mockExercisesWithWorkoutId),
          ),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.getById("wo-1", "stranger-id");

      expect(result).not.toBeNull();
      expect(result?.exercises).toEqual(mockExercises);
    });

    it("should return null when workout does not exist", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValueOnce(makeSelectChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.getById("nonexistent", "user-1");

      expect(result).toBeNull();
    });
  });

  describe("createWithExercises", () => {
    it("should insert workout and nested exercises in a single transaction", async () => {
      const created = { ...baseWorkout, id: "wo-new", name: "New" };
      // The post-insert re-fetch goes through fetchExercisesForWorkouts
      // and groups by workoutId — pin the mock rows to the new id.
      const newWorkoutExercises = mockExercises.map((e) => ({
        ...e,
        workoutId: "wo-new",
      }));
      const insertExercises = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });
      const insertWorkouts = vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([created]),
        }),
      });
      const tx = {
        insert: vi.fn().mockImplementation(() => {
          // First call — workouts; second call — workoutExercises
          if (insertWorkouts.mock.calls.length === 0) return insertWorkouts();
          return insertExercises();
        }),
        select: vi
          .fn()
          .mockReturnValue(makeExercisesByWorkoutChain(newWorkoutExercises)),
      };

      const mockDb = {
        transaction: vi.fn().mockImplementation(async (fn: any) => fn(tx)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.createWithExercises("user-1", {
        name: "New",
        exercises: [
          {
            exerciseId: "ex-1",
            sortOrder: 0,
            targetSets: 3,
            targetRepsMin: 8,
            targetRepsMax: 10,
          },
        ],
      });

      expect(result.id).toBe("wo-new");
      expect(result.exercises).toEqual(mockExercises);
      expect(mockDb.transaction).toHaveBeenCalledTimes(1);
      // workouts insert + workoutExercises insert
      expect(tx.insert).toHaveBeenCalledTimes(2);
    });

    it("should insert only the workout when exercises array is empty", async () => {
      const created = { ...baseWorkout, id: "wo-new", name: "New" };
      const insertWorkouts = vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([created]),
        }),
      });
      const tx = {
        insert: vi.fn().mockImplementation(() => insertWorkouts()),
        select: vi.fn().mockReturnValue(makeExercisesByWorkoutChain([])),
      };
      const mockDb = {
        transaction: vi.fn().mockImplementation(async (fn: any) => fn(tx)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.createWithExercises("user-1", {
        name: "New",
        exercises: [],
      });

      expect(result.exercises).toEqual([]);
      // Only workouts insert called
      expect(tx.insert).toHaveBeenCalledTimes(1);
    });
  });

  describe("update", () => {
    // Ownership is enforced by folding `(id, createdBy)` into the UPDATE
    // WHERE clause. `returning()` returning [] ⇒ either the row doesn't
    // exist or the caller doesn't own it; both surface as 404 from the
    // handler layer. There is NO separate SELECT, so `mockDb.select` is
    // unused on the update path.

    it("should update metadata only when exercises is omitted", async () => {
      const updated = { ...baseWorkout, name: "Updated" };
      const tx = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([updated]),
            }),
          }),
        }),
        select: vi.fn().mockReturnValue(makeExercisesByWorkoutChain([])),
        delete: vi.fn(),
        insert: vi.fn(),
      };
      const mockDb = {
        transaction: vi.fn().mockImplementation(async (fn: any) => fn(tx)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.update("wo-1", "user-1", { name: "Updated" });

      expect(result?.name).toBe("Updated");
      expect(tx.delete).not.toHaveBeenCalled();
      expect(tx.insert).not.toHaveBeenCalled();
    });

    it("should full-replace exercises when array provided", async () => {
      const updated = { ...baseWorkout };
      const tx = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([updated]),
            }),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue(undefined),
        }),
        select: vi
          .fn()
          .mockReturnValue(
            makeExercisesByWorkoutChain(mockExercisesWithWorkoutId),
          ),
      };
      const mockDb = {
        transaction: vi.fn().mockImplementation(async (fn: any) => fn(tx)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.update("wo-1", "user-1", {
        name: "Updated",
        exercises: [
          {
            exerciseId: "ex-2",
            sortOrder: 0,
            targetRepsMin: 5,
            targetRepsMax: 8,
          },
        ],
      });

      expect(result?.exercises).toEqual(mockExercises);
      expect(tx.delete).toHaveBeenCalledTimes(1);
      expect(tx.insert).toHaveBeenCalledTimes(1);
    });

    it("should skip exercises insert when full-replacement array is empty", async () => {
      const tx = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([baseWorkout]),
            }),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
        insert: vi.fn(),
        select: vi.fn().mockReturnValue(makeExercisesByWorkoutChain([])),
      };
      const mockDb = {
        transaction: vi.fn().mockImplementation(async (fn: any) => fn(tx)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.update("wo-1", "user-1", { exercises: [] });

      expect(result?.exercises).toEqual([]);
      expect(tx.delete).toHaveBeenCalledTimes(1);
      expect(tx.insert).not.toHaveBeenCalled();
    });

    it("should return null when the (id, createdBy) UPDATE matches no rows (not found / not owner)", async () => {
      // Empty returning() covers BOTH the not-found and not-owner cases —
      // and crucially the concurrent-delete race where the row vanished
      // between the caller's intent and the actual UPDATE. Pre-fix this
      // path crashed inside fetchWorkoutWithExercises with a 500.
      const tx = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
        delete: vi.fn(),
        insert: vi.fn(),
        select: vi.fn(),
      };
      const mockDb = {
        transaction: vi.fn().mockImplementation(async (fn: any) => fn(tx)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.update("nonexistent", "user-1", {
        name: "X",
      });

      expect(result).toBeNull();
      // No follow-on writes / reads when the UPDATE didn't match a row
      expect(tx.delete).not.toHaveBeenCalled();
      expect(tx.insert).not.toHaveBeenCalled();
      expect(tx.select).not.toHaveBeenCalled();
    });

    it("should update description, visibility, and estimatedDurationMinutes together", async () => {
      const updated = {
        ...baseWorkout,
        description: "new desc",
        visibility: "friends" as const,
        estimatedDurationMinutes: 75,
      };
      const setSpy = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([updated]),
        }),
      });
      const tx = {
        update: vi.fn().mockReturnValue({ set: setSpy }),
        select: vi.fn().mockReturnValue(makeExercisesByWorkoutChain([])),
        delete: vi.fn(),
        insert: vi.fn(),
      };
      const mockDb = {
        transaction: vi.fn().mockImplementation(async (fn: any) => fn(tx)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      await repo.update("wo-1", "user-1", {
        description: "new desc",
        visibility: "friends",
        estimatedDurationMinutes: 75,
      });

      // The .set() call should include all three metadata fields plus updatedAt
      const setArg = setSpy.mock.calls[0][0];
      expect(setArg.description).toBe("new desc");
      expect(setArg.visibility).toBe("friends");
      expect(setArg.estimatedDurationMinutes).toBe(75);
    });

    it("should default targetRepsMin/Max to 1 when omitted in nested exercises", async () => {
      const insertSpy = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });
      const tx = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([baseWorkout]),
            }),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
        insert: insertSpy,
        select: vi.fn().mockReturnValue(makeExercisesByWorkoutChain([])),
      };
      const mockDb = {
        transaction: vi.fn().mockImplementation(async (fn: any) => fn(tx)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      await repo.update("wo-1", "user-1", {
        exercises: [{ exerciseId: "ex-1", sortOrder: 0 }],
      });

      // Drizzle insert chain: insert(table) -> values(rows)
      const valuesArg = insertSpy.mock.results[0].value.values.mock.calls[0][0];
      expect(valuesArg[0].targetRepsMin).toBe(1);
      expect(valuesArg[0].targetRepsMax).toBe(1);
      expect(valuesArg[0].restSeconds).toBe(90);
      expect(valuesArg[0].supersetGroup).toBeNull();
    });
  });

  describe("delete", () => {
    // Same TOCTOU-free pattern as update: ownership in the DELETE WHERE,
    // returning() length = match count.

    it("should delete a workout when (id, createdBy) matches", async () => {
      const mockDb = {
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([baseWorkout]),
          }),
        }),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.delete("wo-1", "user-1");

      expect(result).toBe(true);
    });

    it("should return false when DELETE matches no rows (not found / not owner / concurrent delete)", async () => {
      const mockDb = {
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      expect(await repo.delete("nonexistent", "user-1")).toBe(false);
      expect(await repo.delete("wo-1", "different-user")).toBe(false);
    });
  });

  describe("list — ownerLibraryOnly (trainer de-crowding filter)", () => {
    // Capture the mine-branch WHERE so we can render it with PgDialect and
    // prove the show_in_owner_library predicate is (only) added when asked.
    // The mocked-DB chains can't introspect SQL otherwise — the blind spot
    // reference_drizzle_groupby_param_bug.md warns about.
    function makeRecordingListChain(rows: any, capture: { where?: unknown }) {
      const chain: any = {};
      chain.from = vi.fn().mockReturnValue(chain);
      chain.where = vi.fn((w: unknown) => {
        capture.where = w;
        return chain;
      });
      chain.orderBy = vi.fn().mockReturnValue(chain);
      chain.limit = vi.fn().mockReturnValue(chain);
      chain.offset = vi.fn().mockResolvedValue(rows);
      return chain;
    }

    it("adds show_in_owner_library = true to the mine filter when ownerLibraryOnly", async () => {
      const capture: { where?: unknown } = {};
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeRecordingListChain([baseWorkout], capture))
          .mockReturnValueOnce(makeCountChain(1))
          .mockReturnValueOnce(
            makeExercisesByWorkoutChain(mockExercisesWithWorkoutId),
          )
          .mockReturnValueOnce(makeQuotaUsedChain(1))
          .mockReturnValueOnce(makeQuotaTierChain(null)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      await repo.list("user-1", { type: "mine", ownerLibraryOnly: true });

      const rendered = new PgDialect().sqlToQuery(capture.where as never).sql;
      expect(rendered).toContain('"created_by"');
      expect(rendered).toContain('"show_in_owner_library"');
    });

    it("keeps the mine filter as created_by only when ownerLibraryOnly is false/absent", async () => {
      const capture: { where?: unknown } = {};
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeRecordingListChain([baseWorkout], capture))
          .mockReturnValueOnce(makeCountChain(1))
          .mockReturnValueOnce(
            makeExercisesByWorkoutChain(mockExercisesWithWorkoutId),
          )
          .mockReturnValueOnce(makeQuotaUsedChain(1))
          .mockReturnValueOnce(makeQuotaTierChain(null)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      await repo.list("user-1", { type: "mine" });

      const rendered = new PgDialect().sqlToQuery(capture.where as never).sql;
      expect(rendered).toContain('"created_by"');
      expect(rendered).not.toContain("show_in_owner_library");
    });

    it("still counts ALL created workouts for quota regardless of the filter", async () => {
      // Quota (used) must not be de-crowded — a trainer at 40 authored
      // workouts still reads used=40 even when the list is filtered to the
      // handful they flagged owner-visible.
      const capture: { where?: unknown } = {};
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeRecordingListChain([baseWorkout], capture))
          .mockReturnValueOnce(makeCountChain(1))
          .mockReturnValueOnce(
            makeExercisesByWorkoutChain(mockExercisesWithWorkoutId),
          )
          .mockReturnValueOnce(makeQuotaUsedChain(40))
          .mockReturnValueOnce(makeQuotaTierChain(null)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.list("user-1", {
        type: "mine",
        ownerLibraryOnly: true,
      });

      expect(result.quota).toEqual({ used: 40, limit: null });
    });
  });

  describe("createWithExercises / update — show_in_owner_library", () => {
    it("defaults show_in_owner_library to true when omitted (athlete path)", async () => {
      const valuesSpy = vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([baseWorkout]),
      });
      const tx = {
        insert: vi.fn().mockReturnValue({ values: valuesSpy }),
        select: vi.fn().mockReturnValue(makeExercisesByWorkoutChain([])),
      };
      const mockDb = {
        transaction: vi.fn().mockImplementation(async (fn: any) => fn(tx)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      await repo.createWithExercises("user-1", { name: "Personal" });

      expect(valuesSpy.mock.calls[0][0].showInOwnerLibrary).toBe(true);
    });

    it("persists show_in_owner_library=false when the coach path sends it", async () => {
      const valuesSpy = vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([baseWorkout]),
      });
      const tx = {
        insert: vi.fn().mockReturnValue({ values: valuesSpy }),
        select: vi.fn().mockReturnValue(makeExercisesByWorkoutChain([])),
      };
      const mockDb = {
        transaction: vi.fn().mockImplementation(async (fn: any) => fn(tx)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      await repo.createWithExercises("user-1", {
        name: "For client",
        showInOwnerLibrary: false,
      });

      expect(valuesSpy.mock.calls[0][0].showInOwnerLibrary).toBe(false);
    });

    it("sets show_in_owner_library on update only when provided (no clobber)", async () => {
      const setSpy = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([baseWorkout]),
        }),
      });
      const tx = {
        update: vi.fn().mockReturnValue({ set: setSpy }),
        select: vi.fn().mockReturnValue(makeExercisesByWorkoutChain([])),
        delete: vi.fn(),
        insert: vi.fn(),
      };
      const mockDb = {
        transaction: vi.fn().mockImplementation(async (fn: any) => fn(tx)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      await repo.update("wo-1", "user-1", { showInOwnerLibrary: true });
      expect(setSpy.mock.calls[0][0].showInOwnerLibrary).toBe(true);

      setSpy.mockClear();
      await repo.update("wo-1", "user-1", { name: "Renamed" });
      expect("showInOwnerLibrary" in setSpy.mock.calls[0][0]).toBe(false);
    });
  });

  describe("getHistory", () => {
    const completedWorkout = { ...baseWorkout, createdBy: "user-1" };

    function makeAggChain(row: any, capture?: { where?: unknown }) {
      const chain: any = {};
      chain.from = vi.fn().mockReturnValue(chain);
      chain.where = vi.fn((w: unknown) => {
        if (capture) capture.where = w;
        return Promise.resolve([row]);
      });
      return chain;
    }
    function makeLastSessionChain(rows: any) {
      const chain: any = {};
      chain.from = vi.fn().mockReturnValue(chain);
      chain.where = vi.fn().mockReturnValue(chain);
      chain.orderBy = vi.fn().mockReturnValue(chain);
      chain.limit = vi.fn().mockResolvedValue(rows);
      return chain;
    }
    function makeVolumeChain(volume: number, capture?: { where?: unknown }) {
      const chain: any = {};
      chain.from = vi.fn().mockReturnValue(chain);
      chain.innerJoin = vi.fn().mockReturnValue(chain);
      chain.where = vi.fn((w: unknown) => {
        if (capture) capture.where = w;
        return Promise.resolve([{ volume }]);
      });
      return chain;
    }

    it("aggregates completed sessions for the owner + last-session volume", async () => {
      const completedAt = new Date("2026-03-21T10:00:00.000Z");
      const mockDb = {
        select: vi
          .fn()
          // 1: workout lookup
          .mockReturnValueOnce(makeSelectChain([completedWorkout]))
          // 2: aggregate (count + avg)
          .mockReturnValueOnce(
            makeAggChain({ completedCount: 12, avgDurationSeconds: 2640 }),
          )
          // 3: last completed session
          .mockReturnValueOnce(
            makeLastSessionChain([
              {
                id: "sess-9",
                completedAt,
                createdAt: completedAt,
                totalDurationSeconds: 2820,
              },
            ]),
          )
          // 4: last-session volume
          .mockReturnValueOnce(makeVolumeChain(6240)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const history = await repo.getHistory("wo-1", "user-1");

      expect(history).toEqual({
        completedCount: 12,
        lastCompletedAt: completedAt.toISOString(),
        avgDurationSeconds: 2640,
        lastSession: {
          completedAt: completedAt.toISOString(),
          totalVolumeKg: 6240,
          durationSeconds: 2820,
        },
      });
    });

    it("returns the empty state (count 0, null aggregates) when never completed", async () => {
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeSelectChain([completedWorkout]))
          .mockReturnValueOnce(
            makeAggChain({ completedCount: 0, avgDurationSeconds: null }),
          )
          .mockReturnValueOnce(makeLastSessionChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const history = await repo.getHistory("wo-1", "user-1");

      expect(history).toEqual({
        completedCount: 0,
        lastCompletedAt: null,
        avgDurationSeconds: null,
        lastSession: null,
      });
      // No volume query when there's no last session.
      expect(mockDb.select).toHaveBeenCalledTimes(3);
    });

    it("returns null when the workout does not exist", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValueOnce(makeSelectChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      expect(await repo.getHistory("nope", "user-1")).toBeNull();
      expect(mockDb.select).toHaveBeenCalledTimes(1);
    });

    it("returns null when the caller cannot read the workout (no leak)", async () => {
      const privateOther = {
        ...baseWorkout,
        createdBy: "someone-else",
        visibility: "private" as const,
      };
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeSelectChain([privateOther]))
          // canRead → assignment grant lookup → none
          .mockReturnValueOnce(makeSelectChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      expect(await repo.getHistory("wo-1", "stranger")).toBeNull();
    });

    it("scopes the aggregate + volume SQL to this user, workout and completed status", async () => {
      const aggCapture: { where?: unknown } = {};
      const volCapture: { where?: unknown } = {};
      const completedAt = new Date("2026-03-21T10:00:00.000Z");
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeSelectChain([completedWorkout]))
          .mockReturnValueOnce(
            makeAggChain(
              { completedCount: 1, avgDurationSeconds: 1000 },
              aggCapture,
            ),
          )
          .mockReturnValueOnce(
            makeLastSessionChain([
              {
                id: "sess-1",
                completedAt,
                createdAt: completedAt,
                totalDurationSeconds: 1000,
              },
            ]),
          )
          .mockReturnValueOnce(makeVolumeChain(500, volCapture)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      await repo.getHistory("wo-1", "user-1");

      const dialect = new PgDialect();
      const aggWhere = dialect.sqlToQuery(aggCapture.where as never).sql;
      expect(aggWhere).toContain('"user_id"');
      expect(aggWhere).toContain('"workout_id"');
      expect(aggWhere).toContain('"status"');

      const volWhere = dialect.sqlToQuery(volCapture.where as never).sql;
      // Volume is scoped to the last session's exercises + completed sets.
      expect(volWhere).toContain('"session_id"');
      expect(volWhere).toContain('"is_completed"');
    });

    it("falls back to created_at when a completed session has a null completed_at", async () => {
      const createdAt = new Date("2026-02-01T08:00:00.000Z");
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeSelectChain([completedWorkout]))
          .mockReturnValueOnce(
            makeAggChain({ completedCount: 1, avgDurationSeconds: 900 }),
          )
          .mockReturnValueOnce(
            makeLastSessionChain([
              {
                id: "sess-x",
                completedAt: null,
                createdAt,
                totalDurationSeconds: null,
              },
            ]),
          )
          .mockReturnValueOnce(makeVolumeChain(100)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const history = await repo.getHistory("wo-1", "user-1");

      expect(history?.lastCompletedAt).toBe(createdAt.toISOString());
      expect(history?.lastSession?.completedAt).toBe(createdAt.toISOString());
      expect(history?.lastSession?.durationSeconds).toBeNull();
    });
  });

  describe("getQuota", () => {
    it("should return used count + tier limit when subscription is active", async () => {
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeQuotaUsedChain(7))
          .mockReturnValueOnce(makeQuotaTierChain(50)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const quota = await repo.getQuota("user-1");

      expect(quota).toEqual({ used: 7, limit: 50 });
    });

    it("should return limit=null when no active subscription exists", async () => {
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeQuotaUsedChain(0))
          .mockReturnValueOnce(makeQuotaTierChain(null)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const quota = await repo.getQuota("user-1");

      expect(quota).toEqual({ used: 0, limit: null });
    });
  });
});
