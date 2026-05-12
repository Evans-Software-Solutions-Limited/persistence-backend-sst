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
          // 2nd select: existing personal_records for prior-value capture
          // (first-occurrence vs improvement partition). Empty → all
          // candidates are first occurrences for this test fixture.
          .mockReturnValueOnce(makeWhereSelectChain([]))
          // 3rd select: canonical PRs for the touched exercises
          .mockReturnValueOnce(makeWhereSelectChain(fx.canonicalPRs))
          // 4th select: subquery for userSessionExerciseIdsScope (used as a
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
          // No existingPRs SELECT here — bestPerKey ends up empty
          // because every candidate was filtered out, so the pre-
          // SELECT for prior values is skipped entirely.
          .mockReturnValueOnce(makeWhereSelectChain([]))
          .mockReturnValueOnce(makeSingleJoinSubquery()),
        insert: vi.fn().mockReturnValue(makeUpsertChain()),
        update: vi.fn().mockReturnValue(makeUpdateChain()),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { PersonalRecordsRepository } =
        await import("../personalRecordsRepository");
      const repo = new PersonalRecordsRepository();
      const result = await repo.recordPRsForSession("u1", "session-bw");

      // No upsert — every candidate skipped via the `continue` branches.
      expect(mockDb.insert).not.toHaveBeenCalled();
      // Demote/promote queries still run (touchedExerciseIds is non-empty,
      // even though no set qualified for the upsert) — that's correct
      // behaviour: re-syncing flags is cheap and idempotent.
      expect(mockDb.update).toHaveBeenCalled();
      // No PRs surfaced — every candidate was filtered before
      // partition.
      expect(result).toEqual([]);
    });

    it("returns an empty list (no exerciseName lookup) when every candidate is first-occurrence — Brad's first-workout rule", async () => {
      // One valid set, no prior `personal_records` rows. All 3
      // candidate types (1rm / max_weight / max_volume) hit the
      // first-occurrence branch: they INSERT into personal_records
      // (so future sessions have a baseline) but DO NOT surface in
      // the returned PR list. Result: `detected` is empty, the
      // exerciseName lookup short-circuits, demote/promote still
      // re-sync flags.
      const completedSets = [
        {
          setId: "set-first-ever",
          exerciseId: "exercise-bench",
          weightKg: "100.00",
          reps: 8,
        },
      ];
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeDoubleJoinSelectChain(completedSets))
          // No prior records — empty list. Triggers the first-occurrence
          // branch on every candidate.
          .mockReturnValueOnce(makeWhereSelectChain([]))
          .mockReturnValueOnce(
            makeWhereSelectChain([{ setId: "set-first-ever" }]),
          )
          .mockReturnValueOnce(makeSingleJoinSubquery()),
        insert: vi.fn().mockReturnValue(makeUpsertChain()),
        update: vi.fn().mockReturnValue(makeUpdateChain()),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { PersonalRecordsRepository } =
        await import("../personalRecordsRepository");
      const repo = new PersonalRecordsRepository();
      const result = await repo.recordPRsForSession("u1", "session-first");

      expect(result).toEqual([]);
      // 3 upserts fired (one per candidate type) — the personal_records
      // table is still populated for future sessions to compare against.
      expect(mockDb.insert).toHaveBeenCalledTimes(3);
      // The exerciseName lookup is skipped — `select` only fires for
      // the four steps above (completedSets, existingPRs, canonicalPRs,
      // userSessionExerciseIdsScope). No 5th call.
      expect(mockDb.select).toHaveBeenCalledTimes(4);
    });

    it("returns PRs with previousValue for each computed record type that beat its prior (1rm + max_weight + max_volume)", async () => {
      // One set that beats prior values on ALL three record types.
      // Prior bench PRs: 1rm=110, max_weight=90, max_volume=400.
      // New set: 100 kg × 8 reps → 1rm ≈ 126.67, max_weight=100,
      // max_volume=800. All three improve → all three surface.
      const completedSets = [
        {
          setId: "set-improvement",
          exerciseId: "exercise-bench",
          weightKg: "100.00",
          reps: 8,
        },
      ];
      const priorRecords = [
        {
          exerciseId: "exercise-bench",
          recordType: "1rm",
          value: "110.00",
        },
        {
          exerciseId: "exercise-bench",
          recordType: "max_weight",
          value: "90.00",
        },
        {
          exerciseId: "exercise-bench",
          recordType: "max_volume",
          value: "400.00",
        },
      ];
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeDoubleJoinSelectChain(completedSets))
          .mockReturnValueOnce(makeWhereSelectChain(priorRecords))
          .mockReturnValueOnce(
            makeWhereSelectChain([{ setId: "set-improvement" }]),
          )
          .mockReturnValueOnce(makeSingleJoinSubquery())
          // 5th select: exerciseName denormalisation lookup
          .mockReturnValueOnce(
            makeWhereSelectChain([
              { id: "exercise-bench", name: "Bench Press" },
            ]),
          ),
        insert: vi.fn().mockReturnValue(makeUpsertChain()),
        update: vi.fn().mockReturnValue(makeUpdateChain()),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { PersonalRecordsRepository } =
        await import("../personalRecordsRepository");
      const repo = new PersonalRecordsRepository();
      const result = await repo.recordPRsForSession("u1", "session-improve");

      expect(result).toHaveLength(3);
      // 1rm: Epley = 100 × (1 + 8/30) = 126.666...
      const rm = result.find((r) => r.recordType === "1rm");
      expect(rm?.previousValue).toBe(110);
      expect(rm?.newValue).toBeCloseTo(126.667, 2);
      expect(rm?.exerciseName).toBe("Bench Press");
      // max_weight: 100 kg
      const mw = result.find((r) => r.recordType === "max_weight");
      expect(mw?.previousValue).toBe(90);
      expect(mw?.newValue).toBe(100);
      expect(mw?.exerciseName).toBe("Bench Press");
      // max_volume: 100 × 8 = 800
      const mv = result.find((r) => r.recordType === "max_volume");
      expect(mv?.previousValue).toBe(400);
      expect(mv?.newValue).toBe(800);
      expect(mv?.exerciseName).toBe("Bench Press");
    });

    it("does NOT surface a phantom PR when an identical workout re-runs (float-vs-2dp precision parity — Inspector Brad regression)", async () => {
      // Exactly the bug Inspector Brad flagged on PR #61.
      // Session 1 logged 100 kg × 10 reps → Epley 1RM = 100 × (1 +
      // 10/30) = 133.33333333333334. The DB stored that as "133.33"
      // (numeric(10,2)). Session 2 runs the same lift again.
      //
      // Pre-fix: the JS partition compared the full float
      //   candidate.value (133.33333…) > prior parseFloat("133.33")
      //   (133.33) → true → phantom PR pushed
      // while the DB's `WHERE personal_records.value <
      // excluded.value` saw 133.33 < 133.33 → false → no-op upsert.
      // The Summary screen would show "PR! 133.33 → 133.33" for an
      // identical workout, and the response's setId wouldn't match
      // what `personal_records.setId` actually holds.
      //
      // Fix: round-trip `candidate.value` through `toFixed(2) →
      // parseFloat` so the JS comparison uses the same precision the
      // DB stores — both sides see 133.33 == 133.33 → no PR
      // surfaces. Also hits reps = 1/4/7/10/13/16/19/22/25/28 (the
      // .333… reps/30 family) and any max_volume value with float-
      // multiplication artefacts (e.g. 99.99 × 10 = 999.9000000000001).
      const completedSets = [
        {
          setId: "set-session-2",
          exerciseId: "exercise-bench",
          weightKg: "100.00",
          reps: 10,
        },
      ];
      // Prior `personal_records` row from session 1 — stored at 2dp.
      const priorRecords = [
        {
          exerciseId: "exercise-bench",
          recordType: "1rm",
          value: "133.33",
        },
        {
          exerciseId: "exercise-bench",
          recordType: "max_weight",
          value: "100.00",
        },
        {
          exerciseId: "exercise-bench",
          recordType: "max_volume",
          value: "1000.00",
        },
      ];
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeDoubleJoinSelectChain(completedSets))
          .mockReturnValueOnce(makeWhereSelectChain(priorRecords))
          .mockReturnValueOnce(
            makeWhereSelectChain([{ setId: "set-session-1" }]),
          )
          .mockReturnValueOnce(makeSingleJoinSubquery()),
        // No 5th select: detected is empty → exerciseName lookup
        // short-circuits.
        insert: vi.fn().mockReturnValue(makeUpsertChain()),
        update: vi.fn().mockReturnValue(makeUpdateChain()),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { PersonalRecordsRepository } =
        await import("../personalRecordsRepository");
      const repo = new PersonalRecordsRepository();
      const result = await repo.recordPRsForSession("u1", "session-2");

      // No phantom PRs.
      expect(result).toEqual([]);
      // No exerciseName lookup — the early-return saved a round trip.
      expect(mockDb.select).toHaveBeenCalledTimes(4);
    });

    it("rounds newValue to 2dp in the response so the rendered number matches what the DB persisted", async () => {
      // 100 kg × 11 reps = 136.66666… → "136.67" stored. Prior was
      // 130.00 (genuine improvement). The response's newValue MUST be
      // the 2dp-rounded 136.67, not the raw float 136.66666…, so
      // mobile renders the same number the server actually has.
      const completedSets = [
        {
          setId: "set-real-pr",
          exerciseId: "exercise-bench",
          weightKg: "100.00",
          reps: 11,
        },
      ];
      const priorRecords = [
        {
          exerciseId: "exercise-bench",
          recordType: "1rm",
          value: "130.00",
        },
      ];
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeDoubleJoinSelectChain(completedSets))
          .mockReturnValueOnce(makeWhereSelectChain(priorRecords))
          .mockReturnValueOnce(makeWhereSelectChain([{ setId: "set-real-pr" }]))
          .mockReturnValueOnce(makeSingleJoinSubquery())
          .mockReturnValueOnce(
            makeWhereSelectChain([
              { id: "exercise-bench", name: "Bench Press" },
            ]),
          ),
        insert: vi.fn().mockReturnValue(makeUpsertChain()),
        update: vi.fn().mockReturnValue(makeUpdateChain()),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { PersonalRecordsRepository } =
        await import("../personalRecordsRepository");
      const repo = new PersonalRecordsRepository();
      const result = await repo.recordPRsForSession("u1", "session-real");

      expect(result).toHaveLength(1);
      const rm = result[0];
      expect(rm?.recordType).toBe("1rm");
      expect(rm?.previousValue).toBe(130);
      // Exactly 136.67, NOT 136.66666666666666.
      expect(rm?.newValue).toBe(136.67);
    });

    it("skips an individual record-type PR when the prior value isn't beaten (per-type partition, not all-or-nothing)", async () => {
      // 100 kg × 8 reps. Prior 1rm=200 (way above Epley 126.67 → not
      // beaten → no PR), prior max_weight=50 (beaten by 100 → PR),
      // prior max_volume=900 (above 800 → not beaten → no PR).
      // Exactly ONE PR surfaces: max_weight.
      const completedSets = [
        {
          setId: "set-mixed",
          exerciseId: "exercise-bench",
          weightKg: "100.00",
          reps: 8,
        },
      ];
      const priorRecords = [
        {
          exerciseId: "exercise-bench",
          recordType: "1rm",
          value: "200.00",
        },
        {
          exerciseId: "exercise-bench",
          recordType: "max_weight",
          value: "50.00",
        },
        {
          exerciseId: "exercise-bench",
          recordType: "max_volume",
          value: "900.00",
        },
      ];
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeDoubleJoinSelectChain(completedSets))
          .mockReturnValueOnce(makeWhereSelectChain(priorRecords))
          .mockReturnValueOnce(makeWhereSelectChain([{ setId: "set-mixed" }]))
          .mockReturnValueOnce(makeSingleJoinSubquery())
          .mockReturnValueOnce(
            makeWhereSelectChain([
              { id: "exercise-bench", name: "Bench Press" },
            ]),
          ),
        insert: vi.fn().mockReturnValue(makeUpsertChain()),
        update: vi.fn().mockReturnValue(makeUpdateChain()),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { PersonalRecordsRepository } =
        await import("../personalRecordsRepository");
      const repo = new PersonalRecordsRepository();
      const result = await repo.recordPRsForSession("u1", "session-mixed");

      expect(result).toHaveLength(1);
      expect(result[0]?.recordType).toBe("max_weight");
      expect(result[0]?.previousValue).toBe(50);
      expect(result[0]?.newValue).toBe(100);
    });
  });
});
