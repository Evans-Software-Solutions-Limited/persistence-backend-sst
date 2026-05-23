# 11 — Payments & Subscriptions: Tasks

## Current state (2026-05-23)

**Shipped backend (PRs #69 + #70):**

- `POST /stripe/webhook` with 6 event handlers + idempotency log
- `POST /subscriptions` — new/reinstate/change-of-tier/3DS dispatch
- `POST /subscriptions/:id/cancel` — period-end + immediate
- `subscription_tiers` + `user_subscriptions` + `stripe_webhook_events` Drizzle definitions
- Reconcile script (`scripts/reconcile-stripe.ts`) — drift detection, dry-run by default
- 14 Inspector Brad findings closed across 8 sweeps on PR #70 (no false positives)

**Shipped mobile (PR #70):**

- `PaymentsPort` stub interface at `packages/mobile/src/domain/ports/payments.port.ts` (legacy shape — to be rewritten in M10)
- `StubPaymentsAdapter` placeholder
- `ApiPort.createSubscription` + `ApiPort.cancelSubscription` methods + wire types
- `SSTApiAdapter` implementations for both

**Not shipped — M10 scope:**

- `GET /subscription-tiers` (catalog read endpoint)
- `GET /subscriptions/me` (current entitlement read endpoint with joined tier + profile + trial-eligibility)
- `POST /subscriptions` extensions — optional `payment_method_id`, response discriminator fields (`change_type`, `scheduled`, `effective_at`, `is_trial`)
- Mobile screens: Subscription Selection, Subscription Management, Success
- `PaymentsPort` rewrite + `StripeApplePayAdapter`
- Domain models, services, hooks, container/presenter split
- Navigation wiring (auth flow + profile entry)

**Out of M10 scope (parked):**

- Feature gates (`FeatureGatePrompt`, `useFeatureGate`, per-screen integration) → M11 polish or dedicated slice
- Google Pay (Android subscription buy) → not in legacy
- Stripe Customer Portal → never used; intentionally custom-built
- Stripe Checkout (PaymentSheet) → replaced by Apple Pay direct collection
- Reconcile script cron scheduling → operational follow-up

Parent milestone: **M10 — Subscriptions & payments (Stripe)** — see [`../milestones/M10-subscriptions/`](../milestones/M10-subscriptions/) for the milestone briefs.

## Phase 1 — Spec alignment (lands first, on both M10 branches)

- [x] Rewrite `requirements.md` to reflect the actual Apple-Pay-direct + custom-screen model (8 tiers, role toggle, scheduled change, no Stripe Checkout, no Customer Portal) — **shipped 2026-05-23**
- [x] Rewrite `design.md` with the PaymentsPort/ApiPort/backend-endpoint contract M10 builds against — **shipped 2026-05-23**
- [x] Restructure `tasks.md` Phase 1–8 to match the new contract — **shipped 2026-05-23**

## Phase 2 — Backend reads (M10 backend PR)

- [ ] AC 1.1, 1.2, 1.3 — Implement `GET /subscription-tiers` handler. Public (no auth). Returns active tiers ordered by `price_monthly ASC`. Single envelope `{ data: SubscriptionTier[] }`.
- [ ] AC 5.1, 5.4, 5.5 — Implement `GET /subscriptions/me` handler. Auth required. Joined query across `user_subscriptions` + `subscription_tiers` + `profiles`. Synthesise `free`-tier shape when no row. Include trial eligibility flags from `profiles.has_used_*_trial`.
- [ ] Add `SubscriptionTiersRepository` with `listActive()` method
- [ ] Extend `SubscriptionRepository` with `findForUser(userId)` returning the joined `MySubscription` shape (or synthesised free)
- [ ] Register both routes in [`microservices/core/src/api.ts`](../../microservices/core/src/api.ts)
- [ ] Handler + repo tests; 90% branch coverage on changed files

## Phase 3 — Backend write extensions (M10 backend PR)

- [ ] AC 2.4 — Extend `POST /subscriptions` body validator: `payment_method_id` → `t.Optional(t.String({ minLength: 1 }))`
- [ ] AC 3.3, 3.4 — Extend dispatch precedence to handle the no-payment-method change-of-tier case (refer to design.md § Backend endpoints > POST /subscriptions for ordering)
- [ ] AC 2.4, 3.4 — Extend response shape with `change_type`, `scheduled`, `effective_at`, `is_trial`. Derive `change_type` from dispatch branch; derive `scheduled`/`effective_at` from upgrade/downgrade direction by `price_monthly` delta.
- [ ] All existing PR #70 tests for `subscriptionsCreateHandler` must continue to pass; add tests for the new dispatch precedence + new response fields
- [ ] Document the in-flight marker guard precedence remaining unchanged

## Phase 4 — Mobile domain (M10 frontend PR)

- [ ] Rewrite `packages/mobile/src/domain/models/subscription.ts` with the 8-tier names + `SubscriptionStatus` + `BillingCycle` + `ChangeType` + `MySubscription` + `CreateSubscriptionResult` types
- [ ] Port subscription-utility pure functions from legacy `persistence-mobile/lib/utils/subscriptionUtils.ts` → `domain/services/subscriptionService.ts`: `canCancelSubscription`, `getSubscriptionDisplayInfo`, `isCancelledButActive`
- [ ] Domain tests

## Phase 5 — Mobile ports & adapters (M10 frontend PR)

- [ ] Rewrite `packages/mobile/src/domain/ports/payments.port.ts` to the new shape (`isApplePaySupported`, `collectApplePayPaymentMethod`, `confirm3DS`) — see design.md § PaymentsPort
- [ ] Implement `StripeApplePayAdapter` at `packages/mobile/src/adapters/payments/stripe.adapter.ts` using `@stripe/stripe-react-native`'s `usePlatformPay` + `createPlatformPayPaymentMethod` + `handleNextAction`
- [ ] Implement `MockPaymentsAdapter` at `packages/mobile/src/adapters/payments/__tests__/mock.adapter.ts` (configurable per-test for cancelled / 3DS / success)
- [ ] Extend `ApiPort` with `getSubscriptionTiers()` + `getMySubscription()`; extend `createSubscription` input/output types
- [ ] Implement those methods in `SSTApiAdapter`
- [ ] Extend `InMemoryApiAdapter` to mirror
- [ ] Add `@stripe/stripe-react-native` dependency to `packages/mobile/package.json` if not present
- [ ] Configure `<StripeProvider>` at app root with publishable key from `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- [ ] Adapter tests

## Phase 6 — Mobile UI: components (M10 frontend PR)

- [ ] AC 1.7 — Port `SubscriptionCard` from `persistence-mobile/components/subscription/SubscriptionCard.tsx` → `ui/components/subscription/SubscriptionCard.tsx` as pure presenter
- [ ] AC 1.3, 6.2, 6.3 — Port `TrainerSubscriptionCard` from legacy → `ui/components/subscription/TrainerSubscriptionCard.tsx` as pure presenter (dual-column Standard/Pro)
- [ ] AC 2.1, 2.2, 7.3 — Port `PaymentMethodForm` from legacy → `ui/components/subscription/PaymentMethodForm.tsx` using `PaymentsPort` instead of direct Stripe SDK calls
- [ ] AC 3.7 — Create `ScheduledChangeIndicator` component
- [ ] AC 1.5, 3.6 — Create `CurrentSubscriptionStatusCard` component
- [ ] AC 3.5 — Create `CancelSubscriptionModal` component
- [ ] Component tests

## Phase 7 — Mobile UI: containers + presenters (M10 frontend PR)

- [ ] AC 1.x, 2.x, 3.x, 6.x, 7.x — Port Subscription Selection container + presenter from legacy `persistence-mobile/app/(auth)/subscription-selection.tsx` → split into `SubscriptionSelectionContainer.tsx` + `SubscriptionSelectionPresenter.tsx`
- [ ] AC 3.1, 3.2, 3.3, 3.4 — Port Subscription Management container + presenter from legacy `persistence-mobile/app/subscription-management.tsx` → split into `SubscriptionManagementContainer.tsx` + `SubscriptionManagementPresenter.tsx`
- [ ] AC 2.6, 6.5 — Port Success container + presenter from legacy `persistence-mobile/app/(auth)/success.tsx`
- [ ] Create thin Expo Router screen wrappers at `app/(auth)/subscription-selection.tsx`, `app/subscription-management.tsx`, `app/(auth)/success.tsx`
- [ ] Wire navigation: post-sign-up → subscription-selection; Profile → Subscription Management link
- [ ] AC 2.9 — Android no-buy state on PaymentMethodForm (matches legacy)
- [ ] Container + presenter tests; full integration tests using InMemoryApiAdapter + MockPaymentsAdapter

## Phase 8 — Quality gates + smoke test

- [ ] All subscription-touched files pass 90% line/branch coverage
- [ ] `bun run prettier:check && bun run typecheck && bun run lint && bun run build` clean
- [ ] `bun --filter @persistence/core test:unit` clean (backend extensions don't regress)
- [ ] `bun --filter @persistence/mobile test:unit` clean (mobile suite passes 90% global)
- [ ] E2E smoke test ([`../milestones/M10-subscriptions/SMOKE_TEST.md`](../milestones/M10-subscriptions/SMOKE_TEST.md)) passes against `bun run dev` + staging Stripe (test mode)

## Deferred phases (not M10)

### Future — Feature gates

- [ ] AC 4.x — `FeatureGatePrompt` component
- [ ] AC 4.x — `useFeatureGate(feature)` hook
- [ ] AC 4.x — `SubscriptionBadge` component (tier indicator)
- [ ] AC 4.x — Integrate gates into: exercise library, progress analytics, health integration, trainer features
- [ ] AC 4.x — Tests (free user sees gate, premium user accesses feature)

### Future — Operational

- [ ] Daily cron schedule for `reconcile-stripe.ts` with Slack alerting on failed > 0
- [ ] Per-customer Stripe API fast-path for `--user-id` filter
- [ ] Helper unification — extract `microservices/core/src/application/stripe/eventHandlers/_helpers.ts` into a `@persistence/stripe-helpers` workspace; remove the duplicated helpers from `scripts/reconcile-stripe.ts`
