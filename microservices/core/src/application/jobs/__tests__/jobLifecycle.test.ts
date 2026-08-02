import { describe, it, expect } from "vitest";
import type { AiJob } from "@persistence/db";
import {
  CLAIM_FENCE_MS,
  isLive,
  isOutOfBudget,
  isStaleQueued,
  isStaleRunning,
  isWarmRunning,
  QUEUED_STALE_AFTER_MS,
  STALE_AFTER_MS,
  TERMINAL_STATUSES,
} from "../jobLifecycle";

const NOW = new Date("2026-08-02T12:00:00.000Z");

/** Infra constants the thresholds below are sized against (`infra/jobs.ts`). */
const VISIBILITY_TIMEOUT_MS = 16 * 60 * 1000;
const WORKER_TIMEOUT_MS = 15 * 60 * 1000;
const REDRIVE_RECEIVES = 3;

function job(overrides: Record<string, unknown> = {}): AiJob {
  return {
    id: "j1",
    status: "running",
    heartbeatAt: new Date(NOW.getTime() - 1000),
    createdAt: new Date(NOW.getTime() - 60_000),
    updatedAt: new Date(NOW.getTime() - 1000),
    attempts: 1,
    maxAttempts: 3,
    invocations: 1,
    maxInvocations: 20,
    ...overrides,
  } as unknown as AiJob;
}

/**
 * ⚠ THESE ARE THE CONSTANTS WHOSE WRONGNESS IS INVISIBLE in any single-function
 * test — each one is only correct RELATIVE to a number that lives in
 * `infra/jobs.ts`, which has neither typecheck nor tests. Both have already been
 * wrong once: `STALE_AFTER_MS` was sized against the worker timeout instead of
 * the visibility timeout, which made the poll endpoint tell users to re-run work
 * that was about to succeed.
 */
describe("threshold relationships", () => {
  it("CLAIM_FENCE_MS < STALE_AFTER_MS — a dead job is re-claimable long before it is written off", () => {
    // The other order would declare a hard-killed job dead before any worker
    // could take it over, throwing away its checkpoint.
    expect(CLAIM_FENCE_MS).toBeLessThan(STALE_AFTER_MS);
  });

  it("STALE_AFTER_MS exceeds the visibility timeout PLUS a full worker run", () => {
    // A job awaiting redelivery after a retryable failure has a legitimately cold
    // heartbeat for the whole visibility window.
    expect(STALE_AFTER_MS).toBeGreaterThan(
      VISIBILITY_TIMEOUT_MS + WORKER_TIMEOUT_MS,
    );
  });

  it("QUEUED_STALE_AFTER_MS exceeds the whole redrive window", () => {
    // Reaping sooner would write off a job whose message is still pending its
    // first receive.
    expect(QUEUED_STALE_AFTER_MS).toBeGreaterThan(
      REDRIVE_RECEIVES * VISIBILITY_TIMEOUT_MS,
    );
  });

  it("the fence is comfortably longer than a heartbeat interval, which is per-step", () => {
    // The spine heartbeats after every step; Loadout's are ~2.6 s.
    expect(CLAIM_FENCE_MS).toBeGreaterThan(60_000);
  });
});

describe("isWarmRunning — the JS mirror of the claim's fence", () => {
  it("false for a queued job", () => {
    expect(isWarmRunning(job({ status: "queued" }), NOW)).toBe(false);
  });

  it("false for a terminal job, however recent its heartbeat", () => {
    for (const status of TERMINAL_STATUSES) {
      expect(isWarmRunning(job({ status }), NOW)).toBe(false);
    }
  });

  it("TRUE while the heartbeat is inside the fence — another worker holds it", () => {
    expect(
      isWarmRunning(
        job({ heartbeatAt: new Date(NOW.getTime() - CLAIM_FENCE_MS + 1) }),
        NOW,
      ),
    ).toBe(true);
  });

  it("true exactly AT the fence — the boundary is inclusive, i.e. still held", () => {
    // Deliberately the conservative direction: at the boundary we assume the
    // holder is alive rather than stealing its job.
    expect(
      isWarmRunning(
        job({ heartbeatAt: new Date(NOW.getTime() - CLAIM_FENCE_MS) }),
        NOW,
      ),
    ).toBe(true);
  });

  it("false once past the fence — the worker is presumed dead and the job takeable", () => {
    expect(
      isWarmRunning(
        job({ heartbeatAt: new Date(NOW.getTime() - CLAIM_FENCE_MS - 1) }),
        NOW,
      ),
    ).toBe(false);
  });

  it("false for a NULL heartbeat — nothing to suggest a live holder", () => {
    // And `isStaleRunning` treats the same row as stale, so the two agree that
    // such a row is takeable rather than protected.
    expect(isWarmRunning(job({ heartbeatAt: null }), NOW)).toBe(false);
    expect(isStaleRunning(job({ heartbeatAt: null }), NOW)).toBe(true);
  });

  it("warm and stale are mutually exclusive at every heartbeat age", () => {
    // The invariant the worker's refusal branches depend on: a row is either held
    // by a live worker, or takeable — never both, never neither-with-a-heartbeat.
    for (const ageMs of [
      0,
      1000,
      CLAIM_FENCE_MS - 1,
      CLAIM_FENCE_MS,
      CLAIM_FENCE_MS + 1,
      STALE_AFTER_MS - 1,
      STALE_AFTER_MS + 1,
    ]) {
      const row = job({ heartbeatAt: new Date(NOW.getTime() - ageMs) });
      expect(isWarmRunning(row, NOW) && isStaleRunning(row, NOW)).toBe(false);
    }
  });
});

describe("isStaleQueued — never-started vs released-mid-flight", () => {
  it("does NOT kill a long-running job that a yield released back to the queue", () => {
    // The bug this exists for: measuring from `createdAt` reported a mid-flight
    // job as "never started and was ended", and if the nightly sweep landed in
    // that window it destroyed every checkpointed step.
    const row = job({
      status: "queued",
      createdAt: new Date(NOW.getTime() - 5 * QUEUED_STALE_AFTER_MS),
      // Released seconds ago by `releaseForResume`, which stamps updatedAt.
      updatedAt: new Date(NOW.getTime() - 5_000),
    });
    expect(isStaleQueued(row, NOW)).toBe(false);
  });

  it("still reaps a genuinely never-started job (updatedAt == createdAt)", () => {
    const created = new Date(NOW.getTime() - QUEUED_STALE_AFTER_MS - 1);
    expect(
      isStaleQueued(
        job({ status: "queued", createdAt: created, updatedAt: created }),
        NOW,
      ),
    ).toBe(true);
  });

  it("reaps a released job whose replacement message also died", () => {
    expect(
      isStaleQueued(
        job({
          status: "queued",
          createdAt: new Date(NOW.getTime() - 5 * QUEUED_STALE_AFTER_MS),
          updatedAt: new Date(NOW.getTime() - QUEUED_STALE_AFTER_MS - 1),
        }),
        NOW,
      ),
    ).toBe(true);
  });
});

describe("isLive / isOutOfBudget", () => {
  it("live covers exactly the two non-terminal statuses", () => {
    expect(isLive(job({ status: "queued" }))).toBe(true);
    expect(isLive(job({ status: "running" }))).toBe(true);
    for (const status of TERMINAL_STATUSES) {
      expect(isLive(job({ status }))).toBe(false);
    }
  });

  it("EITHER bound spent is out of budget", () => {
    expect(isOutOfBudget(job({ attempts: 3, maxAttempts: 3 }))).toBe(true);
    expect(isOutOfBudget(job({ invocations: 20, maxInvocations: 20 }))).toBe(
      true,
    );
    expect(isOutOfBudget(job({ attempts: 2, invocations: 19 }))).toBe(false);
  });

  it("a long job that keeps making progress is never out of budget on attempts", () => {
    // `checkpoint()` resets `attempts` to 0, so this is the steady state of a
    // healthy 120-step job across many invocations.
    expect(isOutOfBudget(job({ attempts: 0, invocations: 19 }))).toBe(false);
  });
});
