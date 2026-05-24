# M10 — Frontend Agent Brief

You are implementing the frontend track of Milestone 10 — Subscriptions & Payments (Stripe). Read the parent [`BRIEF.md`](./BRIEF.md) first.

You are working on the React Native / Expo mobile app at `/Users/bradleysimms-evans/Documents/projects/personal/persistence-backend-sst/packages/mobile/`. You are NOT touching the backend — that is the backend agent's responsibility. You may read backend code (especially `microservices/core/src/application/subscriptions/`) for wire-shape context but must not modify it.

## Authority

- Parent spec: [`../../11-payments-subscriptions/`](../../11-payments-subscriptions/) — requirements + design + tasks. **Rewritten 2026-05-23** to reflect what PR #69 + #70 actually shipped + what M10 will build. Read it first.
- Mobile architectural rules: [`../../_agent.md`](../../_agent.md) — hexagonal architecture, container/presenter split, ports & adapters, 90% coverage non-negotiable.
- Legacy reference app: `/Users/bradleysimms-evans/Documents/projects/personal/persistence-mobile/` — **behavioural source of truth**. Port flows + UI patterns 1:1. **Never copy architecture** (legacy is hook-heavy + direct Supabase; V2 is ports/adapters + SST API).

## Spec alignment — READ FIRST

The parent spec has already been updated (2026-05-23) to describe the contract you're implementing. You do NOT need to write a separate spec-update phase. Every implementation commit must cite the spec section it implements in the commit footer:

```
Implements: specs/11-payments-subscriptions/design.md § UI structure > Screens
Closes: specs/11-payments-subscriptions/tasks.md § Phase 7 — Mobile UI: containers + presenters
Satisfies: specs/11-payments-subscriptions/requirements.md AC 2.1, 2.6, 2.9
```

If you find the spec disagrees with this brief or with your implementation reality, **stop and update the spec first** as its own commit.

## Port-1:1 discipline

The legacy app's subscription flow is proven, A/B-tested, and ratified by real users. Your job is to port flows, business logic, copy, and visual layout **exactly**. The /frontend-design polish pass is M11 — NOT M10.

Specifically:

- Match legacy copy verbatim (CTAs, alerts, modal text, error strings)
- Match legacy navigation (post-auth lands on selection; profile entry to management)
- Match legacy interaction model (tap card → immediate Apple Pay sheet; cancel button → confirmation modal; reinstate via tap-current-tier)
- Match legacy tier card layout (role toggle, billing cycle toggle, current-plan badge, trial banner, scheduled-change indicator)
- Match legacy Android no-buy state ("Apple Pay is only available on iOS devices.")

If you spot something genuinely questionable in legacy (e.g., the Alert-driven confirmation pattern feels archaic) — note it in the PR description as a follow-up candidate for M11, but **do not refactor it during M10**.

## Scope

Seven slices. Recommended commit order: domain → ports/adapters → API integration → components → containers → screens → tests. Land all on the same branch.

### 1. Domain models rewrite

Spec: [`design.md` § Domain models](../../11-payments-subscriptions/design.md), satisfies AC 1.1, 1.2, 1.3.

**Rewrite** `packages/mobile/src/domain/models/subscription.ts` to the new shape:

- `SubscriptionTierName` — string union of the 8 named tiers + `'free'`
- `SubscriptionRole` — `'user' | 'personal_trainer' | 'physiotherapist' | 'admin'`
- `SubscriptionStatus` — full Stripe-aligned union (`'active' | 'trialing' | 'past_due' | 'cancelled' | 'incomplete' | 'incomplete_expired' | 'unpaid'`)
- `BillingCycle` — `'monthly' | 'yearly'`
- `ChangeType` — `'new' | 'upgrade' | 'downgrade' | 'reinstate' | 'cycle_change'`
- `SubscriptionTier` interface — mirrors `subscription_tiers` row + `tierFeatures` JSONB
- `MySubscription` interface — joined sub + tier + role + trial flags + `scheduledChange` (see design.md)
- `CreateSubscriptionResult` interface — extended response shape with all M10 discriminators
- `CancelSubscriptionResult` interface — unchanged from PR #70

**Port domain services** from legacy `persistence-mobile/lib/utils/subscriptionUtils.ts`:

- `canCancelSubscription(sub: MySubscription): boolean`
- `getSubscriptionDisplayInfo(sub, tierDisplayNames): { currentTierDisplayName, hasScheduledChange, nextTierDisplayName, effectiveAt, currentTierActiveUntil }`
- `isCancelledButActive(sub: MySubscription): boolean`

These belong at `packages/mobile/src/domain/services/subscriptionService.ts` as pure functions. Domain layer has ZERO framework imports — no React, no Expo, no React Native.

**Tests**: pure unit tests for each service function, edge cases per legacy behaviour.

### 2. PaymentsPort rewrite + adapters

Spec: [`design.md` § PaymentsPort](../../11-payments-subscriptions/design.md), satisfies AC 2.1, 2.2, 2.7, 2.8, 7.3, 8.1.

**Rewrite** `packages/mobile/src/domain/ports/payments.port.ts` to the new shape (see design.md for full interface):

- `isApplePaySupported(): Promise<boolean>`
- `collectApplePayPaymentMethod(input: CollectApplePayPaymentMethodInput): Promise<Result<{ paymentMethodId: string }, PaymentError>>`
- `confirm3DS(clientSecret: string): Promise<Result<void, PaymentError>>`
- `PaymentError` shape: `{ kind: 'cancelled' | 'platform_unavailable' | 'no_payment_methods' | 'stripe_error' | 'unknown', code: string | null, message: string }`

**Implement** `StripeApplePayAdapter` at `packages/mobile/src/adapters/payments/stripe.adapter.ts`:

- Uses `@stripe/stripe-react-native`'s `usePlatformPay()` hook for `isPlatformPaySupported` + `createPlatformPayPaymentMethod`
- For 3DS: uses Stripe SDK's `handleNextAction(clientSecret)`
- Maps Stripe SDK error codes to `PaymentError.kind`:
  - `'Canceled'` / `'canceled'` → `'cancelled'`
  - Apple Pay unsupported / not configured → `'platform_unavailable'`
  - Empty Apple Wallet → `'no_payment_methods'`
  - Other Stripe errors → `'stripe_error'`
  - Unknown → `'unknown'`

**Implement** `MockPaymentsAdapter` at `packages/mobile/src/adapters/payments/__tests__/mock.adapter.ts`:

- Configurable per-test: pass `{ supported: true, response: { paymentMethodId: 'pm_test_…' } }` or `{ response: { kind: 'cancelled' } }` etc.
- For 3DS: configurable success/failure.

**`@stripe/stripe-react-native` dependency**: confirm in `packages/mobile/package.json`. If not present, add. Check the version matches the legacy app's version for behavioural parity.

**`<StripeProvider>` configuration**: wrap the app root with `<StripeProvider publishableKey={EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY} merchantIdentifier="merchant.com.evanssoftwaresolutions.persistence">`. `merchantIdentifier` value matches legacy `app.json`.

**Adapter tests**: 90% line/branch coverage. Mock the Stripe SDK at the module boundary.

### 3. ApiPort extensions + adapter implementations

Spec: [`design.md` § ApiPort additions](../../11-payments-subscriptions/design.md), satisfies AC 1.1, 5.1.

**Extend** `packages/mobile/src/domain/ports/api.port.ts`:

```typescript
interface ApiPort {
  // ... existing ...

  getSubscriptionTiers(): Promise<Result<SubscriptionTier[], ApiError>>;
  getMySubscription(): Promise<Result<MySubscription, ApiError>>;

  // Extend createSubscription input + response types
  createSubscription(
    input: CreateSubscriptionInput,
  ): Promise<Result<CreateSubscriptionResult, ApiError>>;
}

// CreateSubscriptionInput: payment_method_id becomes optional
export type CreateSubscriptionInput = {
  tier_name: SubscriptionTierName;
  billing_cycle: BillingCycle;
  payment_method_id?: string; // optional
  use_trial: boolean;
  platform?: "ios" | "android";
};

// CreateSubscriptionResult: add change_type + scheduled + effective_at + is_trial
export type CreateSubscriptionResult = {
  success: true;
  requires_action: boolean;
  subscription_id: string;
  stripe_subscription_id: string;
  trial_ends_at: string | null;
  next_billing_date: string | null;
  payment_status: SubscriptionStatus;
  client_secret?: string;
  reinstated?: boolean;
  // M10 additions:
  change_type: ChangeType;
  scheduled: boolean;
  effective_at: string | null;
  is_trial: boolean;
};
```

**Implement** in `packages/mobile/src/adapters/api/sst-api.adapter.ts`:

- `getSubscriptionTiers`: `GET /subscription-tiers`, unwrap `{ data }`, transform decimal-string fields to numbers
- `getMySubscription`: `GET /subscriptions/me`, unwrap `{ data }`, no transformation needed (camelCase wire match)
- `createSubscription`: update body to optionally omit `payment_method_id`; type the response with the new discriminators

**Implement** in `packages/mobile/src/adapters/api/__tests__/in-memory-api.adapter.ts`:

- Maintain an internal `tiers: SubscriptionTier[]` + `subscriptionsByUser: Map<string, MySubscription>` state
- `getSubscriptionTiers` returns the in-memory list
- `getMySubscription` returns the row for the current user or a synthetic free shape
- `createSubscription` mutates the in-memory state per dispatch branch and returns the matching discriminator fields
- Used by container tests — must match the SST adapter's wire contract exactly

**Adapter tests**: 90% coverage. Network errors mapped to `ApiError`; empty catalog returns empty list; auth-required endpoints reject on no token.

### 4. Hooks (Tanstack Query wrappers)

Spec: [`design.md` § Subscription state (mobile)](../../11-payments-subscriptions/design.md), satisfies AC 5.1, 5.2, 5.6.

Create:

- `packages/mobile/src/ui/hooks/useSubscriptionTiers.ts` — wraps `api.getSubscriptionTiers`. Stale-time 10 minutes. Key `['subscription-tiers']`.
- `packages/mobile/src/ui/hooks/useMySubscription.ts` — wraps `api.getMySubscription`. Stale-time 2 minutes. Key `['user-subscription', userId]`. Requires `userId`.
- `packages/mobile/src/ui/hooks/useCreateSubscription.ts` — wraps `api.createSubscription`. `onSuccess` invalidates `['user-subscription']` + `['user-profile']` + `['profile-data']` (prefix match).
- `packages/mobile/src/ui/hooks/useCancelSubscription.ts` — wraps `api.cancelSubscription`. Same invalidation pattern.

Tests: hook tests using `@testing-library/react-native` + `QueryClientProvider`. Cover loading / success / error states + invalidation behaviour.

### 5. UI components

Spec: [`design.md` § UI structure](../../11-payments-subscriptions/design.md), satisfies AC 1.x, 2.x, 3.x, 6.x, 7.x.

Port each of these 1:1 from legacy. Layouts MUST match legacy visually (spacing, colours, copy, button placement). Use the V2 theme tokens at `packages/mobile/src/ui/theme/tokens.ts` (port colours/spacing from legacy `constants/colors.ts` + `constants/theme.ts` if missing).

| V2 path                                                        | Legacy reference                                      | Behaviour                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/components/subscription/SubscriptionCard.tsx`              | `components/subscription/SubscriptionCard.tsx`        | Single-column user tier card. Pure presenter. Props: `tier`, `billingCycle`, `isCurrent`, `showTrialBanner`, `trialBannerText`, `onPress`, `disabled`, `getFeaturesList(tier, isTrainer)`, `isTrainer`                                                                                                                                             |
| `ui/components/subscription/TrainerSubscriptionCard.tsx`       | `components/subscription/TrainerSubscriptionCard.tsx` | Dual-column Standard/Pro card. Pure presenter. Props: `standardTier`, `proTier`, `billingCycle`, `isStandardCurrent`, `isProCurrent`, `showProTrialBanner`, `trialBannerText`, `onStandardPress`, `onProPress`, `disabled`                                                                                                                         |
| `ui/components/subscription/PaymentMethodForm.tsx`             | `components/payment/PaymentMethodForm.tsx`            | Apple Pay trigger. Uses `PaymentsPort` (not direct Stripe SDK). Props: `amount`, `currency`, `billingCycle`, `trialDuration`, `isTrialEligible`, `recurringAmount`, `isProcessing`, `shouldTrigger`, `onPaymentMethodReady`, `onError`. Renders nothing on success path (component-as-trigger). Renders error state inline on Android / no-wallet. |
| `ui/components/subscription/CancelSubscriptionModal.tsx`       | (inline in legacy selection screen, lines 567–636)    | Confirmation modal. Props: `subscriptionEndsAt`, `onConfirm`, `onDismiss`, `isProcessing`                                                                                                                                                                                                                                                          |
| `ui/components/subscription/CurrentSubscriptionStatusCard.tsx` | (inline in legacy selection screen, lines 373–414)    | "Current: <tier>" or "Cancelled: <tier> ends <date>" status header. Includes scheduled-change indicator.                                                                                                                                                                                                                                           |

**Component tests**: pure component tests using `@testing-library/react-native`. No mocking of hooks (presenters are hookless). Snapshot tests for visual regression on key states (current, trial-eligible, cancelled-but-active, scheduled-change).

### 6. Containers + presenters + screens

Spec: [`design.md` § UI structure > Container responsibilities](../../11-payments-subscriptions/design.md), satisfies AC 1.x, 2.x, 3.x, 6.x, 7.x, 8.x.

#### Subscription Selection (`ui/containers/SubscriptionSelectionContainer.tsx` + `ui/presenters/SubscriptionSelectionPresenter.tsx`)

**Legacy reference**: `app/(auth)/subscription-selection.tsx` (1853 lines — container + presenter live in the same file; you split them).

**Container responsibilities** (see design.md § Container responsibilities for the full state machine):

- Fetch tiers (`useSubscriptionTiers`) + current sub (`useMySubscription`)
- Manage role toggle (`'user' | 'trainer'`) — auto-default from `profile.role`
- Manage billing cycle (`'monthly' | 'yearly'`) — auto-default from current sub if exists
- Manage `selectedTierForPayment: string | null` — drives PaymentMethodForm mount
- Manage `isProcessingSubscription: boolean` — overlay state
- Manage `showCancelConfirm: boolean` — modal visibility
- Handle `onTierSelect(tier)`:
  - If current tier + no changes + not cancelled-but-active → no-op
  - If `free` → no-op
  - Otherwise set `selectedTierForPayment = tier` → Apple Pay sheet auto-triggers
- Handle `onPaymentMethodReady(paymentMethodId)`:
  - Compute trial eligibility (premium → user-trial, \_pro tiers → trainer-trial, others → none; reinstating cancelled-still-in-trial preserves remaining days)
  - Call `createSubscription({ tier_name, billing_cycle, payment_method_id, use_trial })`
  - On `requires_action: true` → call `payments.confirm3DS(clientSecret)`; on success continue; on failure → alert + reset
  - On success → invalidate queries + `router.push('/(auth)/success')`
- Handle `onPaymentMethodError(error)`:
  - If `'USER_CANCELLED'` → silently clear `selectedTierForPayment`
  - Otherwise → alert + clear
- Handle `onCancelSubscription` → show modal → on confirm → `cancelSubscription({ cancel_immediately: false })` → invalidate + alert with end date
- Handle role/billing toggle changes — reset `selectedTierForPayment` on role change

**Presenter**: pure. Receives all data via props. Renders:

- Header (back button, "Choose your plan" title)
- Processing overlay (when `isProcessingSubscription`)
- Role toggle (User / Trainer)
- Current sub status card (when current tier is paid)
- Billing cycle toggle (Monthly / Yearly with "Save 20%" label)
- Tier card list (filtered by role): user → 2 cards stacked; trainer → 3 dual-tier cards stacked
- Cancel subscription button at bottom (when canCancel + !isCancelledButActive)
- `PaymentMethodForm` (mounted when `selectedTierForPayment` is set; auto-triggers Apple Pay)
- CancelSubscriptionModal (when `showCancelConfirm`)

#### Subscription Management (`ui/containers/SubscriptionManagementContainer.tsx` + `ui/presenters/SubscriptionManagementPresenter.tsx`)

**Legacy reference**: `app/subscription-management.tsx` (560 lines).

**Container responsibilities**:

- Fetch current sub (`useMySubscription`)
- Derive `canUpgrade` (basic → premium), `canDowngrade` (premium → basic), `canCancel` (paid + active/trialing + not already cancelled). **Note: this screen handles user tiers ONLY**; trainer changes route via Selection.
- `handleUpgrade(tier)` → confirmation Alert → `createSubscription({ tier_name, billing_cycle })` with NO payment_method_id → success alert
- `handleDowngrade(tier)` → confirmation Alert → `createSubscription({ tier_name, billing_cycle })` with NO payment_method_id → success alert with `effective_at` formatted date
- `handleCancel` → confirmation Alert (trial-aware wording) → `cancelSubscription({})` → success alert with end date

**Presenter**: pure. Renders:

- Header (back button, "Subscription Management")
- Current Plan card with badges (Active / Trial / Cancelled)
- Plan metadata rows (next billing date / access ends / trial ends / billing cycle / client slots for trainer)
- Upgrade action card (when `canUpgrade`)
- Downgrade action card (when `canDowngrade`)
- Cancel action card (when `canCancel`)
- Cancelled notice card (when already cancelled)

#### Success screen (`ui/containers/SubscriptionSuccessContainer.tsx` + `ui/presenters/SubscriptionSuccessPresenter.tsx`)

**Legacy reference**: `app/(auth)/success.tsx` (203 lines).

**Container responsibilities**:

- Fetch current sub (`useMySubscription`)
- Derive benefits list from `subscriptionData.tier_name` (legacy `getSubscriptionBenefits`)
- Derive success message from tier (legacy `getSuccessMessage`)
- Handle "Go to Home" → `router.replace('/(tabs)/home')`
- Handle "Manage Clients" (trainer tiers only) → `router.replace('/(tabs)/clients')` — even though Clients tab is M8, the route stub should exist

**Presenter**: pure. Renders:

- Title "Subscription Activated!"
- Tier-specific success message
- "What you now have access to:" benefits list
- "Manage Clients" button (trainer tiers only)
- "Go to Home" button

#### Expo Router screen wrappers (thin)

Create three thin route files that just render the container:

- `packages/mobile/app/(auth)/subscription-selection.tsx` → `<SubscriptionSelectionContainer />`
- `packages/mobile/app/subscription-management.tsx` → `<SubscriptionManagementContainer />`
- `packages/mobile/app/(auth)/success.tsx` → `<SubscriptionSuccessContainer />`

**Container + presenter tests**: 90% coverage. Container integration tests use `InMemoryApiAdapter` + `MockPaymentsAdapter` to exercise the full state machine: buy flow → change flow → reinstate flow → 3DS flow → cancel flow → Apple Pay user-cancel.

### 7. Navigation wiring

Spec: satisfies AC 1.9, 3.1.

**Auth flow**: post-sign-up, the auth flow routes through `/(auth)/subscription-selection`. Existing auth flow likely already routes to a placeholder or skips to home — update it to route through Selection. Confirm the existing auth flow's exit point in `packages/mobile/app/(auth)/_layout.tsx` and the sign-up success handler.

**Profile entry**: add a "Subscription" row in the Profile screen that pushes to `/subscription-management`. The Profile container lives at `packages/mobile/src/ui/containers/ProfileContainer.tsx` (post-M6).

**Success exit**: `/(auth)/success` is a leaf — Go to Home replaces to `/(tabs)/home`. Trainer-tier success additionally surfaces "Manage Clients" → `/(tabs)/clients` (route stub OK; tab is M8).

### Android no-buy state

Spec: satisfies AC 2.9.

Match legacy exactly. `PaymentMethodForm` checks `Platform.OS === 'ios'` + `payments.isApplePaySupported()`. On `false`, renders an inline error state with copy: `"Apple Pay is only available on iOS devices. Please use an iPhone or iPad to complete your subscription."`. The selection screen itself still renders cards (read-only) — only the buy CTA is gated.

This is intentional and reflects Brad's App Store IAP-policy decision. Do not add a Card / Google Pay / Web fallback.

## Quality gates

```bash
bun run prettier:check    # format
bun run typecheck          # TypeScript strict
bun run lint               # ESLint (zero errors; warnings tolerated if pre-existing)
bun run build              # all packages
bun --filter @persistence/mobile test:unit   # 90% global aggregate non-negotiable
```

Total mobile test count after M10: target +60–90 tests from current 1413 baseline.

## Files you will touch

```
packages/mobile/package.json                                              # if adding @stripe/stripe-react-native
packages/mobile/app/(auth)/subscription-selection.tsx                     # new screen wrapper
packages/mobile/app/(auth)/success.tsx                                    # new screen wrapper
packages/mobile/app/subscription-management.tsx                           # new screen wrapper
packages/mobile/app/_layout.tsx                                           # wrap StripeProvider at root
packages/mobile/src/domain/
  models/subscription.ts                                                  # rewrite
  ports/payments.port.ts                                                  # rewrite
  ports/api.port.ts                                                       # extend with two reads + extended create types
  services/subscriptionService.ts                                         # new
  services/__tests__/subscriptionService.test.ts                          # new
packages/mobile/src/adapters/
  payments/stripe.adapter.ts                                              # new
  payments/__tests__/stripe.adapter.test.ts                               # new
  payments/__tests__/mock.adapter.ts                                      # new
  api/sst-api.adapter.ts                                                  # extend
  api/__tests__/sst-api.adapter.test.ts                                   # extend
  api/__tests__/in-memory-api.adapter.ts                                  # extend
packages/mobile/src/ui/
  hooks/useSubscriptionTiers.ts                                           # new
  hooks/useMySubscription.ts                                              # new
  hooks/useCreateSubscription.ts                                          # new
  hooks/useCancelSubscription.ts                                          # new
  hooks/__tests__/*.test.ts                                               # new
  components/subscription/SubscriptionCard.tsx                            # new
  components/subscription/TrainerSubscriptionCard.tsx                     # new
  components/subscription/PaymentMethodForm.tsx                           # new
  components/subscription/CancelSubscriptionModal.tsx                     # new
  components/subscription/CurrentSubscriptionStatusCard.tsx               # new
  components/subscription/__tests__/*.test.tsx                            # new
  containers/SubscriptionSelectionContainer.tsx                           # new
  containers/SubscriptionManagementContainer.tsx                          # new
  containers/SubscriptionSuccessContainer.tsx                             # new
  containers/__tests__/*.test.tsx                                         # new
  presenters/SubscriptionSelectionPresenter.tsx                           # new
  presenters/SubscriptionManagementPresenter.tsx                          # new
  presenters/SubscriptionSuccessPresenter.tsx                             # new
  presenters/__tests__/*.test.tsx                                         # new
  containers/ProfileContainer.tsx                                         # extend with Subscription link
```

## Files you will NOT touch

- Anything under `microservices/` — backend agent's territory
- Anything under `scripts/` — reconcile script is final for M10
- `infra/` — no SST changes; Stripe secrets already wired
- `packages/db/src/schema.ts` — no schema changes in M10
- The webhook handlers — never touched by mobile

## Legacy reference paths

Read each of these in legacy `persistence-mobile/` to understand the proven behaviour. **Do not copy architecture** (legacy uses direct Supabase queries + hook-heavy patterns; V2 is ports/adapters). Do copy: flows, business logic, copy strings, layouts, edge-case handling.

| Legacy file                                           | Lines          | What it tells you                                                                                                                                     |
| ----------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/(auth)/subscription-selection.tsx`               | 1853           | The full buy/cancel/change UX state machine. Container responsibilities are lines 639–1053; presenter is lines 79–564; cancel modal is lines 567–636. |
| `app/subscription-management.tsx`                     | 560            | Smaller management surface with upgrade/downgrade/cancel buttons. Container lines 255–415; presenter lines 22–253.                                    |
| `app/(auth)/success.tsx`                              | 203            | Post-payment success landing. Container + presenter both small.                                                                                       |
| `components/payment/PaymentMethodForm.tsx`            | 387            | Apple Pay trigger via `usePlatformPay`. Cart-item construction with trial breakdown. Error handling for cancellation.                                 |
| `components/subscription/SubscriptionCard.tsx`        | 222            | Single-tier card layout.                                                                                                                              |
| `components/subscription/TrainerSubscriptionCard.tsx` | 357            | Dual-column Standard/Pro card layout.                                                                                                                 |
| `components/subscription/ComparisonTable.tsx`         | 351            | **Not used by the selection screen.** Skip the port; legacy includes it for a never-shipped path.                                                     |
| `lib/utils/subscriptionUtils.ts`                      | (not yet read) | Domain helpers — port to `domain/services/subscriptionService.ts`.                                                                                    |
| `hooks/api/usePostCreateStripeSubscription.ts`        | 91             | The legacy mutation hook. V2 replaces with `useCreateSubscription` + `ApiPort.createSubscription`.                                                    |
| `hooks/api/usePostCancelSubscription.ts`              | (not yet read) | Legacy cancel hook → V2 `useCancelSubscription`.                                                                                                      |
| `hooks/api/usePostUpgradeSubscription.ts`             | 58             | Legacy upgrade hook → V2 unified into `useCreateSubscription` with no `payment_method_id`.                                                            |
| `hooks/api/usePostDowngradeSubscription.ts`           | 54             | Legacy downgrade hook → V2 unified into `useCreateSubscription` with no `payment_method_id`.                                                          |
| `hooks/api/useGetSubscriptionTiers.ts`                | 25             | Legacy direct Supabase select → V2 `useSubscriptionTiers` + `ApiPort.getSubscriptionTiers`.                                                           |
| `hooks/api/useGetUserSubscription.ts`                 | 30             | Legacy view read → V2 `useMySubscription` + `ApiPort.getMySubscription`.                                                                              |
| `hooks/api/useGetTrialEligibility.ts`                 | 43             | Legacy direct profile read → V2 trial flags fold into `MySubscription` response. No separate hook.                                                    |
| `constants/colors.ts`, `constants/theme.ts`           | —              | Theme tokens reference. Match or evolve in V2 tokens file.                                                                                            |

## Inspector Brad expectations

Brad fires `@inspector-brad` on PR after his initial review. Mobile-side, PR #70 didn't trigger a sweep (no Stripe-mobile findings). M10's mobile surface is larger but mostly visual port + adapter wire-up; substantive sweep findings will concentrate on:

- State machine edges in the container (mid-flight role/cycle toggle, double-tap tier card, Apple Pay cancel mid-3DS, retry after partial failure)
- Trial-eligibility derivation mismatches between mobile and backend
- Apple Pay cart-item formatting (trial breakdown wrong start dates)
- Adapter wire format drift from the backend contract
- Container/presenter split discipline (logic leaking into presenter, presenter not testable without hooks)
- Test fakes pretending to be tests

TRACE before patching. Same protocol as backend. State the exact code reading + reproduction sequence in commit messages.

## When you finish

- Tests pass with 90% global aggregate
- `gh pr create` against `main` with the M10 reference and SMOKE_TEST link in the description
- Wait for Brad to fire `@inspector-brad` — do not pre-empt
- After fixes land, surface a `(finding, severity, patch)` summary table

## Frontend-design polish — DEFERRED to M11

Once the port lands and Brad signs off, M11 polish gets a `/frontend-design` pass for cohesion, spacing tweaks, transition polish, dark-mode review, micro-interactions. **Do not pre-empt that in M10**. The port-1:1 rule is non-negotiable.
