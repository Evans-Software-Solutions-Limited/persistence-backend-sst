# 11 — Payments & Subscriptions: Tasks

## Current state (2026-04-19)

**Shipped: ~1 of ~35 tasks complete. Stub adapter only.**

What's there:

- `PaymentsPort` interface at `src/domain/ports/payments.port.ts` (shipped as part of 00-guardrails).
- `StubPaymentsAdapter` at `src/adapters/payments/stub.adapter.ts` — no-op placeholder.
- **Backend** — no Stripe integration, no subscription endpoints.

Nothing real is built: no Stripe adapter, no tier selection screen, no checkout flow, no feature gates.

Parent milestone: **M10 Subscriptions & payments (Stripe)** — deferred to last feature milestone per the plan. Upsell chrome (locked badges, upgrade CTAs) may appear in earlier milestones but all CTAs no-op until M10. Backend: Stripe webhook receiver, plan catalog (`GET /subscriptions/plans`), checkout (`POST /subscriptions/checkout`), portal (`POST /subscriptions/portal`), entitlement (`GET /subscriptions/me`). Frontend: subscription selection screen, entitlement gates per screen, Stripe React Native SDK.

## Phase 1: Domain

- [ ] Create `UserSubscription`, `SubscriptionTier`, `SubscriptionStatus` models
- [ ] Create `SubscriptionTierInfo`, `SubscriptionLimits` models
- [ ] Define tier feature/limit mappings (free, premium, trainer)
- [ ] Write tests for limit checking logic

## Phase 2: Ports & Adapters

- [ ] Define `PaymentsPort` interface
- [ ] Add `@stripe/stripe-react-native` dependency
- [ ] Create Stripe adapter implementing `PaymentsPort`
- [ ] Create mock payments adapter for tests
- [ ] Extend `ApiPort` with subscription methods (get tiers, get current, create, cancel)
- [ ] Write adapter tests

## Phase 3: Subscription State

- [ ] Create `useSubscription()` hook (fetches on mount, caches in memory)
- [ ] Create `useFeatureGate()` hook (checks limits, returns upgrade prompt)
- [ ] Implement stale state detection (>24h without server check)
- [ ] Write tests for subscription state management

## Phase 4: UI — Tier Selection

- [ ] Create `TierCard` presenter (name, price, features, CTA)
- [ ] Create `SubscriptionPresenter` (tier comparison, current plan highlight)
- [ ] Create `SubscriptionContainer` (fetches tiers + current subscription)
- [ ] Create `app/(app)/subscription.tsx` screen
- [ ] Write tests

## Phase 5: UI — Checkout

- [ ] Create `CheckoutPresenter` (payment sheet trigger, Apple/Google Pay options)
- [ ] Create `CheckoutContainer` (initialises payment sheet, handles result)
- [ ] Implement Stripe payment sheet flow
- [ ] Write tests (mock Stripe, verify flow)

## Phase 6: UI — Subscription Management

- [ ] Create `SubscriptionManagePresenter` (current plan, next billing, cancel/reactivate)
- [ ] Create `SubscriptionManageContainer` (manage actions)
- [ ] Create `app/(app)/subscription-manage.tsx` screen
- [ ] Write tests

## Phase 7: Feature Gates

- [ ] Create `FeatureGatePrompt` component (upgrade CTA for gated features)
- [ ] Create `SubscriptionBadge` component (tier indicator in profile)
- [ ] Integrate feature gates into: exercise library, progress analytics, health integration, trainer features
- [ ] Write tests (free user sees gate, premium user accesses feature)

## Phase 8: Quality Gates

- [ ] All subscription tests pass with 90% coverage
- [ ] Quality gates pass
