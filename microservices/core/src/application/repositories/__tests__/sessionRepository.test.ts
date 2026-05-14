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

  // BACKEND_BRIEF § 7 step 5: after the bulk insert + PR detection,
  // re-fetch the full session inside the same tx so the response
  // reflects post-detection state (is_personal_record flags).
  describe("recordSession", () => {
    /**
     * Build a tx mock that simulates Postgres flipping
     * is_personal_record on the persisted set during PR detection.
     * Step 2 inserts return only id refs (no isPersonalRecord); step
     * 4's SELECTs are the canonical source of truth, so we wire the
     * SELECT chain to return the post-PR-detection rows.
     */
    function makeRecordSessionTx(
      refreshed: {
        session: any;
        exercises: any[];
        sets: any[];
      },
      options: {
        workoutsThisMonth?: number;
        /**
         * Captures the COUNT(*) chain's `.where(...)` argument so a
         * caller can introspect the filter (e.g. that a
         * `date_trunc('month', now())` SQL fragment is present).
         * Drizzle's `and(...)` returns a `SQL` object whose
         * stringified form contains the fragments we care about.
         */
        captureCountWhere?: (arg: unknown) => void;
      } = {},
    ) {
      const tx = {
        insert: vi.fn().mockImplementation(() => {
          const chain: any = {
            values: vi.fn().mockImplementation(() => {
              // Two insert shapes inside recordSession:
              //   - workoutSessions  (returning() → [session])
              //   - sessionExercises (returning({ id }) → [{ id }])
              //   - exerciseSets     (no returning() — just resolves)
              return {
                returning: vi.fn().mockImplementation((selection?: any) => {
                  if (selection && "id" in selection) {
                    return Promise.resolve([{ id: refreshed.exercises[0].id }]);
                  }
                  return Promise.resolve([refreshed.session]);
                }),
                // exerciseSets insert call has no .returning() chain;
                // tx.insert(...).values(...) is awaited directly.
                then: (resolve: (v: unknown) => unknown) =>
                  Promise.resolve(undefined).then(resolve),
              };
            }),
          };
          return chain;
        }),
        // Four select calls in steps 4 + 5: refreshedSession,
        // exercises, sets, then the COUNT(*) for
        // workoutsThisMonth. Drive them off a queue.
        select: vi
          .fn()
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([refreshed.session]),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValue(refreshed.exercises),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValue(refreshed.sets),
              }),
            }),
          })
          // Step 5 — COUNT(*) for workoutsThisMonth. Chain shape
          // is `.select(...).from(...).where(...)` (no orderBy/limit).
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockImplementation((arg: unknown) => {
                options.captureCountWhere?.(arg);
                return Promise.resolve([
                  { count: options.workoutsThisMonth ?? 0 },
                ]);
              }),
            }),
          }),
      };
      return tx;
    }

    const payload = {
      workoutId: "w1",
      name: "Push Day",
      startedAt: "2026-05-04T10:00:00.000Z",
      completedAt: "2026-05-04T11:00:00.000Z",
      status: "completed" as const,
      totalDurationSeconds: 3600,
      exercises: [
        {
          exerciseId: "ex-1",
          sortOrder: 1,
          sets: [
            {
              setNumber: 1,
              reps: 5,
              weightKg: 100,
              isCompleted: true,
              completedAt: "2026-05-04T10:05:00.000Z",
            },
          ],
        },
      ],
    };

    it("returns the post-PR-detection isPersonalRecord flag (re-fetches inside tx)", async () => {
      const refreshed = {
        session: {
          id: "s1",
          userId: "u1",
          workoutId: "w1",
          name: "Push Day",
          status: "completed",
          startedAt: new Date(),
          completedAt: new Date(),
          createdAt: new Date(),
        },
        exercises: [
          {
            id: "se1",
            sessionId: "s1",
            exerciseId: "ex-1",
            sortOrder: 1,
            supersetGroup: null,
            isSubstituted: false,
            originalExerciseId: null,
            notes: null,
            createdAt: new Date(),
          },
        ],
        // Post-PR-detection: the canonical PR set has isPersonalRecord
        // = true. The bare insert .returning() snapshot would have had
        // false; if the repo returned that pre-detection snapshot the
        // bugbot finding would still fire.
        sets: [
          {
            id: "set1",
            sessionExerciseId: "se1",
            setNumber: 1,
            reps: 5,
            weightKg: "100.00",
            isCompleted: true,
            isPersonalRecord: true,
            completedAt: new Date(),
            createdAt: new Date(),
          },
        ],
      };

      const tx = makeRecordSessionTx(refreshed, {
        workoutsThisMonth: 7,
      });
      const mockDb = {
        transaction: vi
          .fn()
          .mockImplementation((cb: (t: any) => any) => cb(tx)),
      };
      (getDb as any).mockReturnValue(mockDb);

      // runPRDetection now returns the list of surfaced PRs. The test
      // pipes through a fixture — the repo just splices it into the
      // response.
      const detectedPRs = [
        {
          exerciseId: "ex-1",
          exerciseName: "Bench Press",
          recordType: "1rm" as const,
          newValue: 126.67,
          previousValue: 110,
          setId: "set1",
        },
      ];
      const runPRDetection = vi.fn().mockResolvedValue(detectedPRs);

      const { SessionRepository } = await import("../sessionRepository");
      const repo = new SessionRepository();
      const result = await repo.recordSession("u1", payload, runPRDetection);

      expect(runPRDetection).toHaveBeenCalledWith("u1", "s1", tx);
      expect(result.exercises[0]?.sets[0]?.isPersonalRecord).toBe(true);
      // The response should also reflect any other state the canonical
      // table holds — id, weight, etc. — pulled via the re-fetch, not
      // the insert snapshot.
      expect(result.exercises[0]?.sets[0]?.id).toBe("set1");
      // New augmented fields:
      expect(result.personalRecords).toEqual(detectedPRs);
      expect(result.workoutsThisMonth).toBe(7);
    });

    it("workoutsThisMonth reflects the COUNT(*) result; an empty PR list passes through cleanly (first-session)", async () => {
      // First-session path: every candidate was first-occurrence so
      // runPRDetection returns an empty list. The repo must NOT
      // synthesise PRs — Brad's rule is "no PRs on the first workout."
      // workoutsThisMonth is 1 (just this session).
      const refreshed = {
        session: {
          id: "s2",
          userId: "u1",
          workoutId: null,
          name: "First Workout",
          status: "completed",
          startedAt: new Date(),
          completedAt: new Date(),
          createdAt: new Date(),
        },
        exercises: [
          {
            id: "se2",
            sessionId: "s2",
            exerciseId: "ex-1",
            sortOrder: 1,
            supersetGroup: null,
            isSubstituted: false,
            originalExerciseId: null,
            notes: null,
            createdAt: new Date(),
          },
        ],
        sets: [
          {
            id: "set2",
            sessionExerciseId: "se2",
            setNumber: 1,
            reps: 8,
            weightKg: "100.00",
            isCompleted: true,
            isPersonalRecord: true, // canonical-best holder
            completedAt: new Date(),
            createdAt: new Date(),
          },
        ],
      };

      const tx = makeRecordSessionTx(refreshed, {
        workoutsThisMonth: 1,
      });
      const mockDb = {
        transaction: vi
          .fn()
          .mockImplementation((cb: (t: any) => any) => cb(tx)),
      };
      (getDb as any).mockReturnValue(mockDb);

      // First-occurrence: detection ran but surfaced no PRs.
      const runPRDetection = vi.fn().mockResolvedValue([]);

      const { SessionRepository } = await import("../sessionRepository");
      const repo = new SessionRepository();
      const result = await repo.recordSession("u1", payload, runPRDetection);

      expect(result.personalRecords).toEqual([]);
      expect(result.workoutsThisMonth).toBe(1);
    });

    it("skips PR detection when status is cancelled (legacy recordWorkout parity)", async () => {
      const refreshed = {
        session: {
          id: "s1",
          userId: "u1",
          workoutId: "w1",
          name: "Discarded",
          status: "cancelled",
          startedAt: new Date(),
          completedAt: null,
          createdAt: new Date(),
        },
        exercises: [
          {
            id: "se1",
            sessionId: "s1",
            exerciseId: "ex-1",
            sortOrder: 1,
            supersetGroup: null,
            isSubstituted: false,
            originalExerciseId: null,
            notes: null,
            createdAt: new Date(),
          },
        ],
        sets: [
          {
            id: "set1",
            sessionExerciseId: "se1",
            setNumber: 1,
            reps: 5,
            weightKg: "100.00",
            isCompleted: false,
            isPersonalRecord: false,
            completedAt: null,
            createdAt: new Date(),
          },
        ],
      };

      // Cancelled session also has 0 contribution to the
      // workoutsThisMonth count (the WHERE filter excludes it).
      const tx = makeRecordSessionTx(refreshed, {
        workoutsThisMonth: 4,
      });
      const mockDb = {
        transaction: vi
          .fn()
          .mockImplementation((cb: (t: any) => any) => cb(tx)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const runPRDetection = vi.fn().mockResolvedValue([]);

      const { SessionRepository } = await import("../sessionRepository");
      const repo = new SessionRepository();
      const result = await repo.recordSession(
        "u1",
        { ...payload, status: "cancelled", completedAt: null },
        runPRDetection,
      );

      expect(runPRDetection).not.toHaveBeenCalled();
      expect(result.exercises[0]?.sets[0]?.isPersonalRecord).toBe(false);
      // Cancelled session still gets the augmented fields — PRs are
      // empty (detection didn't run), workoutsThisMonth carries the
      // user's current-month completed count (which doesn't include
      // this cancelled one because the WHERE filters on status).
      expect(result.personalRecords).toEqual([]);
      expect(result.workoutsThisMonth).toBe(4);
    });

    it("scopes the workoutsThisMonth COUNT(*) to status='completed' AND COALESCE(completed_at, created_at) >= date_trunc('month', now())", async () => {
      // Regression guard: this is what makes the tile actually
      // surface a number that resets monthly. If someone reverts the
      // WHERE to the cumulative-all-time form, this test fails. We
      // can't validate the SQL at execution time without a real DB,
      // so we introspect the SQL object Drizzle hands to `.where()` —
      // stringified, it contains the `date_trunc('month', now())`
      // fragment from the inline `sql\`…\`` template.
      const refreshed = {
        session: {
          id: "s-scope",
          userId: "u1",
          workoutId: null,
          name: "Scope check",
          status: "completed",
          startedAt: new Date(),
          completedAt: new Date(),
          createdAt: new Date(),
        },
        exercises: [
          {
            id: "se-scope",
            sessionId: "s-scope",
            exerciseId: "ex-1",
            sortOrder: 1,
            supersetGroup: null,
            isSubstituted: false,
            originalExerciseId: null,
            notes: null,
            createdAt: new Date(),
          },
        ],
        sets: [
          {
            id: "set-scope",
            sessionExerciseId: "se-scope",
            setNumber: 1,
            reps: 5,
            weightKg: "100.00",
            isCompleted: true,
            isPersonalRecord: false,
            completedAt: new Date(),
            createdAt: new Date(),
          },
        ],
      };

      let capturedWhere: unknown = null;
      const tx = makeRecordSessionTx(refreshed, {
        workoutsThisMonth: 2,
        captureCountWhere: (arg) => {
          capturedWhere = arg;
        },
      });
      const mockDb = {
        transaction: vi
          .fn()
          .mockImplementation((cb: (t: any) => any) => cb(tx)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const runPRDetection = vi.fn().mockResolvedValue([]);

      const { SessionRepository } = await import("../sessionRepository");
      const repo = new SessionRepository();
      await repo.recordSession("u1", payload, runPRDetection);

      // The SQL object Drizzle composes wraps the inline `sql\`…\``
      // fragment as a string chunk inside its `queryChunks` array.
      // PgTable / PgColumn references are circular (table → column →
      // table), so JSON.stringify trips; walk manually with a cycle
      // guard, collecting every primitive string we encounter.
      function collectStrings(value: unknown, seen = new WeakSet()): string[] {
        if (value == null) return [];
        if (typeof value === "string") return [value];
        if (typeof value !== "object") return [];
        if (seen.has(value as object)) return [];
        seen.add(value as object);
        const out: string[] = [];
        if (Array.isArray(value)) {
          for (const v of value) out.push(...collectStrings(v, seen));
        } else {
          for (const v of Object.values(value as Record<string, unknown>)) {
            out.push(...collectStrings(v, seen));
          }
        }
        return out;
      }
      const fragments = collectStrings(capturedWhere);
      expect(
        fragments.some((s) => s.includes("date_trunc('month', now())")),
      ).toBe(true);
      // `COALESCE(completed_at, created_at)` is what catches legacy
      // rows with NULL completed_at AND keeps the just-inserted
      // session in scope when a caller posts `{ status: "completed",
      // completedAt: null }` (the wire-schema permits it). If
      // someone later reverts to a plain `completed_at >= …` the
      // fragment audit fails.
      expect(fragments.some((s) => s.includes("COALESCE"))).toBe(true);
    });

    it("coalesces completedAt to now() when status='completed' but the payload omits it (contract guard)", async () => {
      // Wire schema allows `{ status: "completed", completedAt:
      // null }` (handler's body validation marks completedAt as
      // Optional). Without the repo-level coalesce, the inserted
      // row carries completed_at=NULL — which the new
      // workoutsThisMonth WHERE (filtering on completed_at) would
      // silently drop from the count. The COALESCE(completed_at,
      // created_at) fallback inside the WHERE keeps such rows in
      // scope as a belt-and-braces guard for legacy data, but
      // fresh writes from this repo should never produce that
      // NULL in the first place — assert the insert path
      // substitutes now() so the row's completed_at is set.
      const refreshed = {
        session: {
          id: "s-coalesce",
          userId: "u1",
          workoutId: null,
          name: "Test",
          status: "completed",
          startedAt: new Date(),
          completedAt: new Date(), // post-coalesce DB state
          createdAt: new Date(),
        },
        exercises: [
          {
            id: "se-coalesce",
            sessionId: "s-coalesce",
            exerciseId: "ex-1",
            sortOrder: 1,
            supersetGroup: null,
            isSubstituted: false,
            originalExerciseId: null,
            notes: null,
            createdAt: new Date(),
          },
        ],
        sets: [
          {
            id: "set-coalesce",
            sessionExerciseId: "se-coalesce",
            setNumber: 1,
            reps: 5,
            weightKg: "100.00",
            isCompleted: true,
            isPersonalRecord: false,
            completedAt: new Date(),
            createdAt: new Date(),
          },
        ],
      };

      // Capture the values passed to the workoutSessions insert.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let capturedValues: any = null;
      const tx = makeRecordSessionTx(refreshed, { workoutsThisMonth: 1 });
      // Override insert to intercept the values object on the first
      // insert call (the workoutSessions root insert).
      const insertCallValues: Array<Record<string, unknown>> = [];
      tx.insert = vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation((v: Record<string, unknown>) => {
          insertCallValues.push(v);
          if (insertCallValues.length === 1) capturedValues = v;
          return {
            returning: vi.fn().mockImplementation((selection?: any) => {
              if (selection && "id" in selection) {
                return Promise.resolve([{ id: refreshed.exercises[0].id }]);
              }
              return Promise.resolve([refreshed.session]);
            }),
            then: (resolve: (v: unknown) => unknown) =>
              Promise.resolve(undefined).then(resolve),
          };
        }),
      }));
      const mockDb = {
        transaction: vi
          .fn()
          .mockImplementation((cb: (t: any) => any) => cb(tx)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const runPRDetection = vi.fn().mockResolvedValue([]);
      const { SessionRepository } = await import("../sessionRepository");
      const repo = new SessionRepository();

      // Payload: completed status, but completedAt omitted (the wire
      // schema permits this).
      const payloadWithoutCompletedAt = {
        ...payload,
        status: "completed" as const,
        completedAt: null,
      };

      const before = Date.now();
      await repo.recordSession("u1", payloadWithoutCompletedAt, runPRDetection);
      const after = Date.now();

      // Repo substituted now() — the inserted completedAt must be a
      // Date within the test execution window.
      expect(capturedValues?.completedAt).toBeInstanceOf(Date);
      const insertedAt = (capturedValues?.completedAt as Date).getTime();
      expect(insertedAt).toBeGreaterThanOrEqual(before);
      expect(insertedAt).toBeLessThanOrEqual(after);
    });

    it("preserves completedAt=null when status='cancelled' (cancelled sessions are not finished workouts)", async () => {
      // The coalesce only fires for `status='completed'`. A
      // cancelled session legitimately has no completed_at — it's a
      // discarded workout, not a finished one — and the column
      // should stay NULL.
      const refreshed = {
        session: {
          id: "s-cancelled",
          userId: "u1",
          workoutId: null,
          name: "Discarded",
          status: "cancelled",
          startedAt: new Date(),
          completedAt: null,
          createdAt: new Date(),
        },
        exercises: [
          {
            id: "se-c",
            sessionId: "s-cancelled",
            exerciseId: "ex-1",
            sortOrder: 1,
            supersetGroup: null,
            isSubstituted: false,
            originalExerciseId: null,
            notes: null,
            createdAt: new Date(),
          },
        ],
        sets: [],
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let capturedValues: any = null;
      const tx = makeRecordSessionTx(refreshed, { workoutsThisMonth: 0 });
      const insertCallValues: Array<Record<string, unknown>> = [];
      tx.insert = vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation((v: Record<string, unknown>) => {
          insertCallValues.push(v);
          if (insertCallValues.length === 1) capturedValues = v;
          return {
            returning: vi.fn().mockImplementation((selection?: any) => {
              if (selection && "id" in selection) {
                return Promise.resolve([{ id: refreshed.exercises[0].id }]);
              }
              return Promise.resolve([refreshed.session]);
            }),
            then: (resolve: (v: unknown) => unknown) =>
              Promise.resolve(undefined).then(resolve),
          };
        }),
      }));
      const mockDb = {
        transaction: vi
          .fn()
          .mockImplementation((cb: (t: any) => any) => cb(tx)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const runPRDetection = vi.fn().mockResolvedValue([]);
      const { SessionRepository } = await import("../sessionRepository");
      const repo = new SessionRepository();

      await repo.recordSession(
        "u1",
        { ...payload, status: "cancelled", completedAt: null },
        runPRDetection,
      );

      expect(capturedValues?.completedAt).toBeNull();
    });
  });
});
