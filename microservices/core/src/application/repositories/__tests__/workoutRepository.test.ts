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

// Loadout provenance keys, as `fetchExercisesForWorkouts` projects them for a
// row that IS a swap. Used to prove the reason survives into every read path —
// AC-3.3 needs it legible two weeks later, not merely stored.
const swappedRowWithProvenance = {
  ...mockExercises[0],
  workoutId: "wo-1",
  substitutedFromExerciseId: "ex-original",
  substitutionReason: {
    code: "equipment_unavailable",
    missingEquipment: ["eq-9"],
    matchedOn: ["chest"],
  },
  isUserOverride: false,
};

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

/**
 * `select().from().where().orderBy()` — `captureProvenance`'s shape (no
 * leftJoin), read inside `update` before the exercise rows are replaced so
 * Loadout swap provenance survives an ordinary edit.
 */
function makeProvenanceCaptureChain(rows: any = []) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(rows),
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

    it("Cluster 2a: type=default excludes public workouts whose author is soft-deleted (NOT EXISTS on profiles.deleted_at)", async () => {
      let capturedWhere: unknown;
      const listChain: any = {};
      listChain.from = vi.fn().mockReturnValue(listChain);
      listChain.where = vi.fn((w: unknown) => {
        capturedWhere = w;
        return listChain;
      });
      listChain.orderBy = vi.fn().mockReturnValue(listChain);
      listChain.limit = vi.fn().mockReturnValue(listChain);
      listChain.offset = vi.fn().mockResolvedValue([]);
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(listChain)
          .mockReturnValueOnce(makeCountChain(0)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      await repo.list("user-1", { type: "default" });

      const dialect = new PgDialect();
      const rendered = dialect.sqlToQuery(capturedWhere as any).sql;
      expect(rendered).toContain("not exists");
      expect(rendered).toContain('"deleted_at" is not null');
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
          // Cluster 2a: isOwnerSoftDeleted check — owner not deleted.
          .mockReturnValueOnce(makeSelectChain([{ deletedAt: null }]))
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
          // Cluster 2a: isOwnerSoftDeleted check — owner not deleted.
          .mockReturnValueOnce(makeSelectChain([{ deletedAt: null }]))
          .mockReturnValueOnce(makeSelectChain([])) // no friendship
          .mockReturnValueOnce(makeSelectChain([])), // no assignment either
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.getById("wo-1", "stranger-id");

      expect(result).toBeNull();
      expect(mockDb.select).toHaveBeenCalledTimes(4);
    });

    it("Cluster 2a: denies access to a friends-visibility workout when the owner is soft-deleted, even for an accepted friend — but an existing assignment can still grant it", async () => {
      const friendsWorkout = {
        ...baseWorkout,
        createdBy: "owner-id",
        visibility: "friends" as const,
      };
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeSelectChain([friendsWorkout]))
          // owner IS soft-deleted — friendship check is skipped entirely.
          .mockReturnValueOnce(
            makeSelectChain([{ deletedAt: new Date("2026-07-13T00:00:00Z") }]),
          )
          .mockReturnValueOnce(makeSelectChain([])), // no assignment either
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.getById("wo-1", "friend-id");

      expect(result).toBeNull();
      // workout fetch, isOwnerSoftDeleted, assignment lookup — the
      // friendship query never runs because ownerDeleted short-circuits it.
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
          // Cluster 2a: isOwnerSoftDeleted check — owner not deleted.
          .mockReturnValueOnce(makeSelectChain([{ deletedAt: null }]))
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
          // Cluster 2a: isOwnerSoftDeleted check — owner not deleted.
          .mockReturnValueOnce(makeSelectChain([{ deletedAt: null }]))
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

    it("Cluster 2a: denies access to a public workout when the author is soft-deleted, even for a stranger — but an existing assignment can still grant it", async () => {
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
            makeSelectChain([{ deletedAt: new Date("2026-07-13T00:00:00Z") }]),
          )
          .mockReturnValueOnce(makeSelectChain([])), // no assignment
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.getById("wo-1", "stranger-id");

      expect(result).toBeNull();
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
          // 1: captureProvenance (pre-wipe), 2: the post-update re-fetch.
          .mockReturnValueOnce(makeProvenanceCaptureChain())
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
        select: vi
          .fn()
          .mockReturnValueOnce(makeProvenanceCaptureChain())
          .mockReturnValue(makeExercisesByWorkoutChain([])),
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
        select: vi
          .fn()
          .mockReturnValueOnce(makeProvenanceCaptureChain())
          .mockReturnValue(makeExercisesByWorkoutChain([])),
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
      // spec-21 § 4 / AC-6.4: the ownerLibraryOnly branch must ALSO exclude
      // Loadout variations. Patching only the other branch would leave
      // trainers — the only callers who pass ownerLibraryOnly: true — seeing
      // every variation, which is the exact crowding this filter exists to stop.
      expect(rendered).toContain('"parent_workout_id" is null');
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
      // …and the plain `mine` branch excludes variations too (spec-21 AC-6.4):
      // a user with one workout and four adapted versions sees ONE card.
      expect(rendered).toContain('"parent_workout_id" is null');
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

  // ─── Loadout variations (spec-21 Phase 0) ─────────────────────────────
  describe("findReadableWorkout", () => {
    it("returns true for the owner without any extra grant lookup", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([baseWorkout])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      expect(await repo.findReadableWorkout("wo-1", "user-1")).toEqual(
        baseWorkout,
      );
      // Owner fast path — only the workout row is read, no friendship or
      // assignment query.
      expect(mockDb.select).toHaveBeenCalledTimes(1);
    });

    it("returns true for a PUBLIC workout owned by someone else (AC-1.2: read, not own)", async () => {
      const publicWorkout = {
        ...baseWorkout,
        createdBy: "other-user",
        visibility: "public" as const,
      };
      const mockDb = {
        select: vi
          .fn()
          // 1. the workout row
          .mockReturnValueOnce(makeSelectChain([publicWorkout]))
          // 2. isOwnerSoftDeleted — owner is live
          .mockReturnValueOnce(makeSelectChain([{ deletedAt: null }])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      expect(await repo.findReadableWorkout("wo-1", "user-1")).toEqual(
        publicWorkout,
      );
    });

    it("returns false for another user's PRIVATE workout with no assignment", async () => {
      const privateWorkout = { ...baseWorkout, createdBy: "other-user" };
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeSelectChain([privateWorkout]))
          // assignment grant lookup — none
          .mockReturnValueOnce(makeSelectChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      expect(await repo.findReadableWorkout("wo-1", "user-1")).toBeNull();
    });

    it("returns false for a nonexistent workout (indistinguishable from forbidden)", async () => {
      const mockDb = { select: vi.fn().mockReturnValue(makeSelectChain([])) };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      expect(await repo.findReadableWorkout("nope", "user-1")).toBeNull();
    });

    // Returns the ROW, not a boolean, specifically so the create path can read
    // `parentWorkoutId` off it and refuse a variation of a variation without a
    // second query.
    it("surfaces parentWorkoutId so the caller can refuse a variation parent", async () => {
      const variation = { ...baseWorkout, parentWorkoutId: "root-1" };
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue(makeSelectChain([variation])),
      });

      const repo = new WorkoutRepository();
      const row = await repo.findReadableWorkout("wo-1", "user-1");
      expect(row?.parentWorkoutId).toBe("root-1");
    });
  });

  // AC-3.3: a stored-but-unreadable reason satisfies the storage half of the
  // requirement and none of the point. `fetchExercisesForWorkouts` is the ONE
  // projection behind GET /workouts/:id, the list response AND createVariation's
  // own 201 body, so this is where write-only would have shown up.
  describe("provenance round-trip", () => {
    // ⚠ THE ASSERTION THAT MATTERS IS ON THE PROJECTION, NOT THE ROWS.
    // `makeExercisesByWorkoutChain` returns whatever rows the test hands it
    // regardless of what `select()` asked for, so an assertion on the returned
    // row cannot fail when a column is dropped from the projection — the
    // mocked-getDb blind spot. Capturing the argument to `select()` is what
    // actually pins the SELECT list.
    it("projects the three provenance columns in the shared exercise read", async () => {
      let projection: Record<string, unknown> | undefined;
      const selectSpy = vi.fn((arg?: Record<string, unknown>) => {
        if (arg && "exerciseId" in arg) projection = arg;
        return arg && "exerciseId" in arg
          ? makeExercisesByWorkoutChain([swappedRowWithProvenance])
          : makeSelectChain([baseWorkout]);
      });
      (getDb as any).mockReturnValue({ select: selectSpy });

      const repo = new WorkoutRepository();
      const result = await repo.getById("wo-1", "user-1");

      expect(projection).toBeDefined();
      expect(Object.keys(projection!)).toEqual(
        expect.arrayContaining([
          "substitutedFromExerciseId",
          "substitutionReason",
          "isUserOverride",
        ]),
      );
      // …and the values do reach the caller.
      expect(result?.exercises[0]).toMatchObject({
        substitutedFromExerciseId: "ex-original",
        substitutionReason: {
          code: "equipment_unavailable",
          missingEquipment: ["eq-9"],
          matchedOn: ["chest"],
        },
        isUserOverride: false,
      });
    });

    it("returns provenance on createVariation's own 201 body", async () => {
      const created = { ...baseWorkout, id: "wo-var-1" };
      const values = vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([created]),
      });
      let first = true;
      const tx = {
        insert: vi.fn().mockImplementation(() => {
          if (first) {
            first = false;
            return { values };
          }
          return { values: vi.fn().mockResolvedValue(undefined) };
        }),
        select: vi
          .fn()
          .mockReturnValue(
            makeExercisesByWorkoutChain([
              { ...swappedRowWithProvenance, workoutId: "wo-var-1" },
            ]),
          ),
      };
      (getDb as any).mockReturnValue({
        transaction: vi.fn().mockImplementation(async (fn: any) => fn(tx)),
      });

      const repo = new WorkoutRepository();
      const result = await repo.createVariation("user-1", "parent-1", {
        name: "Adapted",
        sourceEquipmentTypeIds: ["eq-1"],
        exercises: [{ exerciseId: "ex-swap", sortOrder: 0 }],
      });

      expect(result.exercises[0].substitutedFromExerciseId).toBe("ex-original");
    });
  });

  // `update` is a full delete-and-reinsert, and toWorkoutExerciseInsert projects
  // only the ten pre-Loadout fields — so without the pre-wipe capture, bumping
  // one exercise's target sets on a saved variation through the generic workout
  // editor would silently reset every row's provenance and drop the derived
  // swapCount to 0. Permanent, invisible data loss on a normal edit.
  describe("update — Loadout provenance survives the exercise replace", () => {
    function makeUpdateTx(existingProvenanceRows: any[]) {
      const insertSpy = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });
      return {
        insertSpy,
        tx: {
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
          select: vi
            .fn()
            .mockReturnValueOnce(
              makeProvenanceCaptureChain(existingProvenanceRows),
            )
            .mockReturnValue(makeExercisesByWorkoutChain([])),
        },
      };
    }

    const reason = {
      code: "equipment_unavailable",
      missingEquipment: ["eq-9"],
    };

    it("carries provenance onto the row with the same exercise_id", async () => {
      const { tx, insertSpy } = makeUpdateTx([
        {
          exerciseId: "ex-swap",
          sortOrder: 0,
          substitutedFromExerciseId: "ex-original",
          substitutionReason: reason,
          isUserOverride: true,
        },
      ]);
      (getDb as any).mockReturnValue({
        transaction: vi.fn().mockImplementation(async (fn: any) => fn(tx)),
      });

      const repo = new WorkoutRepository();
      // A plain target-sets edit — the kind of edit that used to wipe the reason.
      await repo.update("wo-var-1", "user-1", {
        exercises: [{ exerciseId: "ex-swap", sortOrder: 0, targetSets: 4 }],
      });

      const values = insertSpy.mock.results[0].value.values.mock.calls[0][0];
      expect(values[0]).toMatchObject({
        exerciseId: "ex-swap",
        targetSets: 4,
        substitutedFromExerciseId: "ex-original",
        substitutionReason: reason,
        isUserOverride: true,
      });
    });

    it("does NOT carry provenance onto a row whose exercise changed", async () => {
      const { tx, insertSpy } = makeUpdateTx([
        {
          exerciseId: "ex-swap",
          sortOrder: 0,
          substitutedFromExerciseId: "ex-original",
          substitutionReason: reason,
          isUserOverride: true,
        },
      ]);
      (getDb as any).mockReturnValue({
        transaction: vi.fn().mockImplementation(async (fn: any) => fn(tx)),
      });

      const repo = new WorkoutRepository();
      await repo.update("wo-var-1", "user-1", {
        exercises: [{ exerciseId: "ex-totally-different", sortOrder: 0 }],
      });

      const values = insertSpy.mock.results[0].value.values.mock.calls[0][0];
      // Correct: it's a different exercise now, so the old reason no longer
      // describes it. Carrying it over would be a lie about the row.
      //
      // The keys are ABSENT rather than explicitly null — no provenance matched,
      // so nothing was spread in and the column defaults apply (NULL / false).
      expect(values[0]).not.toHaveProperty("substitutedFromExerciseId");
      expect(values[0]).not.toHaveProperty("isUserOverride");
    });

    it("queues per exercise_id so a repeated exercise keeps both rows' provenance", async () => {
      const { tx, insertSpy } = makeUpdateTx([
        {
          exerciseId: "ex-dup",
          sortOrder: 0,
          substitutedFromExerciseId: "ex-a",
          substitutionReason: null,
          isUserOverride: false,
        },
        {
          exerciseId: "ex-dup",
          sortOrder: 1,
          substitutedFromExerciseId: "ex-b",
          substitutionReason: null,
          isUserOverride: false,
        },
      ]);
      (getDb as any).mockReturnValue({
        transaction: vi.fn().mockImplementation(async (fn: any) => fn(tx)),
      });

      const repo = new WorkoutRepository();
      await repo.update("wo-var-1", "user-1", {
        exercises: [
          { exerciseId: "ex-dup", sortOrder: 0 },
          { exerciseId: "ex-dup", sortOrder: 1 },
        ],
      });

      const values = insertSpy.mock.results[0].value.values.mock.calls[0][0];
      expect(values[0].substitutedFromExerciseId).toBe("ex-a");
      expect(values[1].substitutedFromExerciseId).toBe("ex-b");
    });

    it("is a no-op for an ordinary workout with no provenance to carry", async () => {
      const { tx, insertSpy } = makeUpdateTx([
        {
          exerciseId: "ex-1",
          sortOrder: 0,
          substitutedFromExerciseId: null,
          substitutionReason: null,
          isUserOverride: false,
        },
      ]);
      (getDb as any).mockReturnValue({
        transaction: vi.fn().mockImplementation(async (fn: any) => fn(tx)),
      });

      const repo = new WorkoutRepository();
      await repo.update("wo-1", "user-1", {
        exercises: [{ exerciseId: "ex-1", sortOrder: 0 }],
      });

      const values = insertSpy.mock.results[0].value.values.mock.calls[0][0];
      // Falls through to toWorkoutExerciseInsert's shape — the pre-Loadout
      // behaviour is unchanged for every workout that isn't a variation.
      expect(values[0].substitutedFromExerciseId).toBeUndefined();
    });
  });

  describe("listExerciseIdsForWorkout", () => {
    function makeDistinctChain(rows: any, capture: { where?: unknown } = {}) {
      const chain: any = {};
      chain.from = vi.fn().mockReturnValue(chain);
      chain.where = vi.fn((w: unknown) => {
        capture.where = w;
        return Promise.resolve(rows);
      });
      return chain;
    }

    it("returns the workout's exercise ids", async () => {
      (getDb as any).mockReturnValue({
        selectDistinct: vi
          .fn()
          .mockReturnValue(
            makeDistinctChain([{ exerciseId: "ex-1" }, { exerciseId: "ex-2" }]),
          ),
      });

      const repo = new WorkoutRepository();
      expect(await repo.listExerciseIdsForWorkout("wo-1")).toEqual([
        "ex-1",
        "ex-2",
      ]);
    });

    // Scoped to the one workout: the create path uses this to exempt CARRIED-OVER
    // rows from the catalogue predicate, so a predicate that leaked other
    // workouts' ids would widen the exemption into a real read grant.
    it("filters on workout_id only", async () => {
      const capture: { where?: unknown } = {};
      (getDb as any).mockReturnValue({
        selectDistinct: vi.fn().mockReturnValue(makeDistinctChain([], capture)),
      });

      const repo = new WorkoutRepository();
      await repo.listExerciseIdsForWorkout("wo-1");

      const rendered = new PgDialect().sqlToQuery(capture.where as never).sql;
      expect(rendered).toContain('"workout_id"');
      expect(rendered).not.toContain("created_by");
    });
  });

  describe("listVariations", () => {
    function makeVariationsChain(rows: any, capture: { where?: unknown }) {
      const chain: any = {};
      chain.from = vi.fn().mockReturnValue(chain);
      chain.leftJoin = vi.fn().mockReturnValue(chain);
      chain.where = vi.fn((w: unknown) => {
        capture.where = w;
        return chain;
      });
      chain.orderBy = vi.fn().mockResolvedValue(rows);
      return chain;
    }

    // The mocked-getDb blind spot means a wrong WHERE ships green, so the
    // predicate is rendered and asserted (memory/reference_drizzle_groupby_
    // param_bug). BOTH columns must appear: parent_workout_id alone would let
    // any reader of a shared parent enumerate every other user's setups.
    it("filters on BOTH parent_workout_id and created_by (AC-6.2 isolation)", async () => {
      const capture: { where?: unknown } = {};
      const mockDb = {
        select: vi.fn().mockReturnValue(makeVariationsChain([], capture)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      await repo.listVariations("parent-1", "user-1");

      const rendered = new PgDialect().sqlToQuery(capture.where as never).sql;
      expect(rendered).toContain('"parent_workout_id"');
      expect(rendered).toContain('"created_by"');
    });

    it("returns the summary rows, including a derived swapCount", async () => {
      const rows = [
        {
          id: "wo-var-1",
          name: "Full Body · Hotel gym",
          description: null,
          parentWorkoutId: "parent-1",
          variationKind: "loadout",
          sourceGymId: "gym-1",
          sourceGymName: "Hotel gym",
          sourceEquipmentTypeIds: ["eq-1", "eq-2"],
          estimatedDurationMinutes: 45,
          swapCount: 3,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      const mockDb = {
        select: vi.fn().mockReturnValue(makeVariationsChain(rows, {})),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.listVariations("parent-1", "user-1");

      expect(result).toHaveLength(1);
      expect(result[0].swapCount).toBe(3);
      expect(result[0].sourceGymName).toBe("Hotel gym");
    });

    it("keeps the frozen kit snapshot when the saved gym is gone (AC-7.3)", async () => {
      // Gym deleted ⇒ FK SET NULL ⇒ no join row ⇒ null name. The
      // source_equipment_type_ids snapshot still describes the kit.
      const rows = [
        {
          id: "wo-var-1",
          name: "Full Body · adapted",
          description: null,
          parentWorkoutId: "parent-1",
          variationKind: "loadout",
          sourceGymId: null,
          sourceGymName: null,
          sourceEquipmentTypeIds: ["eq-1", "eq-2"],
          estimatedDurationMinutes: 45,
          swapCount: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      const mockDb = {
        select: vi.fn().mockReturnValue(makeVariationsChain(rows, {})),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.listVariations("parent-1", "user-1");

      expect(result[0].sourceGymName).toBeNull();
      expect(result[0].sourceEquipmentTypeIds).toEqual(["eq-1", "eq-2"]);
    });
  });

  describe("createVariation", () => {
    function makeVariationTx(created: any) {
      const workoutValues = vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([created]),
      });
      const exerciseValues = vi.fn().mockResolvedValue(undefined);
      const insert = vi.fn().mockImplementation(() => {
        if (workoutValues.mock.calls.length === 0) {
          return { values: workoutValues };
        }
        return { values: exerciseValues };
      });
      const tx = {
        insert,
        select: vi.fn().mockReturnValue(makeExercisesByWorkoutChain([])),
      };
      return { tx, workoutValues, exerciseValues };
    }

    const createdVariation = {
      ...baseWorkout,
      id: "wo-var-1",
      parentWorkoutId: "parent-1",
      variationKind: "loadout",
    };

    // The single most important assertion in this file. § 4 only patches the
    // `mine` list branch; the `default` branch is `visibility = 'public' AND
    // (created_by IS NULL OR created_by != userId)`, so a variation that
    // inherited a PUBLIC parent's visibility would land in every OTHER user's
    // browse — carrying this user's gym kit with it (design § 2.2).
    it("always creates the variation private, never inheriting the parent's visibility", async () => {
      const { tx, workoutValues } = makeVariationTx(createdVariation);
      (getDb as any).mockReturnValue({
        transaction: vi.fn().mockImplementation(async (fn: any) => fn(tx)),
      });

      const repo = new WorkoutRepository();
      await repo.createVariation("user-1", "parent-1", {
        name: "Full Body · Hotel gym",
        sourceEquipmentTypeIds: ["eq-1"],
        exercises: [],
      });

      expect(workoutValues).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: "private" }),
      );
    });

    it("sets parent linkage, kind, owner and the frozen kit snapshot (AC-5.1/5.2)", async () => {
      const { tx, workoutValues } = makeVariationTx(createdVariation);
      (getDb as any).mockReturnValue({
        transaction: vi.fn().mockImplementation(async (fn: any) => fn(tx)),
      });

      const repo = new WorkoutRepository();
      await repo.createVariation("user-1", "parent-1", {
        name: "Full Body · Hotel gym",
        sourceGymId: "gym-1",
        sourceEquipmentTypeIds: ["eq-1", "eq-2"],
        exercises: [],
      });

      expect(workoutValues).toHaveBeenCalledWith(
        expect.objectContaining({
          // The variation is owned by the CALLER, never by the parent's owner
          // (AC-1.2) — that is what makes adapting a coach's workout safe.
          createdBy: "user-1",
          parentWorkoutId: "parent-1",
          variationKind: "loadout",
          sourceGymId: "gym-1",
          sourceEquipmentTypeIds: ["eq-1", "eq-2"],
        }),
      );
    });

    it("persists per-row provenance so the variation can explain itself later (AC-3.3)", async () => {
      const { tx, exerciseValues } = makeVariationTx(createdVariation);
      (getDb as any).mockReturnValue({
        transaction: vi.fn().mockImplementation(async (fn: any) => fn(tx)),
      });

      const reason = {
        code: "equipment_unavailable",
        missingEquipment: ["eq-9"],
        matchedOn: ["chest"],
      };

      const repo = new WorkoutRepository();
      await repo.createVariation("user-1", "parent-1", {
        name: "Adapted",
        sourceEquipmentTypeIds: ["eq-1"],
        exercises: [
          {
            exerciseId: "ex-swap",
            sortOrder: 0,
            targetSets: 3,
            targetRepsMin: 8,
            targetRepsMax: 10,
            substitutedFromExerciseId: "ex-original",
            substitutionReason: reason,
            isUserOverride: true,
          },
          // A KEPT row carries no provenance.
          { exerciseId: "ex-kept", sortOrder: 1 },
        ],
      });

      const inserted = exerciseValues.mock.calls[0][0];
      expect(inserted[0]).toMatchObject({
        exerciseId: "ex-swap",
        substitutedFromExerciseId: "ex-original",
        substitutionReason: reason,
        isUserOverride: true,
        // Training targets are copied through untouched — they are a database
        // property, never a model property (design § 1).
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 10,
      });
      expect(inserted[1]).toMatchObject({
        exerciseId: "ex-kept",
        substitutedFromExerciseId: null,
        substitutionReason: null,
        isUserOverride: false,
      });
    });

    it("never writes to the parent — insert only, no UPDATE or DELETE", async () => {
      const { tx } = makeVariationTx(createdVariation);
      // Spies are actually INSTALLED on the tx, so a stray `tx.update(...)` /
      // `tx.delete(...)` inside createVariation would be recorded rather than
      // throwing — asserting on the fixture's own missing keys (as an earlier
      // version of this test did) could not fail whatever the implementation did.
      const update = vi.fn(() => {
        throw new Error("createVariation must not UPDATE");
      });
      const del = vi.fn(() => {
        throw new Error("createVariation must not DELETE");
      });
      const txWithSpies = { ...tx, update, delete: del };
      const mockDb = {
        transaction: vi
          .fn()
          .mockImplementation(async (fn: any) => fn(txWithSpies)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      await repo.createVariation("user-1", "parent-1", {
        name: "Adapted",
        sourceEquipmentTypeIds: ["eq-1"],
        exercises: [],
      });

      // AC-1.3: the parent row and its workout_exercises are byte-for-byte
      // unchanged, because nothing in the transaction mutates anything.
      expect(update).not.toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
      expect(mockDb.transaction).toHaveBeenCalledTimes(1);
      expect(txWithSpies.insert).toHaveBeenCalledTimes(1);
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
