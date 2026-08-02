/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));

import { getDb } from "@persistence/db/client";
import { AiJobRepository, STALE_AFTER_MS } from "../aiJobRepository";

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

      expect(result).toEqual({ job: row, created: true });
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

      expect(result).toEqual({ job: existing, created: false });
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

    it("⚠ renders the EXECUTABLE predicate: id + status gate + attempts bound, all in ONE statement", async () => {
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
      // `running` is claimable on purpose — it is how a job that yielded at its
      // time budget gets picked back up.
      expect(lower).toContain("'running'");
      expect(lower).toContain("attempts");
      expect(lower).toContain("max_attempts");
      expect(lower).toContain("<");
      expect(params).toContain("j1");
    });

    it("increments attempts and preserves the ORIGINAL started_at across a resume", async () => {
      const { setSpy } = mockClaim([{ id: "j1" }]);
      await new AiJobRepository().claim("j1");

      const set = setSpy.mock.calls[0][0];
      expect(set.status).toBe("running");
      expect(renderSql(set.attempts).sql.toLowerCase()).toContain("+ 1");
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
      // Both the status and the cutoff are bound params, not inline literals.
      expect(params).toContain("running");
      expect(params).toContainEqual(
        new Date(now.getTime() - STALE_AFTER_MS).toISOString(),
      );
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
