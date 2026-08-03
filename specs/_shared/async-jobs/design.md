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
3. **A concurrency cap on the worker — as `maximumConcurrency` on the EVENT
   SOURCE MAPPING, not as Lambda reserved concurrency.** ⚠ `reserved` broke the
   staging deploy: AWS requires ≥ 10 UNRESERVED concurrent executions to remain
   after any reservation, staging is a different AWS account from production, and
   the 2026-08-01 raise to 1000 covered production only — so on staging's quota of
   10 you cannot reserve _any_ concurrency. `maximumConcurrency` caps SQS-driven
   invocations without touching the account's unreserved pool, so it behaves the
   same on both accounts. AWS floors it at 2. Each worker holds up to
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
       invocations = invocations + 1,
       started_at = COALESCE(started_at, now()),
       heartbeat_at = now(),
       updated_at = now()
 WHERE id = $1
   AND (
     status = 'queued'                          -- fresh, or released by a yield
     OR (status = 'running'                     -- takeover of a DEAD worker only
         AND (heartbeat_at IS NULL OR heartbeat_at < $2))  -- $2 = now - CLAIM_FENCE_MS
   )
   AND attempts < max_attempts                  -- consecutive stalls
   AND invocations < max_invocations            -- absolute backstop
RETURNING *;
```

⚠ **The `running` branch is FENCED, and an unfenced version is a real bug.** An
earlier revision of this design allowed claiming ANY `running` job, on the grounds
that a yield leaves the job `running`. That silently permitted the very thing this
section exists to prevent: a duplicate delivery arriving while a worker was
mid-run would claim the job and execute the same steps concurrently, two workers
interleaving checkpoint writes with `progress_done` able to move backwards.

The fix has two halves and both are needed:

- the **yield sets the status back to `queued`** (§ 3.3), so the ordinary resume
  path needs no takeover window at all;
- `running` stays claimable only behind `CLAIM_FENCE_MS` (5 min), which keeps the
  one legitimate takeover — a worker that died without writing a terminal state,
  and a hard-kill runs no `finally`.

`CLAIM_FENCE_MS` **must be far shorter than `STALE_AFTER_MS`**: a hard-killed job
has to become re-claimable long before it is declared dead to the client, or its
checkpoint is thrown away.

#### What the worker does when the claim is REFUSED

⚠ Returning from the handler DELETES the SQS message; throwing keeps it for
redelivery. So the refusal branches are ordered, and the order is load-bearing:

| the row is                    | answer                                      | why                                                                                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gone / terminal               | `skipped`, **return**                       | an ordinary duplicate; deleting is right                                                                                                                                                                                                                                         |
| `running`, heartbeat **warm** | **throw**                                   | another worker holds it. Checked FIRST: on its last allowed claim the holder is already out of budget, so a budget-first check would fail the job under a worker still spending Bedrock — and `succeed()` is scoped to `running`, so its finished result would then be discarded |
| live, cold, out of budget     | `failed` / `attempts_exhausted`, **return** | genuinely finished trying (AC-3.4)                                                                                                                                                                                                                                               |
| live, cold, in budget         | **throw**                                   | the fence refused it, or another worker won the race. Nothing to do now, but the message must survive                                                                                                                                                                            |

The last row is the one that bites. A retryable step failure late in a 15-minute
invocation is redelivered ~16 minutes later with a heartbeat only ~2 minutes old —
inside the fence — so the claim refuses. **Returning `skipped` there destroys the
message** and leaves the job `running` with its checkpoint stranded until the
nightly sweep: ~$0.63 of purchased inference discarded, on the very path this spine
exists to protect. Throwing hands it back; the redrive policy bounds the loop.

**Zero rows returned means "do not run".** That single condition covers every
duplicate-execution path at once: an SQS duplicate delivery, a Lambda retry, a
redelivery after a visibility-timeout expiry, and a message replayed from the
DLQ after the job already succeeded. The worker acks and returns.

⚠ This must be a single statement. A `SELECT … then UPDATE` is a lost-update
race between two concurrent workers and would let a $0.69 job run twice — which
is the whole reason AC-3.1 exists. Do not "clarify" it into two steps.

⚠ Both bounds are inside the same statement for the same reason: a job out of
budget cannot be claimed at all, so the limits hold even if SQS's own
`maxReceiveCount` is misconfigured. SQS bounds _deliveries_; these bound
_executions_.

### 3.1a Two counters, and why one is not enough

`attempts` counts **consecutive stalls** and is **reset to zero by every
checkpoint**. `invocations` counts every claim and never resets.

⚠ **The worker must mirror the reset IN MEMORY.** `claimed.attempts` is read once
at claim time and never refreshed, so testing it against `max_attempts` tests a
counter the loop has already invalidated: a job that stalled twice and then
completed 40 steps in its third invocation would be failed terminally by the next
transient Bedrock 429, discarding ~$0.23 of purchased inference — the exact
outcome the reset exists to prevent. The reset must hold _within_ an invocation,
not only across them.

A single shared counter is wrong in a way that costs money. A yield is not a
failure, but it consumes a claim — so with one counter at 3, a 120-step job at
20 s/step (3+ invocations, entirely normal) reaches its last invocation with zero
retry budget, and one transient Bedrock throttle fails it terminally at ~110/120
steps, discarding ~$0.63 of purchased inference.

Resetting on progress fixes that but cannot be the only bound, precisely because
it resets: a job that makes one step then yields forever would re-enqueue
indefinitely, and SQS cannot catch it either — a yield **deletes** its message and
publishes a new one, so the receive count resets too. Hence `invocations`,
defaulting to a deliberately loose 20.

⚠ **Both bounds are per-kind overridable, and a slow kind must override.** The
default of 20 is sized on Loadout's ~20 s steps (120 steps ≈ 3 invocations). At
60 s/step the same job needs ~9 invocations before any retry budget, and hitting
the bound fails it mid-progress. Mealprint week plans and program import are
unsized — each must set its own `maxInvocations` when it registers.

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

⚠ **Release before publishing.** The yield sets the status back to `queued`
FIRST, then sends the message. That is what lets the claim's fence be strict about
`running` (§ 3.1) — a yielded job has explicitly given itself up, so the resume
cannot overlap the worker that yielded. The ordering also fails safe: if the
publish then throws, the row is `queued` and the queued-stale reaper (§ 3.4) is the
backstop even if the explicit fail does not land.

`invocations` increments on every claim, so a job that cannot make progress still
terminates rather than re-enqueuing forever.

`observedStepMs` is a rolling max of the steps actually run in this invocation,
not a constant — a kind whose steps vary (a 3-exercise workout vs a 12-exercise
one) would otherwise either reserve far too much or get hard-killed.

⚠ A hard-kill runs no `finally`. That is why the reserve exists and why the
checkpoint is a _write before_ the deadline rather than cleanup after it.

### 3.4 Staleness (AC-2.5)

**Two different deaths, two thresholds.**

`STALE_AFTER_MS` (**40 min**) covers a `running` job whose heartbeat has gone
cold — hard-killed, OOM'd, or deployed over.

⚠ It is sized against the queue's **visibility timeout**, not the worker timeout.
An earlier revision used 15 min (the worker timeout plus headroom) and that is
wrong in a way that costs money: a retryable step failure 30 s into an invocation
leaves the message invisible for the whole 16-minute visibility window while the
heartbeat sits at 30 s. At 15 min the poll endpoint would report `failed`/`stale`
— _"Nothing was saved; try again"_ — during the gap before redelivery, so a client
following the documented "stop polling on a terminal status" contract gives up,
the user re-runs and double-spends, while the original job is quietly redelivered
and succeeds. 40 min = 16 min visibility + 15 min worker run + margin.

`QUEUED_STALE_AFTER_MS` (**60 min**) covers the death `STALE_AFTER_MS` cannot
see: a message that dies **before it is ever claimed**, leaving a row nothing
transitions. Not hypothetical — throttled receives count toward the redrive
policy, so a burst against the worker's concurrency cap can send a message to
the DLQ having never executed. Without this reaper the client polls
`queued 0/120` forever AND the terminal-job purge never sees the row. Measured
from `created_at`, since a never-claimed job has no heartbeat; sized off the
redrive policy (3 receives × 16 min ≈ 48 min to the DLQ).

Two things act on both:

- **`GET /jobs/:id` derives it on read** and reports `failed` /
  `code: "stale"`. Deriving rather than depending on a sweep means the client
  is never wedged on a dead job even if the sweep is broken or unscheduled.
- **The nightly sweep persists them** (`markStaleRunning` / `markStaleQueued`),
  so the row stops being re-derived and terminal-job purging can see it.
  ⚠ `markStaleRunning` must also match a NULL heartbeat: `heartbeat_at < cutoff`
  evaluates to NULL for such a row and would never reap it, while the read path
  already reports it stale — leaving the row derived-failed forever and never
  purgeable.

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

### 5.1 One in-flight job per user per kind — the cap the ceiling cannot be

⚠ The ceiling above is **read-then-write**, so N parallel enqueues all see the
same count and all proceed. On the synchronous endpoints that is a recorded,
bounded gap (the #156 pattern). Here one unit of work is up to ~120 inferences, so
the same race is worth ~$0.69 each: **50 concurrent enqueues with distinct
idempotency keys against a ceiling of 3 would accept 50 jobs and ~$34 of Bedrock
spend**, and the worker's concurrency cap only PACES that — it never caps
it.

So the spine adds a **partial UNIQUE index** on
`(user_id, kind) WHERE status IN ('queued','running')`. Enforced by the database
at insert time, it closes the race outright rather than narrowing it, and the
enqueue path reports the collision as `in_flight` (409) rather than queueing a
second job. The repository distinguishes this 23505 from the idempotency one by
**constraint name** — conflating them would report an in-flight collision as a
successful replay.

Note this index IS partial where the idempotency index is deliberately full
(§ 2): here the predicate _is_ the semantics, and nothing infers it via
`ON CONFLICT`, so the 42P10 hazard does not apply.

⚠ **The `schema.ts` mirror must declare this predicate**, unlike the bare-column
mirrors elsewhere in that file. Those are cosmetic; this one decides which rows
conflict, and without it the mirror describes a FULL unique index — one job per
kind _forever_, terminal rows included — so `db:push` / `db:generate` would emit
DDL that permanently locks a user out after their first job.

Two further consequences the naive implementation gets wrong:

- **A keyed retry violates BOTH unique indexes**, and Postgres reports only
  whichever it checked first (index OID order, which nothing in the migration
  pins). So on an in-flight collision the repository re-reads by
  `(user_id, kind, client_request_id)` FIRST and answers `replayed` when a row
  carries the key. Answering `409` there would leave the client unable to poll a
  job it successfully created — the exact failure the idempotency key exists to
  prevent.
- **The index keys off the PERSISTED status, but death is DERIVED on read** and
  only persisted by the nightly sweep. Without a self-heal, a user whose worker
  died is told `failed` ("try again") at 40 minutes and then gets `409` on every
  retry until 05:00 UTC — a lockout governed by a cron cadence rather than by any
  threshold this design reasons about. So on a collision with a row that
  `isStaleRunning`/`isStaleQueued` calls dead, the repository fails that row and
  retries the insert **once** (guarded, so no loop). That `fail` **re-derives the
  staleness in SQL** (`failIfStale`), because a redelivery may legally claim a
  40-minute-stale row during the read→write round-trip; losing that race answers
  `in_flight` rather than proceeding.

  ⚠ **Do not implement that guard as `updated_at` equality.** It was tried, and it
  made the whole self-heal dead code: Postgres `timestamptz` is MICROSECOND
  resolution and every writer stamps `now()`, while a JS `Date` is millisecond — so
  the round-trip truncates `…678912` to `…678000` and the equality matches about
  one time in a thousand. Re-deriving inside the UPDATE is both correct and
  simpler, and it is what `markStaleRunning` already does. (The render test that
  accompanied the broken version asserted the truncated parameter and called it
  correct — `reference_drizzle_groupby_param_bug`, twice over.)

⚠ **Client contract:** the replay check runs BEFORE the self-heal, so a client
retrying with the SAME idempotency key gets its dead job back (derived `failed`),
not a fresh one. That is correct idempotency — same request, same answer — but it
means **a client that wants to start over must rotate the key**. Consumers should
treat a terminal poll result as "this job is done" and mint a new key for a new
attempt.

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
  // NOT `concurrency: { reserved: 5 }` — see § 1.2(3).
  permissions: [ /* the same two Bedrock resource shapes as coreRoute */ ],
  environment: { DATABASE_URL, SENTRY_DSN, …the AI model ids },
}, {
  batch: { size: 1 },                          // § 1.2(4)
  transform: {                                 // § 1.2(3) — the concurrency bound
    eventSourceMapping: { scalingConfig: { maximumConcurrency: 5 } },
  },
});
```

⚠ **The worker needs `link: [aiJobQueue]` too**, and its absence is silent until a
job actually runs long enough to yield. The worker is a PRODUCER on its own queue
(§ 3.3), and the event-source subscription does not grant that: SST's
`QueueLambdaSubscriber` attaches only
`ChangeMessageVisibility|DeleteMessage|GetQueueAttributes|GetQueueUrl|ReceiveMessage`
— no `SendMessage` — and injects no queue URL. Without the link every yield throws,
and `runJob` marks a part-finished job terminally failed, discarding ~$0.63 of
purchased inference on the one code path that exists to avoid exactly that. No
unit test can catch it either, since every `runJob` test injects a fake queue.

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
  `attempts_exhausted`; likewise `max_invocations`.
- **The claim fence** — the rendered predicate gates `running` on the heartbeat,
  and `CLAIM_FENCE_MS < STALE_AFTER_MS`. ⚠ A test that hands one mock repository a
  row and another `null` proves nothing about mutual exclusion — it asserts its
  own fixture. Test the PREDICATE, and separately test `runJob`'s response to
  losing a claim.
- **Threshold relationships** — `STALE_AFTER_MS` exceeds visibility + worker
  timeout; `QUEUED_STALE_AFTER_MS` exceeds the redrive window. These are the two
  constants whose wrongness is invisible in any single-function test.
- **No timestamp EQUALITY in any predicate.** Assert the absence, not just the
  presence: `timestamptz` is microsecond and a JS `Date` is not, so an equality on
  a `now()`-stamped column is a predicate that never matches — a silent no-op with
  a green test.
- **In-flight collision** — a 23505 from the in-flight index is reported as
  `in_flight`, never as a replay.
- **Publish failure deletes** — the row is gone, so a retry with the same
  idempotency key is a fresh job rather than a permanently-replayed dead one.
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
