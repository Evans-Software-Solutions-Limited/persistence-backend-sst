# 25 — Coach ↔ Client Offboarding

**Status:** Draft (go-live blocker) · **Author:** Claude (Opus) · **Date:** 2026-07-20

## Problem

There is currently **no way to end an active coach↔client relationship.** The
`pt_client_relationships` status enum defines `inactive`/`terminated` and an
`end_date` column exists, but no code path ever transitions an `active` row off
`active` (the only `terminated` writes are guarded to `status = 'pending'`,
i.e. declining a still-pending invite — see
`trainersRespondToRequestHandler.ts:78`,
`trainersRespondToClientRequestHandler.ts:128`). There is no coach "remove
client" route and no client "leave coach" route. The V2 mobile Client Detail
screen has a dead "More" kebab (`ClientDetailPresenter.tsx:323`, no `onPress`)
and the empty-state copy already tells coaches to "Remove a client" — an action
that does not exist.

Consequences today:

- A coach cannot offboard a client; a client cannot sever a coach.
- Because `assertTrainerCanActForClient` only requires `status = 'active'`
  (which never flips off), **coach access to a client's data is effectively
  permanent** until a full account deletion.
- Legacy never implemented this either — this is **net-new behaviour**, not a
  port. Design decisions below were made explicitly by Brad (2026-07-20).

This blocks go-live: coaches will expect to offboard clients and clients will
expect to leave a coach (and stop that coach seeing their data).

## Decisions (locked 2026-07-20)

| #   | Decision                            | Choice                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Direction                           | **Bidirectional** — coach can remove a client; client can leave a coach.                                                                                                                                                                                                                                                                                                                                             |
| D2  | Assigned workouts/programmes on end | **Remove** — delete the coach→client assignment rows so the ex-coach's programme disappears from the client's plan (assignments are client-scoped, not relationship-gated, so they would otherwise linger). Client's own logged session history is untouched.                                                                                                                                                        |
| D3  | Coach-set goals & habits on end     | **KEEP** — habits and goals the coach assigned **transfer to the client** and stay active (attribution retained as history). This is not new behaviour: the habit edit-lock is _computed_ from `status='active'` (spec 18 locked decision 6, Brad 2026-06-23; spec 10 `design.md:672`), so soft-ending the relationship lifts the lock automatically with **no teardown code**. **No goal/habit rows are modified.** |
| D4  | Relationship teardown               | **Soft-end** — `status='terminated'`, `end_date=today`; row kept for history; frees the coach's client seat; hidden from both parties' lists. Lifts the habit/goal coach-lock automatically (D3).                                                                                                                                                                                                                    |
| D6  | Model                               | **Hybrid** (Brad 2026-07-20): remove assignments (D2), keep habits+goals (D3). Reconciles today's ask with locked decision 6.                                                                                                                                                                                                                                                                                        |
| D5  | AI access                           | **No-op** — `ai_access` is derived from the acting user's own subscription tier (`subscription_tiers.ai_access`), never coach-granted. Nothing to tear down. Documented, not implemented.                                                                                                                                                                                                                            |

## User stories

### US-1 — Coach removes a client

As a coach, I can remove a client from my roster so I stop coaching them and
free a client seat.

- **AC-1.1** `DELETE /trainers/me/clients/:clientId` ends the active, non-AI
  relationship where the caller is the trainer and `:clientId` is the client.
- **AC-1.2** On success the relationship is `terminated` with `end_date` set,
  and all workout + programme assignments from this coach to this client are
  deleted. Coach-set habits and goals are **left untouched** — they transfer to
  the client via the status-computed lock (D3); no habit/goal rows are written.
- **AC-1.3** The removed client no longer appears in the coach's roster; the
  seat is freed (active-seat count drops by one).
- **AC-1.4** After removal the coach can no longer act on or read that client's
  data (`assertTrainerCanActForClient` returns 403 — verified because the row
  is no longer `active`).
- **AC-1.5** Idempotent/safe: removing a non-existent, already-terminated, or
  not-yours relationship returns 404 (no partial teardown).
- **AC-1.6** AI-trainer relationships (`is_ai_trainer = true`) are **not**
  removable via this route (that is a subscription cancellation) → 404.

### US-2 — Client leaves a coach

As a client, I can leave a coach so they can no longer see my data and I stop
receiving their assigned content.

- **AC-2.1** `DELETE /clients/me/relationships/:relationshipId` ends the
  active, non-AI relationship where the caller is the client on that row.
- **AC-2.2** Same teardown as AC-1.2 (assignments removed, coach-set habits
  disabled, relationship soft-ended).
- **AC-2.3** The client no longer sees the ex-coach's assigned workouts,
  programmes, or the coach in their "Active Trainers" list.
- **AC-2.4** Same guards as AC-1.5 / AC-1.6 (404 on not-yours / already-ended /
  AI-trainer).

### US-3 — Counterparty is notified

- **AC-3.1** When a coach removes a client, the **client** gets an in-app
  notification. When a client leaves, the **coach** gets one. Best-effort,
  post-commit, non-fatal (a notification failure never rolls back the
  teardown). Copy is neutral/non-punitive.

### US-4 — Mobile affordances

- **AC-4.1** Coach Client Detail screen: the "More" kebab opens an action sheet
  with a destructive **Remove client** action + confirmation dialog naming the
  consequences; on success navigates back to the roster and refreshes it.
- **AC-4.2** Client Profile → Active Trainers: each active coach row exposes a
  **Leave coach** action + confirmation dialog; on success refreshes the list
  and the client's plan/assignments.

## Non-goals

- Re-engagement / "reactivate a terminated relationship" flow (terminated rows
  are kept, but re-inviting uses the existing invite path; unique index on
  `(trainer_id, client_id)` handling covered in design § Re-invite).
- Push notifications for termination (in-app row only for v1; matches the
  decline-flow precedent of no push).
- Bulk "remove all clients" / account-deletion changes (separate flow).
- Any change to AI-access derivation (D5).

## Data-isolation acceptance (Dangerous Areas — user data isolation)

- Two-user test: after coach removes client B, coach A's on-behalf reads/writes
  for B return 403; B sees none of A's assignments; A's roster excludes B.
- After client B leaves coach A: same assertions from B's side.
- Teardown (assignment deletion) is scoped strictly by `(trainerId, clientId)`
  — never touches other coaches' assignments for the same client, nor the
  client's own workouts.
- Post-offboarding, the client's coach-set habits + goals remain active and
  become editable by the client (edit-lock lifted); a two-user test asserts the
  ex-coach can no longer read/edit them (403) while the client can.
