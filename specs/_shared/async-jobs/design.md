# Shared async-job spine — Design

> Companion to `requirements.md`. **This is the single place the job-table
> design lives** — spec-21 § 7.3, spec-26 § "Model + sizing" and the parked
> program-import workstream all defer here.

---

## 1. Substrate: SQS standard queue + a worker Lambda

```
POST /<feature>/…/jobs            (api Lambda, 29 s)
  ├─ assertEntitlement (402)
  ├─ daily ceiling      (429)
  ├─ kind.totalFor()    (413 if over the kind's own bound)
  ├─ idempotency probe on client_request_id  → 200 with the existing job
  ├─ INSERT ai_jobs (status='queued')
  └─ SQS SendMessage { jobId }  → 202 { jobId, status:'queued' }
        │                          (publish fails → job='failed', 503)
        ▼
  aiJobQueue  ──── event source ────►  aiJobWorker (900 s Lambda)
        │                                 ├─ CLAIM (conditional UPDATE)
        │                                 ├─ loop: runStep → checkpoint
        │                                 ├─ time budget → re-enqueue
        │                                 └─ succeeded | failed
        └─ maxReceiveCount → aiJobDlq ──► CloudWatch alarm

GET /jobs/:id  (api Lambda) — owner-scoped read of ai_jobs, no recompute
```

### 1.1 Why SQS rather than the alternatives

| Option                                     | Why not                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Step Functions** (incl. Distributed Map) | The natural draw is 120-wide parallel fan-out — but that is precisely what we must **not** do: 120 concurrent Bedrock calls would hit model throughput limits and, on the DB side, blow through `DB_POOL_MAX` (4) into the deadlock territory `client.ts` documents at length. The work is a sequential loop with checkpoints, which is the one shape Step Functions buys nothing for. It also adds a new IaC + local-testing surface for a repo whose async surface today is four `sst.aws.Cron`s. |
| **EventBridge → Lambda**                   | No per-message retry accounting, no DLQ redrive semantics, no visibility timeout. Everything US-3 needs would be hand-rolled.                                                                                                                                                                                                                                                                                                                                                                       |
| **Lambda self-invoke**                     | No durability if the invoke is lost, no DLQ, no queue depth to alarm on.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Cron polling `ai_jobs`**                 | The cheapest thing that could work, and a legitimate fallback if SQS is ever unavailable — but a 1-minute cron adds up to 60 s of dead time to a job the user is watching, and 1440 invocations/day against a shared account concurrency budget (`STATE.md`: raised to 1000 on 2026-08-01, was 10). SQS invokes on arrival and costs nothing idle.                                                                                                                                                  |

**SQS standard, not FIFO.** FIFO's exactly-once is per-message-group and would
serialise all jobs in a group; we need per-job idempotency, which the database
claim gives us unconditionally (§ 3.1) and which we would need regardless
because Lambda retries exist independent of SQS.

### 1.2 The four settings that are load-bearing

These are the ones that silently break an SQS+Lambda pair, so they are stated
as invariants rather than left to the infra file:

1. **`visibilityTimeout` > worker `timeout`.** Otherwise SQS redelivers a
   message whose worker is still running, and two workers race on one job. The
   claim (§ 3.1) makes that safe rather than catastrophic — the second claim
   affects 0 rows and drops — but it burns an invocation per redelivery and
   makes the DLQ count meaningless. Set to worker timeout + 60 s.
2. **Worker `timeout` = 900 s** (the Lambda maximum) and the worker's own
   budget check reserves headroom below it (§ 3.3). ⚠ SST defaults a function to
   **20 seconds** — see the comment on `coreRoute` in `infra/api.ts`, which
   documents this default silently truncating two model paths. Never rely on the
   default here.
3. **`reservedConcurrency` on the worker.** Each worker holds up to
   `DB_POOL_MAX` (4) Postgres sockets for its whole run, and a 900 s run is a
   long time to hold them. Capped at 5 concurrent workers → ≤ 20 sockets, well
   inside Supavisor's pool. It also bounds Bedrock spend under a burst.
4. **`batchSize: 1`.** One job per invocation. A batch of 10 five-minute jobs
   cannot finish in one 900 s invocation, and partial batch failure handling
   would be a second, unnecessary correctness problem.

---

## 2. Data model

`supabase/migrations/<ts>_ai_jobs.sql` + the `schema.ts` mirror. Idempotent per
CLAUDE.md — `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and any
constraint added inside a `pg_constraint` existence guard (the pattern in
`20260726120100_workouts_loadout_variations.sql`).

```
ai_jobs (
  id                uuid PK default gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind              text NOT NULL,          -- registry key; CHECK-free by design (§ 2.1)
  status            text NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  input             jsonb NOT NULL,         -- the request, replayable
  checkpoint        jsonb,                  -- partial work; opaque to the spine (§ 3.2)
  result            jsonb,                  -- terminal success payload
  error             jsonb,                  -- { code, message, retryable }
  progress_done     integer NOT NULL DEFAULT 0,
  progress_total    integer NOT NULL DEFAULT 0,
  attempts          integer NOT NULL DEFAULT 0,
  max_attempts      integer NOT NULL DEFAULT 3,
  client_request_id text,                   -- caller idempotency key
  heartbeat_at      timestamptz,            -- liveness; NULL until first claim
  started_at        timestamptz,
  finished_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
)
```

Indexes:

- `ai_jobs_user_created_idx (user_id, created_at DESC)` — the owner's job list
  and the per-day ceiling count.
- `ai_jobs_user_kind_client_request_idx` — **UNIQUE, and deliberately FULL, not
  partial** on `(user_id, kind, client_request_id)`. The unique index is the
  race-proof half of AC-3.2: the repository **catches** the violation and
  returns the existing row rather than pre-flighting a `SELECT`, exactly as
  `SavedGymRepository` does for gym names.

  ⚠ The obvious `WHERE client_request_id IS NOT NULL` predicate is **wrong
  here**, and this repo has already paid for learning it —
  `20260727120100_client_request_id_idempotency.sql` § "FULL indexes,
  deliberately NOT partial". Two reasons, both still apply: a partial index
  cannot be inferred by `ON CONFLICT (cols)` unless the statement repeats the
  predicate, and Drizzle's `onConflictDoNothing({ target })` emits none — so any
  future move from catch-the-violation to `ON CONFLICT` raises 42P10 on every
  keyed insert. And the predicate buys nothing anyway: NULLs are DISTINCT in a
  Postgres unique index, so the many jobs with no key never conflict with each
  other under a full index either.

- `ai_jobs_status_heartbeat_idx (status, heartbeat_at) WHERE status = 'running'`
  — the stale-job predicate. Partial: running jobs are a tiny minority.

### 2.1 Why `kind` has no CHECK constraint

Every other constrained text column in this schema (`variation_kind`,
`status` above) carries a CHECK so a typo is a reviewed migration rather than a
silent bad row. `kind` deliberately does not, because the authority is the
**TypeScript registry** and a CHECK would mean every consuming spec ships a
migration to add its own kind — coupling three feature branches to a shared
DDL file for no safety gain. The enqueue path only ever writes a registered
kind, and an unregistered kind reaching the worker fails the job with
`unknown_kind` rather than corrupting anything.

### 2.2 `input`/`result` are jsonb and the spine never reads them

The spine treats `input`, `checkpoint` and `result` as opaque. Only the
registered kind interprets them. This is what keeps a spine change from being a
three-feature change.

⚠ **`result` can be large** — a 120-workout adapted programme is not a small
document. Postgres TOASTs it transparently, so there is no storage problem, but
the poll endpoint returns it in full and a client polling every 2 s would
re-download it on every tick after completion. **Consumers must stop polling on
a terminal status**, and `GET /jobs/:id` accepts `?fields=status` to return the
envelope without the payload for the polling loop. (Recorded because the naive
poll loop is the one a client will write first.)

---

## 3. Execution semantics — the part that has to be right

### 3.1 The claim: one conditional UPDATE, not check-then-act

```sql
UPDATE ai_jobs
   SET status = 'running',
       attempts = attempts + 1,
       started_at = COALESCE(started_at, now()),
       heartbeat_at = now(),
       updated_at = now()
 WHERE id = $1
   AND status IN ('queued', 'running')          -- 'running' allows resume (§ 3.3)
   AND attempts < max_attempts
RETURNING *;
```

**Zero rows returned means "do not run".** That single condition covers every
duplicate-execution path at once: an SQS duplicate delivery, a Lambda retry, a
redelivery after a visibility-timeout expiry, and a message replayed from the
DLQ after the job already succeeded. The worker acks and returns.

⚠ This must be a single statement. A `SELECT … then UPDATE` is a lost-update
race between two concurrent workers and would let a $0.69 job run twice — which
is the whole reason AC-3.1 exists. Do not "clarify" it into two steps.

⚠ `attempts < max_attempts` is inside the same statement for the same reason. A
job that has burned its attempts cannot be claimed at all, so the retry bound
holds even if SQS's own `maxReceiveCount` is misconfigured. The two are
belt-and-braces, not duplication: SQS bounds _deliveries_, this bounds
_executions_.

### 3.2 Checkpointing

After each unit of work the worker writes `checkpoint` + `progress_done` +
`heartbeat_at` in one UPDATE. The checkpoint is whatever the kind needs to skip
completed work on resume — for Loadout Phase 4 that is the list of adapted
workouts so far.

The cost argument for this is concrete: without it, a worker that dies at
workout 90 of 120 re-spends ~$0.52 of already-purchased inference on retry.
With it, the retry costs ~$0.17.

⚠ Checkpoint writes are also where `ai_usage_log` rows are written (AC-4.5).
Batching them to the end loses the whole job's cost accounting on a hard-kill,
and the ceiling then under-counts real spend — the exact failure `infra/api.ts`
documents for the equipment scan at the 20 s default.

### 3.3 Time budget: stop before the kill, don't get killed

The worker's loop checks remaining Lambda time before each step:

```
remainingMs() < (observedStepMs * SAFETY + CHECKPOINT_RESERVE)
  → checkpoint, re-enqueue the SAME jobId, return
```

The job stays `running` (which is why the claim permits re-claiming a `running`
job) and `attempts` increments, so a job that cannot make progress still
terminates at `max_attempts` rather than re-enqueuing forever.

`observedStepMs` is a rolling max of the steps actually run in this invocation,
not a constant — a kind whose steps vary (a 3-exercise workout vs a 12-exercise
one) would otherwise either reserve far too much or get hard-killed.

⚠ A hard-kill runs no `finally`. That is why the reserve exists and why the
checkpoint is a _write before_ the deadline rather than cleanup after it.

### 3.4 Staleness (AC-2.5)

A `running` job with `heartbeat_at` older than `STALE_AFTER_MS` (15 min — the
900 s worker timeout plus headroom) is dead: hard-killed, OOM'd, or deployed
over. Two things act on it:

- **`GET /jobs/:id` derives it on read** and reports `failed` /
  `code: "stale"`. Deriving rather than depending on a sweep means the client
  is never wedged on a dead job even if the sweep is broken or unscheduled.
- **The nightly sweep persists it**, so the row stops being re-derived and
  terminal-job purging can see it.

The read does **not** write. A GET that mutates would make the poll loop a write
path and put a write on every client tick.

### 3.5 Failure taxonomy

| `error.code`         | Retryable | Source                                                     |
| -------------------- | --------- | ---------------------------------------------------------- |
| `ai_unavailable`     | yes       | Bedrock throttle / 5xx — the existing `AiUnavailableError` |
| `step_failed`        | yes       | a kind's `runStep` threw                                   |
| `unknown_kind`       | **no**    | the kind is not in the registry (deploy skew)              |
| `input_invalid`      | **no**    | the kind rejected its own `input`                          |
| `attempts_exhausted` | **no**    | terminal, set when the claim is refused on attempts        |
| `stale`              | **no**    | derived / swept (§ 3.4)                                    |

Non-retryable failures mark the job terminal immediately and the worker returns
successfully so SQS deletes the message — re-delivering a job that can never
succeed just burns invocations toward the DLQ.

---

## 4. The kind registry

```ts
export interface JobKind<TInput, TCheckpoint, TResult> {
  kind: string;
  /** Gate asserted at ENQUEUE. Mandatory — see AC-4.2. */
  feature: EntitlementFeature;
  /** Env var holding the per-day job ceiling; fail-safe parsed. */
  ceilingEnv: string;
  /** Ceiling + telemetry endpoint keys. MUST differ — AC-4.4. */
  ceilingEndpoint: string;
  inferenceEndpoint: string;
  /** Validate + size. Returns the step count, or a 413-bearing bound error. */
  plan(input: TInput, userId: string): Promise<{ total: number }>;
  /** One unit of work. Pure w.r.t. the spine — it owns no lifecycle state. */
  runStep(ctx: JobStepContext<TInput, TCheckpoint>): Promise<TCheckpoint>;
  /** Terminal assembly from the final checkpoint. */
  finish(ctx: JobFinishContext<TInput, TCheckpoint>): Promise<TResult>;
}
```

The registry is a plain `Map` built at module load. Registering a kind is one
file plus one line in the registry index; nothing in the spine changes.

**`feature` being non-optional is the design's answer to the catch-all trap.**
`assertEntitlement` returns `{ allowed: true }` for any `EntitlementFeature`
without a routing line (`assertEntitlement.ts` § routing), so a paid gate can
become a no-op with no type error. A job kind cannot be _registered_ without
naming a feature, so at least the enqueue path is always gated by something.
⚠ It does not verify that the named feature is actually routed — the consuming
spec still owns adding its `if (feature === …)` line, and a kind naming a stub
feature (`ai_workout`, `gym_buddy`, `unlimited_exercise_library`) is gated by
nothing. Loadout Phase 4 and Mealprint each need their routing line.

---

## 5. Ceilings — the two-key rule (AC-4.4)

A kind declares **two** `ai_usage_log` endpoint keys:

- `ceilingEndpoint` — one row per **job**, written at enqueue.
  `countForUserToday(userId, ceilingEndpoint)` is the ceiling counter.
- `inferenceEndpoint` — one row per **model call**, written as the job
  checkpoints. Never counted against a ceiling; this is cost telemetry.

The trap this avoids: with one key, a 120-inference job writes 120 rows and
trips its own 30/day ceiling on the first run. It is not a hypothetical — the
shipped single-workout path (`AI_LOADOUT_REMAP_DAILY_LIMIT`, 30/day) uses one
key correctly _because_ it is one inference per request, and the obvious
extension to the programme case is exactly the wrong one.

Worked example for Loadout Phase 4 (illustrative; the kind owns the numbers):
`loadout_programme_adapt` at, say, 3 jobs/day × 120 workouts × $0.0057 ≈
$2.05/user/day worst case. The ceiling is a cost backstop, not a product quota
— same rationale as `AI_LOADOUT_REMAP_DAILY_LIMIT` (spec-21 AC-10.2).

---

## 6. Endpoints

### `GET /jobs/:id`

Owner-scoped (AC-2.2 — `404`, never `403`). Returns:

```json
{ "data": { "id", "kind", "status", "progress": { "done", "total" },
            "result": …|null, "error": {"code","message","retryable"}|null,
            "createdAt", "startedAt", "finishedAt" } }
```

`?fields=status` omits `result` (§ 2.2). Staleness derived on read (§ 3.4).

**There is no generic `POST /jobs`.** Enqueue lives on the feature's own route
(`POST /programs/:id/loadout/adapt`, `POST /nutrition/plans/week`) because
entitlement, sizing and input validation are all kind-specific. The spine
exports `enqueueJob()` for those handlers to call; it does not own a URL.

### Cancellation

`status = 'cancelled'` exists in the enum and the claim refuses a cancelled job,
so the mechanism is in place — but **no cancel endpoint ships in this spine**.
A cancel that cannot stop an in-flight Bedrock call is a partial promise, and
which of "stop at the next checkpoint" or "abandon and refund the ceiling" is
right depends on the kind. First consumer that needs it designs it.

---

## 7. Infrastructure

```ts
// infra/jobs.ts
export const aiJobDlq = new sst.aws.Queue("AiJobDlq");
export const aiJobQueue = new sst.aws.Queue("AiJobQueue", {
  visibilityTimeout: "16 minutes",   // > worker timeout — § 1.2(1)
  dlq: { queue: aiJobDlq.arn, retry: 3 },
});
aiJobQueue.subscribe({
  handler: "microservices/core/src/aiJobWorker.handler",
  timeout: "15 minutes",             // § 1.2(2) — NOT SST's 20 s default
  concurrency: { reserved: 5 },      // § 1.2(3)
  permissions: [ /* the same two Bedrock resource shapes as coreRoute */ ],
  environment: { DATABASE_URL, SENTRY_DSN, …the AI model ids },
}, { batch: { size: 1 } });          // § 1.2(4)
```

`coreRoute` gains `link: [aiJobQueue]` so the enqueue path can publish, and the
worker gains the identical Bedrock `permissions` block `coreRoute` carries —
the wildcards there (`foundation-model/anthropic.*` +
`inference-profile/eu.anthropic.*`) already cover every model id a kind will
use, so no IAM change is needed per kind.

⚠ **Both `inference-profile` and `foundation-model` ARNs are required.** Bedrock
denies the call if only the profile is granted. This is copied deliberately
rather than referenced — a worker missing one of them fails at runtime only.

**Monitoring** (`infra/monitoring.ts`, behind the existing `isMonitoredStage`
gate): an alarm on `AWS/SQS` `ApproximateNumberOfMessagesVisible ≥ 1` on the
DLQ, and the worker's `Errors`. Both publish to the existing alerts topic.

**Purge**: terminal jobs older than 30 days, folded into the existing nightly
`accountPurgeCron` (05:00 UTC) rather than a fifth cron — it already runs at the
right cadence and a new `sst.aws.Cron` costs account concurrency for a `DELETE`.
The same pass persists stale `running` jobs (§ 3.4).

---

## 8. Testing

Vitest against the mocked-`getDb` convention, plus the shapes that convention
has historically missed:

- **Claim atomicity** — two claims of the same job; exactly one gets a row.
- **Duplicate delivery** — the same SQS record twice; `runStep` called once.
- **Resume** — a job checkpointed at 90/120 runs 30 steps, not 120.
- **Time budget** — a worker near its deadline checkpoints and re-enqueues
  instead of starting a step it cannot finish.
- **Attempts** — the `max_attempts`-th claim is refused and the job is
  `attempts_exhausted`.
- **Enqueue failure** — a queue publish that throws leaves the job `failed` and
  returns `503`, never `202` (AC-1.2).
- **Two-key ceiling** — a job writing N inference rows does not move its own
  ceiling count (AC-4.4).
- **Ownership** — another user's poll gets `404`.
- **Staleness** — a `running` job past the threshold reads as `failed`/`stale`
  and the read performs no write.

⚠ **Render the migration's SQL and assert the EXECUTABLE shape**, per
`reference_drizzle_groupby_param_bug.md` — two runtime-only SQL bugs have
shipped green past the mocked-DB suite in this repo, and the existing render
test in one of those cases had pinned the _broken_ shape. The claim statement in
§ 3.1 is exactly the kind of hand-written SQL that gets away with it.
