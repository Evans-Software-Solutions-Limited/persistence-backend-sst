/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

/**
 * Build a chained-mock that resolves to `resolvedValue` from a typical
 * Drizzle select chain: `.from(...).where(...).orderBy(...).limit(...).offset(...)`.
 * Tail call awaits the offset result.
 */
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

/**
 * Select chain with two innerJoins, awaited at the where:
 * `db.select(...).from(...).innerJoin(...).innerJoin(...).where(...)` → resolved value.
 * Used by the "load completed sets" query that joins through both
 * session_exercises and workout_sessions to enforce userId scope.
 */
function makeDoubleJoinSelectChain(resolvedValue: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(resolvedValue),
        }),
      }),
    }),
  };
}

/**
 * Select chain with one innerJoin and a where, used as the
 * `inArray` subquery for the demote / promote scope. Drizzle never
 * awaits this in the host process — Postgres executes it server-side
 * — so the chain just needs to exist; the resolved value is unused.
 */
function makeSingleJoinSubquery() {
  const chain: any = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return chain;
}

/** select chain used by the canonical-PR query (no joins, single where) */
function makeWhereSelectChain(resolvedValue: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(resolvedValue),
    }),
  };
}

function makeUpsertChain() {
  return {
    values: vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    }),
  };
}

function makeUpdateChain() {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  };
}

describe("PersonalRecordsRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("list", () => {
    it("returns the user's PRs ordered by achievedAt desc", async () => {
      const mockPR = {
        id: "pr-1",
        userId: "u1",
        exerciseId: "ex-1",
        recordType: "1rm",
        value: "120.50",
        setId: "set-1",
        achievedAt: new Date(),
      };
      const mockDb = {
        select: vi.fn().mockReturnValue(makeListChain([mockPR])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { PersonalRecordsRepository } =
        await import("../personalRecordsRepository");
      const repo = new PersonalRecordsRepository();
      const result = await repo.list("u1");

      expect(result).toEqual([mockPR]);
    });

    it("forwards exerciseId + recordType filters", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue(makeListChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { PersonalRecordsRepository } =
        await import("../personalRecordsRepository");
      const repo = new PersonalRecordsRepository();
      await repo.list("u1", { exerciseId: "ex-42", recordType: "1rm" });

      // The where clause receives an `and(...)` of three predicates
      // (userId + exerciseId + recordType). The mock chain accepts
      // anything; verifying that select was called once is the most
      // surgical check we can do without re-implementing the query.
      expect(mockDb.select).toHaveBeenCalledTimes(1);
    });
  });

  describe("recordPRsForSession", () => {
    /** A canonical fixture for "session 2 has one set that beats session 1's PR". */
    function buildBugbotFixture() {
      return {
        userId: "u1",
        sessionId: "session-2",
        // Sets in session-2 (the one being completed). One set, exerciseId
        // matches the existing PR's exercise.
        completedSets: [
          {
            setId: "set-2-new-winner",
            exerciseId: "exercise-1",
            weightKg: "120.00",
            reps: 5,
          },
        ],
        // After upsert, personal_records points at the new winner.
        canonicalPRs: [{ setId: "set-2-new-winner" }],
      };
    }

    it("demotes is_personal_record on superseded sets from earlier sessions", async () => {
      const fx = buildBugbotFixture();

      // Capture the second db.update().set(...) call (the demote step).
      const demoteSetCalls: Array<Record<string, unknown>> = [];
      const promoteSetCalls: Array<Record<string, unknown>> = [];

      const mockDb = {
        select: vi
          .fn()
          // 1st select: load completed sets joined through session_exercises + workout_sessions
          .mockReturnValueOnce(makeDoubleJoinSelectChain(fx.completedSets))
          // 2nd select: canonical PRs for the touched exercises
          .mockReturnValueOnce(makeWhereSelectChain(fx.canonicalPRs))
          // 3rd select: subquery for userSessionExerciseIdsScope (used as a
          // value inside inArray; Drizzle never awaits it host-side, but
          // the .from(...).innerJoin(...).where(...) chain is invoked).
          .mockReturnValueOnce(makeSingleJoinSubquery()),
        insert: vi.fn().mockReturnValue(makeUpsertChain()),
        update: vi.fn().mockImplementation(() => {
          // Track each update call's `set(...)` argument so we can
          // assert demote {isPersonalRecord: false} fires before
          // promote {isPersonalRecord: true}.
          return {
            set: vi
              .fn()
              .mockImplementation((value: Record<string, unknown>) => {
                if (value.isPersonalRecord === false) {
                  demoteSetCalls.push(value);
                } else if (value.isPersonalRecord === true) {
                  promoteSetCalls.push(value);
                }
                return { where: vi.fn().mockResolvedValue(undefined) };
              }),
          };
        }),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { PersonalRecordsRepository } =
        await import("../personalRecordsRepository");
      const repo = new PersonalRecordsRepository();
      await repo.recordPRsForSession(fx.userId, fx.sessionId);

      // Demote step ran: cleared is_personal_record = false somewhere.
      expect(demoteSetCalls).toHaveLength(1);
      expect(demoteSetCalls[0]).toEqual({ isPersonalRecord: false });

      // Promote step ran: flagged is_personal_record = true on the
      // canonical PR setId.
      expect(promoteSetCalls).toHaveLength(1);
      expect(promoteSetCalls[0]).toEqual({ isPersonalRecord: true });
    });

    it("does NOT touch exercise_sets when the session has no completed sets", async () => {
      const mockDb = {
        select: vi
          .fn()
          // Empty completedSets — the early return kicks in before any
          // canonical-PR query or update fires.
          .mockReturnValueOnce(makeDoubleJoinSelectChain([])),
        update: vi.fn(),
        insert: vi.fn(),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { PersonalRecordsRepository } =
        await import("../personalRecordsRepository");
      const repo = new PersonalRecordsRepository();
      await repo.recordPRsForSession("u1", "session-empty");

      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("skips sets without weight or reps when computing Epley 1RM", async () => {
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(
            makeDoubleJoinSelectChain([
              // Bodyweight set (weightKg null) — must be skipped.
              {
                setId: "bw-set",
                exerciseId: "exercise-pullups",
                weightKg: null,
                reps: 10,
              },
              // Timed set (reps null) — must be skipped.
              {
                setId: "timed-set",
                exerciseId: "exercise-plank",
                weightKg: "0",
                reps: null,
              },
              // Zero-rep — must be skipped.
              {
                setId: "zero-set",
                exerciseId: "exercise-1",
                weightKg: "100.00",
                reps: 0,
              },
            ]),
          )
          .mockReturnValueOnce(makeWhereSelectChain([]))
          .mockReturnValueOnce(makeSingleJoinSubquery()),
        insert: vi.fn().mockReturnValue(makeUpsertChain()),
        update: vi.fn().mockReturnValue(makeUpdateChain()),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { PersonalRecordsRepository } =
        await import("../personalRecordsRepository");
      const repo = new PersonalRecordsRepository();
      await repo.recordPRsForSession("u1", "session-bw");

      // No upsert — every candidate skipped via the `continue` branches.
      expect(mockDb.insert).not.toHaveBeenCalled();
      // Demote/promote queries still run (touchedExerciseIds is non-empty,
      // even though no set qualified for the upsert) — that's correct
      // behaviour: re-syncing flags is cheap and idempotent.
      expect(mockDb.update).toHaveBeenCalled();
    });
  });
});
