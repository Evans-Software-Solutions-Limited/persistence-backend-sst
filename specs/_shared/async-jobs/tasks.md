# Shared async-job spine — Tasks

> ⚠ **Checkbox discipline.** `tasks.md` ticks across this repo's specs lie in
> both directions (`STATE.md`: all of spec-21's `T-P0.*` is unticked and
> shipped). Verify against the tree, not the ticks.
>
> `[B]` backend · `[I]` infra · `[M]` mobile.

---

## Phase J1 — the spine (this branch, `feat/async-job-spine`)

- [ ] **T-J1.1 [B]** `ai_jobs` migration + `schema.ts` mirror. Idempotent
      (`IF NOT EXISTS` + `pg_constraint` guards). Includes the partial UNIQUE on
      `(user_id, kind, client_request_id)` and the partial running/heartbeat
      index. Design § 2.
- [ ] **T-J1.2 [B]** `AiJobRepository` — `enqueue` (catching the unique
      violation → existing row, AC-3.2), `claim` (the single conditional UPDATE,
      § 3.1), `checkpoint`, `heartbeat`, `succeed`, `fail`, `getForUser`,
      `purgeTerminalOlderThan`, `markStaleRunning`.
- [ ] **T-J1.3 [B]** `JobQueue` port + SQS adapter (`sendJobMessage`). Consumers
      never import the AWS SDK (AC-6.1).
- [ ] **T-J1.4 [B]** Kind registry + `JobKind` interface (§ 4). Ships with
      **zero kinds** — the registry is the extension point, not a feature.
- [ ] **T-J1.5 [B]** `enqueueJob()` — the helper a feature route calls:
      entitlement → ceiling → `plan()` → insert → publish → 202, with the
      publish-fails-means-503 path (AC-1.2).
- [ ] **T-J1.6 [B]** `aiJobWorker.handler` — claim, step loop, checkpointing,
      time-budget re-enqueue (§ 3.3), failure taxonomy (§ 3.5),
      `[ai-job:summary]` log line.
- [ ] **T-J1.7 [B]** `GET /jobs/:id` — owner-scoped, `?fields=status`,
      staleness derived on read without writing (§ 3.4). Mount in `api.ts`.
- [ ] **T-J1.8 [I]** `infra/jobs.ts` — queue + DLQ + worker subscriber with the
      four load-bearing settings (§ 1.2); `link: [aiJobQueue]` on `coreRoute`.
- [ ] **T-J1.9 [I]** DLQ-depth + worker-`Errors` alarms in `infra/monitoring.ts`,
      behind the existing `isMonitoredStage` gate.
- [ ] **T-J1.10 [B]** Terminal-job purge + stale-running persistence folded into
      `accountPurgeCron` (no new cron).
- [ ] **T-J1.11 [B]** Tests per design § 8, including the rendered-SQL assertion
      on the claim statement. ≥ 90 % coverage on the new files.

## Phase J2 — first consumer (spec-21 Loadout Phase 4, separate branch)

Not this branch. Listed so the seam is explicit:

- [ ] **T-J2.1** Register `loadout_programme_adapt`: `feature: 'loadout'`,
      `ceilingEnv: 'AI_LOADOUT_PROGRAMME_DAILY_LIMIT'`, distinct ceiling vs
      inference endpoint keys (§ 5), `plan()` enforcing spec-21's 120-workout
      cap with a `413`.
- [ ] **T-J2.2** `POST /programs/:id/loadout/adapt` calling `enqueueJob()`.
- [ ] **T-J2.3 [M]** Mobile poll loop — **stops on terminal status** and uses
      `?fields=status` while running (§ 2.2).

## Phase J3 — second consumer (spec-26 Mealprint Phase 3, separate branch)

- [ ] **T-J3.1** Register `mealprint_week_plan`. ⚠ Its `EntitlementFeature`
      (`meal_ai` or equivalent) needs its **routing line** in
      `assertEntitlement` — the registry mandates naming a feature but cannot
      verify it is routed (§ 4).

---

## Deliberately out of scope here

- **Any job kind.** A spine shipped with a kind couples it to a feature not yet
  designed.
- **Cancellation endpoint** — enum value and claim behaviour exist; the endpoint
  is the first consumer's call (§ 6).
- **Push on completion** — poll first; push is additive.
