# M12 Subscriptions — Apple IAP + RevenueCat (iOS-only launch)

> **⚠️ SUPERSEDED 2026-06-25 — iOS-only, SINGLE RAIL.** A later review narrowed the launch to
> **Apple IAP + RevenueCat only**; the Stripe/web rail is **deferred** until a web rail is actually
> built. Net effect on this milestone:
>
> - **One billing rail.** The cross-rail `app_user_id` merge, Stripe→RevenueCat seeding, Stripe
>   product import and Stripe billing-cycle work are **out of scope**. The §3b "bind Stripe purchases
>   to the Supabase id" commit was **reverted** on this branch.
> - **Kept (single-rail core):** `POST /revenuecat/webhook` → re-fetch active entitlements →
>   upsert `user_subscriptions`. RevenueCat keys everything by **App User ID = the Supabase user id**.
>   The native Stripe webhook handlers stay **dormant** (not removed; not required for iOS-only).
> - **Purchasable on iOS (2026-06-27 update — all 4 tiers):** `premium`, `individual_trainer`,
>   `small_business`, `medium_enterprise` all have Apple IAP products. Business tiers are
>   **monthly-only** (no yearly pricing — Apple's high-end GBP price points don't map to round
>   numbers; annual business pricing is parked for a separate review). Note: unpriced draft
>   "Small Business Annual" (ASC id `6784980136`) still exists in App Store Connect — delete when
>   convenient.
> - RevenueCat project `b408fd30`, offering `default` (`ofrng79adc3c998`); **6 packages**: consumer
>   (`app.persistence.{premium,trainer.individual}.{monthly,annual}`) + business
>   (`app.persistence.small_business.monthly`, `app.persistence.medium_enterprise.monthly`). Mobile
>   configures RevenueCat with the Supabase user id and reads `getOfferings()` → `default`.
>
> The sections below are retained as historical context; where they describe Stripe/cross-rail, the
> banner above wins.

> **Status (original, 2026-06-24): DRAFT.**
> Architecture decision: **RevenueCat is the entitlement source-of-truth layer** in front of BOTH
> the existing Stripe integration (web + business tiers) and NEW native Apple IAP (iOS consumer
> tiers). This replaces the earlier hand-rolled receipt-verification design (`grantIosSubscription` /
> `verifyAppleReceipt` / `POST /subscriptions/ios-receipt`) — RevenueCat owns receipt validation,
> replay defence, renewals, refunds, grace periods.

## Why this shape (research-backed — see sources at bottom)

- Apple §3.1.1 still requires real Apple IAP for in-app digital subscriptions. RevenueCat **wraps**
  StoreKit; it does not bypass it. So we still create IAP products in App Store Connect.
- RevenueCat's **"Stripe Billing + Track External Purchases"** path lets us KEEP our existing
  Stripe Products / Prices / Customers / checkout / webhook untouched, and just _feed_ Stripe
  subscription ids to RevenueCat so they unlock the same entitlements as Apple purchases. We do
  **NOT** adopt RevenueCat "Web Billing" (that would make RC own our checkout — wrong for us).
- One entitlement model across platforms; `user_subscriptions` + `assertEntitlement` stay the
  backend authority. RevenueCat feeds that table via webhook; nothing downstream changes.

## The model

```
 iOS app ─► react-native-purchases ─► Apple IAP ─┐
                                                  ├─► RevenueCat ─► webhook ─► our backend ─► user_subscriptions ─► assertEntitlement
 Web/Android ─► EXISTING Stripe checkout ─────────┘   (re-fetch        (upsert)
                 (+ seed sub id → RC)                  via REST)
```

Two payment rails, one entitlement layer (RevenueCat), one source-of-truth table (`user_subscriptions`).

## THE load-bearing rule: identity

A web Stripe purchase only unlocks the iOS entitlement (and vice-versa) if **the same App User ID
is used everywhere**. **App User ID = our Supabase user id**, on every rail:

- iOS: `Purchases.logIn(<supabaseUserId>)` right after auth, before any purchase.
- Web/Stripe: when we seed a Stripe sub into RevenueCat we pass `app_user_id = <supabaseUserId>`.

Anonymous/ mismatched ids = entitlements that don't merge. This is the #1 failure mode — call it
out in both PRs.

## Tier ↔ entitlement mapping (4 entitlements)

| Tier               | RC entitlement       | Apple IAP products                  | Stripe products                |
| ------------------ | -------------------- | ----------------------------------- | ------------------------------ |
| free               | (none — default)     | —                                   | —                              |
| premium            | `premium`            | `premium_monthly`, `premium_annual` | existing Stripe monthly/annual |
| individual_trainer | `individual_trainer` | `trainer_monthly`, `trainer_annual` | existing Stripe monthly/annual |
| small_business     | `small_business`     | `small_business_monthly` (monthly only) | existing Stripe           |
| medium_enterprise  | `medium_enterprise`  | `medium_enterprise_monthly` (monthly only) | existing Stripe        |

All 4 paid tiers are purchasable on iOS via Apple IAP. Business tiers are monthly-only for launch
(annual pricing parked — see banner note). Annual individual_trainer / premium have yearly Apple
products.

## Canonical-table guard (unchanged)

Entitlement state lives in **`user_subscriptions`** (`packages/db/src/schema.ts:293`). There is **no
`entitlements` table**. The RevenueCat webhook handler upserts this table; `assertEntitlement`
(M10.5) reads it read-only. No schema columns need adding (store RC store/product/expiry in
`metadata`; `external_subscription_id` can hold the underlying store transaction id).

## Sequencing

1. **Backend agent, PR 1:** RevenueCat webhook handler (`POST /webhooks/revenuecat`) → verify bearer
   secret → re-fetch customer via RC REST → map entitlement→tier → upsert `user_subscriptions`;
   PLUS seed existing Stripe subs into RC (`app_user_id` = Supabase id). See BACKEND_BRIEF.
2. **Frontend agent, PR 2:** `react-native-purchases` SDK, identity (`logIn`), iOS paywall
   purchase/restore, platform branching, "Manage in App Store". See FRONTEND_BRIEF.

Both develop in parallel against the entitlement contract. Backend is testable with mocked RC
REST/webhook payloads. Full iOS e2e closes once Prerequisites land.

## Prerequisites — BRAD MUST SET UP (dashboards)

**RevenueCat:** create one Project; 4 entitlements (`premium`, `individual_trainer`,
`small_business`, `medium_enterprise`); connect the Apple App Store (App-Specific Shared Secret +
In-App Purchase Key); connect Stripe via the **RevenueCat app in the Stripe App Marketplace** (as
Stripe project owner); attach products to entitlements per the table; enable the Stripe
**server-to-server auto-track** toggle; set the **webhook URL + Authorization secret** (→ SST Secret).

**App Store Connect:** IAP subscription products (monthly + annual) for `premium` +
`individual_trainer` in a subscription group; App-Specific Shared Secret + In-App Purchase Key;
App Store Server Notifications **V2** pointed at RevenueCat.

**Stripe:** install the RevenueCat marketplace app (project owner). No product changes required.

**Build:** EAS dev build (`react-native-purchases` is native — Expo Go only runs RC's mock Preview
mode). You already build a dev client.

## Pricing note

RevenueCat is free to **$2,500/month tracked revenue**, then **1%** of tracked revenue (not a cut of
Apple/Stripe fees). Generous for launch.

## Out of scope

Sentry, FlashList, expo-image, legacy-theme retirement, a11y audit, store metadata/screenshots
(other spec-12 pillars). Android billing stays on Stripe. RevenueCat "Web Billing" (we use
Track-External-Purchases instead). Migrating historical Stripe subs (one-time CSV import if wanted —
separate task).

## Definition of done

See `SMOKE_TEST.md`. Both PRs green on the full gate, 90% coverage on changed files, identity
verified (a Stripe web purchase and an Apple purchase under the same Supabase id resolve to the same
entitlement), and an on-device sandbox Apple purchase granting entitlement end-to-end once
Prerequisites land.

## Sources (RevenueCat docs, verified 2026-06-24)

Stripe track-external-purchases, web/integrations/stripe; customers/identifying-customers;
integrations/webhooks (+ event-types-and-fields); api-v1 / api-v2; getting-started/entitlements,
offerings/overview; installation/expo + reactnative; platform-resources/server-notifications
(apple + stripe); pricing. Two items to confirm at implementation time: exact per-event grant/revoke
mapping (docs+community consensus) and the precise Expo config-plugin string / RN `storeKitVersion`
param for the pinned SDK version.
