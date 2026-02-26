/* eslint-disable @typescript-eslint/no-explicit-any */
import { WorkoutRepository } from "../workoutRepository";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

// inArray receives a Drizzle subquery object built by the mock chain;
// stub it to return a plain condition marker so the unit test doesn't
// attempt to introspect the mock as real SQL.
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

function makeExercisesChain(resolvedValue: any) {
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

describe("WorkoutRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("list", () => {
    it("should return own workouts when type=mine", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue(makeListChain([baseWorkout])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.list("user-1", { type: "mine" });

      expect(result).toEqual([baseWorkout]);
    });

    it("should return public workouts when type=default", async () => {
      const publicWorkout = { ...baseWorkout, visibility: "public" as const };
      const mockDb = {
        select: vi.fn().mockReturnValue(makeListChain([publicWorkout])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.list("user-1", { type: "default" });

      expect(result).toEqual([publicWorkout]);
    });

    it("should query assigned workouts when type=assigned", async () => {
      const assignedWorkout = { ...baseWorkout, createdBy: "trainer-1" };
      const mockDb = {
        select: vi
          .fn()
          // First call: builds the subquery for workoutAssignments
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({ subquery: true }),
            }),
          })
          // Second call: the main list query
          .mockReturnValueOnce(makeListChain([assignedWorkout])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.list("user-1", { type: "assigned" });

      expect(result).toEqual([assignedWorkout]);
      // db.select is called twice: once for the subquery, once for the main query
      expect(mockDb.select).toHaveBeenCalledTimes(2);
    });
  });

  describe("getById", () => {
    it("should allow owner to access their own private workout", async () => {
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeSelectChain([baseWorkout]))
          .mockReturnValueOnce(makeExercisesChain(mockExercises)),
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
          // 1st: fetch workout
          .mockReturnValueOnce(makeSelectChain([friendsWorkout]))
          // 2nd: check friendship — accepted friendship found
          .mockReturnValueOnce(makeSelectChain([{ id: "friendship-1" }]))
          // 3rd: fetch exercises
          .mockReturnValueOnce(makeExercisesChain(mockExercises)),
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
          // 1st: fetch workout
          .mockReturnValueOnce(makeSelectChain([friendsWorkout]))
          // 2nd: check friendship — no accepted friendship
          .mockReturnValueOnce(makeSelectChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.getById("wo-1", "stranger-id");

      expect(result).toBeNull();
      // Exercises should never be fetched after access is denied
      expect(mockDb.select).toHaveBeenCalledTimes(2);
    });

    it("should deny access to private workout for non-owner", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValueOnce(makeSelectChain([baseWorkout])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.getById("wo-1", "not-the-owner");

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

  describe("create", () => {
    it("should create a workout", async () => {
      const mockCreatedWorkout = {
        ...baseWorkout,
        name: "New Workout",
        estimatedDurationMinutes: 30,
      };
      const mockDb = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockCreatedWorkout]),
          }),
        }),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.create("user-1", {
        name: "New Workout",
        visibility: "private",
        estimatedDurationMinutes: 30,
      });

      expect(result).toEqual(mockCreatedWorkout);
    });
  });

  describe("update", () => {
    it("should update a workout owned by the user", async () => {
      const mockUpdatedWorkout = { ...baseWorkout, name: "Updated Workout" };
      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([baseWorkout])),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([mockUpdatedWorkout]),
            }),
          }),
        }),
      };
      (getDb as any).mockReturnValue(mockDb);

      const repo = new WorkoutRepository();
      const result = await repo.update("wo-1", "user-1", {
        name: "Updated Workout",
      });

      expect(result).toEqual(mockUpdatedWorkout);
    });
  });

  describe("delete", () => {
    it("should delete a workout owned by the user", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([baseWorkout])),
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
  });
});
