# Stripe Rail Removal — Recon & Plan (PARKED, do not execute pre-release)

**Status:** Recon only. **No code deleted.** Revisit after the iOS production
release, once the Android/web + B2B payment strategy is decided.

**Decision context (Brad, 2026-07-21):**

- Subscriptions are **RevenueCat / Apple IAP only** on the live iOS build. The
  mobile Stripe rail is dead-on-iOS (proof below) but **not deleted** — Android/web
  is planned and a B2B web rail is undecided, so deletion now = likely rework.
- **Stripe billing is confirmed fully retired externally** (no Dashboard webhook
  pointed at us, no live/legacy subscriptions emitting events). This makes the
  backend Stripe rail genuinely dead weight — but we are **holding** it pending the
  strategy call below, not deleting pre-release.
- **Strategic direction to evaluate:** use **RevenueCat as the single rail across
  iOS + Android + web** rather than reintroducing a separate Stripe code rail for
  Android/web/B2B. RevenueCat supports Google Play (Android) and Web Billing (web,
  Stripe as the underlying processor), all surfaced through the existing
  `/revenuecat/webhook`. If adopted, both the mobile Stripe rail **and** the backend
  `/stripe/webhook` rail retire permanently. Verify against current RC docs: Web
  Billing fees, and whether enterprise annual/invoiced B2B ("Contact Sales" tiers)
  stays outside RevenueCat.

---

## Reachability proof (why the mobile rail is dead on iOS)

`packages/mobile/src/ui/containers/SubscriptionSelectionContainer.tsx` dispatches:

```
if (Platform.OS === "ios" && usePurchases() !== null) return <IOSPurchaseFlowContainer/>;
return <StripeSubscriptionSelectionContainer/>;   // dead on iOS
```

`createPurchasesAdapter()` (providers.tsx) returns a `RevenueCatPurchasesAdapter` on
**every** iOS launch (unconfigured if the SDK key is empty, but non-null), so the
Stripe branch is unreachable on the iOS-only build. It would only revive on an
Android/web target — which is exactly why we hold rather than delete.

---

## Section A — Dead code (safe to delete once strategy is confirmed)

### Mobile (PR 1 candidate)
- `src/adapters/payments/stripe.adapter.ts` (+ test) — `StripeApplePayAdapter`, `classifyStripeError`.
- `src/ui/components/subscription/PaymentMethodForm.tsx` (+ test) — also exports `USER_CANCELLED_ERROR` used by the dead container.
- `src/ui/hooks/useCreateSubscription.ts` (+ test), `src/ui/hooks/useCancelSubscription.ts` (+ test) — only importer is the dead `StripeSubscriptionSelectionContainer`.
- `deriveTrialEligibility` (inside `SubscriptionSelectionPresenter.tsx`) — iOS uses `useIntroEligibility` + `offeringTrialDays` instead.
- `StripeSubscriptionSelectionContainer` + the `SubscriptionSelectionPresenter` **component**.

### Backend (PR 2/3 candidates — Stripe now externally retired)
- `application/stripe/**` — `stripeWebhookHandler`, all `eventHandlers/*`, `alerts.ts`, `subscriptionState.ts`, `stripeIdempotency.ts`, `pgErrors.ts`, `stripeClient`, `reconcile/reconcileDetect.ts`.
- `application/repositories/subscriptionStatusTransitionsRepository.ts` (+ test) — only written by Stripe `subscriptionUpdated`.
- `application/repositories/stripeWebhookEventsRepository.ts` — only used by `/stripe/webhook`.
- `subscriptions/create` + `subscriptions/cancel` handlers (+ tests) — Stripe-coupled; only dead mobile hooks call them (confirm no web/admin caller first).

---

## Section B — Shared / MUST NOT DELETE (live rail depends on these)

### Mobile
- **`DEFAULT_TRIAL_DAYS`** (`domain/models/subscription.ts`) — imported by the live iOS `IOSPurchaseFlowContainer` and `ProfileDrawerPresenter`. Keep. (Note: PR #292 makes the iOS trial nullable; the container's `offeringTrialDays(packages, DEFAULT_TRIAL_DAYS)` fallback is being removed there, but `ProfileDrawerPresenter` still uses it.)
- **`getFeaturesList`** — defined in `SubscriptionSelectionPresenter.tsx`, imported by the live `IOSPurchaseFlowPresenter`. **Extract to a neutral module before deleting the presenter file.**
- **`PaymentsPort`** — required field of the shared `Adapters` type; removal touches `shared/types/adapters.ts`, `providers.tsx`, and ~50 test harnesses that build `MockPaymentsAdapter`. Wiring change, not a clean delete.
- **`StripeProvider`** (`@stripe/stripe-react-native`) — mounted at the live root `app/_layout.tsx`. Removable but a live-file edit + drop the dep + `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`.

### Backend
- **`SubscriptionRepository`** — used by `revenueCatSync`, `subscriptions/me`, `subscriptions/sync`, `assertEntitlement`, `trainerRepository`. Core shared. Keep.
- **`assertEntitlement.ts`** (+ `SubscriptionTierName`) — ~18 live consumers. Keep.
- **`subscriptions/tiers` + `me` + `sync` handlers** — live iOS rail. Keep. Unwire the dead create/cancel selectively inside `subscriptionsRoutes.ts`; don't delete the sub-app.
- **`user_subscriptions` columns + `SubscriptionStatus` enum** — also written by the RevenueCat rail. Do NOT drop columns.

---

## Section C — Live-wired Stripe (holding; safe to remove once we commit)

Stripe is externally retired, so these are functional no-ops, but they are on live
paths / deployed infra and are held pending the strategy decision:

1. `/stripe/webhook` route — `api.ts` (`honoApp.post`).
2. `reconcile-stripe-drift` **cron** — deployed hourly, `infra/api.ts`, reads `STRIPE_SECRET_KEY` (wasted invocations against a retired Stripe — quick-win removal candidate).
3. **Account-deletion safety-net** — `application/account/cancelUserStripeSubscriptions.ts`, called by `accountDeleteHandler` + `accountPurgeCron` (GDPR / App-Store 5.1.1 deletion path). No-op with no Stripe subs, but removal changes the deletion flow — do consciously.
4. SST Secrets `StripeSecretKey` / `StripeWebhookSecret` (`infra/secrets.ts`) + env bindings — remove last.
5. `packages/web` uses **no** Stripe code; `Privacy.tsx` only names "Stripe — payment processing" in prose. Update copy if Stripe is fully removed (and note RC Web Billing still uses Stripe as processor, so the privacy mention may still be accurate).

**Coverage gate risk:** the shared survivors (`subscriptionRepository`, `assertEntitlement`) draw some coverage from Stripe tests. After deleting Stripe tests, dry-run `vitest --coverage`; backfill RevenueCat-side tests if the aggregate 90% dips.

---

## Section D — Sequencing (when un-parked)

- **PR 1 — Mobile rail** (only if we do NOT keep it for Android/web): extract `getFeaturesList` first; delete the dead components/hooks/adapter; remove the `payments` port + `StripeProvider` + dep + env. Gate on mobile `jest --coverage` ≥ 90% + typecheck.
- **PR 2 — Backend dead endpoints**: unmount `subscriptions/create` + `cancel`, then `stripeIdempotency`/`pgErrors` (confirm no non-mobile caller first).
- **PR 3 — Backend Stripe rail + infra**: delete `application/stripe/**`, `reconcileCron`, the account-deletion safety-net (rewire delete/purge), `/stripe/webhook`, the cron + Stripe env bindings + Secrets. DB table drops (`stripe_webhook_events`, `subscription_status_transitions`) are a separate follow-up after a retention window.

**Recommended trigger:** the Android/web build kickoff, bundled with the
RevenueCat-single-rail decision — so removal and the RC Android/web/Web-Billing
integration land together instead of deleting now and rebuilding later.
