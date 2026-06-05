# 17 — Payments Reliability Hardening: Design

Scope of this revision: **Phase A** (idempotency + concurrency). Phases B–D are summarised at the end and will be expanded in their own PRs.

## Constraints that shape the design

- **DB driver is `postgres.js` over Supabase's transaction-mode pooler** (`packages/db/src/client.ts`, `prepare:false`, `max:1`). Under transaction-mode pgbouncer, **session-level** primitives (session advisory locks, `SET`, prepared statements) are unsafe. Transaction-scoped advisory locks (`pg_advisory_xact_lock`) work only inside an explicit transaction — and holding one across the multi-second Stripe API calls would force every repo write into a passed-tx refactor of the 1692-line create handler. That blast radius is not justified for Phase A.
- **Therefore the concurrency arbiter is the DB unique index** (atomic regardless of pooling) plus **Stripe-side idempotency** (collapses duplicate intents at the gateway). This closes every realistic vector without a transaction refactor.
- **Backward compatibility**: backend must ship without a coordinated mobile release, so the new `idempotency_key` field is optional with a deterministic server fallback.

## A1 — Outbound Stripe idempotency

### New helper: `stripeIdempotency.ts`

`microservices/core/src/application/stripe/stripeIdempotency.ts` — pure, unit-tested.

```ts
// Derive the base key for a subscription-create/change flow.
export function deriveSubscriptionBaseKey(input: {
  clientKey?: string | null;
  userId: string;
  tierName: string;
  billingCycle: string;
  paymentMethodId?: string | null;
  existingExternalSubscriptionId?: string | null;
}): string;

// Derive the base key for a cancel flow.
export function deriveCancelBaseKey(input: {
  clientKey?: string | null;
  userId: string;
  localSubscriptionId: string;
  cancelImmediately: boolean;
}): string;

// Namespace a base key for a specific Stripe operation.
export function opKey(
  baseKey: string,
  op:
    | "customer"
    | "cust-update"
    | "pm-attach"
    | "sub-create"
    | "sub-update"
    | "sub-cancel",
): string; // → `${baseKey}:${op}`
```

Rules:

- If `clientKey` is a non-empty string → base key = `clientKey` (trimmed, capped at 200 chars).
- Else → deterministic base = the colon-joined stable-intent string from AC-A1.4. `existingExternalSubscriptionId` (or `'new'`) is the field that makes resubscribe-after-cancel distinct from a retry of the same in-flight attempt.
- `opKey` appends `:${op}` so distinct operations in one flow never share a key. (Stripe scopes idempotency by key + endpoint, so cross-endpoint reuse is technically safe, but explicit namespacing is clearer and future-proofs against a refactor that moves a call to a different endpoint.)

### Threading the key through the SDK calls

Stripe's Node SDK takes request options as the **second argument**: `stripe.subscriptions.create(params, { idempotencyKey })`.

Call sites to update (all mutating):

| File                                                          | Call                    | op            |
| ------------------------------------------------------------- | ----------------------- | ------------- |
| `subscriptionsCreateHandler.ts` `resolveCustomerId`           | `customers.create`      | `customer`    |
| `subscriptionsCreateHandler.ts` `attachPaymentMethod`         | `paymentMethods.attach` | `pm-attach`   |
| `subscriptionsCreateHandler.ts` `attachPaymentMethod`         | `customers.update`      | `cust-update` |
| `subscriptionsCreateHandler.ts` new-sub                       | `subscriptions.create`  | `sub-create`  |
| `subscriptionsCreateHandler.ts` `handleSubscriptionChange`    | `subscriptions.create`  | `sub-create`  |
| `subscriptionsCreateHandler.ts` `handleReinstate`             | `subscriptions.update`  | `sub-update`  |
| `subscriptionsCreateHandler.ts` `handleChangeOfTierNoPayment` | `subscriptions.update`  | `sub-update`  |
| `subscriptionsCancelHandler.ts` immediate                     | `subscriptions.cancel`  | `sub-cancel`  |
| `subscriptionsCancelHandler.ts` period-end                    | `subscriptions.update`  | `sub-update`  |

The base key is computed once at the top of each handler and the relevant `opKey(...)` is threaded down into the helper functions (added as a parameter to `resolveCustomerId`, `attachPaymentMethod`, `handleReinstate`, `handleSubscriptionChange`, `handleChangeOfTierNoPayment`).

**Rollback cancels intentionally do NOT carry an idempotency key** — a rollback `subscriptions.cancel(orphanId)` is a one-shot best-effort on a specific sub id; reusing a flow key there could clash with a legitimate retry. They stay keyless (current behaviour).

**Webhook-side** (`subscriptionUpdated.ts` `cancelOldSubscriptionWithRetry`): the retry loop cancels a specific old sub id. We give it a deterministic key `sub-cancel:${oldId}` so Stripe's retries of the same delivery don't double-act; the `isAlreadyCanceledError` tolerance already covers the rest.

## A2 — Single live subscription under concurrency

### Migration: widen the partial unique index

New migration `supabase/migrations/20260605120000_widen_active_subscription_unique.sql`:

```sql
-- Widen the single-live-subscription guard to include trialing + past_due.
-- Prior predicate ('active','pending') left a hole: two concurrent new-trial
-- sign-ups both insert a 'trialing' row, yielding two billable Stripe subs.

DROP INDEX IF EXISTS user_subscriptions_active_unique;

CREATE UNIQUE INDEX user_subscriptions_active_unique
  ON user_subscriptions (user_id)
  WHERE payment_status IN ('active', 'pending', 'trialing', 'past_due');

COMMENT ON INDEX user_subscriptions_active_unique IS
  'One live subscription per user. Live = active|pending|trialing|past_due. Terminal (cancelled|expired|incomplete_expired) excluded so users can resubscribe.';
```

**Pre-existing-duplicate handling (AC-A2.2):** if a user already has two rows in the newly-covered set (e.g. a legacy duplicate `trialing` pair), `CREATE UNIQUE INDEX` will fail. The migration header documents a guarded pre-check query operators run first:

```sql
-- Run BEFORE applying if this is a populated prod DB:
--   SELECT user_id, count(*) FROM user_subscriptions
--   WHERE payment_status IN ('active','pending','trialing','past_due')
--   GROUP BY user_id HAVING count(*) > 1;
-- Resolve any rows returned (keep the latest by created_at, demote the rest
-- to 'cancelled') before applying. Phase B reconciliation will then re-align
-- from Stripe truth.
```

We do **not** auto-demote inside the migration — silently mutating subscription state in a schema migration is the kind of money-touching side effect that must be a deliberate, reviewed data op, not a DDL side effect.

### Schema parity (`schema.ts`)

Update line ~319 `where(sql`payment_status IN ('active', 'pending')`)` → the four-status predicate, matching the migration verbatim.

### 23505-safe new-sub insert (AC-A2.4)

In the new-subscription INSERT path (`subscriptionsCreateHandler.ts` ~line 1567), the `catch` currently treats any insert error identically (log + cancel Stripe sub + 500). Add a unique-violation branch (reuse the existing `isUniqueViolation` detector pattern from `subscriptionCreated.ts` — extract it to a shared util `microservices/core/src/application/stripe/pgErrors.ts` so both call sites share one implementation):

```
catch (err) {
  await stripe.subscriptions.cancel(subscription.id).catch(log)   // cancel the orphan
  if (isUniqueViolation(err)) {
    ctx.set.status = 409
    return { error: "A subscription is already being set up for your account. Please refresh and try again." }
  }
  ctx.set.status = 500
  return { error: `Failed to create subscription record: ${message}` }
}
```

Net effect: a concurrent double-tap where both requests reach `subscriptions.create` → both create a Stripe sub → first DB insert wins, second hits 23505 → second's Stripe sub is cancelled and the user gets a clean 409. Combined with the deterministic idempotency key (AC-A1.4/A2.6), the two identical-intent `subscriptions.create` calls actually collapse to **one** Stripe sub at the gateway, so in the common case the orphan-cancel path isn't even exercised — the index + 409 is the belt-and-braces backstop for the case where the two requests carry different (or client-supplied distinct) keys.

### Shared pg-error util

Extract the SQLSTATE-23505 detector (currently inline in `subscriptionCreated.ts:isUniqueViolation`) into `application/stripe/pgErrors.ts`:

- walks the `cause` chain up to depth 4 looking for `code === "23505"`,
- falls back to a constraint-name regex match.
  `subscriptionCreated.ts` imports it (no behaviour change there); the new-sub insert path imports it too.

## Residual risk (documented, deferred to Phase D)

Two **different-intent** changes fired by the same user within the same few-ms window — before either writes its `old_stripe_subscription_id` marker — can both call `subscriptions.create` with different keys, briefly creating two Stripe subs. The second-arriving `POST /subscriptions` is blocked by the existing in-flight marker 409 once the first commits; the unguarded window is sub-second and requires a single user firing two _distinct_ changes near-simultaneously (pathological on a single mobile device). Phase D evaluates a full-handler transaction + `pg_advisory_xact_lock(hashtext(userId))` to close it, accepting the connection-holding tradeoff.

## Phases B–D (initiative summary — detailed later)

- **B**: add a `status` (`pending`/`done`) column to `stripe_webhook_events` instead of delete-on-failure, so stranded events are queryable; add an SST cron invoking a detect+alert reconcile mode (diff Stripe vs DB, emit metric/alert, auto-heal only safe cases).
- **C**: handlers for `charge.refunded`, `charge.dispute.created`, `customer.subscription.paused`; wire `invoice.payment_failed` + `trial_will_end` to the M9 notification path.
- **D**: central `canTransition(current, next, source)` table gating every `payment_status` write; append-only transition ledger; fix reconcile's stale `"basic"` default → `"free"`; pin Stripe API version; consider the advisory-lock different-intent fix.
