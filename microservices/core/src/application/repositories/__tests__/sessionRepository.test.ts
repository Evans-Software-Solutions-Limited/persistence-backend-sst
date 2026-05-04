/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

function makeSelectChain(resolvedValue: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(resolvedValue),
      }),
    }),
  };
}

function makeListChain(resolvedValue: unknown) {
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

function makeSelectWithOrderBy(resolvedValue: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(resolvedValue),
      }),
    }),
  };
}

function makeSelectWithOrderByForExerciseSets(resolvedValue: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(resolvedValue),
      }),
    }),
  };
}

function makeUpdateChain(resolvedValue: unknown) {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(resolvedValue),
      }),
    }),
  };
}

function makeDeleteChain(resolvedValue: unknown) {
  return {
    where: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(resolvedValue),
    }),
  };
}

describe("SessionRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("should create a session", async () => {
      const mockSession = {
        id: "s1",
        userId: "u1",
        workoutId: "w1",
        name: "Session 1",
        status: "in_progress" as const,
        startedAt: new Date(),
        completedAt: null,
        totalDurationSeconds: null,
        userNotes: null,
        trainerFeedback: null,
        sessionRating: null,
        overallRpe: null,
        difficultyRanking: null,
        createdAt: new Date(),
      };

      const mockDb = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockSession]),
          }),
        }),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SessionRepository } = await import("../sessionRepository");
      const repo = new SessionRepository();
      const result = await repo.create("u1", {
        workoutId: "w1",
      } as any);

      expect(result).toEqual(mockSession);
    });
  });

  describe("list", () => {
    it("should list sessions for a user", async () => {
      const mockSession = {
        id: "s1",
        userId: "u1",
        workoutId: "w1",
        name: "Session 1",
        status: "in_progress" as const,
        startedAt: new Date(),
        completedAt: null,
        totalDurationSeconds: null,
        userNotes: null,
        trainerFeedback: null,
        sessionRating: null,
        overallRpe: null,
        difficultyRanking: null,
        createdAt: new Date(),
      };

      const mockDb = {
        select: vi.fn().mockReturnValue(makeListChain([mockSession])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SessionRepository } = await import("../sessionRepository");
      const repo = new SessionRepository();
      const result = await repo.list("u1", { limit: 20, offset: 0 });

      expect(result).toEqual([mockSession]);
    });
  });

  describe("getById", () => {
    it("should get session by id with exercises", async () => {
      const mockSession = {
        id: "s1",
        userId: "u1",
        workoutId: "w1",
        name: "Session 1",
        status: "in_progress" as const,
        startedAt: new Date(),
        completedAt: null,
        totalDurationSeconds: null,
        userNotes: null,
        trainerFeedback: null,
        sessionRating: null,
        overallRpe: null,
        difficultyRanking: null,
        createdAt: new Date(),
      };

      const mockExercises = [
        {
          id: "se1",
          sessionId: "s1",
          exerciseId: "ex1",
          sortOrder: 1,
          notes: null,
          createdAt: new Date(),
        },
      ];

      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeSelectChain([mockSession]))
          .mockReturnValueOnce(makeSelectWithOrderBy(mockExercises)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SessionRepository } = await import("../sessionRepository");
      const repo = new SessionRepository();
      const result = await repo.getById("s1", "u1");

      expect(result).toEqual({
        ...mockSession,
        exercises: mockExercises,
      });
    });

    it("should return null when session not found", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SessionRepository } = await import("../sessionRepository");
      const repo = new SessionRepository();
      const result = await repo.getById("s1", "u1");

      expect(result).toBeNull();
    });
  });

  describe("update", () => {
    it("should update a session", async () => {
      const mockSession = {
        id: "s1",
        userId: "u1",
        workoutId: "w1",
        name: "Session 1",
        status: "completed" as const,
        startedAt: new Date(),
        completedAt: new Date(),
        totalDurationSeconds: 3600,
        userNotes: "Good session",
        trainerFeedback: null,
        sessionRating: null,
        overallRpe: null,
        difficultyRanking: null,
        createdAt: new Date(),
      };

      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([mockSession])),
        update: vi.fn().mockReturnValue(makeUpdateChain([mockSession])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SessionRepository } = await import("../sessionRepository");
      const repo = new SessionRepository();
      const result = await repo.update("s1", "u1", {
        userNotes: "Good session",
      });

      expect(result).toEqual(mockSession);
    });

    it("should return null when session not found for update", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SessionRepository } = await import("../sessionRepository");
      const repo = new SessionRepository();
      const result = await repo.update("s1", "u1", {
        userNotes: "Good session",
      });

      expect(result).toBeNull();
    });
  });

  describe("delete", () => {
    it("should delete a session", async () => {
      const mockSession = {
        id: "s1",
        userId: "u1",
        workoutId: "w1",
        name: "Session 1",
        status: "in_progress" as const,
        startedAt: new Date(),
        completedAt: null,
        totalDurationSeconds: null,
        userNotes: null,
        trainerFeedback: null,
        sessionRating: null,
        overallRpe: null,
        difficultyRanking: null,
        createdAt: new Date(),
      };

      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([mockSession])),
        delete: vi.fn().mockReturnValue(makeDeleteChain([mockSession])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SessionRepository } = await import("../sessionRepository");
      const repo = new SessionRepository();
      const result = await repo.delete("s1", "u1");

      expect(result).toBe(true);
    });

    it("should return false when session not found for delete", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SessionRepository } = await import("../sessionRepository");
      const repo = new SessionRepository();
      const result = await repo.delete("s1", "u1");

      expect(result).toBe(false);
    });
  });

  describe("addExercise", () => {
    it("should add exercise to session", async () => {
      const mockExercise = {
        id: "se1",
        sessionId: "s1",
        exerciseId: "ex1",
        sortOrder: 1,
        notes: null,
        createdAt: new Date(),
      };

      const mockDb = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockExercise]),
          }),
        }),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SessionRepository } = await import("../sessionRepository");
      const repo = new SessionRepository();
      const result = await repo.addExercise({
        sessionId: "s1",
        exerciseId: "ex1",
        sortOrder: 1,
      } as any);

      expect(result).toEqual(mockExercise);
    });
  });

  describe("getSessionExercises", () => {
    it("should get all exercises for a session", async () => {
      const mockExercises = [
        {
          id: "se1",
          sessionId: "s1",
          exerciseId: "ex1",
          sortOrder: 1,
          notes: null,
          createdAt: new Date(),
        },
        {
          id: "se2",
          sessionId: "s1",
          exerciseId: "ex2",
          sortOrder: 2,
          notes: null,
          createdAt: new Date(),
        },
      ];

      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectWithOrderBy(mockExercises)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SessionRepository } = await import("../sessionRepository");
      const repo = new SessionRepository();
      const result = await repo.getSessionExercises("s1");

      expect(result).toEqual(mockExercises);
    });
  });

  describe("removeExercise", () => {
    it("should remove exercise from session", async () => {
      const mockExercise = {
        id: "se1",
        sessionId: "s1",
        exerciseId: "ex1",
        sortOrder: 1,
        notes: null,
        createdAt: new Date(),
      };

      const mockSession = {
        id: "s1",
        userId: "u1",
        workoutId: "w1",
        name: "Session 1",
        status: "in_progress" as const,
        startedAt: new Date(),
        completedAt: null,
        totalDurationSeconds: null,
        userNotes: null,
        trainerFeedback: null,
        sessionRating: null,
        overallRpe: null,
        difficultyRanking: null,
        createdAt: new Date(),
      };

      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeSelectChain([mockExercise]))
          .mockReturnValueOnce(makeSelectChain([mockSession]))
          .mockReturnValueOnce(makeDeleteChain([mockExercise])),
        delete: vi.fn().mockReturnValue(makeDeleteChain([mockExercise])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SessionRepository } = await import("../sessionRepository");
      const repo = new SessionRepository();
      const result = await repo.removeExercise("se1", "u1");

      expect(result).toBe(true);
    });

    it("should return false when exercise not found", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SessionRepository } = await import("../sessionRepository");
      const repo = new SessionRepository();
      const result = await repo.removeExercise("se1", "u1");

      expect(result).toBe(false);
    });

    it("should return false when session does not belong to user", async () => {
      const mockExercise = {
        id: "se1",
        sessionId: "s1",
        exerciseId: "ex1",
        sortOrder: 1,
        notes: null,
        createdAt: new Date(),
      };

      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeSelectChain([mockExercise]))
          .mockReturnValueOnce(makeSelectChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SessionRepository } = await import("../sessionRepository");
      const repo = new SessionRepository();
      const result = await repo.removeExercise("se1", "u1");

      expect(result).toBe(false);
    });
  });

  describe("addSet", () => {
    it("should add set to exercise", async () => {
      const mockSet = {
        id: "set1",
        sessionExerciseId: "se1",
        reps: 10,
        weightKg: "50.00" as any,
        durationSeconds: null,
        distanceMeters: null,
        restAfterSeconds: 90,
        setNumber: 1,
        rpe: null,
        isPersonalRecord: false,
        createdAt: new Date(),
      };

      const mockDb = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockSet]),
          }),
        }),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SessionRepository } = await import("../sessionRepository");
      const repo = new SessionRepository();
      const result = await repo.addSet({
        sessionExerciseId: "se1",
        reps: 10,
        weightKg: "50.00" as any,
        setNumber: 1,
      } as any);

      expect(result).toEqual(mockSet);
    });
  });

  describe("getExerciseSets", () => {
    it("should get all sets for an exercise", async () => {
      const mockSets = [
        {
          id: "set1",
          sessionExerciseId: "se1",
          reps: 10,
          weightKg: "50.00" as any,
          durationSeconds: null,
          distanceMeters: null,
          restAfterSeconds: 90,
          setNumber: 1,
          rpe: null,
          isPersonalRecord: false,
          createdAt: new Date(),
        },
        {
          id: "set2",
          sessionExerciseId: "se1",
          reps: 8,
          weightKg: "55.00" as any,
          durationSeconds: null,
          distanceMeters: null,
          restAfterSeconds: 90,
          setNumber: 2,
          rpe: null,
          isPersonalRecord: false,
          createdAt: new Date(),
        },
      ];

      const mockDb = {
        select: vi
          .fn()
          .mockReturnValue(makeSelectWithOrderByForExerciseSets(mockSets)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SessionRepository } = await import("../sessionRepository");
      const repo = new SessionRepository();
      const result = await repo.getExerciseSets("se1");

      expect(result).toEqual(mockSets);
    });
  });

  // After commit 6 (M3 BACKEND_BRIEF § 4 / M2 learning #14), updateSet
  // and deleteSet fold ownership into a single mutation WHERE via a
  // correlated subquery. The mock therefore needs to handle ONE chain
  // call per method (no SELECT cascade), and the WHERE clause is what
  // the join filters against — when the join filters everything out
  // (set doesn't exist, or it does but isn't ours), the mutation
  // returning() yields an empty array.
  describe("updateSet", () => {
    it("updates the set in a single round-trip when the join matches", async () => {
      const mockSet = {
        id: "set1",
        sessionExerciseId: "se1",
        reps: 10,
        weightKg: "60.00" as any,
        durationSeconds: null,
        distanceMeters: null,
        restAfterSeconds: 90,
        setNumber: 1,
        rpe: 8,
        isPersonalRecord: false,
        isCompleted: false,
        completedAt: null,
        createdAt: new Date(),
      };

      // The subquery in the WHERE clause is itself a `db.select(...)`
      // expression Drizzle uses positionally. We don't need to mock
      // it — the production update().set().where().returning() chain
      // resolves to the rows from `returning()`, which is what the
      // mock controls.
      const mockDb = {
        // The TOCTOU-safe updateSet/deleteSet use a correlated
        // subquery inside their WHERE: `db.select({...}).from(...)
        // .innerJoin(...).where(...)`. The subquery is passed as a
        // value to inArray() — Drizzle never AWAITS it (Postgres
        // executes it server-side), so the mock can return any chain
        // stub that supports the dotted method calls; the actual
        // filtering happens at the SQL layer in production.
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({}),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue(makeUpdateChain([mockSet])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SessionRepository } = await import("../sessionRepository");
      const repo = new SessionRepository();
      const result = await repo.updateSet("set1", "u1", {
        reps: 10,
        weightKg: "60.00" as any,
        rpe: 8,
      });

      expect(result).toEqual(mockSet);
      expect(mockDb.update).toHaveBeenCalledTimes(1);
    });

    it("returns null when the join filters everything out (set doesn't exist or wrong user)", async () => {
      // Empty returning() — covers both "no such set" and "set exists
      // but session belongs to another user" since a single mutation
      // is now the only round-trip.
      const mockDb = {
        // The TOCTOU-safe updateSet/deleteSet use a correlated
        // subquery inside their WHERE: `db.select({...}).from(...)
        // .innerJoin(...).where(...)`. The subquery is passed as a
        // value to inArray() — Drizzle never AWAITS it (Postgres
        // executes it server-side), so the mock can return any chain
        // stub that supports the dotted method calls; the actual
        // filtering happens at the SQL layer in production.
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({}),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue(makeUpdateChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SessionRepository } = await import("../sessionRepository");
      const repo = new SessionRepository();
      const result = await repo.updateSet("set1", "u1", { reps: 10 });

      expect(result).toBeNull();
    });
  });

  describe("deleteSet", () => {
    it("deletes the set in a single round-trip when the join matches", async () => {
      const mockSet = {
        id: "set1",
        sessionExerciseId: "se1",
        reps: 10,
        weightKg: "50.00" as any,
        durationSeconds: null,
        distanceMeters: null,
        restAfterSeconds: 90,
        setNumber: 1,
        rpe: null,
        isPersonalRecord: false,
        isCompleted: false,
        completedAt: null,
        createdAt: new Date(),
      };

      const mockDb = {
        // The TOCTOU-safe updateSet/deleteSet use a correlated
        // subquery inside their WHERE: `db.select({...}).from(...)
        // .innerJoin(...).where(...)`. The subquery is passed as a
        // value to inArray() — Drizzle never AWAITS it (Postgres
        // executes it server-side), so the mock can return any chain
        // stub that supports the dotted method calls; the actual
        // filtering happens at the SQL layer in production.
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({}),
            }),
          }),
        }),
        delete: vi.fn().mockReturnValue(makeDeleteChain([mockSet])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SessionRepository } = await import("../sessionRepository");
      const repo = new SessionRepository();
      const result = await repo.deleteSet("set1", "u1");

      expect(result).toBe(true);
      expect(mockDb.delete).toHaveBeenCalledTimes(1);
    });

    it("returns false when the join filters everything out (set doesn't exist or wrong user)", async () => {
      const mockDb = {
        // The TOCTOU-safe updateSet/deleteSet use a correlated
        // subquery inside their WHERE: `db.select({...}).from(...)
        // .innerJoin(...).where(...)`. The subquery is passed as a
        // value to inArray() — Drizzle never AWAITS it (Postgres
        // executes it server-side), so the mock can return any chain
        // stub that supports the dotted method calls; the actual
        // filtering happens at the SQL layer in production.
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({}),
            }),
          }),
        }),
        delete: vi.fn().mockReturnValue(makeDeleteChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { SessionRepository } = await import("../sessionRepository");
      const repo = new SessionRepository();
      const result = await repo.deleteSet("set1", "u1");

      expect(result).toBe(false);
    });
  });
});
