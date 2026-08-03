# Shared async-job spine — Requirements

> **Cross-spec infrastructure, not a feature.** Three workstreams need the same
> thing and every one of their specs says it must not be built twice:
>
> - **spec-21 Loadout Phase 4** — `requirements.md` AC-10.3, `design.md` § 7.3.
>   Programme adaptation is 120 workouts × ~2.6 s ≈ 5 min, far past the 30 s API
>   Gateway ceiling.
> - **spec-26 Mealprint Phase 3** — `design.md` § "Model + sizing". A week plan
>   is 7 × a day plan and busts the same ceiling.
> - **Program import** (parked, `ROADMAP.md` § 5.3) — screenshot/PDF ingestion.
>
> ⚠ Each of those specs defers the job-table design to one of the others.
> spec-26 § 1 names its twin "spec-20"; **spec-20 is sleep-quicklog** — the
> intended referent is program import. **This document is the one place.** The
> consuming specs defer here; nothing about the job table is re-specified there.
>
> Authored 2026-08-02 under the Premium+ launch bundle plan of record
> (`STATE.md` § "PLAN OF RECORD"), which puts this spine at step 0 — ahead of
> Loadout Phase 4, Mealprint and M21, because all three consume it.

---

## Scope

**In:** a durable job record, an enqueue path with entitlement + ceiling
enforcement, an execution substrate that survives past the request ceiling, a
poll endpoint, and the failure/retry/idempotency semantics that make an
expensive job safe to run at-least-once.

**Out:** any individual job KIND. This spine ships with an empty kind registry.
Loadout Phase 4 registers `loadout_programme_adapt`; Mealprint registers
`mealprint_week_plan`. Shipping a kind here would couple the spine to a feature
that has not been designed yet.

**Out:** client-push completion (APNs/Expo). Poll first — the mobile client is
already on a foreground surface when it starts one of these jobs. Push is a
later, additive change (US-6 records the seam).

---

## US-1 — A caller can start work that outlives the request

**As a** consuming endpoint (Loadout programme adaptation, Mealprint week plan)
**I want** to hand work to a durable queue and return immediately
**So that** a 5-minute job is not attempted inside a 29 s Lambda.

- **AC-1.1** Enqueue returns `202 Accepted` with `{ jobId, status: "queued" }`
  in well under the request ceiling. No model call happens on the enqueue path.
- **AC-1.2** The job is durable before the response is sent: a row exists in
  `ai_jobs` and the queue message is published. If the queue publish fails the
  enqueue returns `503` and **the row is deleted** — it must never return `202`
  for work nothing will ever pick up. ⚠ Deleted rather than marked `failed`: a
  dead row keeps occupying the idempotency key and the in-flight slot, so a client
  retrying with the same key (what the key is for) would get `200 replayed` with
  the same dead job, permanently.
- **AC-1.3** Job execution is not bound by the 29 s API Lambda timeout. The
  worker's budget is its own, and is at least 10 minutes of usable work time.

## US-2 — The caller can poll for progress and result

- **AC-2.1** `GET /jobs/:id` returns `{ status, progress, result?, error? }`.
  `status` ∈ `queued | running | succeeded | failed | cancelled`.
- **AC-2.2** The endpoint is **owner-scoped**: a job belongs to the `user_id`
  that created it, and any other caller gets `404` — never `403`, which would
  confirm the job exists.
- **AC-2.3** `progress` is `{ done, total }` and advances while the job runs, so
  a 5-minute wait can render a real progress bar rather than a spinner.
- **AC-2.4** A terminal job returns its payload from the job row. The result is
  **not** re-derived on read and the poll endpoint makes no model call.
- **AC-2.5** A job whose worker died without writing a terminal state (Lambda
  hard-kill, OOM, deploy mid-run) is reported as `failed` with `code: "stale"`
  once its heartbeat is older than the staleness threshold — the client must never
  poll a dead job forever. ⚠ That threshold is sized against the queue's
  **visibility timeout**, not the worker timeout: a job awaiting redelivery after a
  retryable failure has a legitimately cold heartbeat for the whole visibility
  window, and calling it dead there makes the user re-run work that is about to
  succeed.
- **AC-2.6** A job whose message died **before it was ever claimed** also reaches
  a terminal state. `running` staleness cannot see it, so without this the client
  polls `queued` forever and the row is never purgeable.

## US-3 — An expensive job is never accidentally run twice

The failure this AC exists for is measurable: a 120-workout programme adaptation
is ~120 model calls and ~$0.69. Duplicate execution is a real cost event, not a
tidiness concern.

- **AC-3.1** SQS is at-least-once. Duplicate delivery of the same job message
  must execute the job's work **exactly once**. The claim is a conditional
  state transition in Postgres, not an application-level check-then-act, and its
  `running` branch is **fenced on the heartbeat** so a duplicate cannot join a
  worker that is still running.
- **AC-3.2** A caller that retries the same logical request (same
  `client_request_id`, same user, same kind) gets the **existing** job back with
  `200`, not a second job. Mirrors the shipped
  `20260727120100_client_request_id_idempotency.sql` convention.
- **AC-3.3** Work already completed inside a partially-run job is checkpointed
  and **not repeated** when the job resumes. A retry after 90 of 120 workouts
  costs 30 model calls, not 120.
- **AC-3.4** A job that exhausts its retries reaches a terminal `failed` state
  with a structured error, and the queue message is not redelivered forever. Two
  independent counters: consecutive stalls (reset on progress) and total
  invocations (never reset). ⚠ A single shared counter charges a time-budget yield
  as a failure and kills a long job mid-progress.
- **AC-3.5** A user may have at most ONE job of a given kind in flight, enforced by
  a database constraint rather than by a read-then-write check. The daily ceiling
  cannot bound a concurrent burst, and one unit of work here is ~120 inferences.

## US-4 — A job is gated, metered and attributable

- **AC-4.1** Entitlement is asserted **at enqueue**, before the job row is
  written. An unentitled caller gets `402` and creates no job. The **whole deny
  verdict** reaches the calling route, not just the feature name — `pickUpgradeTier`
  exists so a `loadout` deny upsells Premium+ rather than Premium, and that is
  unreconstructable from a feature name.
- **AC-4.2** Every job kind declares its `EntitlementFeature` in the registry.
  ⚠ This is the structural answer to `assertEntitlement`'s catch-all
  (`assertEntitlement.ts` § routing — an unrouted feature silently returns
  `{ allowed: true }`): a kind cannot be registered without naming a feature,
  so a job kind cannot ship ungated by omission. It does **not** absolve the
  consuming spec of adding the feature's routing line in `assertEntitlement`.
- **AC-4.3** The daily ceiling is counted **per job**, at enqueue, on the
  `#156` pattern: `429` with `ai_daily_limit`, fail-safe env parse, and no
  usage row written for a rejected attempt.
- **AC-4.4** ⚠ Per-inference telemetry inside a job writes `ai_usage_log` rows
  under an endpoint key **distinct from** the key the ceiling counts. A
  120-inference job writing 120 rows under its own ceiling key would trip its
  own ceiling on the first run. The ceiling key counts jobs; the telemetry key
  counts inferences.
- **AC-4.5** Cost telemetry survives a worker crash to the extent the runtime
  allows: usage rows for completed inferences are written as the job
  checkpoints, not batched to the end. (A Lambda hard-kill runs no `finally` —
  see `infra/api.ts`'s 29 s comment for the precedent this is avoiding.)

## US-5 — Failures are visible

- **AC-5.1** A job that fails carries a structured
  `{ code, message, retryable }` — not a stack trace and not a raw model error.
- **AC-5.2** Messages that exhaust the redrive policy land in a dead-letter
  queue, and a non-empty DLQ raises a CloudWatch alarm on the existing
  `infra/monitoring.ts` alerts topic.
- **AC-5.3** The worker logs a one-line `[ai-job:summary]` per job on the same
  convention as the existing crons (`[reconcile:summary]`,
  `[streak-cron:summary]`).

## US-6 — The spine does not leak its substrate

- **AC-6.1** Consuming code depends on a `JobQueue` port and a kind registry, not
  on the AWS SDK. Swapping SQS for another substrate must not touch a consumer.
- **AC-6.2** A job kind is registered by supplying
  `{ kind, feature, ceilingEnv, ceilingDefault, ceilingEndpoint, inferenceEndpoint, plan, runStep, finish }`
  — the spine owns claim, checkpoint, heartbeat, completion, failure and
  time-budget management. A consumer that has to reimplement any of those is a
  spine bug.

---

## Non-functional

- **Retention.** Job rows are user data (they contain generated plans). They
  cascade on profile delete like every other user-owned table, and are covered
  by the existing account-purge sweep by virtue of that cascade.
- **Table growth.** Terminal jobs older than 30 days are purged by a nightly
  sweep. A job row holds a whole generated programme — this is not a log table.
- **Coverage.** ≥ 90 % on the new application + repository files, per CLAUDE.md.
  Claim atomicity, duplicate delivery, resume-from-checkpoint and the
  time-budget re-enqueue are behavioural tests, not smoke tests.

---

## Open — Brad

1. **DLQ alarm routing.** `infra/monitoring.ts` gates on `isMonitoredStage`, so
   a DLQ alarm exists on staging + production only. Assumed correct; flag if
   personal stages should page too. _(Proceeding on the assumption.)_
2. **Staleness threshold.** Proposed 15 minutes — the worker's own timeout plus
   headroom, so a legitimately long job is never reaped mid-run. _(Proceeding.)_
3. **The 120-workout cap** (spec-21 design § 7.3) is still an open checkpoint
   and is **not** re-decided here. The spine imposes no cap of its own; a kind
   declares its own bound and returns `413`.
