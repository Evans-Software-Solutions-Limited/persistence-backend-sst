/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AiUnavailableError } from "../../nutrition/services/aiBedrockClient";
import {
  CHECKPOINT_RESERVE_MS,
  INITIAL_STEP_ESTIMATE_MS,
  runJob,
} from "../runJob";
import { __clearJobKindRegistry, registerJobKind } from "../registry";
import { JobKindError } from "../types";

/**
 * A fake job row. Only the fields `runJob` reads are populated — the spine is
 * deliberately incurious about `input`/`checkpoint`/`result`.
 */
function job(overrides: Record<string, unknown> = {}) {
  return {
    id: "j1",
    userId: "u1",
    kind: "test_kind",
    status: "running",
    input: { seed: 1 },
    checkpoint: null,
    progressDone: 0,
    progressTotal: 3,
    attempts: 1,
    maxAttempts: 3,
    invocations: 1,
    maxInvocations: 20,
    ...overrides,
  } as any;
}

function makeRepo(claimed: unknown, existing: unknown = null) {
  return {
    claim: vi.fn().mockResolvedValue(claimed),
    get: vi.fn().mockResolvedValue(existing),
    checkpoint: vi.fn().mockResolvedValue(undefined),
    releaseForResume: vi.fn().mockResolvedValue(undefined),
    heartbeat: vi.fn().mockResolvedValue(undefined),
    succeed: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function makeQueue() {
  return { send: vi.fn().mockResolvedValue(undefined) };
}

/**
 * A registered kind whose steps just append their index.
 *
 * The params are typed loosely on purpose: individual tests substitute steps
 * returning different checkpoint shapes (an array here, `{ n }` in the resume
 * test), and the spine is deliberately incurious about that shape.
 */
type AnyStep = ReturnType<typeof vi.fn>;
function registerCountingKind(
  runStep: AnyStep = vi.fn(async (ctx: any) => [
    ...(ctx.checkpoint ?? []),
    ctx.index,
  ]),
  finish: AnyStep = vi.fn(async (ctx: any) => ({ steps: ctx.checkpoint })),
) {
  registerJobKind({
    kind: "test_kind",
    feature: "loadout",
    ceilingEnv: "TEST_LIMIT",
    ceilingDefault: 3,
    ceilingEndpoint: "/test/job",
    inferenceEndpoint: "/test/job/inference",
    plan: vi.fn(async () => ({ total: 3 })),
    runStep,
    finish,
  } as any);
  return { runStep, finish };
}

describe("runJob", () => {
  beforeEach(() => {
    __clearJobKindRegistry();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  const plentyOfTime = () => 15 * 60 * 1000;

  describe("the claim (AC-3.1) — exactly-once under at-least-once delivery", () => {
    it("a duplicate delivery of an already-succeeded job runs NO step", async () => {
      const { runStep } = registerCountingKind();
      const repo = makeRepo(null, job({ status: "succeeded", attempts: 1 }));

      const outcome = await runJob({
        jobId: "j1",
        remainingMs: plentyOfTime,
        repository: repo,
        queue: makeQueue() as any,
      });

      expect(outcome.status).toBe("skipped");
      expect(runStep).not.toHaveBeenCalled();
      expect(repo.fail).not.toHaveBeenCalled();
    });

    it("losing the claim to a LIVE worker THROWS — the message must survive, not be deleted", async () => {
      // The fence's mutual exclusion is a property of the claim SQL and of
      // `isWarmRunning` (jobLifecycle.test.ts). What runJob owns is the RESPONSE
      // to losing it: do no work, do not fail the job the other worker is
      // running, and do not let SQS delete the message — if the holder dies, a
      // later redelivery has to be able to take the job over.
      const { runStep } = registerCountingKind();
      const repo = makeRepo(
        null,
        job({
          status: "running",
          attempts: 1,
          invocations: 1,
          // Warm: heartbeat seconds old, which is why the claim was refused.
          heartbeatAt: new Date(Date.now() - 1000),
        }),
      );

      await expect(
        runJob({
          jobId: "j1",
          remainingMs: plentyOfTime,
          repository: repo,
          queue: makeQueue() as any,
        }),
      ).rejects.toThrow(/held by a live worker/);

      expect(runStep).not.toHaveBeenCalled();
      expect(repo.fail).not.toHaveBeenCalled();
    });

    it("⚠ a warm holder on its LAST allowed claim is NOT failed by a duplicate", async () => {
      // The ordering bug: with the budget checked first, a duplicate arriving
      // during the holder's final invocation would mark the job
      // `attempts_exhausted` while the holder was still spending Bedrock — and
      // `succeed()` is scoped to `running`, so the finished result would be
      // discarded and the user told the job failed repeatedly.
      registerCountingKind();
      const repo = makeRepo(
        null,
        job({
          status: "running",
          attempts: 3,
          maxAttempts: 3,
          invocations: 20,
          maxInvocations: 20,
          heartbeatAt: new Date(Date.now() - 1000),
        }),
      );

      await expect(
        runJob({
          jobId: "j1",
          remainingMs: plentyOfTime,
          repository: repo,
          queue: makeQueue() as any,
        }),
      ).rejects.toThrow(/held by a live worker/);
      expect(repo.fail).not.toHaveBeenCalled();
    });

    it("⚠ a redelivery refused by the FENCE throws rather than orphaning the job", async () => {
      // The bug this exists for: a retryable step failure late in a 15-minute
      // invocation is redelivered ~16 min later with a heartbeat only ~2 min old —
      // inside the 5-minute fence — so the claim refuses. Returning `skipped`
      // there DELETED the message and left the job `running` with its checkpoint
      // stranded until the nightly sweep: ~$0.63 of purchased inference discarded
      // on the very path this spine exists to protect.
      registerCountingKind();
      const repo = makeRepo(
        null,
        job({
          status: "running",
          attempts: 1,
          invocations: 2,
          heartbeatAt: new Date(Date.now() - 2 * 60 * 1000),
        }),
      );

      await expect(
        runJob({
          jobId: "j1",
          remainingMs: plentyOfTime,
          repository: repo,
          queue: makeQueue() as any,
        }),
      ).rejects.toThrow(/held by a live worker/);
      expect(repo.fail).not.toHaveBeenCalled();
    });

    it("a QUEUED row whose claim was lost is SKIPPED — a replacement message already exists", async () => {
      // Branch (d), queued sub-case. This is provably the aftermath of another
      // worker's yield, and `releaseForResume` is always followed by a `send`. So
      // a message already exists; throwing would add a SECOND one, which then
      // bounces off the real worker for three receives and lands in the DLQ while
      // the job succeeds — tripping a `threshold: 1` alarm whose text says a
      // paying user lost a job.
      registerCountingKind();
      const repo = makeRepo(
        null,
        job({
          status: "queued",
          attempts: 0,
          invocations: 1,
          heartbeatAt: new Date(Date.now() - 30 * 60 * 1000),
        }),
      );

      const outcome = await runJob({
        jobId: "j1",
        remainingMs: plentyOfTime,
        repository: repo,
        queue: makeQueue() as any,
      });

      expect(outcome.status).toBe("skipped");
      expect(repo.fail).not.toHaveBeenCalled();
    });

    it("a RUNNING-but-cold row whose claim was lost throws, not skips", async () => {
      // Branch (d): live, in budget, not warm — another worker claimed it between
      // our UPDATE and this read. Nothing to do now, but the message must survive
      // in case that worker dies.
      // A genuine race: someone claimed it between our UPDATE and this read.
      // Nothing to do now, but the message must survive in case they die.
      registerCountingKind();
      const repo = makeRepo(
        null,
        job({
          status: "running",
          attempts: 0,
          invocations: 1,
          // Cold, so the warm branch does not catch it.
          heartbeatAt: new Date(Date.now() - 10 * 60 * 1000),
        }),
      );

      await expect(
        runJob({
          jobId: "j1",
          remainingMs: plentyOfTime,
          repository: repo,
          queue: makeQueue() as any,
        }),
      ).rejects.toThrow(/not claimable yet/);
      expect(repo.fail).not.toHaveBeenCalled();
      expect(repo.succeed).not.toHaveBeenCalled();
    });

    it("AC-3.4: a claim refused on EXHAUSTED attempts becomes terminal, not a silent skip", async () => {
      registerCountingKind();
      // SQS can deliver more times than max_attempts allows executions. Without
      // this, the job would sit `running` until the staleness sweep found it 15
      // minutes later.
      const repo = makeRepo(
        null,
        // COLD heartbeat: the fence is not what refused this claim, the budget is.
        job({
          status: "running",
          attempts: 3,
          maxAttempts: 3,
          heartbeatAt: new Date(Date.now() - 30 * 60 * 1000),
        }),
      );

      const outcome = await runJob({
        jobId: "j1",
        remainingMs: plentyOfTime,
        repository: repo,
        queue: makeQueue() as any,
      });

      expect(outcome).toMatchObject({
        status: "failed",
        code: "attempts_exhausted",
      });
      expect(repo.fail).toHaveBeenCalledWith(
        "j1",
        expect.objectContaining({
          code: "attempts_exhausted",
          retryable: false,
        }),
      );
    });

    it("a claim refused on EXHAUSTED INVOCATIONS is terminal too — the backstop attempts cannot be", async () => {
      // `attempts` resets on progress, so a job that makes one step then yields
      // forever would re-enqueue indefinitely (a yield deletes its message and
      // publishes a new one, so SQS's receive count resets too). `invocations`
      // is the counter that never resets.
      registerCountingKind();
      const repo = makeRepo(
        null,
        job({
          status: "queued",
          attempts: 0,
          maxAttempts: 3,
          invocations: 20,
          maxInvocations: 20,
        }),
      );

      const outcome = await runJob({
        jobId: "j1",
        remainingMs: plentyOfTime,
        repository: repo,
        queue: makeQueue() as any,
      });

      expect(outcome).toMatchObject({
        status: "failed",
        code: "attempts_exhausted",
      });
    });

    it("a vanished job is skipped, not failed", async () => {
      registerCountingKind();
      const repo = makeRepo(null, null);
      const outcome = await runJob({
        jobId: "j1",
        remainingMs: plentyOfTime,
        repository: repo,
        queue: makeQueue() as any,
      });
      expect(outcome.status).toBe("skipped");
      expect(repo.fail).not.toHaveBeenCalled();
    });
  });

  describe("execution + checkpointing", () => {
    it("runs every step, checkpoints after EACH one, then finishes", async () => {
      const { runStep, finish } = registerCountingKind();
      const repo = makeRepo(job());

      const outcome = await runJob({
        jobId: "j1",
        remainingMs: plentyOfTime,
        repository: repo,
        queue: makeQueue() as any,
      });

      expect(outcome).toMatchObject({
        status: "succeeded",
        stepsRun: 3,
        progress: 3,
      });
      expect(runStep).toHaveBeenCalledTimes(3);
      // Never batched: a hard-kill mid-invocation would otherwise lose the whole
      // invocation's progress, and with it the cost accounting for inference
      // already billed (AC-4.5).
      expect(repo.checkpoint).toHaveBeenCalledTimes(3);
      expect(
        repo.checkpoint.mock.calls.map((c: any[]) => c[0].progressDone),
      ).toEqual([1, 2, 3]);
      expect(finish).toHaveBeenCalledTimes(1);
      expect(repo.succeed).toHaveBeenCalledWith("j1", { steps: [0, 1, 2] });
    });

    it("threads a working heartbeat into the step context", async () => {
      // Previously the repository method existed but nothing could reach it, so a
      // kind whose single step outlasts CLAIM_FENCE_MS would be taken over
      // mid-step by another worker.
      const runStep = vi.fn(async (ctx: any) => {
        await ctx.heartbeat();
        return ctx.index;
      });
      registerCountingKind(runStep);
      const repo = makeRepo(job({ progressTotal: 2 }));

      await runJob({
        jobId: "j1",
        remainingMs: plentyOfTime,
        repository: repo,
        queue: makeQueue() as any,
      });

      expect(typeof runStep.mock.calls[0][0].heartbeat).toBe("function");
      expect(repo.heartbeat).toHaveBeenCalledWith("j1");
      expect(repo.heartbeat).toHaveBeenCalledTimes(2);
    });

    it("AC-3.3: a job checkpointed at 90/120 runs 30 steps, NOT 120", async () => {
      // The whole cost argument for checkpointing: without it this retry
      // re-buys ~$0.52 of inference already purchased.
      const runStep = vi.fn(async (ctx: any) => ({ n: ctx.index + 1 }));
      registerCountingKind(runStep);
      const repo = makeRepo(
        job({ progressDone: 90, progressTotal: 120, checkpoint: { n: 90 } }),
      );

      const outcome = await runJob({
        jobId: "j1",
        remainingMs: plentyOfTime,
        repository: repo,
        queue: makeQueue() as any,
      });

      expect(outcome).toMatchObject({ status: "succeeded", stepsRun: 30 });
      expect(runStep).toHaveBeenCalledTimes(30);
      // It resumes AT the checkpoint, not from zero.
      expect(runStep.mock.calls[0][0].index).toBe(90);
      expect(runStep.mock.calls[0][0].checkpoint).toEqual({ n: 90 });
    });

    it("a zero-step job finishes immediately without running a step", async () => {
      const { runStep, finish } = registerCountingKind();
      const repo = makeRepo(job({ progressTotal: 0 }));

      const outcome = await runJob({
        jobId: "j1",
        remainingMs: plentyOfTime,
        repository: repo,
        queue: makeQueue() as any,
      });

      expect(outcome.status).toBe("succeeded");
      expect(runStep).not.toHaveBeenCalled();
      expect(finish).toHaveBeenCalledTimes(1);
    });
  });

  describe("the time budget (§ 3.3) — stop before the kill", () => {
    it("yields and re-enqueues instead of starting a step it cannot finish", async () => {
      const { runStep } = registerCountingKind();
      const repo = makeRepo(job({ progressTotal: 10 }));
      const queue = makeQueue();
      // Just under the first step's reserve, so it yields before step one.
      const remainingMs = vi
        .fn()
        .mockReturnValue(INITIAL_STEP_ESTIMATE_MS + CHECKPOINT_RESERVE_MS - 1);

      const outcome = await runJob({
        jobId: "j1",
        remainingMs,
        repository: repo,
        queue: queue as any,
      });

      expect(outcome).toMatchObject({ status: "yielded", stepsRun: 0 });
      expect(runStep).not.toHaveBeenCalled();
      // A hard-kill runs no `finally`, so the re-enqueue must happen BEFORE the
      // deadline — that is the whole point of the reserve.
      expect(queue.send).toHaveBeenCalledWith({ jobId: "j1" });
      // ⚠ RELEASED to `queued` before the publish. That is what lets the claim's
      // fence be strict about `running`: a yielded job has explicitly given
      // itself up, so the resume needs no takeover window and cannot overlap the
      // worker that yielded.
      expect(repo.releaseForResume).toHaveBeenCalledWith("j1");
      expect(repo.releaseForResume.mock.invocationCallOrder[0]).toBeLessThan(
        queue.send.mock.invocationCallOrder[0],
      );
      expect(repo.fail).not.toHaveBeenCalled();
      expect(repo.succeed).not.toHaveBeenCalled();
    });

    it("uses the OBSERVED slowest step, not a constant, to size the reserve", async () => {
      // A kind whose steps vary would otherwise either over-reserve (abandoning
      // a run with minutes left) or under-reserve and get hard-killed.
      let clock = 0;
      const now = () => clock;
      const runStep = vi.fn(async (ctx: any) => {
        clock += 1_000; // each step takes 1s
        return ctx.index;
      });
      registerCountingKind(runStep);
      const repo = makeRepo(job({ progressTotal: 10 }));
      const queue = makeQueue();

      // The budget starts a hair above the FIRST step's reserve (20 s estimate
      // + 15 s), and shrinks as the clock advances. That is what makes this a
      // real test: with a fixed 20 s estimate, step two would need
      // 35 000 < 35 000 and the run would yield after exactly one step. With the
      // rolling max — 1 s observed × 1.5 + 15 s — it keeps going.
      const budgetAtStart =
        INITIAL_STEP_ESTIMATE_MS + CHECKPOINT_RESERVE_MS + 100;
      const remainingMs = vi.fn(() => budgetAtStart - clock);

      const outcome = await runJob({
        jobId: "j1",
        remainingMs,
        repository: repo,
        queue: queue as any,
        now,
      });

      expect(outcome.stepsRun).toBeGreaterThan(1);
      // And it does eventually stop rather than run past the deadline: the
      // budget only allows ~20 of these, so a 10-step job completes.
      expect(outcome.status).toBe("succeeded");
      expect(runStep).toHaveBeenCalledTimes(10);
    });

    it("keeps reserving for a slow TAIL step: the estimate is a max, so one slow step raises it for good", async () => {
      // The first step is slow (18 s) and the rest are fast (1 s). Because the
      // estimate is a MAX rather than an average, it stays at 18 s — so the run
      // yields conservatively instead of assuming the remaining steps are all
      // cheap. Deliberately conservative: a hard-kill is unrecoverable, an extra
      // invocation costs a few hundred milliseconds.
      let clock = 0;
      const now = () => clock;
      const runStep = vi.fn(async (ctx: any) => {
        clock += ctx.index === 0 ? 18_000 : 1_000;
        return ctx.index;
      });
      registerCountingKind(runStep);
      const repo = makeRepo(job({ progressTotal: 10 }));
      const queue = makeQueue();

      const budgetAtStart = 60_000;
      const outcome = await runJob({
        jobId: "j1",
        remainingMs: () => budgetAtStart - clock,
        repository: repo,
        queue: queue as any,
        now,
      });

      // 18 s × 1.5 + 15 s = 42 s reserved after the first step. Budget left
      // after it is 42 s, so exactly one more step fits, then it yields —
      // conservative, and deliberately so: a hard-kill is unrecoverable.
      expect(outcome.status).toBe("yielded");
      expect(outcome.stepsRun).toBeLessThan(10);
      expect(queue.send).toHaveBeenCalledWith({ jobId: "j1" });
    });

    it("fails the job when the re-enqueue itself cannot be published", async () => {
      registerCountingKind();
      const repo = makeRepo(job({ progressTotal: 10 }));
      const queue = {
        send: vi.fn().mockRejectedValue(new Error("sqs down")),
      };

      const outcome = await runJob({
        jobId: "j1",
        remainingMs: () => 0,
        repository: repo,
        queue: queue as any,
      });

      // Better a prompt, honest error than a `running` job reaped as stale 15
      // minutes later. The work done so far is already checkpointed.
      expect(outcome.status).toBe("failed");
      expect(repo.fail).toHaveBeenCalledWith(
        "j1",
        expect.objectContaining({ code: "step_failed" }),
      );
    });
  });

  describe("failure taxonomy (§ 3.5)", () => {
    it("an unknown kind is TERMINAL — deploy skew must not retry forever", async () => {
      const repo = makeRepo(job({ kind: "not_registered" }));

      const outcome = await runJob({
        jobId: "j1",
        remainingMs: plentyOfTime,
        repository: repo,
        queue: makeQueue() as any,
      });

      expect(outcome).toMatchObject({ status: "failed", code: "unknown_kind" });
      expect(repo.fail).toHaveBeenCalledWith(
        "j1",
        expect.objectContaining({ code: "unknown_kind", retryable: false }),
      );
    });

    it("a RETRYABLE step failure with attempts left THROWS, so SQS redelivers", async () => {
      // Throwing is the retry mechanism. The job stays `running` with its
      // checkpoint intact, so the redelivery resumes rather than restarts.
      registerCountingKind(
        vi.fn().mockRejectedValue(new AiUnavailableError("bedrock 429")),
      );
      const repo = makeRepo(job({ attempts: 1, maxAttempts: 3 }));

      await expect(
        runJob({
          jobId: "j1",
          remainingMs: plentyOfTime,
          repository: repo,
          queue: makeQueue() as any,
        }),
      ).rejects.toThrow("bedrock 429");
      expect(repo.fail).not.toHaveBeenCalled();
    });

    it("⚠ PROGRESS WITHIN AN INVOCATION restores the retry allowance — the job is NOT failed", async () => {
      // The bug: `claimed.attempts` is read once at claim time, but
      // `checkpoint()` sets `attempts = 0` on every completed step. Testing the
      // claim-time value tests a counter the loop has already invalidated — so a
      // job that stalled twice and then completed 40 steps in its third
      // invocation would be failed TERMINALLY by the next transient Bedrock 429,
      // discarding ~$0.23 of purchased inference. Both earlier review passes
      // missed this, and the comment above the guard claimed it was impossible.
      let call = 0;
      const runStep = vi.fn(async (ctx: any) => {
        call += 1;
        // Two successful steps, then a retryable failure.
        if (call > 2) throw new AiUnavailableError("bedrock 429");
        return ctx.index;
      });
      registerCountingKind(runStep);
      // Claim-time attempts are already AT the bound: the previous two
      // invocations stalled without progress.
      const repo = makeRepo(
        job({ progressTotal: 10, attempts: 3, maxAttempts: 3 }),
      );

      await expect(
        runJob({
          jobId: "j1",
          remainingMs: plentyOfTime,
          repository: repo,
          queue: makeQueue() as any,
        }),
      ).rejects.toThrow("bedrock 429");

      // THROWN, so SQS redelivers and the 2 completed steps are kept. Failing
      // here would have discarded them.
      expect(repo.fail).not.toHaveBeenCalled();
      expect(repo.checkpoint).toHaveBeenCalledTimes(2);
    });

    it("but a stall with NO progress in this invocation is still terminal at the bound", async () => {
      // The counterpart: the reset must not make the bound unenforceable.
      registerCountingKind(
        vi.fn().mockRejectedValue(new AiUnavailableError("bedrock 429")),
      );
      const repo = makeRepo(
        job({ progressTotal: 10, attempts: 3, maxAttempts: 3 }),
      );

      const outcome = await runJob({
        jobId: "j1",
        remainingMs: plentyOfTime,
        repository: repo,
        queue: makeQueue() as any,
      });

      expect(outcome).toMatchObject({
        status: "failed",
        code: "ai_unavailable",
      });
      expect(repo.checkpoint).not.toHaveBeenCalled();
    });

    it("the SAME failure on the LAST attempt is terminal, not another throw", async () => {
      registerCountingKind(
        vi.fn().mockRejectedValue(new AiUnavailableError("bedrock 429")),
      );
      const repo = makeRepo(job({ attempts: 3, maxAttempts: 3 }));

      const outcome = await runJob({
        jobId: "j1",
        remainingMs: plentyOfTime,
        repository: repo,
        queue: makeQueue() as any,
      });

      expect(outcome).toMatchObject({
        status: "failed",
        code: "ai_unavailable",
      });
    });

    it("a NON-retryable kind error is terminal immediately, even with attempts left", async () => {
      registerCountingKind(
        vi
          .fn()
          .mockRejectedValue(new JobKindError("input_invalid", "bad input")),
      );
      const repo = makeRepo(job({ attempts: 1, maxAttempts: 3 }));

      const outcome = await runJob({
        jobId: "j1",
        remainingMs: plentyOfTime,
        repository: repo,
        queue: makeQueue() as any,
      });

      expect(outcome).toMatchObject({
        status: "failed",
        code: "input_invalid",
      });
      expect(repo.fail).toHaveBeenCalledWith(
        "j1",
        expect.objectContaining({ retryable: false }),
      );
    });

    it("an unrecognised throw is classified RETRYABLE — fail-safe toward retrying", async () => {
      registerCountingKind(vi.fn().mockRejectedValue(new Error("who knows")));
      const repo = makeRepo(job({ attempts: 3, maxAttempts: 3 }));

      const outcome = await runJob({
        jobId: "j1",
        remainingMs: plentyOfTime,
        repository: repo,
        queue: makeQueue() as any,
      });

      expect(outcome.code).toBe("step_failed");
      expect(repo.fail).toHaveBeenCalledWith(
        "j1",
        expect.objectContaining({ retryable: true }),
      );
    });

    it("a throw from finish() fails the job rather than escaping as a crash", async () => {
      registerCountingKind(
        undefined,
        vi.fn().mockRejectedValue(new Error("assembly blew up")),
      );
      const repo = makeRepo(job());

      const outcome = await runJob({
        jobId: "j1",
        remainingMs: plentyOfTime,
        repository: repo,
        queue: makeQueue() as any,
      });

      expect(outcome.status).toBe("failed");
      expect(repo.succeed).not.toHaveBeenCalled();
    });
  });
});
