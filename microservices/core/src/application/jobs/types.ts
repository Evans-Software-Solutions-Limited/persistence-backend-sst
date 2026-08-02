import type { EntitlementFeature } from "../entitlement/assertEntitlement";

/**
 * Shared async-job spine — the contract a job KIND implements.
 * `specs/_shared/async-jobs/design.md` § 4.
 *
 * The spine owns claiming, checkpointing, heartbeats, the time budget,
 * completion and failure. A kind owns only its own work: how big the job is
 * (`plan`), one unit of it (`runStep`), and how to assemble the answer
 * (`finish`). A kind that finds itself reimplementing any lifecycle concern is
 * a spine bug, not a kind bug (AC-6.2).
 */

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

/**
 * Failure taxonomy — design § 3.5.
 *
 * `retryable` is the worker's decision, not the caller's: a non-retryable
 * failure is marked terminal immediately and the queue message is deleted,
 * because redelivering work that can never succeed only burns invocations on
 * the way to the DLQ.
 */
export type JobErrorCode =
  | "ai_unavailable"
  | "step_failed"
  | "unknown_kind"
  | "input_invalid"
  | "attempts_exhausted"
  | "stale";

export interface JobError {
  code: JobErrorCode;
  message: string;
  retryable: boolean;
}

/** Codes that must never be retried, however they arose. */
export const NON_RETRYABLE_CODES: ReadonlySet<JobErrorCode> =
  new Set<JobErrorCode>([
    "unknown_kind",
    "input_invalid",
    "attempts_exhausted",
    "stale",
  ]);

/**
 * Thrown by a kind's `plan`/`runStep` to fail the job terminally with a
 * specific code. Anything else a kind throws is `step_failed` (retryable) —
 * fail-safe in the direction of retrying, since an unrecognised throw is more
 * likely a blip than a permanent rejection.
 */
export class JobKindError extends Error {
  // Plain field declarations, not constructor parameter properties — the web
  // package's tsconfig sets `erasableSyntaxOnly: true`, which forbids those.
  // Mirrors `AiUnreadableError` and `EntitlementError`.
  public readonly code: JobErrorCode;
  public readonly retryable: boolean;

  constructor(code: JobErrorCode, message: string) {
    super(message);
    this.name = "JobKindError";
    this.code = code;
    this.retryable = !NON_RETRYABLE_CODES.has(code);
    Object.setPrototypeOf(this, JobKindError.prototype);
  }
}

/**
 * Thrown by a kind's `plan` when the request is over the kind's own bound.
 * Surfaces as `413` from the enqueue path — never a silent truncation
 * (spec-21 design § 7.3: "No silent truncation").
 */
export class JobTooLargeError extends Error {
  public readonly total: number;
  public readonly limit: number;

  constructor(total: number, limit: number, message: string) {
    super(message);
    this.name = "JobTooLargeError";
    this.total = total;
    this.limit = limit;
    Object.setPrototypeOf(this, JobTooLargeError.prototype);
  }
}

export interface JobStepContext<TInput, TCheckpoint> {
  jobId: string;
  userId: string;
  input: TInput;
  /** `null` on the first step of a job that has never checkpointed. */
  checkpoint: TCheckpoint | null;
  /** 0-based index of the step about to run. */
  index: number;
  total: number;
}

export interface JobFinishContext<TInput, TCheckpoint> {
  jobId: string;
  userId: string;
  input: TInput;
  checkpoint: TCheckpoint | null;
  total: number;
}

export interface JobKind<
  TInput = unknown,
  TCheckpoint = unknown,
  TResult = unknown,
> {
  /** Registry key. Also the value written to `ai_jobs.kind`. */
  kind: string;

  /**
   * The entitlement gate asserted at ENQUEUE, before any row is written.
   *
   * ⚠ MANDATORY, and that is the point (AC-4.2). `assertEntitlement` returns
   * `{ allowed: true }` for any `EntitlementFeature` lacking an explicit
   * routing line, so a paid gate can silently become a no-op with no type
   * error and no failing test. Making this field non-optional means a job kind
   * cannot ship ungated *by omission*.
   *
   * It does NOT verify the named feature is actually routed. A kind naming one
   * of the accept-all stubs (`ai_workout`, `gym_buddy`,
   * `unlimited_exercise_library`) is gated by nothing — the consuming spec
   * still owns adding its `if (feature === …)` line in `assertEntitlement`.
   */
  feature: EntitlementFeature;

  /**
   * Env var holding this kind's per-day ceiling, and its fail-safe default.
   * Parsed on the #156 pattern: garbage → NaN and "" → 0 must fall back to the
   * default rather than silently disabling the guard.
   */
  ceilingEnv: string;
  ceilingDefault: number;

  /**
   * ⚠ THE TWO KEYS MUST DIFFER (AC-4.4, design § 5).
   *
   * `ceilingEndpoint` gets ONE `ai_usage_log` row per JOB and is what the daily
   * ceiling counts. `inferenceEndpoint` gets one row per MODEL CALL and is
   * never counted against a ceiling — it is cost telemetry.
   *
   * With a single key, a 120-inference job writes 120 rows under its own
   * ceiling key and trips its own ceiling on the first run. The shipped
   * single-workout path gets away with one key only because it is one
   * inference per request; the obvious extension to the programme case is
   * exactly the wrong one. `registerJobKind` rejects a kind whose two keys are
   * equal rather than trusting this comment to be read.
   */
  ceilingEndpoint: string;
  inferenceEndpoint: string;

  /**
   * Validate the input and size the work. Throws `JobKindError('input_invalid')`
   * for a bad request and `JobTooLargeError` when over the kind's own bound.
   *
   * Runs on the ENQUEUE path (inside the 29 s API Lambda), so it must be cheap
   * — SQL and arithmetic, never a model call.
   */
  plan(input: TInput, userId: string): Promise<{ total: number }>;

  /**
   * One unit of work. Returns the checkpoint to persist, which is whatever this
   * kind needs to skip completed work on resume.
   *
   * ⚠ Must be safe to re-run for a given index: the spine guarantees a
   * checkpoint is written after each step, but a worker killed between the step
   * and its checkpoint write will re-run that one step.
   */
  runStep(ctx: JobStepContext<TInput, TCheckpoint>): Promise<TCheckpoint>;

  /** Assemble the terminal result from the final checkpoint. */
  finish(ctx: JobFinishContext<TInput, TCheckpoint>): Promise<TResult>;
}

/** The message body on the queue. Deliberately tiny — the row is the state. */
export interface JobMessage {
  jobId: string;
}
