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

## Current state (2026-05-24, post M10)

**Shipped on `main` via PR #71:**

- `GET /subscription-tiers` (public catalog)
- `GET /subscriptions/me` (authed entitlement read with joined tier + profile + trial flags + scheduled-change marker)
- `POST /subscriptions` extensions (optional `payment_method_id`, response discriminators `change_type` / `scheduled` / `effective_at` / `is_trial`)
- 8-tier role-toggle Selection screen, Management screen, Success screen ported 1:1 from legacy
- `StripeApplePayAdapter` (production) + `MockPaymentsAdapter` (tests) backing the rewritten `PaymentsPort`
- Apple-Pay-only buy flow on iOS; Android shows "Apple Pay only on iOS" inline state (matches legacy + App Store policy)
- 4 Inspector Brad findings closed in sweep #1 (scheduled_change marker leakage, no-PM downgrade stale-marker clear, alert chaining, yearly-not-available)
- Test deltas: core 728 → 799 (+71), mobile 1413 → 1647 (+234), scripts 37 unchanged

**Next: M10.5 — Entitlement hardening + feature gates + offline UX** (specs/milestones/M10-5-entitlement-hardening/)

## Phase 9 — Server-side `assertEntitlement` (M10.5 backend)

- [ ] AC 9.1, 9.6 — Build `microservices/core/src/application/entitlement/assertEntitlement.ts` with the feature enum + verdict shape + `EntitlementError`. Reads live DB only; no JWT-only paths.
- [ ] AC 9.2 — Add a shared Elysia error handler that maps `EntitlementError` to HTTP 402 with the structured `{ code, error, feature, current_tier, upgrade_to, upgrade_price_monthly }` body
- [ ] AC 9.3 — Wire `assertEntitlement(userId, "create_workout")` into `POST /workouts` (workoutsCreateHandler.ts)
- [ ] AC 9.4 — Wire `assertEntitlement(userId, "create_workout")` into `POST /sessions/record` (sessionsRecordHandler.ts) — only when the session represents a fresh workout (not re-recording an existing one)
- [ ] AC 9.5 — Stub `ai_workout`, `gym_buddy`, `unlimited_exercise_library`, `trainer_clients` features — each returns `{ allowed: true }` today
- [ ] AC 9.7 — 100% branch coverage on `assertEntitlement.ts`; handler integration tests cover 402 + 200 paths

## Phase 10 — Mobile feature-gate primitives (M10.5 frontend — Wave 1)

- [ ] AC 10.1 — `useFeatureGate(feature)` hook reading the cached `MySubscription`; pure (no network)
- [ ] AC 10.2 — `FeatureGatePrompt` component (paywall card with upgrade CTA)
- [ ] AC 10.3 — `SubscriptionBadge` component (tier chip)
- [ ] AC 10.4 — `SSTApiAdapter` intercepts 402 → produces `ApiError` with `code: 'ENTITLEMENT_DENIED'` + verdict payload
- [ ] AC 10.5 — Wave 1 ships primitives only; per-screen integration is Wave 2
- [ ] Tests: hook unit tests, component snapshot tests, adapter 402-handling test

## Phase 11 — Mobile offline UX on subscription screens (M10.5 frontend — Wave 1)

- [ ] AC 11.1 — `useOnlineStatus()` hook using RN `NetInfo`; offline banner on both subscription screens
- [ ] AC 11.2 — Offline pre-flight on buy / change / cancel CTAs — alert "You need to be online to manage your subscription" instead of mounting Apple Pay
- [ ] AC 11.3 — Slow-network "still working…" indicator at 8s on `useSubscriptionTiers` + `useMySubscription`
- [ ] AC 11.4 — Pre-flight check on `createSubscription` + `cancelSubscription` mutations
- [ ] AC 11.5 — 3DS confirmation pre-flight + mid-flight network-drop recovery
- [ ] Tests: hook tests with mocked NetInfo, container tests for offline + online + mid-flow disconnection

## Phase 12 — Per-screen feature-gate integration (M10.5 Wave 2)

Lands AFTER Phase 10 primitives are on `main`. Split across 3 parallel agents in Wave 2:

- [ ] AC 4.6 — Exercise library / workout creator (m105-gates-workouts)
- [ ] AC 4.6 — Progress + health + profile (m105-gates-progress)
  - [ ] Progress tab — render gate prompt for advanced analytics when free; full content otherwise. Free-tier verdict computed via `useFeatureGate("gym_buddy")` (closest existing stub for the missing `advanced_analytics` feature; see design.md § Per-screen feature-gate integration > Wave 2 Progress / Health / Profile subset).
  - [ ] Home tab — wrap the `MyProgressSection` health tiles (Steps / Body weight / Body fat / Energy) with the same gate (`gym_buddy`); free users see a single gate prompt in place of the tile grid.
  - [ ] Profile tab — render `<SubscriptionBadge tier paymentStatus compact />` next to display name; reads `useMySubscription()` directly so the badge gets the typed `SubscriptionTierName` enum.
  - [ ] Tests — `ProgressContainer.test.tsx` (free vs premium), `HomeContainer.test.tsx` extension (free vs premium health tiles), `ProfileContainer.test.tsx` extension (badge rendering + each tier variant).
- [ ] AC 4.6 — Trainer route stubs (m105-gates-trainer)

## Phase 13 — Sync-queue entitlement re-check (M10.6 — single mobile agent)

- [ ] AC 12.1 — Extend `SyncEntry` with `blocked_entitlement` status + `entitlementVerdict` field; storage adapter persists across restarts
- [ ] AC 12.2 — `sync.command.ts` catches 402 + ENTITLEMENT_DENIED → marks entry blocked + records verdict + continues processing (no abort)
- [ ] AC 12.4 — `SyncBlockedBanner` component + `useBlockedSyncEntries` hook → renders on Home when total > 0
- [ ] AC 12.5 — `/sync-blocked` screen (container + presenter) with grouped list + Upgrade-and-retry / Discard CTAs
- [ ] AC 12.3 — `useAutoRetryOnUpgrade` hook watches `useMySubscription`; on satisfying tier change, unblocks matching entries + triggers flush
- [ ] AC 12.7 — `tierSatisfies` helper in `subscriptionService.ts` enforcing track independence (user vs trainer)
- [ ] AC 12.6 — Regression: non-402 errors still classify as `failed` (existing behaviour preserved)
- [ ] Tests: 90% global coverage + dedicated coverage on every new file + storage adapter (both in-memory + SQLite)

## Deferred phases (out of M10.6)

### Future — Operational

- [ ] Daily cron schedule for `reconcile-stripe.ts` with Slack alerting on failed > 0
- [ ] Per-customer Stripe API fast-path for `--user-id` filter
- [ ] Helper unification — extract `microservices/core/src/application/stripe/eventHandlers/_helpers.ts` into a `@persistence/stripe-helpers` workspace; remove the duplicated helpers from `scripts/reconcile-stripe.ts`
