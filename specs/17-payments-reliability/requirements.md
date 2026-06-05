# 17 — Payments Reliability Hardening: Requirements

## Overview

A reliability hardening pass over the Stripe subscription/payments backend shipped in PRs #69 / #70 / #72 / #73. The existing implementation is sound on the happy path and already defends most webhook race conditions; this spec closes the remaining correctness gaps surfaced by a read-only payments audit (2026-06-03).

The work is split into **four sequential phases**, each landing as its own PR off a fresh `main`:

| Phase           | Theme                 | Audit findings closed                                                                |
| --------------- | --------------------- | ------------------------------------------------------------------------------------ |
| **A** (this PR) | Double-charge closure | HIGH-1 (outbound idempotency), HIGH-2 (concurrency / `trialing` unique-index hole)   |
| B               | Safety net            | HIGH-3 (scheduled detect+alert reconcile), MED-2 (webhook claim durability)          |
| C               | Completeness          | MED-3 (refund/dispute/pause handlers), MED-4 (dunning + trial-ending notifications)  |
| D               | Hardening             | MED-1 (explicit state machine), LOW-1/2/3 (stale default, version pin, audit ledger) |

This requirements doc specifies **Phase A in full**; B/C/D are scoped at the initiative level here and will be detailed in their own design/tasks revisions when their PRs are cut.

## Background — why these gaps matter

- **Gateways are at-least-once and asynchronous.** A mobile timeout-and-retry or a double-tap on "Subscribe" re-runs the whole `POST /subscriptions` flow. Today nothing dedupes the outbound Stripe calls, so a retry can create **duplicate Stripe customers and subscriptions** — and at trial end, **two real charges**.
- **The only concurrency backstop has a hole.** The partial unique index `user_subscriptions(user_id) WHERE payment_status IN ('active','pending')` excludes `'trialing'`. Two concurrent new-trial sign-ups both insert a `trialing` row → two live Stripe subscriptions per user.

## Current state (2026-06-05)

- Backend: `POST /subscriptions`, `POST /subscriptions/:id/cancel`, `POST /stripe/webhook` (6 event handlers), `scripts/reconcile-stripe.ts`, server-side entitlement — all shipped and merged to `main` (through #73).
- No outbound Stripe call passes an `Idempotency-Key` (grep-confirmed zero usages).
- Partial unique index predicate is `('active','pending')` — see `supabase/migrations/001_initial_schema.sql:789` and `packages/db/src/schema.ts:319`.
- DB driver: `postgres.js` over Supabase transaction-mode pooler (`prepare:false`, `max:1`) — `packages/db/src/client.ts`.

---

## Phase A requirements

### STORY-A1 — Outbound Stripe idempotency (closes HIGH-1)

> As the platform, every state-changing Stripe API call must be safe to retry, so a client retry or internal retry never creates a duplicate customer, subscription, or charge.

**Acceptance criteria**

- **AC-A1.1** Every **mutating** outbound Stripe call passes an `idempotencyKey` in the request-options arg:
  `customers.create`, `customers.update`, `paymentMethods.attach`, `subscriptions.create`, `subscriptions.update`, `subscriptions.cancel`. Read-only calls (`*.retrieve`, `subscriptions.list`) do **not** require one.
- **AC-A1.2** `POST /subscriptions` and `POST /subscriptions/:id/cancel` accept an **optional** `idempotency_key` string on the request body (max 200 chars, client-generated, stable per user action). The endpoints remain backward-compatible — older clients that omit it still work.
- **AC-A1.3** When `idempotency_key` is **provided**, the backend derives per-operation keys by namespacing it (e.g. `${key}:sub-create`, `${key}:customer`), so distinct operations within one flow never collide while each is individually retry-safe.
- **AC-A1.4** When `idempotency_key` is **omitted**, the backend derives a **deterministic** base key from stable request intent — `${userId}:${tier_name}:${billing_cycle}:${payment_method_id ?? 'default'}:${existingExternalSubscriptionId ?? 'new'}` — so two retries of the **same intent** collapse to one Stripe object, while a genuinely different action (e.g. resubscribe after a full cancel, where the existing sub id differs) gets a distinct key.
- **AC-A1.5** Idempotency must NOT cause a false-dedupe across semantically different actions (the derivation in A1.4 includes the discriminating fields that make actions distinct).
- **AC-A1.6** No regression to any existing flow (new / reinstate / change-with-PM / change-no-PM / 3DS / cancel-immediate / cancel-at-period-end).

### STORY-A2 — Single live subscription per user under concurrency (closes HIGH-2)

> As the platform, a user must never end up with two live (billable) subscriptions, even under concurrent or retried requests.

**Acceptance criteria**

- **AC-A2.1** The partial unique index on `user_subscriptions(user_id)` is widened to cover all **live/billable** statuses: `('active','pending','trialing','past_due')`. A second row in any of those statuses for the same user is rejected by the DB atomically.
- **AC-A2.2** The migration is **idempotent** (safe to re-run) and handled correctly given there may be existing data — if any user already has >1 row in the newly-covered statuses (e.g. an existing duplicate `trialing` pair), the migration must not fail silently; it drops+recreates the index and surfaces a clear error if a genuine duplicate blocks creation (with a documented manual-dedupe step in the migration comment).
- **AC-A2.3** The Drizzle schema (`schema.ts`) `where` predicate is updated to match the migration exactly, so schema-derived tooling and the migration agree.
- **AC-A2.4** The **new-subscription INSERT path** in `subscriptionsCreateHandler.ts` catches a unique-violation (SQLSTATE `23505`) on insert: it cancels the just-created orphan Stripe subscription (best-effort, logged) and returns **HTTP 409** with a friendly "a subscription is already being set up — please refresh" message — never a bare 500, and never a stranded billable Stripe sub with no local row.
- **AC-A2.5** The existing webhook `subscriptionCreated` 23505 handling and the `old_stripe_subscription_id` 409 in-flight guards remain intact (no regression).
- **AC-A2.6** Concurrent **identical-intent** requests collapse to a single Stripe subscription via the deterministic idempotency key from A1.4 (the index + idempotency together prevent both a duplicate Stripe object and a duplicate local row).

### Non-goals (Phase A)

- Mobile changes to send `idempotency_key` — the backend ships backward-compatible; the mobile port to emit a stable key is a follow-up task tracked for the M-payments mobile slice.
- The narrow **different-intent simultaneous change** race (two different tier changes fired within the same few-ms window before either commits). This is mitigated by the existing in-flight marker 409 guard for the second-arriving request and is documented as accepted residual risk; a full-handler-transaction + advisory-lock fix is deferred to **Phase D** (it requires a large, higher-risk refactor that the transaction-mode pooler makes non-trivial).
- Reconciliation scheduling (Phase B), refund/dispute (Phase C), state machine (Phase D).

## Testing requirements (Phase A)

- Unit tests for the idempotency-key derivation helper: provided-key namespacing, deterministic-fallback stability across identical inputs, distinctness across different intents, the resubscribe-after-cancel distinctness case.
- Handler tests asserting the derived `idempotencyKey` is passed to each mutating Stripe call (mock the Stripe SDK; assert the second options arg).
- A `23505`-on-insert test: simulate the unique violation on the new-sub insert → assert the orphan Stripe sub is cancelled and a 409 is returned.
- A migration test / schema-parity assertion that the index predicate includes the four live statuses.
- All existing payments tests must continue to pass; repo-wide 90% coverage bar holds on changed files.
