# Phase 3 — Trainer on-behalf endpoints (10.3)

> **Session-starter brief.** Read `STATE.md` + this file + `specs/_shared/cross-cuts.md § 1, § 2, § 5` and you have everything. Backend only. Critical path — the core of the coach surface.

## Where this sits

Coach Mode Completion mandate, Phase 3. **Phases 0–2 are MERGED** (#159 docs, #160 audit foundation, #161 measurement reconcile). The audit foundation you build on already exists:

- `microservices/core/src/application/relationships/assertTrainerCanActForClient.ts` — the authz gate. `assertTrainerCanActForClient(trainerId, clientId)` returns a discriminated verdict: `{ allowed: true }` or `{ allowed: false; reason: "wrong_role" | "no_relationship"; status: 403; body: { code; message } }`. Role-first (personal_trainer/physiotherapist/admin), then active non-AI relationship.
- `microservices/core/src/application/relationships/auditTrainerAction.ts` — `auditTrainerAction({ trainerId, clientId, actionType, targetTable, targetRowId, payload, tx })`, writes one `trainer_actions_audit` row on the caller's transaction handle; propagates failure so the whole action rolls back.
- `ActionType` union + `trainerActionsAudit` table are in `@persistence/db` (schema.ts).

**Follow the Phase-2 pattern exactly** — it's the reference implementation: `microservices/core/src/application/trainers/measurements/logClientMeasurement.ts` (shared core: assert-gate → `getDb().transaction` [row write with `tx` + `auditTrainerAction` with `tx`] → post-commit side effects) + a thin handler that maps the verdict/result to `ctx.set.status`.

## Scope — the endpoints (cross-cuts § 1.2, all under `/trainers/me/clients/:clientId/...`)

Each **write** = assert-gate → transaction(row write with `logged_by_user_id`/`assigned_by_user_id` = trainerId + `auditTrainerAction` in the same tx) → post-commit notification (see enum step). Each **GET** = assert-gate → parity read (no audit). Body validators mirror the client's own self-write route so the same `t.Object` is reused.

| Endpoint                    | Action type                                                 | Notes                                                                                                                                                                                                           |
| --------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /sessions`            | `workout_logged_on_behalf`                                  | Mirror the self session-create; `logged_by_user_id = trainerId`. Retroactive vs live is a client concern; backend just records.                                                                                 |
| `GET /sessions`             | (read)                                                      | Parity list for the client, scoped to `clientId`.                                                                                                                                                               |
| `GET /measurements`         | (read)                                                      | **POST already shipped in Phase 2** — only the parity GET is new here.                                                                                                                                          |
| `POST /goals`               | `goal_assigned`                                             | `user_goals` row with `assigned_by_user_id = trainerId` (cross-cuts § 2.1).                                                                                                                                     |
| `GET /goals`                | (read)                                                      |                                                                                                                                                                                                                 |
| `PUT /goals/:id`            | (no new audit if same trainer; **403 if not the assigner**) | Edit-own only per cross-cuts § 2.2 — verify `assigned_by_user_id = trainerId` before allowing.                                                                                                                  |
| `PUT /nutrition/target`     | `nutrition_target_set`                                      | Reuse the 13-nutrition target validator. **Nutrition is otherwise OFF LIMITS** — this one target write is in scope because the mandate names it.                                                                |
| `POST /workout-assignments` | `workout_assigned`                                          | Existing assignment pattern; add audit-in-tx. Check whether a self/legacy assignment handler already exists and re-home it onto the shared helpers (like Phase 2 did for measurements) rather than duplicating. |

Find each self-route's handler + repository first (`grep` in `microservices/core/src/application`) and mirror its body shape + repository. Thread `tx` into each repository `create`/`update` the same way Phase 2 added an optional `tx?` (`DbOrTx` alias) to `MeasurementRepository.create`.

## The notification-enum migration (do this FIRST, before the handlers)

This phase is the **first to emit on-behalf notifications**, so the `notification_type` Postgres enum must be extended BEFORE any handler inserts one, or the first insert fails at runtime with `invalid input value for enum notification_type`. Per `10-trainer design.md § Frontend — Notification triggers` + cross-cuts § 5:

```sql
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'goal_assigned_by_trainer';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'workout_logged_on_behalf';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'measurement_logged_on_behalf';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'nutrition_target_set_by_trainer';
```

- `workout_assigned` already exists in the enum — do not re-add.
- New migration file: timestamp **strictly after** the newest in `supabase/migrations/` (as of Phase 1 the newest is `20260705140000`; **re-check at authoring time — a parallel agent may have added one**).
- Also extend the `notificationTypeEnum` in `packages/db/src/schema.ts` to match, and the mobile `NotificationType` union if it exists (`09-notifications-social`).
- ⚠ Postgres quirk: `ALTER TYPE ... ADD VALUE` **cannot run inside a transaction block** with other statements in some setups — keep the enum ALTERs in their own migration, standalone. Verify against how prior enum-extension migrations in this repo are structured.
- Wire the notification emit **after** the transaction commits (best-effort, like the accept-invite-code handler) — a notification failure must not fail the write. Deep-link + opt-in defaults per cross-cuts § 5 table.

## Measurement notification backfill

Phase 2 deliberately deferred the `measurement_logged_on_behalf` notification (it needed this enum ALTER). Now that the enum exists, wire the post-commit notification into `logClientMeasurementOnBehalf` too, so measurement-on-behalf matches the others.

## Conventions that bite (from STATE.md + the mandate)

- **Commit with explicit pathspecs; verify `git diff --cached --name-only` before committing** (a pre-staged index broke a deploy — see STATE.md).
- Run repo-level **`bun run prettier:check`** before the PR, not just the change-scoped PR job. Untracked local files (STATE.md, marketing/) show as warnings locally but are invisible to CI.
- Role guard order is baked into `assertTrainerCanActForClient` — don't re-implement inline.
- Drizzle: never reuse a parameterized `sql` expr in SELECT + GROUP BY (42803); the unit suite mocks `getDb`, so render suspicious SQL via `PgDialect` to guard.
- `?? null` not `?? 0` for missing wire fields; numbers round-tripped `toFixed(2)`→`parseFloat` where DB equality matters.
- This checkout may need `bun install` if `@anthropic-ai/bedrock-sdk` isn't resolved.

## Tests (per endpoint)

Happy path (row written + audit row in the SAME tx + notification emitted), **403 wrong role**, **403 no relationship**, **audit rollback** (audit insert throws → whole tx rejects, row NOT persisted, post-commit side effects never run), and for `PUT /goals/:id` the **403-not-assigner** path. Mock `getDb`/`db.transaction` per the existing handler-test conventions (see `logClientMeasurement.test.ts` + `trainersAcceptInviteCodeHandler.test.ts`). Coverage ≥ 90% on new application/handler code; audit code ≥ 95%.

## Gates (repo root)

`bun run prettier:check && bun run typecheck && bun run lint && bun run build && bun run test:unit`. Then a **local inspector-brad sweep** on the branch diff before the PR — fix findings, re-verify, note `🕵️ Inspector Brad (local): clean @ <sha>` in the PR body. Do NOT fire the `@inspector-brad` CI action.

## Definition of done

All endpoints in the table live + mounted in `api.ts`; notification enum extended (migration + schema + mobile union) and sequenced before emits; measurement notification backfilled; every write audited-in-tx with a rollback test; parity GETs scoped to the client; PR raised (rebased on latest origin/main), gates green, inspector clean; Brad pinged via `slack-progress-updates` at the phase boundary.

## Ping Brad when

Blocked, or at the phase boundary. No open decisions block this phase.
