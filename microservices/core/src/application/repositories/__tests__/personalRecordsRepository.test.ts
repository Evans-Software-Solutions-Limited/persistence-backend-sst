/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

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

    it("skips sets without weight or reps when computing PR candidates", async () => {
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
      // One valid 8-rep set, no prior `personal_records` rows. With
      // the legacy exact-rep ladder, reps=8 does NOT sit on a rung
      // (1/3/5/10), so only `max_weight` + `max_volume` candidates
      // are emitted — 2 candidates total. Both hit the first-
      // occurrence branch: they INSERT into personal_records (so
      // future sessions have a baseline) but DO NOT surface in the
      // returned PR list. Result: `detected` is empty, the
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
      // 2 upserts fired (max_weight + max_volume — no Xrm at reps=8)
      // — the personal_records table is still populated for future
      // sessions to compare against.
      expect(mockDb.insert).toHaveBeenCalledTimes(2);
      // The exerciseName lookup is skipped — `select` only fires for
      // the four steps above (completedSets, existingPRs, canonicalPRs,
      // userSessionExerciseIdsScope). No 5th call.
      expect(mockDb.select).toHaveBeenCalledTimes(4);
    });

    it("returns PRs with previousValue for each computed record type that beat its prior (10rm + max_weight + max_volume)", async () => {
      // One 10-rep set that beats prior values on ALL three record
      // types the new ladder emits for reps=10: max_weight,
      // max_volume, and 10rm. Prior bench PRs: 10rm=90,
      // max_weight=90, max_volume=400. New set: 100 kg × 10 reps →
      // max_weight=100, max_volume=1000, 10rm=100. All three
      // improve → all three surface.
      const completedSets = [
        {
          setId: "set-improvement",
          exerciseId: "exercise-bench",
          weightKg: "100.00",
          reps: 10,
        },
      ];
      const priorRecords = [
        {
          exerciseId: "exercise-bench",
          recordType: "10rm",
          value: "90.00",
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
      // 10rm: 100 kg lifted for exactly 10 reps.
      const rm = result.find((r) => r.recordType === "10rm");
      expect(rm?.previousValue).toBe(90);
      expect(rm?.newValue).toBe(100);
      expect(rm?.exerciseName).toBe("Bench Press");
      // max_weight: 100 kg
      const mw = result.find((r) => r.recordType === "max_weight");
      expect(mw?.previousValue).toBe(90);
      expect(mw?.newValue).toBe(100);
      expect(mw?.exerciseName).toBe("Bench Press");
      // max_volume: 100 × 10 = 1000
      const mv = result.find((r) => r.recordType === "max_volume");
      expect(mv?.previousValue).toBe(400);
      expect(mv?.newValue).toBe(1000);
      expect(mv?.exerciseName).toBe("Bench Press");
    });

    it("does NOT surface a phantom PR when an identical workout re-runs (float-vs-2dp precision parity — Inspector Brad regression)", async () => {
      // Inspector Brad PR #61 regression. With the Epley path dropped,
      // the only remaining float-arithmetic risk is `max_volume`'s
      // `weight × reps` multiplication — e.g. 99.99 × 10 evaluates to
      // 999.9000000000001 in JS but is stored as "999.90" in
      // `personal_records.value` (numeric(10,2)).
      //
      // Pre-fix: the JS partition compared the full float
      //   candidate.value (999.9000000000001) > prior parseFloat("999.90")
      //   (999.9) → true → phantom PR pushed
      // while the DB's `WHERE personal_records.value <
      // excluded.value` saw 999.90 < 999.90 → false → no-op upsert.
      // The Summary screen would show "PR! 999.90 → 999.90" for an
      // identical workout, and the response's setId wouldn't match
      // what `personal_records.setId` actually holds.
      //
      // Fix: round-trip `candidate.value` through `toFixed(2) →
      // parseFloat` so the JS comparison uses the same precision the
      // DB stores — both sides see 999.90 == 999.90 → no PR surfaces.
      const completedSets = [
        {
          setId: "set-session-2",
          exerciseId: "exercise-bench",
          weightKg: "99.99",
          reps: 10,
        },
      ];
      // Prior `personal_records` rows from session 1 — stored at 2dp.
      // 10rm is included so the rep-max candidate also matches its
      // prior and doesn't surface as a first-occurrence skip.
      const priorRecords = [
        {
          exerciseId: "exercise-bench",
          recordType: "10rm",
          value: "99.99",
        },
        {
          exerciseId: "exercise-bench",
          recordType: "max_weight",
          value: "99.99",
        },
        {
          exerciseId: "exercise-bench",
          recordType: "max_volume",
          value: "999.90",
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
      // 99.99 kg × 10 reps. The only PR candidate that's susceptible
      // to JS float-arithmetic drift is `max_volume`: 99.99 × 10
      // evaluates to 999.9000000000001 in JS, but is stored as
      // "999.90" in `personal_records.value` (numeric(10,2)). The
      // response's newValue MUST be the 2dp-rounded 999.9, not the
      // raw float, so mobile renders the same number the server
      // actually has. Prior was 900.00 (genuine improvement), so the
      // candidate surfaces.
      const completedSets = [
        {
          setId: "set-real-pr",
          exerciseId: "exercise-bench",
          weightKg: "99.99",
          reps: 10,
        },
      ];
      // Only seed a prior for max_volume so it's the single surfaced
      // PR. max_weight and 10rm have no priors → first-occurrence
      // skip → not in `result`.
      const priorRecords = [
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
      const mv = result[0];
      expect(mv?.recordType).toBe("max_volume");
      expect(mv?.previousValue).toBe(900);
      // Exactly 999.9, NOT 999.9000000000001.
      expect(mv?.newValue).toBe(999.9);
    });

    it("skips an individual record-type PR when the prior value isn't beaten (per-type partition, not all-or-nothing)", async () => {
      // 100 kg × 10 reps emits 3 candidates: 10rm, max_weight,
      // max_volume. Priors: 10rm=200 (above 100 → not beaten → no
      // PR), max_weight=50 (beaten by 100 → PR), max_volume=1500
      // (above 1000 → not beaten → no PR). Exactly ONE PR
      // surfaces: max_weight.
      const completedSets = [
        {
          setId: "set-mixed",
          exerciseId: "exercise-bench",
          weightKg: "100.00",
          reps: 10,
        },
      ];
      const priorRecords = [
        {
          exerciseId: "exercise-bench",
          recordType: "10rm",
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
          value: "1500.00",
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

    /**
     * Helper for the exact-rep-ladder candidate-enumeration tests
     * below. Asserts how many candidate upserts fire for a single
     * completed set at `reps`. The first-occurrence branch is taken
     * for every candidate (no priors seeded), so the upsert count IS
     * the candidate count — a tight proxy for "the candidate
     * enumeration emitted exactly N record-type rows for this set".
     */
    function makeLadderHarness(reps: number) {
      const completedSets = [
        {
          setId: "set-rep-test",
          exerciseId: "exercise-bench",
          weightKg: "100.00",
          reps,
        },
      ];
      return {
        select: vi
          .fn()
          .mockReturnValueOnce(makeDoubleJoinSelectChain(completedSets))
          .mockReturnValueOnce(makeWhereSelectChain([]))
          .mockReturnValueOnce(
            makeWhereSelectChain([{ setId: "set-rep-test" }]),
          )
          .mockReturnValueOnce(makeSingleJoinSubquery()),
        insert: vi.fn().mockReturnValue(makeUpsertChain()),
        update: vi.fn().mockReturnValue(makeUpdateChain()),
      };
    }

    it("emits 1rm + max_weight + max_volume candidates for a 1-rep set", async () => {
      const mockDb = makeLadderHarness(1);
      (getDb as any).mockReturnValue(mockDb);

      const { PersonalRecordsRepository } =
        await import("../personalRecordsRepository");
      const repo = new PersonalRecordsRepository();
      await repo.recordPRsForSession("u1", "session-1rep");

      // Three candidates: max_weight + max_volume always, plus 1rm
      // (exact rep match).
      expect(mockDb.insert).toHaveBeenCalledTimes(3);
    });

    it("emits 3rm + max_weight + max_volume candidates for a 3-rep set", async () => {
      const mockDb = makeLadderHarness(3);
      (getDb as any).mockReturnValue(mockDb);

      const { PersonalRecordsRepository } =
        await import("../personalRecordsRepository");
      const repo = new PersonalRecordsRepository();
      await repo.recordPRsForSession("u1", "session-3rep");

      expect(mockDb.insert).toHaveBeenCalledTimes(3);
    });

    it("emits 5rm + max_weight + max_volume candidates for a 5-rep set", async () => {
      const mockDb = makeLadderHarness(5);
      (getDb as any).mockReturnValue(mockDb);

      const { PersonalRecordsRepository } =
        await import("../personalRecordsRepository");
      const repo = new PersonalRecordsRepository();
      await repo.recordPRsForSession("u1", "session-5rep");

      expect(mockDb.insert).toHaveBeenCalledTimes(3);
    });

    it("emits 10rm + max_weight + max_volume candidates for a 10-rep set (NO 1rm)", async () => {
      const mockDb = makeLadderHarness(10);
      (getDb as any).mockReturnValue(mockDb);

      const { PersonalRecordsRepository } =
        await import("../personalRecordsRepository");
      const repo = new PersonalRecordsRepository();
      await repo.recordPRsForSession("u1", "session-10rep");

      // Three candidates total. Critically, NOT four: a 10-rep set
      // does NOT also produce a 1rm Epley estimate (that bug is what
      // this PR exists to fix). Asserting on the count alone catches
      // an accidental Epley re-introduction.
      expect(mockDb.insert).toHaveBeenCalledTimes(3);
    });

    it("emits ONLY max_weight + max_volume for a 7-rep set (no Xrm — exact-rep match required)", async () => {
      const mockDb = makeLadderHarness(7);
      (getDb as any).mockReturnValue(mockDb);

      const { PersonalRecordsRepository } =
        await import("../personalRecordsRepository");
      const repo = new PersonalRecordsRepository();
      await repo.recordPRsForSession("u1", "session-7rep");

      // Two candidates: max_weight + max_volume. No rep-max
      // candidate — 7 doesn't sit on the legacy 1/3/5/10 ladder, and
      // unlike Epley we don't approximate from off-ladder reps.
      expect(mockDb.insert).toHaveBeenCalledTimes(2);
    });
  });

  describe("getPersonalRecordsForSessionReplay (M13 sync-hardening, Cluster 1a Task 1)", () => {
    it("returns [] when the session has no completed sets", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValueOnce(makeDoubleJoinSelectChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { PersonalRecordsRepository } =
        await import("../personalRecordsRepository");
      const repo = new PersonalRecordsRepository();
      const result = await repo.getPersonalRecordsForSessionReplay(
        "u1",
        "session-empty",
      );

      expect(result).toEqual([]);
      // Only the sessionSets query fired — no personal_records / otherSets
      // round trips for a session with nothing completed.
      expect(mockDb.select).toHaveBeenCalledTimes(1);
    });

    it("returns [] when none of this session's sets are the CURRENT canonical PR holder (superseded by a later session)", async () => {
      const sessionSets = [
        {
          setId: "set-replay-session",
          exerciseId: "exercise-bench",
          weightKg: "100.00",
          reps: 10,
        },
      ];
      // personal_records currently points at a DIFFERENT set (a later
      // session beat this one) — not attributable to our session.
      const currentPRs = [
        {
          exerciseId: "exercise-bench",
          recordType: "max_weight",
          value: "110.00",
          setId: "set-from-a-later-session",
        },
      ];
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeDoubleJoinSelectChain(sessionSets))
          .mockReturnValueOnce(makeWhereSelectChain(currentPRs)),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { PersonalRecordsRepository } =
        await import("../personalRecordsRepository");
      const repo = new PersonalRecordsRepository();
      const result = await repo.getPersonalRecordsForSessionReplay(
        "u1",
        "session-replay",
      );

      expect(result).toEqual([]);
      // No otherSets / exerciseName round trip — bailed after finding zero
      // attributable rows.
      expect(mockDb.select).toHaveBeenCalledTimes(2);
    });

    it("returns [] when this session's PR has no other-session baseline (first-occurrence within this session)", async () => {
      const sessionSets = [
        {
          setId: "set-first-ever",
          exerciseId: "exercise-bench",
          weightKg: "100.00",
          reps: 10,
        },
      ];
      const currentPRs = [
        {
          exerciseId: "exercise-bench",
          recordType: "max_weight",
          value: "100.00",
          setId: "set-first-ever",
        },
      ];
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeDoubleJoinSelectChain(sessionSets))
          .mockReturnValueOnce(makeWhereSelectChain(currentPRs))
          // No other session ever logged this exercise.
          .mockReturnValueOnce(makeDoubleJoinSelectChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { PersonalRecordsRepository } =
        await import("../personalRecordsRepository");
      const repo = new PersonalRecordsRepository();
      const result = await repo.getPersonalRecordsForSessionReplay(
        "u1",
        "session-replay",
      );

      expect(result).toEqual([]);
      // No exerciseName lookup — nothing surfaced.
      expect(mockDb.select).toHaveBeenCalledTimes(3);
    });

    it("reconstructs the PR (previousValue + newValue + exerciseName) when this session still holds the canonical PR and a prior baseline exists", async () => {
      const sessionSets = [
        {
          setId: "set-replay-winner",
          exerciseId: "exercise-bench",
          weightKg: "100.00",
          reps: 10,
        },
      ];
      const currentPRs = [
        {
          exerciseId: "exercise-bench",
          recordType: "10rm",
          value: "100.00",
          setId: "set-replay-winner",
        },
        {
          exerciseId: "exercise-bench",
          recordType: "max_weight",
          value: "100.00",
          setId: "set-replay-winner",
        },
        {
          exerciseId: "exercise-bench",
          recordType: "max_volume",
          value: "1000.00",
          setId: "set-replay-winner",
        },
      ];
      // An earlier (different) session's set is the historical baseline.
      const otherSets = [
        {
          setId: "set-earlier-session",
          exerciseId: "exercise-bench",
          weightKg: "90.00",
          reps: 10,
        },
      ];
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeDoubleJoinSelectChain(sessionSets))
          .mockReturnValueOnce(makeWhereSelectChain(currentPRs))
          .mockReturnValueOnce(makeDoubleJoinSelectChain(otherSets))
          .mockReturnValueOnce(
            makeWhereSelectChain([
              { id: "exercise-bench", name: "Bench Press" },
            ]),
          ),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { PersonalRecordsRepository } =
        await import("../personalRecordsRepository");
      const repo = new PersonalRecordsRepository();
      const result = await repo.getPersonalRecordsForSessionReplay(
        "u1",
        "session-replay",
      );

      expect(result).toHaveLength(3);
      const rm = result.find((r) => r.recordType === "10rm");
      expect(rm).toMatchObject({
        exerciseId: "exercise-bench",
        exerciseName: "Bench Press",
        newValue: 100,
        previousValue: 90,
        setId: "set-replay-winner",
      });
      const mw = result.find((r) => r.recordType === "max_weight");
      expect(mw).toMatchObject({ newValue: 100, previousValue: 90 });
      const mv = result.find((r) => r.recordType === "max_volume");
      expect(mv).toMatchObject({ newValue: 1000, previousValue: 900 });
    });

    it("excludes THIS session's own sets from the otherSets baseline query (does not compare a session against itself)", async () => {
      // If the otherSets query didn't exclude this session, the baseline
      // would include this session's own 100kg set, making
      // `newValue > previousValue` false (100 > 100) and wrongly hiding a
      // genuine PR. This test just asserts the `otherSets` select fires
      // (its `ne(workoutSessions.id, sessionId)` predicate is exercised via
      // the mocked chain) and the PR still surfaces when the mock's
      // returned otherSets correctly excludes the session's own data.
      const sessionSets = [
        {
          setId: "set-only-winner",
          exerciseId: "exercise-squat",
          weightKg: "150.00",
          reps: 5,
        },
      ];
      const currentPRs = [
        {
          exerciseId: "exercise-squat",
          recordType: "max_weight",
          value: "150.00",
          setId: "set-only-winner",
        },
      ];
      const otherSets = [
        {
          setId: "set-prior-best",
          exerciseId: "exercise-squat",
          weightKg: "140.00",
          reps: 5,
        },
      ];
      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeDoubleJoinSelectChain(sessionSets))
          .mockReturnValueOnce(makeWhereSelectChain(currentPRs))
          .mockReturnValueOnce(makeDoubleJoinSelectChain(otherSets))
          .mockReturnValueOnce(
            makeWhereSelectChain([
              { id: "exercise-squat", name: "Back Squat" },
            ]),
          ),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { PersonalRecordsRepository } =
        await import("../personalRecordsRepository");
      const repo = new PersonalRecordsRepository();
      const result = await repo.getPersonalRecordsForSessionReplay(
        "u1",
        "session-squat-replay",
      );

      expect(result).toEqual([
        {
          exerciseId: "exercise-squat",
          exerciseName: "Back Squat",
          recordType: "max_weight",
          newValue: 150,
          previousValue: 140,
          setId: "set-only-winner",
        },
      ]);
    });

    it("renders the otherSets query's WHERE clause with an explicit != this sessionId (mocked-DB blind spot guard)", async () => {
      // A mocked chain resolves to whatever we hand it regardless of the
      // WHERE predicate, so a bug that dropped the `ne(workoutSessions.id,
      // sessionId)` exclusion (comparing a session's own sets against
      // themselves as "history") would NOT be caught by the behavioural
      // tests above if their fixtures happened to still produce the right
      // answer. Render the actual `.where(...)` argument passed to the
      // otherSets select via PgDialect and assert the compiled SQL/params
      // really exclude `sessionId`.
      const sessionSets = [
        {
          setId: "set-x",
          exerciseId: "exercise-bench",
          weightKg: "100.00",
          reps: 5,
        },
      ];
      const currentPRs = [
        {
          exerciseId: "exercise-bench",
          recordType: "max_weight",
          value: "100.00",
          setId: "set-x",
        },
      ];
      let capturedOtherSetsWhere: unknown;
      let selectCallCount = 0;
      const mockDb = {
        select: vi.fn().mockImplementation(() => {
          selectCallCount += 1;
          if (selectCallCount === 1) {
            return makeDoubleJoinSelectChain(sessionSets);
          }
          if (selectCallCount === 2) {
            return makeWhereSelectChain(currentPRs);
          }
          // 3rd call: otherSets — capture the where predicate instead of
          // using the plain chain helper.
          return {
            from: vi.fn().mockReturnValue({
              innerJoin: vi.fn().mockReturnValue({
                innerJoin: vi.fn().mockReturnValue({
                  where: vi.fn().mockImplementation((w: unknown) => {
                    capturedOtherSetsWhere = w;
                    return Promise.resolve([]);
                  }),
                }),
              }),
            }),
          };
        }),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { PersonalRecordsRepository } =
        await import("../personalRecordsRepository");
      const repo = new PersonalRecordsRepository();
      await repo.getPersonalRecordsForSessionReplay("u1", "session-x");

      expect(capturedOtherSetsWhere).toBeDefined();
      const { sql, params } = new PgDialect().sqlToQuery(
        capturedOtherSetsWhere as never,
      );
      // The exclusion predicate compiles to a `<>` (Drizzle's `ne`) against
      // workout_sessions.id, and the excluded session's id is bound as a
      // parameter — proving the query genuinely scopes "history" to every
      // OTHER session, not this one.
      expect(sql).toContain('"workout_sessions"."id" <>');
      expect(params).toContain("session-x");
    });
  });
});
