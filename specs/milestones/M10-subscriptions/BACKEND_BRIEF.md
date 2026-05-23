# M10 — Backend Agent Brief

You are implementing the backend track of Milestone 10 — Subscriptions & Payments (Stripe). Read the parent [`BRIEF.md`](./BRIEF.md) first.

You are working on the SST / Elysia backend at `/Users/bradleysimms-evans/Documents/projects/personal/persistence-backend-sst/microservices/core/`. You are NOT touching the mobile app — that is the frontend agent's responsibility. You may read mobile code (especially `packages/mobile/src/domain/ports/api.port.ts`) for contract context but must not modify it.

## Authority

- Parent spec: [`../../11-payments-subscriptions/`](../../11-payments-subscriptions/) — requirements + design + tasks. **Rewritten 2026-05-23** to reflect what PR #69 + #70 actually shipped + what M10 will build. Read it first.
- Backend architectural rules: [`CLAUDE.md`](../../../CLAUDE.md) at repo root (SST v3 + Elysia + Neon + Drizzle + JWT auth + explicit ownership checks).
- Workflow discipline: [`../../_agent.md`](../../_agent.md) — spec-first, always.
- Stripe surface conventions inherited from PR #69 + #70 — see [`microservices/core/src/application/stripe/`](../../../microservices/core/src/application/stripe/) and the `subscriptionsCreateHandler.ts` / `subscriptionsCancelHandler.ts` files. **Read these before extending them.**

## Spec alignment — READ FIRST

The parent spec has already been updated (2026-05-23) to describe the contract you're implementing. You do NOT need to write a separate spec-update phase — that lands as the first commit on the milestone branch and is the canonical reference for what you're building.

Every implementation commit must cite the spec section it implements in the commit footer:

```
Implements: specs/11-payments-subscriptions/design.md § Backend endpoints > GET /subscription-tiers
Closes: specs/11-payments-subscriptions/tasks.md § Phase 2 — Backend reads
Satisfies: specs/11-payments-subscriptions/requirements.md AC 1.1, 1.2, 1.3
```

If you find the spec disagrees with this brief or with your implementation reality, **stop and update the spec first** as its own commit. Do not code around a spec disagreement.

## Scope

Three logical slices. Recommended commit order: tier read → sub-details read → POST extensions. Each slice ships its own tests + 90% branch coverage on changed files. Land all three on the same branch.

### 1. `GET /subscription-tiers` — tier catalog read

Spec: [`design.md` § Backend endpoints > GET /subscription-tiers](../../11-payments-subscriptions/design.md), satisfies requirements AC 1.1–1.3.

**Handler**: `microservices/core/src/application/subscriptions/tiers/subscriptionsTiersHandler.ts`

**Behaviour**:
- Method: `GET`
- Path: `/subscription-tiers`
- Auth: **none** (public). The auth-flow selection screen renders before sign-in.
- Query params: none.
- Response: `{ data: SubscriptionTier[] }` ordered by `price_monthly ASC`. Each row maps `subscription_tiers` columns to camelCase per Drizzle's `$inferSelect` — but emit as JSON with consistent field names matching the spec's `SubscriptionTier` type.

**Repository**: `microservices/core/src/application/repositories/subscriptionTiersRepository.ts`
- `listActive(): Promise<SubscriptionTier[]>`
- Single query: `SELECT * FROM subscription_tiers WHERE is_active = true ORDER BY price_monthly ASC`
- No userId filter — catalog is global.

**Wire shape** (mirror in mobile's `InMemoryApiAdapter`):
```typescript
{
  data: [
    {
      tierName: "basic",
      displayName: "Basic",
      description: "...",
      priceMonthly: 9.99,
      priceYearly: 95.88,
      currency: "GBP",
      features: { /* JSONB */ },
      workoutLimit: 20,
      aiAccess: true,
      aiWorkoutLimit: 1,
      gymBuddyAccess: false,
      trainerClientLimit: null,
      isTrainerTier: false,
      analyticsAccess: false,
      exportAccess: false,
      stripePriceIdMonthly: "price_…",
      stripePriceIdYearly: "price_…"
    },
    /* ... more tiers ... */
  ]
}
```

**Edge cases**:
- Empty catalog → returns `{ data: [] }` + 200 (not 404). Caller treats empty catalog as a deploy-misconfiguration issue, not a runtime error.
- `is_active = false` rows excluded — they exist in legacy as the historical record.
- Decimal handling: Drizzle returns `price_monthly` / `price_yearly` as decimal strings (e.g. `"9.99"`). Parse to `number` in the handler before emitting JSON.

**Register** in [`microservices/core/src/api.ts`](../../../microservices/core/src/api.ts). The route lives before the auth-required handlers since it's public.

### 2. `GET /subscriptions/me` — current entitlement read

Spec: [`design.md` § Backend endpoints > GET /subscriptions/me](../../11-payments-subscriptions/design.md), satisfies requirements AC 5.1, 5.4, 5.5, 6.1.

**Handler**: `microservices/core/src/application/subscriptions/me/subscriptionsMeHandler.ts`

**Behaviour**:
- Method: `GET`
- Path: `/subscriptions/me`
- Auth: **required** (JWT, via `requireAuth` middleware).
- Query params: none.
- Response: `{ data: MySubscription }` — see `design.md` for the full shape.

**Repository**: extend `microservices/core/src/application/repositories/subscriptionRepository.ts` with `findForUser(userId: string): Promise<MySubscription>`.

**Query logic**:
- LEFT JOIN `user_subscriptions` on `profiles.id = user_subscriptions.user_id` (latest active row per user — use the partial unique index `user_subscriptions_active_unique` semantics)
- INNER JOIN `subscription_tiers` on `tier_name`
- Selects all the fields the `MySubscription` type lists
- When no active `user_subscriptions` row: synthesise the response from `SELECT * FROM subscription_tiers WHERE tier_name = 'free'`, with `subscriptionId: null`, `paymentStatus: 'active'` (free tier is always "active"), null dates, `scheduledChange: null`.

**Scheduled-change derivation** (AC 3.7):
- Read `user_subscriptions.metadata.scheduled_change` if present. Shape:
  ```typescript
  metadata.scheduled_change: {
    next_tier_name: SubscriptionTierName,
    effective_at: string  // ISO
  }
  ```
- Backend stamps this on the existing user_subscriptions row when a downgrade is scheduled (Phase 3, change-path dispatch).
- Resolve `next_display_name` from `subscription_tiers` lookup.

**Trial-eligibility flags** (AC 5.5):
- Read `profiles.has_used_user_trial` + `profiles.has_used_trainer_trial`.
- `isEligibleForUserTrial: !hasUsedUserTrial`
- `isEligibleForTrainerTrial: !hasUsedTrainerTrial`

**Edge cases**:
- Auth failure → 401 (handled by `requireAuth` middleware).
- User exists in `profiles` but has no `user_subscriptions` row → synthesised free shape.
- `subscription_tiers WHERE tier_name = 'free'` is missing → 500 with structured log (deploy misconfig).

**Trigger contract**: handler is read-only. NEVER writes to `profiles.subscription_id`, `profiles.role`, `subscription_limits.*`. NEVER writes to `profiles.has_used_*_trial` here (those are written only by the create handler's trial-using paths).

### 3. `POST /subscriptions` extensions

Spec: [`design.md` § Backend endpoints > POST /subscriptions — extended](../../11-payments-subscriptions/design.md), satisfies requirements AC 2.4, 3.3, 3.4.

You are extending the existing `microservices/core/src/application/subscriptions/create/subscriptionsCreateHandler.ts`. **Read it end-to-end first.** PR #70 went through 8 Inspector Brad sweeps closing 14 findings; the patterns there are load-bearing.

**Body validator change**:
```typescript
// Before (PR #70):
payment_method_id: t.String({ minLength: 1 })

// After (M10):
payment_method_id: t.Optional(t.String({ minLength: 1 }))
```

**Dispatch precedence** (handler enforces in order — see `design.md` § Backend endpoints > POST /subscriptions for full rules):

1. **In-flight marker guard** (UNCHANGED from PR #70) — if row carries `metadata.old_stripe_subscription_id`, return 409.
2. **No payment_method_id + no active sub** → 422 `payment_method_id required for new subscription`.
3. **No payment_method_id + active sub + same tier + same cycle** → 400 `no change to apply`.
4. **No payment_method_id + active sub + different tier or cycle** → change-of-tier path; call `stripe.subscriptions.update(stripeSubscriptionId, { items: [{ price: newPriceId, … }], … })` with the customer's existing default payment method on file (no `default_payment_method` parameter — Stripe uses the customer-level default).
5. **payment_method_id present + cancelled sub of same tier** → reinstate path (UNCHANGED).
6. **payment_method_id present + no active sub** → new-sub path (UNCHANGED).
7. **payment_method_id present + active sub** → change-of-tier path WITH new payment method attached.

**Response shape extension**:

Add four fields to the success response (alongside the existing fields):

```typescript
{
  /* ... existing PR #70 fields ... */
  change_type: "new" | "upgrade" | "downgrade" | "reinstate" | "cycle_change",
  scheduled: boolean,
  effective_at: string | null,  // ISO when scheduled
  is_trial: boolean,             // = payment_status === "trialing"
}
```

**Discriminator derivation** (server-side, by dispatch branch):
- New-sub path → `change_type: "new"`, `scheduled: false`, `effective_at: null`
- Reinstate path → `change_type: "reinstate"`, `scheduled: false`, `effective_at: null` (reinstate is always immediate)
- Change-of-tier where `new_price_monthly > current_price_monthly` → `change_type: "upgrade"`, `scheduled: false` (Stripe prorates + bills immediately on `proration_behavior: "always_invoice"`), `effective_at: null`
- Change-of-tier where `new_price_monthly < current_price_monthly` → `change_type: "downgrade"`, `scheduled: true`, `effective_at: current_period_end`. Stamp `metadata.scheduled_change = { next_tier_name, effective_at }` on the EXISTING user_subscriptions row. The Stripe sub update uses `proration_behavior: "none"` + `billing_cycle_anchor: "unchanged"` so the new tier takes effect at the next billing period.
- Cycle change only (same `tier_name`, different `billing_cycle`) → `change_type: "cycle_change"`; `scheduled`/`effective_at` follow the upgrade/downgrade rules by total annual price comparison.
- `is_trial`: `payment_status === "trialing"` (read from Stripe sub response after create/update).

**Existing PR #70 behaviours that MUST be preserved**:
- 14 Inspector Brad findings closed across 8 sweeps. Do not regress any of them. Especially:
  - Stale `requires_3d_secure: true` cleared on change-path
  - `platform` not clobbered when caller omits it
  - Cancel handler matches both UK + US spellings of "cancelled"
  - Reinstate-on-cancelled refuses (those Stripe subs are permanently dead)
  - In-flight marker guard at dispatch site, single source of truth
  - `isAlreadyCanceledError` recovery on both period-end + immediate cancel branches
- The webhook-driven cleanup pattern stays: change-of-tier NEVER cancels inline; `metadata.old_stripe_subscription_id` stamped on both new sub + local row; webhook handler drives the actual cancel-of-old (on `active`/`trialing`) or rollback (on `incomplete_expired`).

**Tests to add**:
- Optional `payment_method_id`: missing + active sub + different tier → change-path dispatch + 200
- Optional `payment_method_id`: missing + no active sub → 422
- Optional `payment_method_id`: missing + active sub + same tier + same cycle → 400
- Discriminator: new-sub path → `change_type: "new"`
- Discriminator: upgrade path → `change_type: "upgrade"`, `scheduled: false`
- Discriminator: downgrade path → `change_type: "downgrade"`, `scheduled: true`, `effective_at` present
- Discriminator: cycle-change path → `change_type: "cycle_change"`
- Discriminator: reinstate path → `change_type: "reinstate"`
- Discriminator: trial path → `is_trial: true`, `payment_status: "trialing"`
- In-flight marker still refuses no-payment-method change attempts (regression check)

## Quality gates

```bash
bun run prettier:check    # format
bun run typecheck          # TypeScript
bun run lint               # ESLint (zero errors; warnings tolerated if pre-existing)
bun run build              # all packages
bun --filter @persistence/core test:unit   # 90% branches non-negotiable on changed files
```

Total core test count after M10: target +25–40 tests from current 728 baseline.

## Files you will touch

```
microservices/core/src/api.ts                                            # route registration
microservices/core/src/application/subscriptions/tiers/
  subscriptionsTiersHandler.ts                                            # new
  __tests__/subscriptionsTiersHandler.test.ts                              # new
microservices/core/src/application/subscriptions/me/
  subscriptionsMeHandler.ts                                                # new
  __tests__/subscriptionsMeHandler.test.ts                                 # new
microservices/core/src/application/subscriptions/create/
  subscriptionsCreateHandler.ts                                            # extend
  __tests__/subscriptionsCreateHandler.test.ts                             # extend
microservices/core/src/application/repositories/
  subscriptionTiersRepository.ts                                           # new
  subscriptionRepository.ts                                                # extend with findForUser
  __tests__/subscriptionTiersRepository.test.ts                            # new
  __tests__/subscriptionRepository.test.ts                                 # extend
```

## Files you will NOT touch

- Anything under `packages/mobile/` — frontend agent's territory
- The webhook handlers (`microservices/core/src/application/stripe/eventHandlers/*`) — final for M10
- The reconcile script (`scripts/reconcile-stripe.ts`) — final for M10
- `packages/db/src/schema.ts` — no schema changes in M10
- The DB trigger / migrations — `update_subscription_limits_trigger` stays exactly as is
- `infra/` — no SST changes; environment variables already wired

## Inspector Brad expectations

PR #70 took 8 sweeps to close 14 findings. PR #69 closed at 3. M10 backend touches a smaller surface than #70 but extends a critical dispatch handler. Expect 1–4 sweeps. Patterns Brad has flagged before are extra worth re-reading:

- Trial flags written via plain UPDATE (NOT through the trigger contract)
- Metadata spread carrying stale flags on change-path
- Cancel handler matching both UK + US `cancelled` spellings
- `isAlreadyCanceledError` recovery on every path that talks to a possibly-dead Stripe sub
- Counters separating planned vs applied (reconcile)

TRACE before patching. State the exact code reading + reproduction sequence in commit messages. PR #70 was 14/14 real findings — Brad's signal is high but his earlier read of "~60% real, 40% reading from old state" still applies on more cross-cut surfaces.

## When you finish

- Tests pass with 90% branch coverage on touched files
- `gh pr create` against `main` with the M10 reference and SMOKE_TEST link in the description
- Wait for Brad to fire `@inspector-brad` — do not pre-empt
- After fixes land, surface a `(finding, severity, patch)` summary table so Brad can decide whether to re-fire
