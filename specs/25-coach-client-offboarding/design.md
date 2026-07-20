# 25 — Coach ↔ Client Offboarding — Design

Grounded in the code as of `main` @ 59d0354 (2026-07-20).

## 1. Shared teardown core

One service function does the whole teardown in a single transaction. Both
endpoints (coach-removes, client-leaves) call it — the only difference is who
the caller is and how the target row is located.

```
microservices/core/src/application/relationships/endCoachClientRelationship.ts
```

```ts
export interface EndRelationshipArgs {
  trainerId: string;
  clientId: string;
  initiatedBy: "trainer" | "client";
}
export type EndRelationshipResult =
  | { ok: true; relationshipId: string }
  | { ok: false; status: 404 };
```

### Transaction steps (order matters)

All inside `getDb().transaction(async (tx) => …)`:

1. **Soft-end the relationship (conditional, atomic).**

   ```ts
   const [row] = await tx.update(ptClientRelationships)
     .set({ status: "terminated", endDate: <today>, updatedAt: new Date() })
     .where(and(
       eq(ptClientRelationships.trainerId, trainerId),
       eq(ptClientRelationships.clientId, clientId),
       eq(ptClientRelationships.status, "active"),
       eq(ptClientRelationships.isAiTrainer, false),
     ))
     .returning({ id: ptClientRelationships.id });
   if (!row) return null; // → 404, nothing else ran (whole tx is a no-op)
   ```

   The `status = 'active'` predicate is the race guard (mirrors the decline
   handlers) and enforces AC-1.5/AC-1.6/AC-2.4 in one shot — no separate
   pre-read. `endDate` is a `date` column (`text`/date per schema); use the
   same "today" convention the assignment code uses (client-local date not
   required for an end marker — use UTC `YYYY-MM-DD`).

2. **Delete programme assignments from this coach** (cascades to their
   materialised `workout_assignments` occurrences via
   `workout_assignments.program_assignment_id → program_assignments … onDelete
cascade`):

   ```ts
   await tx
     .delete(programAssignments)
     .where(
       and(
         eq(programAssignments.clientId, clientId),
         eq(programAssignments.assignedBy, trainerId),
       ),
     );
   ```

3. **Delete remaining (ad-hoc) workout assignments from this coach**:

   ```ts
   await tx
     .delete(workoutAssignments)
     .where(
       and(
         eq(workoutAssignments.clientId, clientId),
         eq(workoutAssignments.trainerId, trainerId),
       ),
     );
   ```

   Step 2 already removed programme-occurrence rows; step 3 sweeps ad-hoc rows
   and is idempotent for anything already gone. `completed_session_id` is a
   nullable FK **to** `workout_sessions` — deleting the assignment row does not
   touch the client's logged session (the client owns that; it is not
   coach-scoped). D2 = clean break on the _assignment link_, history preserved.

4. **Habits & goals — NO teardown (D3, honors locked decision 6).** Coach-set
   habits and goals are deliberately left untouched. The habit edit-lock is
   _computed_ from `pt_client_relationships.status = 'active'`
   (`habitConfigRepository.isHabitCoachLocked`), so step 1's flip to
   `terminated` lifts the lock automatically — the habit stays active, the
   streak is unbroken, `assigned_by_user_id` is retained as history, and the
   client can now edit it (spec 18 `design.md § 5`, spec 10 `design.md:672`).
   Non-habit coach-assigned goals stay active with attribution as history the
   same way. **This step writes nothing** — it exists in the design only to
   make the "do not touch goals/habits" decision explicit and to anchor the
   regression test (§ 8) that proves the lock lifts and the rows survive.

5. **Audit.** One `trainer_actions_audit` row via `auditTrainerAction`:

   ```ts
   await auditTrainerAction({
     trainerId,
     clientId,
     actionType: "relationship_terminated", // NEW enum value — see § 3
     targetTable: "pt_client_relationships",
     targetRowId: row.id,
     payload: { initiatedBy, assignmentsRemoved },
     tx,
   });
   ```

6. **Notification (best-effort, post-commit — OUTSIDE the tx).** After the tx
   commits, insert one in-app notification for the counterparty via
   `NotificationRepository` (same insert path as Send-brief). Wrap in
   try/catch; a failure is logged and swallowed (AC-3.1). Recipient:
   `initiatedBy === "trainer"` → notify `clientId`; else notify `trainerId`.

> **Why the notification is post-commit here** (not in-tx like Send-brief): the
> teardown must succeed regardless of notification delivery, and the recipient
> flips (client vs coach) by direction. If Brad prefers in-tx atomicity we can
> move it inside; noted as a reviewable choice.

## 2. Endpoints

### 2a. Coach removes client

```
microservices/core/src/application/trainers/clients/trainersRemoveClientHandler.ts
DELETE /trainers/me/clients/:clientId
```

- Auth: `getAuthUser` + `requireAuth` (same header derive as sibling handlers).
- `trainerId = getUser(ctx).sub`, `clientId = ctx.params.clientId`.
- Calls `endCoachClientRelationship({ trainerId, clientId, initiatedBy: "trainer" })`.
- `ok:false` → `set.status = 404` + `{ code: "not_found", message: … }`.
- `ok:true` → `{ success: true }`.
- No entitlement/seat guard needed on removal (removal only _frees_ a seat).

### 2b. Client leaves coach

```
microservices/core/src/application/trainers/relationships/clientLeaveCoachHandler.ts
DELETE /clients/me/relationships/:relationshipId
```

(Client-side routes live under `/clients/me/...`, matching
`trainersRespondToRequestHandler` which is `POST /clients/me/relationships/:relationshipId/respond`.)

- `clientId = getUser(ctx).sub`; look up the row by `id = :relationshipId AND
client_id = clientId AND status = 'active' AND is_ai_trainer = false` to
  resolve `trainerId` (single indexed read), then call the shared core with
  `initiatedBy: "client"`. If the lookup misses → 404 (never reveals another
  user's relationship).
- Alternatively resolve trainerId inside the core by widening the WHERE to
  accept a `relationshipId`; keep the lookup in the handler to keep the core's
  signature `(trainerId, clientId)` uniform. Either is fine — implementer's call.

Both handlers mount in `microservices/core/src/api.ts` next to the existing
relationship/clients handlers (§ lines ~205–229).

## 3. Migration — new audit enum value

`packages/db/migrations/<ts>_relationship_terminated_audit_value.sql` — add
`relationship_terminated` to `action_type_enum` (idempotent, mirror
`20260706170000_workout_unassigned_audit_value.sql`):

```sql
ALTER TYPE action_type_enum ADD VALUE IF NOT EXISTS 'relationship_terminated';
```

Add the same value to `actionTypeEnum` in `packages/db/src/schema.ts:228`.

> Postgres note: `ADD VALUE` cannot run inside a transaction block with other
> statements in some setups — keep this migration to the single `ALTER TYPE`.

No schema change needed for `status`/`end_date`/assignments/habits — all
columns already exist.

## 4. Seat accounting (verify, don't assume)

Coach active-seat count is computed by `evaluateTrainerClientsActiveSeat`
(`trainers/seats/trainerSeats.ts`) and the roster comes from
`trainersClientsListHandler`. Both must count only `status = 'active'`. Since
teardown sets `terminated`, the seat frees and the roster drops the client with
no extra work — **but the implementer MUST confirm both queries filter on
`status = 'active'`** (not merely "not pending") and add a test. The
relationship-list handler already "hides terminated/inactive"
(`trainersClientRelationshipsListHandler.ts:22,70`).

## 5. Re-invite / resume after termination (confirmed 2026-07-20)

`pt_client_relationships` has `UNIQUE(trainer_id, client_id)`
(`schema.ts:858`). A terminated row keeps that pair occupied. **VERIFIED: both
re-invite paths already revive the dormant row in place** rather than
INSERT-colliding — email invite (`trainerRepository.ts:1332-1349`) and
invite-code accept (`trainersAcceptInviteCodeHandler.ts:211-224`) both UPDATE
`status → 'pending'` and clear `end_date`. No change needed.

**Resume semantics (Brad's "keep hybrid resume" decision, 2026-07-20)** — when
the same coach and client reconnect (revive → accept → `active`):

- **Assignments: fresh start.** They were deleted at offboarding and are NOT
  restored — the coach re-assigns workouts/programmes.
- **Habits & goals: carry over and re-lock.** The rows persisted with
  `assigned_by_user_id = coach`; because the edit-lock is computed from
  `status='active'`, re-activation silently re-locks the coach-set habits
  (client can't edit them again), including any edits the client made while
  unlocked during the gap. Accepted trade-off (the client re-consented to
  coaching). NOT a clean slate by design.
- **Notes, logged measurements, audit history: carry over.**

This is the coherent consequence of D2 (remove assignments) + D3 (keep
habits/goals with attribution). A "full clean slate" was explicitly declined —
it would require clearing habit/goal attribution at offboarding, contradicting
locked decision 6.

## 5b. Guard consolidation (in scope — Brad, 2026-07-20)

Two coach reads of client **health data** used an inline active-relationship
check instead of the shared `assertTrainerCanActForClient`, skipping the role
check + trainer-soft-deleted check (the "lapsed trainer on a stale relationship
row" hole the shared guard closes):

- `trainersClientBodyTrendHandler` (returns weight + body-fat trend)
- `trainersClientActiveProgrammeGetHandler`

**Both migrated onto `assertTrainerCanActForClient`.** Behaviour preserved for
the relationship/soft-deleted cases (`not_your_client` 403); adds `not_a_trainer`
(role) and `account_deleted` (trainer soft-deleted) denials. Tests updated to
mock the shared guard. (Surfaced during the offboarding health-data audit; see
requirements § Related findings.)

## 6. Mobile

### 6a. Coach — Client Detail kebab (AC-4.1)

- `src/domain/ports/api.port.ts`: add `removeClient(clientId: string): Promise<void>`.
- `src/adapters/api/sst-api.adapter.ts`: `DELETE /trainers/me/clients/:clientId`.
- `src/ui/presenters/coach/ClientDetailPresenter.tsx:323` — wire the existing
  `testID="client-detail-more"` IconBtn `onPress` to an action sheet (reuse the
  app's existing action-sheet/Alert pattern) with a destructive **Remove
  client** item.
- Container (`ClientDetailContainer` / wherever the presenter's handlers are
  injected): `Alert.alert` confirm →
  copy: _"Remove {name}? They'll lose the workouts, programmes and habits you
  assigned. Your coaching history is kept and a client seat is freed."_ →
  on confirm call the mutation → on success `navigation.goBack()` + invalidate
  the clients-roster + client-detail queries.

### 6b. Client — Leave coach (AC-4.2)

- `api.port.ts`: `leaveCoach(relationshipId: string): Promise<void>` →
  `DELETE /clients/me/relationships/:relationshipId`.
- `src/ui/presenters/ProfilePresenter.tsx:441` (Active Trainers rows,
  `testID="active-trainer-${rel.id}"`) — make the row expose a **Leave coach**
  action (trailing button or long-press → action sheet; keep consistent with
  the row's current plain-View styling, minimal per port-then-revamp).
- Confirm copy: _"Leave {coachName}? You'll lose the workouts, programmes and
  habits they assigned you. They'll no longer see your data."_
- On success invalidate the trainers list + the client's plan/assignments
  queries (so the ex-coach's assigned content disappears from Home/Plan).

> This UI is net-new (legacy had none), so there is no 1:1 target to match.
> Keep it minimal and consistent with existing confirm/alert patterns; defer
> visual polish to a post-port `/frontend-design` pass.

## 7. AI access (D5) — explicitly nothing to do

`assertAiAccess` / `assertEntitlement(userId, "ai_access")`
(`entitlement/assertEntitlement.ts:424`) resolves the **acting user's own**
tier (`subscription_tiers.ai_access`). There is no coach→client AI grant in the
schema. A client's AI access follows their own subscription and is unaffected
by offboarding; a coach's client-AI features stop working automatically because
`assertTrainerCanActForClient` now fails (row no longer `active`). No code
change. A test documents this (client keeps/loses AI access strictly by their
own tier, unchanged across offboarding).

## 7b. Data we deliberately KEEP (not torn down)

- **Coach-set habits + goals (D3)** — untouched. Transfer to the client via the
  status-computed edit-lock (locked decision 6). See § 1 step 4.
- **`trainer_client_notes`** — soft-end keeps the relationship row, so the FK
  cascade never fires; the coach's notes persist as history. The coach cannot
  see them post-removal (roster/detail gated on `active`). Kept intentionally
  (supports re-engagement). No action.
- **`body_measurements`** the coach logged — owned by the client
  (`user_id = client`); the client keeps their measurement history. Coach loses
  visibility via the access guard. No action.
- **`workout_sessions`** the client logged against assignments — client-owned;
  deleting the assignment link (§1.3) never touches the session. No action.

## 8. Test plan (≥90% on changed files, no fake tests)

Backend (Vitest, render SQL via PgDialect where a query is non-trivial —
mocked-DB blind-spot rule):

- Shared core: happy path (both directions), 404 on not-active / not-yours /
  AI-trainer, teardown scoping (another coach's assignments for the same client
  survive; the client's own workouts survive), audit row written, notification
  recipient correct per direction, notification failure does not roll back.
- **Decision-6 regression (D3):** after offboarding, the client's coach-set
  habit + goal rows still exist and are `is_active`; `isHabitCoachLocked`
  returns false (lock lifted → client can edit); the ex-coach's on-behalf habit
  edit now 403s. This is the guard that the teardown did NOT touch goals/habits.
- Endpoints: authz (wrong caller → 404), param wiring.
- Seat/roster: terminated client excluded; seat freed.
- Data-isolation two-user test per requirements § Data-isolation acceptance.
- AI-access invariance test (D5).

Mobile: presenter renders the action; container confirm → mutation → invalidate

- navigate; error path surfaces an alert.
