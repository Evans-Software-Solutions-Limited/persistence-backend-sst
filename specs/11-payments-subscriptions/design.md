# 11 — Payments & Subscriptions: Technical Design

## Architecture summary

Custom Apple-Pay-driven subscription flow against the Stripe API. Three layers:

1. **Mobile** collects a `payment_method_id` via `@stripe/stripe-react-native`'s Apple Pay primitive (`usePlatformPay()` → `createPlatformPayPaymentMethod`).
2. **Backend** receives `{ tier_name, billing_cycle, payment_method_id?, use_trial }`, dispatches to one of five flows (new / reinstate / upgrade / downgrade / cycle-change), and creates / changes / reactivates the Stripe subscription server-side. Returns local + Stripe sub IDs plus discriminator fields.
3. **Stripe webhook** drives eventual side-effects: cancel-of-old after change-of-tier, rollback on `incomplete_expired`, payment-status flips after 3DS, trial-end notifications.

**No Stripe Checkout sessions, no Stripe Customer Portal.** Both screens (selection + management) are native React Native and hit the SST API directly.

## Domain models

```typescript
// src/domain/models/subscription.ts

export type SubscriptionTierName =
  | "free"
  | "basic"
  | "premium"
  | "individual_trainer_standard"
  | "individual_trainer_pro"
  | "small_business_standard"
  | "small_business_pro"
  | "medium_enterprise_standard"
  | "medium_enterprise_pro";

export type SubscriptionRole =
  | "user"
  | "personal_trainer"
  | "physiotherapist"
  | "admin";

export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "cancelled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid";

export type BillingCycle = "monthly" | "yearly";

export type ChangeType =
  | "new"
  | "upgrade"
  | "downgrade"
  | "reinstate"
  | "cycle_change";

/**
 * Catalog entry. Mirrors the `subscription_tiers` table.
 */
export interface SubscriptionTier {
  tierName: SubscriptionTierName;
  displayName: string;
  description: string | null;
  priceMonthly: number; // pounds (e.g. 9.99) — wire decimal string parsed to number
  priceYearly: number | null;
  currency: string; // ISO-4217, default "GBP"
  features: Record<string, unknown>;
  workoutLimit: number | null; // null = unlimited
  aiAccess: boolean;
  aiWorkoutLimit: number;
  gymBuddyAccess: boolean;
  trainerClientLimit: number | null;
  isTrainerTier: boolean;
  analyticsAccess: boolean;
  exportAccess: boolean;
  stripePriceIdMonthly: string | null;
  stripePriceIdYearly: string | null;
}

/**
 * User's current subscription state, joined with their tier info. Returned by
 * `GET /subscriptions/me`. When the user has no `user_subscriptions` row, the
 * backend synthesises a `free`-tier shape from `subscription_tiers` so the UI
 * never has to handle a null sub specially.
 */
export interface MySubscription {
  // From user_subscriptions
  subscriptionId: string | null; // null only for synthetic free shape
  tierName: SubscriptionTierName;
  paymentStatus: SubscriptionStatus;
  billingCycle: BillingCycle | null;
  startsAt: string; // ISO
  expiresAt: string | null;
  cancelledAt: string | null;
  trialEndsAt: string | null;
  externalSubscriptionId: string | null; // Stripe sub id

  // From subscription_tiers (joined)
  tierDisplayName: string;
  tierDescription: string | null;
  workoutLimit: number | null;
  aiAccess: boolean;
  aiWorkoutLimit: number;
  gymBuddyAccess: boolean;
  trainerClientLimit: number | null;
  isTrainerTier: boolean;

  // From profiles
  role: SubscriptionRole;

  // Trial eligibility (read from profiles.has_used_*_trial)
  hasUsedUserTrial: boolean;
  hasUsedTrainerTrial: boolean;
  isEligibleForUserTrial: boolean; // = !hasUsedUserTrial
  isEligibleForTrainerTrial: boolean; // = !hasUsedTrainerTrial

  // Scheduled-change marker (read from user_subscriptions.metadata.scheduled_change when present)
  scheduledChange: {
    nextTierName: SubscriptionTierName;
    nextDisplayName: string;
    effectiveAt: string; // ISO
  } | null;
}

/**
 * Result of `createSubscription`. Backend returns one of these shapes:
 *
 *   success path:        { success, requires_action: false, ...sub fields }
 *   3DS path:            { success, requires_action: true, client_secret, ...sub fields }
 *   change-of-tier path: same as success, with change_type/scheduled/effective_at populated
 */
export interface CreateSubscriptionResult {
  success: true;
  requiresAction: boolean;
  subscriptionId: string;
  stripeSubscriptionId: string;
  trialEndsAt: string | null;
  nextBillingDate: string | null;
  paymentStatus: SubscriptionStatus;
  clientSecret?: string; // present iff requiresAction === true
  reinstated?: boolean;
  changeType: ChangeType;
  scheduled: boolean; // true iff downgrade scheduled to period-end
  effectiveAt: string | null; // ISO when scheduled
  isTrial: boolean;
}

export interface CancelSubscriptionResult {
  success: true;
  cancelledAt: string;
  subscriptionEndsAt: string;
  message: string;
}
```

## PaymentsPort

The legacy stub (`initializePaymentSheet` / `presentPaymentSheet`) is replaced. The new port reflects the actual Apple-Pay-direct flow.

```typescript
// src/domain/ports/payments.port.ts

export type PaymentErrorKind =
  | "cancelled" // user cancelled the Apple Pay sheet
  | "platform_unavailable" // Apple Pay not supported on this device / Android
  | "no_payment_methods" // Apple Wallet empty
  | "stripe_error" // Stripe SDK returned an error
  | "unknown";

export interface PaymentError {
  readonly kind: PaymentErrorKind;
  readonly code: string | null;
  readonly message: string;
}

export interface ApplePayCartItem {
  label: string;
  amountPence: number;
  paymentType: "Immediate" | "Recurring" | "Deferred";
  intervalCount?: number;
  intervalUnit?: "minute" | "hour" | "day" | "month" | "year";
  startDate?: number; // unix seconds — used to defer recurring start past trial
  isPending?: boolean;
}

export interface CollectApplePayPaymentMethodInput {
  merchantCountryCode: string; // "GB"
  currencyCode: string; // "GBP"
  cartItems: ApplePayCartItem[];
}

export interface CollectApplePayPaymentMethodResult {
  paymentMethodId: string;
}

export interface PaymentsPort {
  /**
   * True on iOS when Apple Pay is configured AND a card is set up in
   * Apple Wallet. False on Android and on iOS devices without a wallet.
   */
  isApplePaySupported(): Promise<boolean>;

  /**
   * Presents the Apple Pay sheet (immediately — no UI before the sheet appears)
   * and returns a Stripe `payment_method_id` on success. On user cancel,
   * returns Result.err with kind "cancelled".
   *
   * Itemise trials via cartItems: free trial period as `paymentType: "Immediate"`
   * with amountPence: 0, recurring charge as `paymentType: "Recurring"` with
   * startDate = today + trial_duration_days. Apple displays the breakdown.
   */
  collectApplePayPaymentMethod(
    input: CollectApplePayPaymentMethodInput,
  ): Promise<Result<CollectApplePayPaymentMethodResult, PaymentError>>;

  /**
   * Confirms a 3DS challenge for a PaymentIntent. Called when backend's
   * `createSubscription` returns `requires_action: true` + a `client_secret`.
   * The Stripe SDK presents the challenge sheet; on success the eventual
   * `customer.subscription.updated` webhook commits the final `payment_status`
   * server-side.
   */
  confirm3DS(clientSecret: string): Promise<Result<void, PaymentError>>;
}
```

**Implementations:**

- `StripeApplePayAdapter` — production. Uses `@stripe/stripe-react-native` `usePlatformPay` + `createPlatformPayPaymentMethod` + `handleNextAction`. Lives at `packages/mobile/src/adapters/payments/stripe.adapter.ts`.
- `MockPaymentsAdapter` — tests. Returns canned responses; configurable per-test for cancelled / 3DS / success.

## ApiPort additions

The existing `createSubscription` + `cancelSubscription` shipped in PR #70. M10 extends both signatures + adds two new read methods.

```typescript
// src/domain/ports/api.port.ts — additions

interface ApiPort {
  // ... existing ...

  /**
   * Fetch the active subscription tier catalog. Returns all `subscription_tiers`
   * rows where `is_active = true`, ordered by `price_monthly` ascending.
   * Public read — no auth required, intended for the auth-flow selection screen.
   */
  getSubscriptionTiers(): Promise<Result<SubscriptionTier[], ApiError>>;

  /**
   * Fetch the current user's subscription joined with tier + trial eligibility.
   * Returns a synthetic `free`-tier `MySubscription` when the user has no row in
   * `user_subscriptions`. Auth required.
   */
  getMySubscription(): Promise<Result<MySubscription, ApiError>>;

  /**
   * Extended in M10: `payment_method_id` becomes optional. When absent, the
   * backend requires an existing active subscription (change-of-tier path);
   * otherwise 422. Response shape extended with change_type / scheduled /
   * effective_at / is_trial discriminators.
   */
  createSubscription(
    input: CreateSubscriptionInput,
  ): Promise<Result<CreateSubscriptionResult, ApiError>>;
}

// Wire type extensions
export type CreateSubscriptionInput = {
  tier_name: SubscriptionTierName;
  billing_cycle: BillingCycle;
  payment_method_id?: string; // optional — required only for new-sub / 3DS / reinstate
  use_trial: boolean;
  platform?: "ios" | "android";
};
```

## Backend endpoints

### `GET /subscription-tiers`

- **Auth**: none (public). The auth-flow selection screen renders before sign-in.
- **Query params**: none.
- **Response**: `{ data: SubscriptionTier[] }` — array ordered by `price_monthly ASC`, filtered `is_active = true`. Single envelope.
- **Handler**: `microservices/core/src/application/subscriptions/tiers/subscriptionsTiersHandler.ts`
- **Repo**: `SubscriptionTiersRepository.listActive()` — single `SELECT * FROM subscription_tiers WHERE is_active = true ORDER BY price_monthly ASC`. No userId filter (catalog is global).
- **Edge cases**: empty catalog → returns `{ data: [] }` + 200, not 404. Backend deploy is broken if the table is empty; that's a config issue, not a runtime error.

### `GET /subscriptions/me`

- **Auth**: required (JWT).
- **Query params**: none.
- **Response**: `{ data: MySubscription }` — always returns a `MySubscription` shape, synthesising the `free` tier when the user has no `user_subscriptions` row.
- **Handler**: `microservices/core/src/application/subscriptions/me/subscriptionsMeHandler.ts`
- **Repo**: `SubscriptionRepository.findForUser(userId)` — joins `user_subscriptions` (LEFT) with `subscription_tiers` (INNER on `tierName`) and `profiles` (INNER on `userId`). When no `user_subscriptions` row exists, repo synthesises the free shape from `subscription_tiers WHERE tier_name = 'free'`.
- **Trigger contract**: handler does NOT write to `profiles.subscription_id`, `profiles.role`, or `subscription_limits.*`. Read-only.

### `POST /subscriptions` — extended

- **Body validator change**: `payment_method_id` becomes `t.Optional(t.String({ minLength: 1 }))`.
- **Dispatch precedence** (handler enforces in order):
  1. **In-flight marker guard** (unchanged from PR #70): if the row carries `metadata.old_stripe_subscription_id`, return 409 — any follow-up flow refused until webhook chain resolves.
  2. **No payment_method_id + no active sub** → 422 `payment_method_id required for new subscription`.
  3. **No payment_method_id + active sub + same tier + same cycle** → 400 `no change to apply`.
  4. **No payment_method_id + active sub + different tier or cycle** → change-of-tier path; backend calls Stripe's `subscriptions.update` with the existing default payment method on file.
  5. **payment_method_id present + cancelled sub of same tier** → reinstate path.
  6. **payment_method_id present + no active sub** → new-sub path.
  7. **payment_method_id present + active sub** → change-of-tier path with the new payment method attached (rare; covers the "user wants to switch card AND tier in one flow" case).
- **Response shape extension**:
  ```typescript
  {
    success: true,
    requires_action: boolean,
    subscription_id: string,
    stripe_subscription_id: string,
    trial_ends_at: string | null,
    next_billing_date: string | null,
    payment_status: string,
    client_secret?: string,
    reinstated?: boolean,
    // M10 additions:
    change_type: "new" | "upgrade" | "downgrade" | "reinstate" | "cycle_change",
    scheduled: boolean,                 // true iff downgrade scheduled to period-end
    effective_at: string | null,        // ISO when scheduled; null otherwise
    is_trial: boolean,                  // = payment_status === "trialing"
  }
  ```
- **Discriminator derivation (server-side, by dispatch branch)**:
  - New-sub path → `change_type: "new"`, `scheduled: false`, `effective_at: null`, `is_trial: payment_status === "trialing"`.
  - Reinstate path → `change_type: "reinstate"`, `scheduled: false`, `effective_at: null`, `is_trial` from sub state.
  - Change-of-tier where new `price_monthly` > current → `change_type: "upgrade"`, `scheduled: false` (Stripe prorates and bills immediately), `effective_at: null`.
  - Change-of-tier where new `price_monthly` < current → `change_type: "downgrade"`, `scheduled: true`, `effective_at: current_period_end`. Backend stamps `metadata.scheduled_change` on the existing row.
  - Cycle change only (monthly ↔ yearly, same tier) → `change_type: "cycle_change"`; scheduled per upgrade/downgrade direction by price delta.
- **In-flight marker** (unchanged): change-of-tier + reinstate paths stamp `metadata.old_stripe_subscription_id` on both the new Stripe sub AND the local row's metadata; webhook handler cleans up the old sub when the new transitions to `active`/`trialing`, or rolls back if the new transitions to `incomplete_expired`.

### `POST /subscriptions/:id/cancel` — unchanged

Shipped in PR #70. M10 does not touch this endpoint. Period-end cancel by default; `cancel_immediately: true` opt-in for immediate.

## Subscription state (mobile)

### Tanstack Query keys

| Key                             | Purpose                         | Stale-time |
| ------------------------------- | ------------------------------- | ---------- |
| `['subscription-tiers']`        | Catalog                         | 10 minutes |
| `['user-subscription', userId]` | Current user's `MySubscription` | 2 minutes  |

### Hooks

```typescript
// ui/hooks/useSubscriptionTiers.ts
export function useSubscriptionTiers() {
  /* wraps api.getSubscriptionTiers */
}

// ui/hooks/useMySubscription.ts
export function useMySubscription() {
  /* wraps api.getMySubscription */
}

// ui/hooks/useCreateSubscription.ts
export function useCreateSubscription() {
  // wraps api.createSubscription
  // onSuccess: invalidate ['user-subscription'], ['user-profile'], ['profile-data']
}

// ui/hooks/useCancelSubscription.ts
export function useCancelSubscription() {
  // wraps api.cancelSubscription
  // onSuccess: invalidate same set
}
```

### Trial-eligibility derivation

Trial eligibility lives on the `MySubscription` shape returned by `GET /subscriptions/me` — no separate endpoint. The selection screen reads `isEligibleForUserTrial` / `isEligibleForTrainerTrial` and displays the trial banner accordingly.

## UI structure

### Screens

```
ui/navigation/(auth)/subscription-selection.tsx   # thin screen wrapper
ui/navigation/subscription-management.tsx          # thin screen wrapper
ui/navigation/(auth)/success.tsx                   # thin screen wrapper

ui/containers/
  SubscriptionSelectionContainer.tsx
  SubscriptionManagementContainer.tsx
  SubscriptionSuccessContainer.tsx

ui/presenters/
  SubscriptionSelectionPresenter.tsx
  SubscriptionManagementPresenter.tsx
  SubscriptionSuccessPresenter.tsx
  CancelSubscriptionModal.tsx

ui/components/subscription/
  SubscriptionCard.tsx                  # user-tier card (single column)
  TrainerSubscriptionCard.tsx           # trainer-tier card (Standard / Pro dual-column)
  PaymentMethodForm.tsx                 # Apple Pay trigger (uses PaymentsPort)
  ScheduledChangeIndicator.tsx          # "Scheduled: <next> effective <date>"
  CurrentSubscriptionStatusCard.tsx     # "Current: <tier>" / "Cancelled: <tier> ends <date>"
```

### Legacy → V2 mapping

| Legacy path                                           | V2 path                                                                                                                                                                                          | Notes                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `app/(auth)/subscription-selection.tsx`               | `ui/containers/SubscriptionSelectionContainer.tsx` + `ui/presenters/SubscriptionSelectionPresenter.tsx`                                                                                          | Container owns data + state machine; presenter is pure                                               |
| `app/subscription-management.tsx`                     | `ui/containers/SubscriptionManagementContainer.tsx` + `ui/presenters/SubscriptionManagementPresenter.tsx`                                                                                        | Same split                                                                                           |
| `app/(auth)/success.tsx`                              | `ui/containers/SubscriptionSuccessContainer.tsx` + `ui/presenters/SubscriptionSuccessPresenter.tsx`                                                                                              | Reads `useMySubscription` to derive benefits list                                                    |
| `components/subscription/SubscriptionCard.tsx`        | `ui/components/subscription/SubscriptionCard.tsx`                                                                                                                                                | Pure presenter                                                                                       |
| `components/subscription/TrainerSubscriptionCard.tsx` | `ui/components/subscription/TrainerSubscriptionCard.tsx`                                                                                                                                         | Pure presenter                                                                                       |
| `components/subscription/ComparisonTable.tsx`         | (not ported — replaced by the role-toggle + stacked cards model from legacy `subscription-selection.tsx`. Legacy `ComparisonTable.tsx` is referenced but unused in the legacy selection screen.) | Skip                                                                                                 |
| `components/payment/PaymentMethodForm.tsx`            | `ui/components/subscription/PaymentMethodForm.tsx`                                                                                                                                               | Uses `PaymentsPort` instead of direct Stripe SDK                                                     |
| `lib/utils/subscriptionUtils.ts`                      | `domain/services/subscriptionService.ts`                                                                                                                                                         | Port `canCancelSubscription`, `getSubscriptionDisplayInfo`, `isCancelledButActive` as pure functions |

### Container responsibilities (Selection screen)

- Fetch tiers + current sub via hooks
- Manage role toggle state (`user` / `trainer`)
- Manage billing cycle toggle state (`monthly` / `yearly`)
- Manage selected-tier-for-payment state (`null` | tier_name) — drives `PaymentMethodForm` mount
- Manage cancel-confirmation-modal visibility
- Handle `onTierSelect`:
  - If current tier with no changes → no-op
  - If free tier → no-op (free isn't buyable)
  - Set `selectedTierForPayment = tierName` → triggers Apple Pay sheet
- Handle `onPaymentMethodReady(paymentMethodId)`:
  - Compute trial eligibility from current sub state
  - Call `createSubscription` with `use_trial` set accordingly
  - On `requires_action: true` → call `payments.confirm3DS(clientSecret)`
  - On final success → invalidate queries + router.push `/(auth)/success`
  - On error → alert + reset selected tier
- Handle `onCancel` → show modal → on confirm → `cancelSubscription` → alert + invalidate

### Container responsibilities (Management screen)

- Fetch current sub via `useMySubscription`
- Derive `canUpgrade` / `canDowngrade` / `canCancel` from sub state (user-tier-only logic)
- `handleUpgrade(tier)` → confirmation alert → `createSubscription({ tier_name, billing_cycle })` with NO `payment_method_id` → success alert + invalidate
- `handleDowngrade(tier)` → confirmation alert → `createSubscription({ tier_name, billing_cycle })` with NO `payment_method_id` → response carries `scheduled: true` + `effective_at` → success alert showing effective date
- `handleCancel` → confirmation alert (trial vs paid wording) → `cancelSubscription` with default body → success alert with end date

## Stripe integration

### SDK installation + config

- Package: `@stripe/stripe-react-native` (already in legacy `persistence-mobile` dependencies; M10 adds to V2 `packages/mobile/package.json`)
- App config: Apple Merchant ID configured in `app.json` (`merchantIdentifier`). Already present in legacy.
- `<StripeProvider>` wraps the app at root, providing the publishable key (from `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`).
- Backend: `STRIPE_SECRET_KEY` (server-side) is set per-stage via `bunx sst secret set`. Mobile only ever holds the publishable key.

### Apple Pay flow

```
[User taps tier card]
         │
         ▼
[Container sets selectedTierForPayment]
         │
         ▼
[PaymentMethodForm mounts; calls payments.isApplePaySupported()]
         │
         ├─ false (Android / no wallet) ─► [Error state shown inline]
         │
         ▼ true
[payments.collectApplePayPaymentMethod(cartItems)]
         │
         ├─ Result.err{kind: "cancelled"} ─► [Container clears selectedTierForPayment, silent]
         ├─ Result.err{other}              ─► [Alert + clear]
         │
         ▼ Result.ok{paymentMethodId}
[Container calls createSubscription with paymentMethodId]
         │
         ▼
[Backend creates Stripe sub + attaches payment method]
         │
         ├─ requires_action: false ─► [Success path]
         │
         ▼ requires_action: true
[Container calls payments.confirm3DS(clientSecret)]
         │
         ├─ Result.err ─► [Alert + clear; sub stays in `incomplete`, webhook eventually rolls back]
         │
         ▼ Result.ok
[Webhook commits final payment_status server-side]
         │
         ▼
[Container invalidates ['user-subscription'] + routes to success]
```

### Webhook handler architecture

Lives at the Hono parent layer (not Elysia) because signature verification requires the raw request bytes. See [`microservices/core/src/api.ts:117`](../../microservices/core/src/api.ts).

| Event type                             | Handler                      | What it does                                                                                                                                                                                  |
| -------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customer.subscription.created`        | `subscriptionCreated.ts`     | Inserts or updates `user_subscriptions` row matching Stripe sub id                                                                                                                            |
| `customer.subscription.updated`        | `subscriptionUpdated.ts`     | Updates tier / billing_cycle / payment_status; drives change-of-tier cleanup of the old sub when `metadata.old_stripe_subscription_id` resolves; rollback to original on `incomplete_expired` |
| `customer.subscription.deleted`        | `subscriptionDeleted.ts`     | Flips local row to `cancelled`                                                                                                                                                                |
| `invoice.payment_succeeded`            | `invoicePaymentSucceeded.ts` | Updates `next_billing_date`; flips `trialing` → `active` after trial end                                                                                                                      |
| `invoice.payment_failed`               | `invoicePaymentFailed.ts`    | Flips local row to `past_due`                                                                                                                                                                 |
| `customer.subscription.trial_will_end` | `trialWillEnd.ts`            | (currently logs — future: push notification)                                                                                                                                                  |

Idempotency dedup via `stripe_webhook_events` table (atomic INSERT before dispatch; release-on-failure for retries).

### Change-of-tier dispatch model

The backend NEVER cancels the old Stripe sub inline. The change-of-tier path:

1. Creates the new Stripe sub via `stripe.subscriptions.create()` with `payment_method_id` (if provided) or reuses customer's default.
2. Stamps `metadata.old_stripe_subscription_id` on BOTH the new Stripe sub AND the local `user_subscriptions` row.
3. Returns to the mobile with the new sub id + discriminator fields.
4. **Webhook drives cleanup**: when the new sub transitions to `active`/`trialing`, the webhook handler cancels the old Stripe sub. When the new sub transitions to `incomplete_expired` (~23h timeout), the webhook handler rolls the local row back to the original sub id.

This was legacy's "billed twice" failure mode pre-V2. The webhook-driven pattern is locked in. Synchronous endpoints never call `stripe.subscriptions.cancel()` on the old sub.

### `isAlreadyCanceledError` recovery

Both the webhook handler ([`eventHandlers/subscriptionUpdated.ts:79`](../../microservices/core/src/application/stripe/eventHandlers/subscriptionUpdated.ts)) and the cancel handler ([`subscriptionsCancelHandler.ts:isAlreadyCanceledError`](../../microservices/core/src/application/subscriptions/cancel/subscriptionsCancelHandler.ts)) treat `code: "resource_missing"` + `/already cancell?ed/` message-match as success. Retries after partial failures converge to 200 instead of cycling through 502s.

### In-flight marker guard

Any follow-up flow on a row carrying `metadata.old_stripe_subscription_id` is refused with 409 until the webhook chain resolves. Lives at the top of `POST /subscriptions` dispatch and inside `POST /subscriptions/:id/cancel`. Bounded by Stripe's ~23h `incomplete_expired` auto-transition.

## Database

### Tables (existing, no schema changes in M10)

- `subscription_tiers` — see [`packages/db/src/schema.ts:241`](../../packages/db/src/schema.ts). Catalog table — single source of truth for tier metadata + Stripe price IDs.
- `user_subscriptions` — see [`packages/db/src/schema.ts:273`](../../packages/db/src/schema.ts). User's subscription rows; unique index ensures one `active`/`pending` row per user.
- `subscription_limits` — maintained by the `update_subscription_limits_trigger`; handlers MUST NOT write.
- `profiles` — `has_used_user_trial` / `has_used_trainer_trial` written explicitly by the create handler on trial-using paths; `subscription_id` / `role` maintained by the trigger.
- `stripe_webhook_events` — idempotency log; INSERT-with-ON-CONFLICT-DO-NOTHING dedup.

### Trigger contract reminder

`update_subscription_limits_trigger` on `user_subscriptions` maintains:

- `profiles.subscription_id`
- `profiles.role` (auto-set to `personal_trainer` for `is_trainer_tier` subs)
- `subscription_limits.{limit_type, limit_value, current_count, reset_date}`

Handler code MUST NOT write to those columns. The `profiles.has_used_*_trial` flags are the ONLY exception — written explicitly on trial-using create paths.

## Reconciliation

`scripts/reconcile-stripe.ts` (shipped in PR #70) provides drift detection between Stripe state and local `user_subscriptions`. M10 does NOT change the script. Future improvement: schedule it as a daily cron with Slack alerting on `failed > 0`. Out of M10 scope.

## Test strategy

### Backend (Vitest, 90% branch coverage non-negotiable on changed files)

- `subscriptionTiersHandler.test.ts` — list returns active rows in price order; empty catalog returns `{ data: [] }` + 200
- `subscriptionsMeHandler.test.ts` — returns joined sub+tier+profile shape; synthesises free shape when no row; surfaces trial eligibility flags; respects auth
- `subscriptionsCreateHandler.test.ts` — extended for: optional `payment_method_id`; new dispatch precedence; new discriminator fields in response. Existing PR #70 tests must continue to pass.
- `subscriptionRepository.test.ts` — extended for `listActiveTiers()`, `findForUser(userId)` returning joined shape

### Frontend (Vitest, 90% global coverage non-negotiable)

- `subscriptionService.test.ts` — pure functions: `canCancelSubscription`, `getSubscriptionDisplayInfo`, `isCancelledButActive` ported from legacy `lib/utils/subscriptionUtils.ts`
- `SubscriptionSelectionPresenter.test.tsx` — renders all 8 tiers across role toggle; trial banner conditional on eligibility; scheduled-change indicator; cancel modal; Android error state
- `SubscriptionManagementPresenter.test.tsx` — current plan card; upgrade/downgrade/cancel button visibility per current tier; trainer client slots
- `SubscriptionSelectionContainer.test.tsx` — full container integration with InMemoryApiAdapter + MockPaymentsAdapter: buy flow, change flow, reinstate flow, 3DS flow, cancel flow, Apple Pay user-cancel
- `SubscriptionManagementContainer.test.tsx` — upgrade flow (no payment_method_id), downgrade flow (scheduled), cancel flow
- `StripeApplePayAdapter.test.ts` — adapter unit tests mocking the Stripe SDK
- `PaymentMethodForm.test.tsx` — Apple Pay trigger, trial cart-item construction, cancel handling

### Smoke test

See `specs/milestones/M10-subscriptions/SMOKE_TEST.md` for the full e2e walkthrough.

---

## Entitlement enforcement (M10.5)

After M10 shipped, three architectural gaps remained: server-side enforcement of premium-only mutations, mobile feature-gate primitives + per-screen integration, and offline UX on the subscription screens. M10.5 ("Entitlement hardening + feature gates + offline UX") addresses all three. The design below documents the contract; per-slice execution detail lives in `specs/milestones/M10-5-entitlement-hardening/`.

### Server-side `assertEntitlement` helper

Lives at `microservices/core/src/application/entitlement/assertEntitlement.ts`. Reusable across handlers that mutate premium-gated state. Reads live DB — **never trusts JWT claims alone**, defending the "valid token but cancelled sub" abuse vector.

```typescript
// microservices/core/src/application/entitlement/assertEntitlement.ts

export type EntitlementFeature =
  | "create_workout" // ENFORCED in M10.5: POST /workouts, POST /sessions/record
  | "ai_workout" // STUB: future AI endpoint
  | "gym_buddy" // STUB
  | "unlimited_exercise_library" // STUB
  | "trainer_clients"; // STUB: future M8 endpoints

export type EntitlementVerdict =
  | { allowed: true }
  | {
      allowed: false;
      reason: "tier" | "limit" | "cancelled" | "expired";
      currentTier: SubscriptionTierName;
      upgradeTo: SubscriptionTierName | null;
      upgradePriceMonthly: number | null;
    };

export async function assertEntitlement(
  userId: string,
  feature: EntitlementFeature,
): Promise<EntitlementVerdict>;

export class EntitlementError extends Error {
  constructor(
    public readonly verdict: Extract<EntitlementVerdict, { allowed: false }>,
  ) {
    super("ENTITLEMENT_DENIED");
  }
}
```

Handlers call `assertEntitlement(userId, feature)`; if the verdict denies, throw `EntitlementError(verdict)`. A shared Elysia error handler maps `EntitlementError` to HTTP 402 with the structured body:

```json
{
  "code": "ENTITLEMENT_DENIED",
  "error": "Subscription does not include this feature",
  "feature": "create_workout",
  "current_tier": "basic",
  "upgrade_to": "premium",
  "upgrade_price_monthly": 14.99
}
```

**Feature → tier-rule mapping (M10.5 scope):**

| Feature                      | Rule                                                                                                                                     | Defining column                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `create_workout`             | `subscription_limits.workouts_per_month.current_count < subscription_limits.workouts_per_month.limit_value` (null limit = unlimited)     | `subscription_limits` table + trigger-maintained |
| `ai_workout`                 | `subscription_tiers.aiAccess === true` AND `subscription_limits.ai_workouts_per_month.current_count < ai_workouts_per_month.limit_value` | stubbed today                                    |
| `gym_buddy`                  | `subscription_tiers.gymBuddyAccess === true`                                                                                             | stubbed today                                    |
| `unlimited_exercise_library` | tier-level boolean (TBD on schema — out of M10.5)                                                                                        | stubbed today                                    |
| `trainer_clients`            | `subscription_tiers.isTrainerTier === true` AND under `trainerClientLimit`                                                               | stubbed today                                    |

### Mobile feature-gate model

Three components + one hook, all framework-aware but stateless:

```typescript
// packages/mobile/src/ui/hooks/useFeatureGate.ts
export type FeatureGateReason = "tier" | "limit" | "cancelled" | "unknown";

export interface FeatureGateResult {
  allowed: boolean;
  reason: FeatureGateReason;
  gateProps: FeatureGatePromptProps;
}

export function useFeatureGate(feature: EntitlementFeature): FeatureGateResult;

// packages/mobile/src/ui/components/subscription/FeatureGatePrompt.tsx
export interface FeatureGatePromptProps {
  feature: EntitlementFeature;
  featureDisplayName: string;
  currentTier: SubscriptionTierName;
  upgradeTo: SubscriptionTierName | null;
  upgradePriceMonthly: number | null;
  onUpgrade: () => void; // routes to /(auth)/subscription-selection with target pre-selected
}

export function FeatureGatePrompt(props: FeatureGatePromptProps): JSX.Element;

// packages/mobile/src/ui/components/subscription/SubscriptionBadge.tsx
export interface SubscriptionBadgeProps {
  tier: SubscriptionTierName;
  paymentStatus: SubscriptionStatus;
  compact?: boolean;
}

export function SubscriptionBadge(props: SubscriptionBadgeProps): JSX.Element;
```

The hook is **a pure function of the cached `MySubscription`** — no network in the hot path. It computes the verdict client-side and returns props ready for the gate prompt to render. The server's 402 path is the authoritative defense — the client-side gate is UX-only.

**402 response interception (`SSTApiAdapter`):**

```typescript
// On a 402 from any endpoint, parse the structured body and produce
// an ApiError carrying the same verdict shape. Containers can either:
//   (a) catch the error, call useFeatureGate(feature), render the gate
//   (b) re-throw and let an upstream boundary render the gate
// — adapter never silently swallows the error.
```

### Offline UX on subscription screens

`useOnlineStatus()` hook returns `boolean` based on RN's `NetInfo`. Two consumers in M10.5:

1. **Subscription Selection / Management screens**: when offline, render an "You're offline" banner above the tier cards. The cached `MySubscription` + tier catalog still render. CTAs are visually disabled-style but tappable — tap surfaces an alert "You need to be online to manage your subscription".
2. **Mutation pre-flight**: before invoking `payments.collectApplePayPaymentMethod` or `payments.confirm3DS` or `api.createSubscription` or `api.cancelSubscription`, check `useOnlineStatus`. If offline, refuse with the same alert.

`useSubscriptionTiers` and `useMySubscription` add an 8-second "still working…" indicator via a sibling state that flips after the timeout; the underlying Tanstack query continues. Mobile UX gets clear "we know it's slow" feedback without spamming retries.

**No client-side grace window / `validUntil`.** `expiresAt` is trusted as-is on the client — server enforces at every premium-only mutation. This was Brad's explicit call: trade marginal client-side abuse-defense for simplicity, knowing AI features inherently require network anyway.

### Sync-queue entitlement handling (M10.6)

After M10.5 closes the synchronous-mutation abuse paths, one edge case remains: a user who creates premium-only data while offline (e.g., workouts past their tier limit) and tries to flush via the sync queue. Server-side `assertEntitlement` correctly rejects each entry with 402 — but the mobile sync engine treats it as a generic error and either drops or endlessly retries.

M10.6 makes the sync engine entitlement-aware. The changes are entirely mobile-side; backend stays as M10.5 left it.

**Storage model extension:**

```typescript
// packages/mobile/src/domain/ports/sync.types.ts (extended in M10.6)
export type SyncEntryStatus =
  | "pending"
  | "syncing"
  | "synced"
  | "failed"
  | "blocked_entitlement"; // NEW

export interface SyncEntry {
  id: string;
  // ... existing fields ...
  status: SyncEntryStatus;
  entitlementVerdict?: {
    feature: EntitlementFeature;
    currentTier: SubscriptionTierName;
    upgradeTo: SubscriptionTierName | null;
    upgradePriceMonthly: number | null;
    blockedAt: string; // ISO timestamp
  };
}
```

**Sync engine flow:**

```
[processSyncQueue iterates pending entries]
         │
         ▼
[POST mutation]
         │
         ├─ 200/201 ─► [mark synced]
         ├─ 5xx     ─► [mark failed; retry on next flush]
         ├─ 402 +
         │  ENTITLEMENT_DENIED
         │           ─► [parse verdict; mark blocked_entitlement;
         │              store verdict; CONTINUE to next entry]
         └─ other   ─► [mark failed]
```

The flush worker filters `status === "pending"` only; blocked entries are excluded from automatic retries. They re-enter the pool via two paths:

1. **Explicit user action** on the `/sync-blocked` review screen ("Upgrade and retry" → after upgrade success → manual unblock-all-with-matching-upgradeTo) or ("Retry" → manual unblock for one)
2. **Automatic on tier change**: `useAutoRetryOnUpgrade` observes `useMySubscription`; when the tier changes to one satisfying `upgradeTo` for any blocked entry's verdict, those entries are unblocked + a flush is triggered.

**Tier hierarchy** (extending `subscriptionService.ts`):

```typescript
// Returns true if currentTier provides at least the entitlements of requiredTier.
// User-tier track: free < basic < premium
// Trainer-tier track: free-trainer-equivalent < standard < pro
// Tracks are independent — premium does NOT satisfy a trainer_clients requirement.
export function tierSatisfies(
  currentTier: SubscriptionTierName,
  requiredTier: SubscriptionTierName,
): boolean;
```

**UI:**

- `SyncBlockedBanner` mounted at the top of Home tab; visible when `useBlockedSyncEntries().total > 0`. Single-line summary with a Review CTA.
- `/sync-blocked` screen lists entries grouped by upgrade target; per-group CTA: "Upgrade to <tier> and retry" → routes to Selection with target pre-applied.
- Discard path: confirmation modal → deletes sync entry AND local cached data (when no other entry references it).

**Telemetry hook** (informational, not enforcement): log when `blocked_entitlement` count crosses thresholds — useful product signal for "where users actually hit limits."

### Per-screen feature-gate integration (Wave 2)

After Wave 1 ships the primitives, Wave 2 wires `useFeatureGate` + `FeatureGatePrompt` into specific screens:

- `app/(app)/(tabs)/exercises.tsx` — premium exercises locked behind gate
- `app/(app)/exercises/create.tsx` — AI-generated workout-creator step locked
- `app/(app)/workouts/create.tsx` — `create_workout` limit warning at limit-3, gate at limit
- `app/(app)/(tabs)/progress.tsx` — advanced analytics locked for free
- `app/(app)/(tabs)/index.tsx` (Home) — Health tiles section locked for free
- `app/(app)/(tabs)/profile.tsx` — `SubscriptionBadge` rendered next to display name + tier name inline on the Subscription row
- Trainer routes — stub gate when accessed by non-trainer or free trainer tier

Each Wave 2 agent owns a different screen tree to keep parallelism.

#### Wave 2 Progress / Health / Profile subset (m105-gates-progress agent)

This agent wires the gate primitives into the Progress, Home (health tiles) and Profile screens. The implementation has three load-bearing rules:

1. **No new entitlement features in Wave 2.** The brief calls out two candidate gaps —
   `advanced_analytics` (Progress tab PRs / volume / trends) and `health_integration`
   (HealthKit-backed Home tiles). Both are mapped to the closest existing stub feature
   `gym_buddy` for Wave 2:
   - `gym_buddy` evaluates `tier.gymBuddyAccess === true`, which is set on `premium`
     and the trainer-pro tiers per the live `subscription_tiers` seed. That mapping
     matches the legacy paywall split for both surfaces (PRs / volume trends + HealthKit
     are Premium-and-above).
   - When a dedicated `advanced_analytics` / `health_integration` feature is introduced
     server-side (M11 or later), the mobile call sites swap the feature name in one place
     each — the primitive and the gate prompt are unchanged.
2. **Gate location is the presenter, not the section component.** The Wave 1 primitives
   stay un-touched. The container computes `useFeatureGate("gym_buddy")` once and threads
   the `{ allowed, gateProps }` slice into the presenter (`HomePresenter` /
   `ProgressPresenter`), which renders either the existing section or the
   `FeatureGatePrompt`. The section components themselves (`MyProgressSection`,
   `BodyWeightTile` etc.) are not gate-aware — they keep zero feature-gate coupling.
3. **`SubscriptionBadge` reads `useMySubscription` directly on Profile.** The Profile tab
   already caches a `subscription` slice via `useProfilePage`, but that slice's
   `tierName` is a loose `string | null` (legacy DB shape). The badge requires the typed
   `SubscriptionTierName` enum. Rather than widen the badge, the Profile container
   calls `useMySubscription()` for the badge alone — it shares the same React Query
   key with the rest of the app, so it's a cache hit on the second mount and adds at
   most one round-trip on cold-start.

**`FeatureGatePrompt` `compact` variant.** Wave 1 shipped the prompt without a `compact`
variant. The Wave 2 agent brief called this out as a likely gap. The default vertical-
card layout fits within the section bounds on the Progress and Home surfaces without
overflow, so Wave 2 ships without a `compact` prop. If a layout collision surfaces in
QA, the fix is to extend the primitive in a tiny follow-up — NOT to introduce a per-
screen override (per Wave 2 cross-cutting rule 2).

**Profile `SubscriptionBadge` placement.** The badge renders next to the display-name
text in the Profile header (under the avatar). For `useMySubscription` still loading,
the badge is omitted entirely — the user's tier rendering elsewhere on the screen
(Subscription card) carries the load until the badge data lands. No placeholder skeleton
chip — the header is already loader-gated by `isInitialLoading`.

**Profile Subscription row tier inline.** Cosmetic addition (not gated): the Subscription
section's card title for non-free users already shows the tier display name; this is
extended to free users so the row reads "Free Tier" — already the case in the current
shape. No structural change needed beyond confirming the existing copy is in place.
