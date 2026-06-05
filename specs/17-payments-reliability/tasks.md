# 17 — Payments Reliability Hardening: Tasks

## Phase A — Double-charge closure (this PR)

### A.1 — Shared utilities

- [ ] **T-A.1.1** Create `microservices/core/src/application/stripe/pgErrors.ts` — extract `isUniqueViolation(err)` (SQLSTATE 23505 via cause-chain walk + constraint-name regex fallback) from `subscriptionCreated.ts`.
- [ ] **T-A.1.2** Update `subscriptionCreated.ts` to import `isUniqueViolation` from the shared util (delete the inline copy; behaviour unchanged).
- [ ] **T-A.1.3** Create `microservices/core/src/application/stripe/stripeIdempotency.ts` — `deriveSubscriptionBaseKey`, `deriveCancelBaseKey`, `opKey` per design. Pure functions.

### A.2 — Idempotency keys on outbound Stripe calls

- [ ] **T-A.2.1** `subscriptionsCreateHandler.ts`: compute the base key once at the top of the POST handler (from optional `body.idempotency_key` + intent fields); add `idempotency_key` to the Elysia body schema (`t.Optional(t.String({ maxLength: 200 }))`).
- [ ] **T-A.2.2** Thread `opKey` into `resolveCustomerId` (`customers.create` → `customer`), `attachPaymentMethod` (`paymentMethods.attach` → `pm-attach`, `customers.update` → `cust-update`).
- [ ] **T-A.2.3** Pass `{ idempotencyKey: opKey(base,'sub-create') }` to the new-sub `subscriptions.create` and the `handleSubscriptionChange` `subscriptions.create`.
- [ ] **T-A.2.4** Pass `{ idempotencyKey: opKey(base,'sub-update') }` to `handleReinstate` and `handleChangeOfTierNoPayment` `subscriptions.update` calls.
- [ ] **T-A.2.5** `subscriptionsCancelHandler.ts`: compute cancel base key; pass `sub-cancel` key to `subscriptions.cancel` and `sub-update` key to the period-end `subscriptions.update`; add optional `idempotency_key` to its body schema.
- [ ] **T-A.2.6** `eventHandlers/subscriptionUpdated.ts`: pass deterministic `idempotencyKey: \`sub-cancel:${oldId}\``to`cancelOldSubscriptionWithRetry`'s `subscriptions.cancel`.
- [ ] **T-A.2.7** Confirm rollback `subscriptions.cancel` calls (orphan cleanup) stay **keyless** (per design).

### A.3 — Concurrency / unique index

- [ ] **T-A.3.1** New migration `supabase/migrations/20260605120000_widen_active_subscription_unique.sql` — drop+recreate the partial unique index with predicate `('active','pending','trialing','past_due')`; idempotent; documented pre-existing-duplicate pre-check in the header.
- [ ] **T-A.3.2** Update `packages/db/src/schema.ts` (~line 319) `where` predicate to match the migration verbatim.
- [ ] **T-A.3.3** New-sub INSERT path: cancel the orphan Stripe sub on any insert failure; on `isUniqueViolation` → HTTP 409 friendly message; else → 500 (existing). Reuse `pgErrors.isUniqueViolation`.

### A.4 — Tests

- [ ] **T-A.4.1** `stripeIdempotency.test.ts` — provided-key namespacing; deterministic-fallback stability (same inputs → same key); distinctness across tier/cycle/PM/existing-sub-id; resubscribe-after-cancel distinctness.
- [ ] **T-A.4.2** `subscriptionsCreateHandler` tests — assert the correct `idempotencyKey` reaches each mutating Stripe mock call across new / reinstate / change-with-PM / change-no-PM paths.
- [ ] **T-A.4.3** 23505-on-insert test — mock the insert to throw a 23505 → assert orphan `subscriptions.cancel` called + 409 returned.
- [ ] **T-A.4.4** `subscriptionsCancelHandler` tests — assert cancel/update idempotency keys passed; no regression to immediate/period-end/already-cancelled branches.
- [ ] **T-A.4.5** `subscriptionUpdated` test — assert `cancelOldSubscriptionWithRetry` passes the deterministic key.
- [ ] **T-A.4.6** `pgErrors.test.ts` — 23505 via direct code, via cause chain, via constraint-name regex; non-matching errors return false.
- [ ] **T-A.4.7** Schema-parity assertion — index predicate includes the four live statuses.

### A.5 — Gate

- [ ] **T-A.5.1** `bun run prettier:check && bun run typecheck && bun run lint && bun run build && bun run test:unit` all green; coverage ≥ 90% on changed files.
- [ ] **T-A.5.2** PR description documents: the design decision (index+idempotency vs advisory-lock), the optional `idempotency_key` contract for the future mobile change, and the documented residual different-intent risk deferred to Phase D.

---

## Phase B — Safety net (DONE — in this PR)

- [x] **MED-2 durable claim** — `stripe_webhook_events` gains `status`/`attempts`/`last_error`/`updated_at` (migration `20260605130000`, schema parity). `claim()` is a single atomic upsert: skip only `done`, re-claim `failed` or stale (`>15min`) `processing`; never delete. Handler marks `done` on success / unhandled, `failed` on throw. Stranded events stay queryable via `WHERE status <> 'done'`. Repo + handler tests updated.
- [x] **HIGH-3 detect+alert reconcile** — new `stripe/reconcile/reconcileDetect.ts` (dependency-injected, read-only diff of payment_status + tier vs Stripe; pure `diffSubscription` + `reconcileDetect` runner, unit-tested). Cron Lambda `src/reconcileCron.ts` logs `[reconcile:summary]` always + `[reconcile:drift]` (ERROR) on mismatch. Hourly `sst.aws.Cron` wired in `infra/api.ts`.
- [ ] **Deploy-verification pending (ops, not code):** confirm the cron fires post-deploy; wire a CloudWatch Logs metric filter on `[reconcile:drift]` + an alarm to page. SST Cron syntax compiles but isn't deploy-verified in this PR.

## Phase C — Completeness (future PR)

- [ ] `charge.refunded`, `charge.dispute.created`, `customer.subscription.paused` handlers.
- [ ] Wire `invoice.payment_failed` + `trial_will_end` to M9 notifications.

## Phase D — Hardening (future PR)

- [ ] Central `canTransition()` state-machine gate on all `payment_status` writes.
- [ ] Append-only transition/money ledger.
- [ ] Fix reconcile stale `"basic"` default → `"free"`; pin Stripe API version.
- [ ] Evaluate full-handler transaction + advisory lock for the different-intent change race.
