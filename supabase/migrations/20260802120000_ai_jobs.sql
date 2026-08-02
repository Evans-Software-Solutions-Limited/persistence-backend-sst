-- Shared async-job spine — `ai_jobs`.
--
-- Design: specs/_shared/async-jobs/design.md § 2. Requirements: US-1…US-6.
--
-- WHY THIS EXISTS. Three workstreams need work that outlives a request, and all
-- three of their specs say the infrastructure must not be built twice:
--   * spec-21 Loadout Phase 4 (AC-10.3) — 120 workouts x ~2.6 s ~= 5 minutes,
--     far past the 30 s API Gateway ceiling (and the 29 s Lambda timeout that
--     actually binds first — see infra/api.ts);
--   * spec-26 Mealprint Phase 3 — a week plan is 7 x a day plan;
--   * the parked program-import workstream (ROADMAP § 5.3).
-- Nobody had built it once. This is the one place.
--
-- Purely additive: a new table, no existing column or index is touched, so it is
-- safe under migrate-then-deploy in either order. (Contrast
-- 20260727120100_client_request_id_idempotency.sql, where the reverse order
-- breaks every read of two tables — that hazard does not exist here.)
--
-- Re-runnable: CREATE TABLE / CREATE INDEX IF NOT EXISTS throughout, and the
-- CHECK constraint sits inside a pg_constraint existence guard — a bare
-- `ALTER TABLE … ADD CONSTRAINT` is NOT idempotent and fails on re-run. Guard
-- pattern: 20260726120100_workouts_loadout_variations.sql.

CREATE TABLE IF NOT EXISTS ai_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- CASCADE, unlike ai_usage_log's bare reference. A job row holds a whole
  -- GENERATED ARTEFACT (an adapted programme, a week of meals), so it is user
  -- content rather than telemetry, and deleting an account must take it. This
  -- is also what puts ai_jobs inside the existing account-purge sweep for free:
  -- the sweep deletes the profile, and the cascade does the rest.
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Registry key (design § 4). ⚠ Deliberately NO CHECK constraint, which is the
  -- opposite of what this schema does everywhere else (workouts.variation_kind,
  -- status below). The authority for a valid kind is the TypeScript registry; a
  -- CHECK here would make every consuming spec ship a migration against this
  -- shared file just to add its own kind, coupling three feature branches to one
  -- DDL for no safety gain. Only the enqueue path writes this column and it only
  -- ever writes a registered kind; an unregistered kind reaching the worker
  -- fails its job with `unknown_kind` rather than corrupting anything.
  kind text NOT NULL,

  status text NOT NULL DEFAULT 'queued',

  -- Opaque to the spine (design § 2.2) — only the registered kind interprets
  -- these. That opacity is what keeps a spine change from being a three-feature
  -- change.
  --   input      — the request, replayable
  --   checkpoint — partial work, so a resume does not re-buy completed inference
  --   result     — terminal success payload
  --   error      — { code, message, retryable }; never a stack trace
  input jsonb NOT NULL,
  checkpoint jsonb,
  result jsonb,
  error jsonb,

  progress_done integer NOT NULL DEFAULT 0,
  progress_total integer NOT NULL DEFAULT 0,

  -- TWO SEPARATE BOUNDS, both enforced INSIDE the claim statement (design § 3.1
  -- / § 3.3a). Conflating them into one counter is a real bug, not a
  -- simplification.
  --
  -- `attempts` counts CONSECUTIVE STALLED invocations and is RESET TO ZERO
  -- whenever a step completes. It is a stall budget, not an invocation budget: a
  -- yield at the time budget is not a failure and must not be charged as one. At
  -- 20 s/step a 120-step job legitimately needs 3+ invocations, so a single
  -- shared counter of 3 would fail it terminally at ~110/120 steps and discard
  -- ~$0.63 of already-purchased inference.
  --
  -- `invocations` is the absolute backstop that `attempts` cannot be, precisely
  -- BECAUSE `attempts` resets on progress: without it, a job that makes one step
  -- then yields forever would re-enqueue indefinitely. SQS's own receive count
  -- cannot bound that either — a yield DELETES its message and publishes a new
  -- one, so the count resets. 20 covers a 120-step job at 20 s/step (~3
  -- invocations) with a very wide margin.
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  invocations integer NOT NULL DEFAULT 0,
  max_invocations integer NOT NULL DEFAULT 20,

  -- Caller idempotency key (AC-3.2), same convention as
  -- 20260727120100_client_request_id_idempotency.sql.
  client_request_id text,

  -- Liveness. NULL until the first claim. A `running` job whose heartbeat has
  -- gone cold is dead — hard-killed, OOM'd, or deployed over — and is reported
  -- as failed/`stale` (design § 3.4). A Lambda hard-kill runs no `finally`, so
  -- there is no cleanup path that could have written a terminal state.
  heartbeat_at timestamptz,

  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_jobs_status_check'
  ) THEN
    ALTER TABLE ai_jobs ADD CONSTRAINT ai_jobs_status_check
      CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'));
  END IF;
END $$;

-- The owner's job list and the per-day ceiling count.
CREATE INDEX IF NOT EXISTS ai_jobs_user_created_idx
  ON ai_jobs (user_id, created_at DESC);

-- Idempotency (AC-3.2). The repository CATCHES the violation this raises and
-- returns the existing row, rather than pre-flighting a SELECT — which would be
-- racy between two concurrent enqueues of the same key.
--
-- ⚠ FULL, deliberately NOT partial (`WHERE client_request_id IS NOT NULL`).
-- This repo has already paid for that lesson — see
-- 20260727120100_client_request_id_idempotency.sql § "FULL indexes". A partial
-- index cannot be inferred by `ON CONFLICT (cols)` unless the statement repeats
-- the predicate, and Drizzle's `onConflictDoNothing({ target })` emits none, so
-- any later move from catch-the-violation to ON CONFLICT would raise 42P10 on
-- every keyed insert. The predicate buys nothing regardless: NULLs are DISTINCT
-- in a Postgres unique index, so the many jobs carrying no key never conflict
-- with each other under a full index either.
--
-- Dropped-then-created so a re-run converges on the intended SHAPE, not on
-- whatever already carried the name: `CREATE UNIQUE INDEX IF NOT EXISTS` skips
-- on a NAME match and does not reconcile the definition. Migrations here are
-- applied by hand against staging and production, so "I already ran something
-- called that" is a real state to defend against.
DROP INDEX IF EXISTS ai_jobs_user_kind_client_request_idx;
CREATE UNIQUE INDEX IF NOT EXISTS ai_jobs_user_kind_client_request_idx
  ON ai_jobs (user_id, kind, client_request_id);

-- ONE IN-FLIGHT JOB PER USER PER KIND — the cost control the daily ceiling
-- cannot be (design § 5.1).
--
-- The ceiling is read-then-write (the #156 pattern every AI endpoint here
-- shares), so N parallel enqueues all see the same count and all proceed. On the
-- synchronous endpoints that is a recorded, bounded gap. HERE one unit is up to
-- ~120 inferences, so the same race is worth ~$0.69 each: 50 concurrent
-- enqueues with distinct idempotency keys against a ceiling of 3 would accept 50
-- jobs and ~$34 of Bedrock spend, and the worker's reserved concurrency only
-- PACES that, it never caps it.
--
-- A unique index is enforced by the database at insert time, so it closes the
-- race outright rather than narrowing it. The repository catches 23505 and
-- distinguishes this constraint from the idempotency one by NAME.
--
-- ⚠ PARTIAL here, where the idempotency index above is deliberately FULL — the
-- difference is real, not an inconsistency. This predicate IS the semantics
-- ("in flight"), and terminal rows must be excluded or a user could never run a
-- second job of the same kind. The 42P10 hazard that forced the other index to
-- be full does not apply: nothing infers this index via ON CONFLICT.
--
-- Dropped-then-created for the same converge-on-SHAPE reason as above.
DROP INDEX IF EXISTS ai_jobs_one_inflight_per_kind_idx;
CREATE UNIQUE INDEX IF NOT EXISTS ai_jobs_one_inflight_per_kind_idx
  ON ai_jobs (user_id, kind) WHERE status IN ('queued', 'running');

-- The stale-job predicate (design § 3.4) and the worker's own resume lookups.
-- Partial: running jobs are a tiny minority of the table at any moment.
CREATE INDEX IF NOT EXISTS ai_jobs_running_heartbeat_idx
  ON ai_jobs (heartbeat_at) WHERE status = 'running';

-- Backs the queued-too-long reaper (design § 3.4). A message can die before it
-- is ever claimed — throttled receives count toward the redrive policy, so a
-- burst can send a message to the DLQ having never executed — leaving a row
-- `queued` forever. Without this reaper such a row is never terminal, so the
-- client polls it indefinitely AND the terminal-job purge never removes it.
CREATE INDEX IF NOT EXISTS ai_jobs_queued_created_idx
  ON ai_jobs (created_at) WHERE status = 'queued';

-- Terminal-job purge (30 days, folded into accountPurgeCron rather than a fifth
-- sst.aws.Cron). A job row holds a whole generated programme, so this is not a
-- log table that can be left to grow.
CREATE INDEX IF NOT EXISTS ai_jobs_terminal_finished_idx
  ON ai_jobs (finished_at) WHERE status IN ('succeeded', 'failed', 'cancelled');

COMMENT ON TABLE ai_jobs IS 'Shared async-job spine (specs/_shared/async-jobs). Work that outlives the 29 s request ceiling: Loadout programme adaptation, Mealprint week plans, program import. The row is the durable state; SQS is only the wake-up.';
COMMENT ON COLUMN ai_jobs.kind IS 'Registry key. Deliberately unconstrained in SQL — the TypeScript kind registry is the authority, so adding a kind is not a shared-migration change.';
COMMENT ON COLUMN ai_jobs.checkpoint IS 'Partial work, opaque to the spine. Exists so a retry does not re-buy completed inference: without it a worker dying at workout 90 of 120 re-spends ~$0.52.';
COMMENT ON COLUMN ai_jobs.attempts IS 'CONSECUTIVE stalled invocations, reset to 0 on any completed step. A stall budget, not an invocation budget — a time-budget yield is not a failure and must not be charged as one.';
COMMENT ON COLUMN ai_jobs.invocations IS 'Total claims. The absolute backstop attempts cannot be, since attempts resets on progress and a yield resets SQS receive count too.';
COMMENT ON COLUMN ai_jobs.heartbeat_at IS 'Liveness. Cold heartbeat on a running job = the worker died without running any finally block; reported as failed/stale.';
