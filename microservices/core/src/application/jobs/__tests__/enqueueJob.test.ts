/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../entitlement/assertEntitlement", () => ({
  assertEntitlement: vi.fn(),
}));

import { assertEntitlement } from "../../entitlement/assertEntitlement";
import { enqueueJob, resolveCeiling } from "../enqueueJob";
import { __clearJobKindRegistry, registerJobKind } from "../registry";
import { JobKindError, JobTooLargeError } from "../types";

function registerKind(overrides: Record<string, unknown> = {}) {
  const kind = {
    kind: "test_kind",
    feature: "loadout",
    ceilingEnv: "TEST_JOB_LIMIT",
    ceilingDefault: 3,
    ceilingEndpoint: "/test/job",
    inferenceEndpoint: "/test/job/inference",
    plan: vi.fn(async () => ({ total: 5 })),
    runStep: vi.fn(),
    finish: vi.fn(),
    ...overrides,
  };
  registerJobKind(kind as any);
  return kind;
}

function makeDeps(opts: { usedToday?: number; created?: boolean } = {}) {
  const job = { id: "j1", userId: "u1", kind: "test_kind" };
  const repository = {
    enqueue: vi.fn().mockResolvedValue({ job, created: opts.created ?? true }),
    fail: vi.fn().mockResolvedValue(undefined),
  };
  const usageLog = {
    countForUserToday: vi.fn().mockResolvedValue(opts.usedToday ?? 0),
    record: vi.fn().mockResolvedValue(undefined),
  };
  const queue = { send: vi.fn().mockResolvedValue(undefined) };
  return { repository, usageLog, queue, job };
}

const call = (deps: any, extra: Record<string, unknown> = {}) =>
  enqueueJob({
    userId: "u1",
    kind: "test_kind",
    input: { a: 1 },
    queue: deps.queue,
    repository: deps.repository as any,
    usageLog: deps.usageLog as any,
    ...extra,
  });

describe("resolveCeiling — fail-safe env parse (#156 pattern)", () => {
  const KEY = "TEST_CEILING_PARSE";
  afterEach(() => {
    delete process.env[KEY];
  });

  it.each([
    ["unset", undefined, 6],
    ["empty string (parses to 0)", "", 6],
    ["garbage (parses to NaN)", "abc", 6],
    ["zero", "0", 6],
    ["negative", "-4", 6],
  ])("falls back to the default for %s", (_label, value, expected) => {
    if (value !== undefined) process.env[KEY] = value as string;
    // A mis-set env var must never silently DISABLE the guard.
    expect(resolveCeiling(KEY, 6)).toBe(expected);
  });

  it("uses a valid positive value", () => {
    process.env[KEY] = "30";
    expect(resolveCeiling(KEY, 6)).toBe(30);
  });
});

describe("enqueueJob", () => {
  beforeEach(() => {
    __clearJobKindRegistry();
    vi.clearAllMocks();
    (assertEntitlement as any).mockResolvedValue({ allowed: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("accepts a job: row written, message published, ceiling row recorded", async () => {
    registerKind();
    const deps = makeDeps();

    const result = await call(deps);

    expect(result).toEqual({ outcome: "accepted", job: deps.job });
    expect(deps.repository.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", kind: "test_kind", total: 5 }),
    );
    expect(deps.queue.send).toHaveBeenCalledWith({ jobId: "j1" });
  });

  it("an unregistered kind is rejected before anything else happens", async () => {
    const deps = makeDeps();
    const result = await enqueueJob({
      userId: "u1",
      kind: "nope",
      input: {},
      queue: deps.queue,
      repository: deps.repository as any,
      usageLog: deps.usageLog as any,
    });

    expect(result).toEqual({ outcome: "unknown_kind" });
    expect(assertEntitlement).not.toHaveBeenCalled();
    expect(deps.repository.enqueue).not.toHaveBeenCalled();
  });

  describe("guard order — the cost-safety contract", () => {
    it("AC-4.1: an unentitled caller creates NO job and writes no usage row", async () => {
      registerKind();
      (assertEntitlement as any).mockResolvedValue({
        allowed: false,
        reason: "tier",
      });
      const deps = makeDeps();

      const result = await call(deps);

      expect(result).toEqual({ outcome: "not_entitled", feature: "loadout" });
      expect(deps.repository.enqueue).not.toHaveBeenCalled();
      expect(deps.usageLog.record).not.toHaveBeenCalled();
      // Entitlement precedes the ceiling read, so a 402 cannot be used to probe
      // usage.
      expect(deps.usageLog.countForUserToday).not.toHaveBeenCalled();
    });

    it("AC-4.3: over the ceiling → rate_limited, and no free sizing work", async () => {
      const kind = registerKind();
      const deps = makeDeps({ usedToday: 3 });

      const result = await call(deps);

      expect(result).toEqual({ outcome: "rate_limited" });
      expect(kind.plan).not.toHaveBeenCalled();
      expect(deps.repository.enqueue).not.toHaveBeenCalled();
      expect(deps.usageLog.record).not.toHaveBeenCalled();
    });

    it("AC-4.4: the ceiling is counted on ceilingEndpoint, NEVER on inferenceEndpoint", async () => {
      // With one shared key a 120-inference job would trip its own ceiling on
      // its first run.
      registerKind();
      const deps = makeDeps();

      await call(deps);

      expect(deps.usageLog.countForUserToday).toHaveBeenCalledWith(
        "u1",
        "/test/job",
      );
      expect(deps.usageLog.countForUserToday).not.toHaveBeenCalledWith(
        "u1",
        "/test/job/inference",
      );
      // ONE row per job, on the ceiling key.
      expect(deps.usageLog.record).toHaveBeenCalledTimes(1);
      expect(deps.usageLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ endpoint: "/test/job" }),
      );
    });
  });

  describe("sizing", () => {
    it("over the kind's own bound → too_large (413), never a silent truncation", async () => {
      registerKind({
        plan: vi
          .fn()
          .mockRejectedValue(
            new JobTooLargeError(180, 120, "too many workouts"),
          ),
      });
      const deps = makeDeps();

      const result = await call(deps);

      expect(result).toEqual({ outcome: "too_large", total: 180, limit: 120 });
      expect(deps.repository.enqueue).not.toHaveBeenCalled();
    });

    it("a kind rejecting its own input → input_invalid", async () => {
      registerKind({
        plan: vi
          .fn()
          .mockRejectedValue(new JobKindError("input_invalid", "no exercises")),
      });
      const deps = makeDeps();

      expect(await call(deps)).toEqual({
        outcome: "input_invalid",
        message: "no exercises",
      });
    });

    it("any other plan() throw propagates rather than being swallowed as a 4xx", async () => {
      registerKind({
        plan: vi.fn().mockRejectedValue(new Error("db down")),
      });
      const deps = makeDeps();
      await expect(call(deps)).rejects.toThrow("db down");
    });
  });

  describe("idempotency + publish failure", () => {
    it("AC-3.2: a replay returns the existing job and does NOT re-publish", async () => {
      registerKind();
      const deps = makeDeps({ created: false });

      const result = await call(deps, { clientRequestId: "req-1" });

      expect(result).toEqual({ outcome: "replayed", job: deps.job });
      // Re-publishing would be a duplicate delivery. The claim makes that safe,
      // but it would still burn a worker invocation for nothing.
      expect(deps.queue.send).not.toHaveBeenCalled();
      // And a replay must not consume a second unit of quota.
      expect(deps.usageLog.record).not.toHaveBeenCalled();
    });

    it("AC-1.2: a publish failure marks the job FAILED and reports queue_unavailable — never accepted", async () => {
      registerKind();
      const deps = makeDeps();
      deps.queue.send.mockRejectedValue(new Error("sqs unreachable"));

      const result = await call(deps);

      // Returning 202 here would leave the client polling a `queued` job
      // forever — the one failure mode polling cannot recover from.
      expect(result).toEqual({ outcome: "queue_unavailable", job: deps.job });
      expect(deps.repository.fail).toHaveBeenCalledWith(
        "j1",
        expect.objectContaining({ code: "step_failed" }),
      );
      // No quota consumed for a job that will never run.
      expect(deps.usageLog.record).not.toHaveBeenCalled();
    });

    it("a usage-log write failure never fails an accepted job", async () => {
      registerKind();
      const deps = makeDeps();
      deps.usageLog.record.mockRejectedValue(new Error("log table gone"));

      const result = await call(deps);

      expect(result.outcome).toBe("accepted");
    });
  });
});
