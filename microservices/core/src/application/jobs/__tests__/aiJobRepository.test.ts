/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));

import { getDb } from "@persistence/db/client";
import {
  AiJobRepository,
  CLAIM_FENCE_MS,
  IDEMPOTENCY_INDEX,
  INFLIGHT_INDEX,
  QUEUED_STALE_AFTER_MS,
  STALE_AFTER_MS,
} from "../aiJobRepository";

function renderSql(fragment: unknown): { sql: string; params: unknown[] } {
  const { sql, params } = new PgDialect().sqlToQuery(fragment as any);
  return { sql, params };
}

describe("AiJobRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("enqueue", () => {
    it("inserts a queued job and reports it as created", async () => {
      const valuesSpy = vi.fn();
      const row = { id: "j1", userId: "u1", kind: "k", status: "queued" };
      (getDb as any).mockReturnValue({
        insert: vi.fn().mockReturnValue({
          values: valuesSpy.mockReturnValue({
            returning: vi.fn().mockResolvedValue([row]),
          }),
        }),
      });

      const result = await new AiJobRepository().enqueue({
        userId: "u1",
        kind: "k",
        input: { a: 1 },
        total: 12,
      });

      expect(result).toEqual({ job: row, outcome: "created" });
      expect(valuesSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "u1",
          kind: "k",
          input: { a: 1 },
          progressTotal: 12,
          clientRequestId: null,
        }),
      );
    });

    it("omits maxAttempts so the column default applies when not supplied", async () => {
      const valuesSpy = vi.fn();
      (getDb as any).mockReturnValue({
        insert: vi.fn().mockReturnValue({
          values: valuesSpy.mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: "j1" }]),
          }),
        }),
      });

      await new AiJobRepository().enqueue({
        userId: "u1",
        kind: "k",
        input: {},
        total: 1,
      });

      expect(valuesSpy.mock.calls[0][0]).not.toHaveProperty("maxAttempts");
    });

    it("AC-3.2: a replayed clientRequestId returns the EXISTING job, not a second one", async () => {
      const existing = { id: "j1", clientRequestId: "req-1" };
      const uniqueViolation = Object.assign(new Error("duplicate key"), {
        code: "23505",
        constraint_name: IDEMPOTENCY_INDEX,
      });
      const whereSpy = vi.fn();
      (getDb as any).mockReturnValue({
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockRejectedValue(uniqueViolation),
          }),
        }),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: whereSpy.mockReturnValue({
              limit: vi.fn().mockResolvedValue([existing]),
            }),
          }),
        }),
      });

      const result = await new AiJobRepository().enqueue({
        userId: "u1",
        kind: "k",
        input: {},
        total: 1,
        clientRequestId: "req-1",
      });

      expect(result).toEqual({ job: existing, outcome: "replayed" });
      // The re-read is scoped to exactly the row that collided.
      const { sql, params } = renderSql(whereSpy.mock.calls[0][0]);
      expect(sql).toContain("user_id");
      expect(sql).toContain("kind");
      expect(sql).toContain("client_request_id");
      expect(params).toEqual(expect.arrayContaining(["u1", "k", "req-1"]));
    });

    it("rethrows a unique violation when there is NO clientRequestId — it came from somewhere else", async () => {
      const uniqueViolation = Object.assign(new Error("duplicate key"), {
        code: "23505",
      });
      (getDb as any).mockReturnValue({
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockRejectedValue(uniqueViolation),
          }),
        }),
      });

      await expect(
        new AiJobRepository().enqueue({
          userId: "u1",
          kind: "k",
          input: {},
          total: 1,
        }),
      ).rejects.toThrow("duplicate key");
    });

    it("rethrows rather than returning a success with no job when the collided row cannot be re-read", async () => {
      const uniqueViolation = Object.assign(new Error("duplicate key"), {
        code: "23505",
      });
      (getDb as any).mockReturnValue({
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockRejectedValue(uniqueViolation),
          }),
        }),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      });

      await expect(
        new AiJobRepository().enqueue({
          userId: "u1",
          kind: "k",
          input: {},
          total: 1,
          clientRequestId: "req-1",
        }),
      ).rejects.toThrow("duplicate key");
    });

    /**
     * The in-flight branch reads the colliding row, so these tests drive the
     * insert + a sequence of selects.
     */
    function mockInflightCollision(selectResults: unknown[][]) {
      const uniqueViolation = Object.assign(new Error("duplicate key"), {
        code: "23505",
        constraint_name: INFLIGHT_INDEX,
      });
      let insertCalls = 0;
      let selectCalls = 0;
      const updateSpy = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });
      (getDb as any).mockReturnValue({
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockImplementation(() => {
              insertCalls += 1;
              // First insert always collides; a reclaim retry succeeds.
              return insertCalls === 1
                ? Promise.reject(uniqueViolation)
                : Promise.resolve([{ id: "j-new" }]);
            }),
          }),
        }),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi
                .fn()
                .mockImplementation(() =>
                  Promise.resolve(selectResults[selectCalls++] ?? []),
                ),
            }),
          }),
        }),
        update: updateSpy,
      });
      return { updateSpy, insertCalls: () => insertCalls };
    }

    it("an IN-FLIGHT collision with a genuinely live job is reported as such, NOT as a replay", async () => {
      const live = {
        id: "j-live",
        status: "running",
        heartbeatAt: new Date(),
        updatedAt: new Date(),
        createdAt: new Date(),
        attempts: 1,
        maxAttempts: 3,
        invocations: 1,
        maxInvocations: 20,
      };
      mockInflightCollision([[live]]);

      expect(
        await new AiJobRepository().enqueue({
          userId: "u1",
          kind: "k",
          input: {},
          total: 1,
        }),
      ).toEqual({ job: null, outcome: "in_flight" });
    });

    it("⚠ a KEYED retry that collides on the in-flight index still answers `replayed`", async () => {
      // Both unique indexes are violated by a keyed retry of an in-flight job, and
      // Postgres reports only whichever it checked first (index OID order — which
      // nothing in the migration pins). Answering `409` would leave the client
      // unable to poll a job it successfully created, i.e. exactly the failure the
      // idempotency key exists to prevent. The answer must not depend on which
      // index Postgres happened to name.
      const live = {
        id: "j-live",
        status: "queued",
        heartbeatAt: null,
        updatedAt: new Date(),
        createdAt: new Date(),
        attempts: 0,
        maxAttempts: 3,
        invocations: 0,
        maxInvocations: 20,
      };
      // select 1 = findLiveForKind, select 2 = findByClientRequestId
      mockInflightCollision([[live], [live]]);

      expect(
        await new AiJobRepository().enqueue({
          userId: "u1",
          kind: "k",
          input: {},
          total: 1,
          clientRequestId: "req-1",
        }),
      ).toEqual({ job: live, outcome: "replayed" });
    });

    it("⚠ a collision with a DEAD row self-heals: the row is failed and the insert retried", async () => {
      // The in-flight index keys off the PERSISTED status, but death is DERIVED on
      // read and only persisted by the nightly sweep. Without this, a user whose
      // worker died is told "failed, try again" at 40 minutes and then gets 409 on
      // every retry until 05:00 UTC — a lockout governed by a cron cadence.
      const dead = {
        id: "j-dead",
        status: "running",
        // Heartbeat far past STALE_AFTER_MS.
        heartbeatAt: new Date(Date.now() - STALE_AFTER_MS - 60_000),
        updatedAt: new Date(Date.now() - STALE_AFTER_MS - 60_000),
        createdAt: new Date(Date.now() - STALE_AFTER_MS - 60_000),
        attempts: 3,
        maxAttempts: 3,
        invocations: 3,
        maxInvocations: 20,
      };
      const { updateSpy, insertCalls } = mockInflightCollision([[dead]]);

      const result = await new AiJobRepository().enqueue({
        userId: "u1",
        kind: "k",
        input: {},
        total: 1,
      });

      expect(result).toEqual({ job: { id: "j-new" }, outcome: "created" });
      // The dead row was finalised...
      expect(updateSpy).toHaveBeenCalled();
      // ...and the insert was retried exactly ONCE, never looped.
      expect(insertCalls()).toBe(2);
    });

    it("does not loop: a second collision after the reclaim reports in_flight", async () => {
      const dead = {
        id: "j-dead",
        status: "running",
        heartbeatAt: new Date(Date.now() - STALE_AFTER_MS - 60_000),
        updatedAt: new Date(Date.now() - STALE_AFTER_MS - 60_000),
        createdAt: new Date(Date.now() - STALE_AFTER_MS - 60_000),
        attempts: 3,
        maxAttempts: 3,
        invocations: 3,
        maxInvocations: 20,
      };
      const uniqueViolation = Object.assign(new Error("duplicate key"), {
        code: "23505",
        constraint_name: INFLIGHT_INDEX,
      });
      let insertCalls = 0;
      (getDb as any).mockReturnValue({
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            // ALWAYS collides — a pathological state.
            returning: vi.fn().mockImplementation(() => {
              insertCalls += 1;
              return Promise.reject(uniqueViolation);
            }),
          }),
        }),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([dead]),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      });

      expect(
        await new AiJobRepository().enqueue({
          userId: "u1",
          kind: "k",
          input: {},
          total: 1,
        }),
      ).toEqual({ job: null, outcome: "in_flight" });
      expect(insertCalls).toBe(2);
    });

    it("rethrows a unique violation from an UNRECOGNISED index rather than guessing", async () => {
      const uniqueViolation = Object.assign(new Error("duplicate key"), {
        code: "23505",
        constraint_name: "some_other_index",
      });
      (getDb as any).mockReturnValue({
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockRejectedValue(uniqueViolation),
          }),
        }),
      });

      await expect(
        new AiJobRepository().enqueue({
          userId: "u1",
          kind: "k",
          input: {},
          total: 1,
          clientRequestId: "req-1",
        }),
      ).rejects.toThrow("duplicate key");
    });

    it("rethrows a non-unique-violation error untouched", async () => {
      (getDb as any).mockReturnValue({
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockRejectedValue(new Error("connection reset")),
          }),
        }),
      });

      await expect(
        new AiJobRepository().enqueue({
          userId: "u1",
          kind: "k",
          input: {},
          total: 1,
          clientRequestId: "req-1",
        }),
      ).rejects.toThrow("connection reset");
    });
  });

  describe("claim — the exactly-once mechanism (AC-3.1)", () => {
    function mockClaim(returned: unknown[]) {
      const setSpy = vi.fn();
      const whereSpy = vi.fn();
      (getDb as any).mockReturnValue({
        update: vi.fn().mockReturnValue({
          set: setSpy.mockReturnValue({
            where: whereSpy.mockReturnValue({
              returning: vi.fn().mockResolvedValue(returned),
            }),
          }),
        }),
      });
      return { setSpy, whereSpy };
    }

    it("returns null when the conditional UPDATE matches nothing — a duplicate delivery must not run", async () => {
      mockClaim([]);
      expect(await new AiJobRepository().claim("j1")).toBeNull();
    });

    it("returns the claimed row when the UPDATE matches", async () => {
      const row = { id: "j1", status: "running", attempts: 1 };
      mockClaim([row]);
      expect(await new AiJobRepository().claim("j1")).toEqual(row);
    });

    it("⚠ renders the EXECUTABLE predicate: id, FENCED status gate, and BOTH bounds, all in ONE statement", async () => {
      // Guards against the failure mode in
      // memory/reference_drizzle_groupby_param_bug: a render test that pins a
      // shape without checking it is the shape that must execute. Splitting
      // this into a SELECT-then-UPDATE would let a $0.69 job run twice.
      const { whereSpy } = mockClaim([{ id: "j1" }]);
      await new AiJobRepository().claim("j1");

      const { sql, params } = renderSql(whereSpy.mock.calls[0][0]);
      const lower = sql.toLowerCase();
      expect(lower).toContain('"id"');
      expect(lower).toContain("'queued'");
      // ⚠ `running` is claimable ONLY behind the heartbeat fence. An earlier
      // revision allowed ANY running job, which silently permitted two workers
      // to execute one job concurrently — the exact thing AC-3.1 exists to stop.
      // So the predicate must mention the heartbeat, not just the status.
      expect(lower).toContain("'running'");
      expect(lower).toContain("heartbeat_at");
      expect(lower).toContain("is null");
      // Both bounds, in the same statement.
      expect(lower).toContain("attempts");
      expect(lower).toContain("max_attempts");
      expect(lower).toContain("invocations");
      expect(lower).toContain("max_invocations");
      expect(params).toContain("j1");
      // The fence cutoff is bound as a parameter. Note it arrives as a Date:
      // a raw `sql` template passes the JS value through, where `lt()` would
      // have serialised it to an ISO string first.
      expect(params.some((p) => p instanceof Date)).toBe(true);
    });

    it("the fence cutoff is CLAIM_FENCE_MS in the past — and far shorter than STALE_AFTER_MS", async () => {
      // The ordering between the two constants is load-bearing: a hard-killed
      // job must become re-claimable long BEFORE it is declared dead to the
      // client, or its checkpoint is thrown away.
      expect(CLAIM_FENCE_MS).toBeLessThan(STALE_AFTER_MS);

      const before = Date.now();
      const { whereSpy } = mockClaim([{ id: "j1" }]);
      await new AiJobRepository().claim("j1");
      const after = Date.now();

      const { params } = renderSql(whereSpy.mock.calls[0][0]);
      const cutoff = params.find((p) => p instanceof Date) as Date;
      const cutoffMs = cutoff.getTime();
      expect(cutoffMs).toBeGreaterThanOrEqual(before - CLAIM_FENCE_MS - 50);
      expect(cutoffMs).toBeLessThanOrEqual(after - CLAIM_FENCE_MS + 50);
    });

    it("increments attempts and preserves the ORIGINAL started_at across a resume", async () => {
      const { setSpy } = mockClaim([{ id: "j1" }]);
      await new AiJobRepository().claim("j1");

      const set = setSpy.mock.calls[0][0];
      expect(set.status).toBe("running");
      expect(renderSql(set.attempts).sql.toLowerCase()).toContain("+ 1");
      // Both counters advance on a claim; only `attempts` is later reset by a
      // checkpoint, which is what makes `invocations` the absolute bound.
      expect(renderSql(set.invocations).sql.toLowerCase()).toContain("+ 1");
      const startedAt = renderSql(set.startedAt).sql.toLowerCase();
      expect(startedAt).toContain("coalesce");
      expect(startedAt).toContain("started_at");
      expect(renderSql(set.heartbeatAt).sql.trim().toLowerCase()).toBe("now()");
    });
  });

  describe("checkpoint", () => {
    it("writes checkpoint, progress and heartbeat in ONE statement", async () => {
      const setSpy = vi.fn();
      (getDb as any).mockReturnValue({
        update: vi.fn().mockReturnValue({
          set: setSpy.mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      });

      await new AiJobRepository().checkpoint({
        jobId: "j1",
        checkpoint: { done: ["a"] },
        progressDone: 1,
      });

      // A partial write — progress advanced, checkpoint not — would make a
      // resume skip work it never did.
      const set = setSpy.mock.calls[0][0];
      expect(set.checkpoint).toEqual({ done: ["a"] });
      expect(set.progressDone).toBe(1);
      // ⚠ Progress RESETS the consecutive-stall counter. Without this a 120-step
      // job needing 3+ invocations spends its whole retry allowance on yields and
      // dies mid-progress on the first transient Bedrock throttle.
      expect(set.attempts).toBe(0);
      expect(renderSql(set.heartbeatAt).sql.trim().toLowerCase()).toBe("now()");
    });
  });

  describe("heartbeat", () => {
    it("touches liveness only", async () => {
      const setSpy = vi.fn();
      (getDb as any).mockReturnValue({
        update: vi.fn().mockReturnValue({
          set: setSpy.mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      });

      await new AiJobRepository().heartbeat("j1");

      const set = setSpy.mock.calls[0][0];
      expect(Object.keys(set).sort()).toEqual(["heartbeatAt", "updatedAt"]);
    });
  });

  describe("succeed / fail", () => {
    function mockUpdate() {
      const setSpy = vi.fn();
      const whereSpy = vi.fn();
      (getDb as any).mockReturnValue({
        update: vi.fn().mockReturnValue({
          set: setSpy.mockReturnValue({
            where: whereSpy.mockResolvedValue(undefined),
          }),
        }),
      });
      return { setSpy, whereSpy };
    }

    it("succeed is scoped to a RUNNING job so a late worker cannot resurrect a finalised one", async () => {
      const { setSpy, whereSpy } = mockUpdate();
      await new AiJobRepository().succeed("j1", { ok: true });

      expect(setSpy.mock.calls[0][0]).toEqual(
        expect.objectContaining({ status: "succeeded", result: { ok: true } }),
      );
      // Clearing a stale error matters: a job that failed a step, retried and
      // then succeeded must not carry the old error on the wire.
      expect(setSpy.mock.calls[0][0].error).toBeNull();
      // `eq()` PARAMETERISES its value, so the status lands in `params`, not
      // inline in the SQL. Asserting on the rendered string would pass for a
      // predicate that filtered on nothing at all.
      const { sql, params } = renderSql(whereSpy.mock.calls[0][0]);
      expect(sql).toContain("status");
      expect(params).toEqual(expect.arrayContaining(["j1", "running"]));
    });

    it("fail covers QUEUED too — the enqueue path fails a job whose publish threw", async () => {
      const { setSpy, whereSpy } = mockUpdate();
      await new AiJobRepository().fail("j1", {
        code: "step_failed",
        message: "nope",
        retryable: true,
      });

      expect(setSpy.mock.calls[0][0]).toEqual(
        expect.objectContaining({ status: "failed" }),
      );
      const lower = renderSql(whereSpy.mock.calls[0][0]).sql.toLowerCase();
      expect(lower).toContain("'queued'");
      expect(lower).toContain("'running'");
    });
  });

  describe("getForUser — ownership (AC-2.2)", () => {
    it("puts the user_id predicate IN THE QUERY, not in a post-read comparison", async () => {
      const whereSpy = vi.fn();
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: whereSpy.mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: "j1", userId: "u1" }]),
            }),
          }),
        }),
      });

      await new AiJobRepository().getForUser("j1", "u1");

      const { sql, params } = renderSql(whereSpy.mock.calls[0][0]);
      expect(sql).toContain("user_id");
      expect(params).toEqual(expect.arrayContaining(["j1", "u1"]));
    });

    it("returns null for a miss", async () => {
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      });
      expect(await new AiJobRepository().getForUser("j1", "u1")).toBeNull();
    });
  });

  describe("get — the worker's unscoped read", () => {
    it("reads by id alone and returns null for a miss", async () => {
      const whereSpy = vi.fn();
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: whereSpy.mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      });

      expect(await new AiJobRepository().get("j1")).toBeNull();
      const { params } = renderSql(whereSpy.mock.calls[0][0]);
      expect(params).toEqual(["j1"]);
    });

    it("returns the row when present", async () => {
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: "j1" }]),
            }),
          }),
        }),
      });
      expect(await new AiJobRepository().get("j1")).toEqual({ id: "j1" });
    });
  });

  describe("markStaleRunning", () => {
    it("reaps running jobs whose heartbeat predates the staleness cutoff", async () => {
      const whereSpy = vi.fn();
      const setSpy = vi.fn();
      (getDb as any).mockReturnValue({
        update: vi.fn().mockReturnValue({
          set: setSpy.mockReturnValue({
            where: whereSpy.mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: "a" }, { id: "b" }]),
            }),
          }),
        }),
      });

      const now = new Date("2026-08-02T12:00:00.000Z");
      const reaped = await new AiJobRepository().markStaleRunning(now);

      expect(reaped).toBe(2);
      expect(setSpy.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          status: "failed",
          error: expect.objectContaining({ code: "stale", retryable: false }),
        }),
      );
      const { sql, params } = renderSql(whereSpy.mock.calls[0][0]);
      expect(sql).toContain("status");
      expect(sql).toContain("heartbeat_at");
      // ⚠ Must also match a NULL heartbeat: `lt()` alone evaluates to NULL for
      // such a row, so it would never be reaped — while the read path already
      // reports it stale, leaving the row derived-failed forever and unpurgeable.
      expect(sql.toLowerCase()).toContain("is null");
      // Both the status and the cutoff are bound params, not inline literals.
      expect(params).toContain("running");
      expect(params).toContainEqual(new Date(now.getTime() - STALE_AFTER_MS));
    });

    it("STALE_AFTER_MS clears the queue's 16-minute visibility timeout", () => {
      // ⚠ Sized against the VISIBILITY TIMEOUT, not the worker timeout. A
      // retryable failure 30 s into a run leaves the heartbeat cold for the whole
      // visibility window; declaring the job dead in that gap tells the user to
      // re-run work that is about to succeed — double spend, and the sweep would
      // discard the checkpoint.
      const VISIBILITY_TIMEOUT_MS = 16 * 60 * 1000;
      const WORKER_TIMEOUT_MS = 15 * 60 * 1000;
      expect(STALE_AFTER_MS).toBeGreaterThan(
        VISIBILITY_TIMEOUT_MS + WORKER_TIMEOUT_MS,
      );
    });
  });

  describe("deleteUnpublished — AC-1.2 cleanup", () => {
    it("deletes only a never-claimed QUEUED row, so it cannot race a worker", async () => {
      const whereSpy = vi.fn();
      (getDb as any).mockReturnValue({
        delete: vi
          .fn()
          .mockReturnValue({ where: whereSpy.mockResolvedValue(undefined) }),
      });

      await new AiJobRepository().deleteUnpublished("j1");

      const { sql, params } = renderSql(whereSpy.mock.calls[0][0]);
      const lower = sql.toLowerCase();
      expect(lower).toContain("heartbeat_at");
      expect(lower).toContain("is null");
      expect(params).toEqual(expect.arrayContaining(["j1", "queued"]));
    });
  });

  describe("releaseForResume — the yield transition", () => {
    it("sets the job back to QUEUED, scoped to running", async () => {
      // This is what lets `claim`'s fence be strict about `running`: a yielded
      // job has explicitly released itself, so it needs no takeover window.
      const setSpy = vi.fn();
      const whereSpy = vi.fn();
      (getDb as any).mockReturnValue({
        update: vi.fn().mockReturnValue({
          set: setSpy.mockReturnValue({
            where: whereSpy.mockResolvedValue(undefined),
          }),
        }),
      });

      await new AiJobRepository().releaseForResume("j1");

      expect(setSpy.mock.calls[0][0].status).toBe("queued");
      const { params } = renderSql(whereSpy.mock.calls[0][0]);
      expect(params).toEqual(expect.arrayContaining(["j1", "running"]));
    });
  });

  describe("markStaleQueued", () => {
    it("reaps jobs whose queue message died, measured from updated_at", async () => {
      // The failure `markStaleRunning` cannot see: a message that dies before its
      // first receive leaves a row nothing ever transitions, so the client polls
      // `queued 0/120` forever and the terminal purge never sees it.
      const whereSpy = vi.fn();
      const setSpy = vi.fn();
      (getDb as any).mockReturnValue({
        update: vi.fn().mockReturnValue({
          set: setSpy.mockReturnValue({
            where: whereSpy.mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: "a" }]),
            }),
          }),
        }),
      });

      const now = new Date("2026-08-02T12:00:00.000Z");
      expect(await new AiJobRepository().markStaleQueued(now)).toBe(1);

      expect(setSpy.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          status: "failed",
          error: expect.objectContaining({ code: "stale", retryable: false }),
        }),
      );
      const { sql, params } = renderSql(whereSpy.mock.calls[0][0]);
      // ⚠ `updated_at`, not `created_at`: `releaseForResume` stamps it on every
      // yield, so a legitimately long job in flight is not written off as "never
      // started" — which would destroy every checkpointed step.
      expect(sql).toContain("updated_at");
      expect(sql).not.toContain("created_at");
      expect(params).toContain("queued");
      expect(params).toContainEqual(
        new Date(now.getTime() - QUEUED_STALE_AFTER_MS).toISOString(),
      );
    });

    it("QUEUED_STALE_AFTER_MS outlasts the redrive policy, so the message is genuinely gone", () => {
      // 3 receives x a 16-minute visibility timeout is ~48 minutes to the DLQ.
      // Reaping sooner would write off a job still waiting for its first receive.
      expect(QUEUED_STALE_AFTER_MS).toBeGreaterThan(3 * 16 * 60 * 1000);
    });
  });

  describe("purgeTerminalOlderThan", () => {
    it("deletes only TERMINAL jobs finished before the cutoff", async () => {
      const whereSpy = vi.fn();
      (getDb as any).mockReturnValue({
        delete: vi.fn().mockReturnValue({
          where: whereSpy.mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: "a" }]),
          }),
        }),
      });

      const cutoff = new Date("2026-07-03T00:00:00.000Z");
      expect(await new AiJobRepository().purgeTerminalOlderThan(cutoff)).toBe(
        1,
      );

      const { sql, params } = renderSql(whereSpy.mock.calls[0][0]);
      const lower = sql.toLowerCase();
      expect(lower).toContain("'succeeded'");
      expect(lower).toContain("'failed'");
      expect(lower).toContain("'cancelled'");
      // A running job must never be swept away underneath its worker. The
      // status list here IS inline (a raw `sql` IN-list, not `eq()`), so
      // asserting on the rendered string is the right check for it.
      expect(lower).not.toContain("'running'");
      expect(lower).not.toContain("'queued'");
      // The cutoff comes through `lt()`, which parameterises and serialises the
      // Date to an ISO string on the way to postgres.js.
      expect(params).toContainEqual(cutoff.toISOString());
    });
  });
});
