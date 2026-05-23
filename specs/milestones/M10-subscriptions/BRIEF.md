# M10 — Subscriptions & Payments (Stripe)

## Why this milestone

PRs #69 + #70 shipped the Stripe backend surface — webhook receiver, `POST /subscriptions`, `POST /subscriptions/:id/cancel`, reconcile script. The mobile `ApiPort` got `createSubscription` + `cancelSubscription` methods and SST adapter implementations.

The buy / cancel / upgrade / downgrade screens still live in the legacy `persistence-mobile` repo. M10 ports them — and adds the two backend read endpoints they need (`GET /subscription-tiers`, `GET /subscriptions/me`), plus the two write-side extensions (optional `payment_method_id`, extended response discriminators) — so the V2 app gets full subscription functionality matching legacy 1:1.

This is the last consumer-facing milestone before M11 polish. Get the model right; the rest of the app inherits the entitlement read.

## Parent spec

[`../../11-payments-subscriptions/`](../../11-payments-subscriptions/) — requirements + design + tasks.

The spec was rewritten on 2026-05-23 to reflect what PRs #69 + #70 actually shipped + what M10 will build. Read it BEFORE either brief — it's the contract; the briefs are scoped cuts of it.

## Scope summary

### Backend (one PR)

- **`GET /subscription-tiers`** — public read of the active tier catalog. Returns `subscription_tiers` rows ordered by `price_monthly ASC` with `is_active = true`.
- **`GET /subscriptions/me`** — authed read of the current user's subscription joined with tier info + profile role + trial-eligibility flags. Synthesises a `free`-tier shape when the user has no `user_subscriptions` row.
- **`POST /subscriptions` extensions**:
  - Body validator: `payment_method_id` → optional. New dispatch precedence handles change-of-tier without a fresh payment method (uses customer's default Stripe payment method on file).
  - Response shape: add `change_type` ('new'|'upgrade'|'downgrade'|'reinstate'|'cycle_change') + `scheduled` (bool) + `effective_at` (ISO|null) + `is_trial` (bool).
- **No schema changes.** Uses existing `subscription_tiers` + `user_subscriptions` + `profiles`. Trigger-maintained columns stay untouched.
- **No webhook changes.** `customer.subscription.updated` and the change-of-tier cleanup pattern remain as PR #69 + #70 built.

### Frontend (one PR)

- **Rewrite `PaymentsPort`** from the legacy stub interface to: `isApplePaySupported()`, `collectApplePayPaymentMethod(input)`, `confirm3DS(clientSecret)`. Implement `StripeApplePayAdapter` (production, uses `@stripe/stripe-react-native`) + `MockPaymentsAdapter` (tests).
- **Extend `ApiPort`** with `getSubscriptionTiers()` + `getMySubscription()`. Extend existing `createSubscription` input (`payment_method_id` optional) + response types (new discriminator fields). Implement in `SSTApiAdapter` + `InMemoryApiAdapter`.
- **Port two screens 1:1** from legacy `persistence-mobile`:
  - `app/(auth)/subscription-selection.tsx` → `SubscriptionSelectionContainer` + `SubscriptionSelectionPresenter` (full role-toggle + tier cards + Apple Pay form + cancel modal + scheduled-change indicator + reinstate-by-tap)
  - `app/subscription-management.tsx` → `SubscriptionManagementContainer` + `SubscriptionManagementPresenter` (smaller upgrade/downgrade/cancel surface accessed from Profile)
- **Port supporting components** 1:1: `SubscriptionCard`, `TrainerSubscriptionCard`, `PaymentMethodForm`, `CancelSubscriptionModal`. Pure presenters except `PaymentMethodForm` which wraps `PaymentsPort`.
- **Port success screen** from `app/(auth)/success.tsx`.
- **Navigation**: auth flow lands on Subscription Selection post-sign-up; Profile → Subscription Management link.
- **Android no-buy state**: match legacy exactly — "Apple Pay is only available on iOS devices" inline state, no fallback. Reflects App Store IAP-policy constraint Brad has accepted.

## Success criteria (review gate)

Done when all of these pass against `bun run dev` + staging Stripe (test mode):

1. Auth flow lands on Subscription Selection. Role toggle defaults from `profile.role`. Tier cards render from `GET /subscription-tiers`. Yearly/monthly toggle updates prices.
2. Tap `premium` while trial-eligible → Apple Pay sheet itemises 7-day free trial + recurring charge starting on trial-end date. Pay → backend creates Stripe sub in `trialing` state → success screen lands.
3. Tap `basic` while currently on `premium` → no Apple Pay sheet (no new payment method needed) → backend returns `change_type: "downgrade"`, `scheduled: true`, `effective_at: <next billing date>`. Selection screen shows scheduled-change indicator.
4. Tap current tier card while in `cancelled-but-still-active` state → backend returns `change_type: "reinstate"` → row's `cancelled_at` clears, sub continues.
5. Subscription Management screen (from Profile) shows current plan + correct upgrade/downgrade CTAs for the current tier (`basic` ↔ `premium` only; trainer tiers route via Selection).
6. Cancel from Management → confirmation alert → 200 from `POST /subscriptions/:id/cancel` → sub flips to `cancelled` with `expires_at = current_period_end`.
7. Force a 3DS-required card via Stripe test mode → backend returns `requires_action: true` + `client_secret` → mobile presents 3DS sheet → on success, webhook updates payment_status; mobile picks up the change on refetch.
8. Open the app on an Android emulator → Subscription Selection still renders cards (read-only OK), but tapping a tier shows the "Apple Pay only on iOS" inline state with no path forward.
9. Plus per-PR quality gates (prettier / typecheck / lint / build / test, 90% coverage on changed files).

## Agent briefs

Two parallel agent tracks. Each reads its own brief plus the parent spec and the referenced legacy/code files.

- **Backend:** [`BACKEND_BRIEF.md`](./BACKEND_BRIEF.md)
- **Frontend:** [`FRONTEND_BRIEF.md`](./FRONTEND_BRIEF.md)
- **Smoke test:** [`SMOKE_TEST.md`](./SMOKE_TEST.md)

Each PR lives on its own branch off fresh `main`:

- Backend: `feat/m10-backend-subscription-reads`
- Frontend: `feat/m10-mobile-subscription-screens`

The frontend depends on both new read endpoints (`/subscription-tiers`, `/subscriptions/me`) AND the `POST /subscriptions` extensions. Coordinate on the **wire format up front** — see "Cross-cutting" below. The backend PR can ship first; the frontend can then rebase onto main and use the real endpoints. While the backend isn't on main, the frontend uses `InMemoryApiAdapter` test fixtures mirroring the agreed wire shape.

## Explicit non-goals for M10

- **No feature-gate integration.** `FeatureGatePrompt` component + per-screen integration across exercise library / progress / health / trainer features is its own follow-up slice (likely M11 polish or a dedicated milestone). The two subscription screens + adapter surface + entitlement read are M10's scope.
- **No Google Pay.** Legacy is Apple Pay only; V2 matches. Android subscription buy stays blocked behind the inline error state.
- **No Stripe Customer Portal integration.** Management is fully native.
- **No Stripe Checkout.** Buy flow uses Apple Pay direct payment-method collection.
- **No schema changes.** All M10 reads are served by existing tables.
- **No webhook handler changes.** The PR #69 + #70 webhook surface is final for M10.
- **No new payment methods beyond Apple Pay.** Card field, SEPA, Google Pay etc. are out of scope.
- **No reconcile cron / Slack alerting.** Operational follow-up.
- **No helper unification refactor.** The `microservices/core/src/application/stripe/eventHandlers/_helpers.ts` vs `scripts/reconcile-stripe.ts` duplication is a known follow-up (see parent `tasks.md` § Deferred phases).
- **No M8 trainer features.** Trainer tier selection IS in M10 (it's part of the same selection screen), but the `Clients` tab + client management flows are M8.

## Cross-cutting (carry into both briefs)

- **Wire-format contract:** the backend's `GET /subscription-tiers` response shape and `GET /subscriptions/me` response shape are the load-bearing contracts. The frontend's `InMemoryApiAdapter` test fixtures must mirror them exactly. If you discover the shapes need to drift mid-implementation, surface a spec update FIRST, then mirror in both tracks. Never code against an undocumented shape.
- **Trigger contract:** the backend agent MUST NOT write to `profiles.subscription_id`, `profiles.role`, or `subscription_limits.*`. `update_subscription_limits_trigger` owns those columns. The trial flags `profiles.has_used_user_trial` / `has_used_trainer_trial` are the only exception — written explicitly on trial-using create paths.
- **In-flight marker guard** stays at the top of the `POST /subscriptions` dispatch — including for the new no-payment-method change-of-tier path. Any row carrying `metadata.old_stripe_subscription_id` → 409 until webhook resolves.
- **`isAlreadyCanceledError` recovery** is unchanged from PR #70. Both the webhook handler and the cancel handler share the pattern. New paths that talk to `stripe.subscriptions.cancel()` or `.update()` must mirror it.
- **Spec-first discipline:** if either agent finds the parent spec disagrees with the brief, the spec wins. Flag it in PR review; update the spec first; then implement.
- **Stripe SDK quirks** from PR #69 + #70 still apply (see `microservices/core/src/application/stripe/eventHandlers/_helpers.ts`): `readCurrentPeriodEnd`, `readInvoiceSubscriptionId`, the `Stripe.Response<T>` cast, no `apiVersion` pin in the SDK constructor.
- **Stripe webhook endpoint must be registered against staging URL** before any 3DS testing can pass. (Brad's already confirmed this is done.)
