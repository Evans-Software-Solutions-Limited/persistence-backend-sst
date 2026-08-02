import { databaseUrl, sentryDsn } from "./secrets";

/**
 * The shared async-job spine — `specs/_shared/async-jobs/design.md` § 1 / § 7.
 *
 * Work that outlives the request: Loadout programme adaptation (spec-21 Phase
 * 4, ~5 minutes at the 120-workout cap), Mealprint week plans (spec-26 Phase
 * 3), program import. All three of those specs say this must not be built
 * twice; this is the once.
 *
 * ## Why SQS rather than Step Functions
 *
 * The obvious draw of a Distributed Map is 120-wide parallel fan-out — which is
 * exactly what we must NOT do. 120 concurrent Bedrock calls would hit model
 * throughput limits, and on the DB side would blow through `DB_POOL_MAX` (4)
 * into the deadlock territory `packages/db/src/client.ts` documents at length.
 * The work is a sequential loop with checkpoints, the one shape Step Functions
 * buys nothing for, and it would add a new IaC surface to a repo whose entire
 * async footprint today is five `sst.aws.Cron`s.
 */

/**
 * Dead-letter queue. A message here is a job that failed its whole redrive
 * policy — see the alarm in `infra/monitoring.ts`.
 *
 * The job ROW is still the source of truth for the user: the worker marks a job
 * terminally failed on a non-retryable error, and the staleness sweep catches
 * anything hard-killed. So the DLQ is an operator signal, not a recovery
 * mechanism — nobody polls it to find out what happened to their programme.
 */
export const aiJobDlq = new sst.aws.Queue("AiJobDlq");

export const aiJobQueue = new sst.aws.Queue("AiJobQueue", {
  // ⚠ MUST EXCEED THE WORKER TIMEOUT (design § 1.2(1)). Otherwise SQS
  // redelivers a message whose worker is still running and two workers race on
  // one job. The claim (a single conditional UPDATE) makes that safe rather
  // than catastrophic — the second claim affects zero rows and drops — but it
  // burns an invocation per redelivery and makes the DLQ count meaningless.
  // 16 minutes = the worker's 15 + a minute of headroom.
  visibilityTimeout: "16 minutes",
  dlq: { queue: aiJobDlq.arn, retry: 3 },
});

/**
 * Exported so `infra/monitoring.ts` can dimension the worker's `Errors` alarm
 * onto THIS function. The worker is neither the API route nor a cron, so
 * without an explicitly-dimensioned alarm it is covered by nothing at all.
 */
export const aiJobWorker = aiJobQueue.subscribe(
  {
    handler: "microservices/core/src/aiJobWorker.handler",
    // ⚠ 15 minutes — the Lambda maximum, and EXPLICIT because SST defaults a
    // function to **20 seconds** (`.sst/platform/src/components/aws/function.ts`
    // — `timeout ?? "20 seconds"`). That default silently truncated two model
    // paths on the API route; see the long comment on `coreRoute` in
    // `infra/api.ts`. On a five-minute job it would be catastrophic rather than
    // merely wrong, and the worker's own time-budget check (design § 3.3) is
    // sized against THIS number.
    timeout: "15 minutes",
    // ⚠ Each worker holds up to `DB_POOL_MAX` (4) Postgres sockets for the
    // whole of a run that can last 15 minutes — far longer than any request
    // Lambda. 5 concurrent workers → ≤ 20 sockets, comfortably inside
    // Supavisor's pool, and it doubles as the bound on how much Bedrock spend a
    // burst can generate.
    concurrency: { reserved: 5 },
    // ⚠ Both ARN shapes are required and this is deliberately COPIED from
    // `coreRoute` rather than shared: Bedrock denies the call if only the
    // inference profile is granted, because the profile is a routing
    // indirection rather than a standalone invokable unit. A worker missing one
    // of them fails at runtime only. The wildcards already cover every model id
    // a job kind will use, so registering a kind needs no IAM change.
    permissions: [
      {
        actions: ["bedrock:InvokeModel"],
        resources: [
          "arn:aws:bedrock:*::foundation-model/anthropic.*",
          "arn:aws:bedrock:*:*:inference-profile/eu.anthropic.*",
        ],
      },
    ],
    environment: {
      DATABASE_URL: databaseUrl.value,
      // Sentry crash reporting (optional; empty DSN = disabled), same fail-safe
      // shape as the crons.
      SENTRY_DSN: sentryDsn.value,
      // ⚠ Model ids and per-kind ceilings are deliberately NOT set here yet.
      // This spine ships with an empty kind registry; the first consuming
      // feature (spec-21 Loadout Phase 4) adds its own `AI_*_MODEL_ID` and
      // `AI_*_DAILY_LIMIT` alongside its kind, so the two never drift apart.
    },
  },
  {
    // ⚠ ONE job per invocation (design § 1.2(4)). A batch of ten five-minute
    // jobs cannot finish inside one 900 s invocation, and partial-batch-failure
    // reporting would be a second, entirely avoidable correctness problem.
    batch: { size: 1 },
  },
);
