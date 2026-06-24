# M12 Subscriptions (RevenueCat) — smoke test (e2e gate)

> Gates merge of the milestone branch to `main`. Split into CI-gateable-now (mocked) vs on-device
> (needs Brad's dashboard Prerequisites).

## A. CI-gateable now (both PRs, no external setup)

1. **Full gate green:** `bun run prettier:check && bun run typecheck && bun run lint &&
   bun run build && bun run test:unit && bun --filter @persistence/web test:unit`; 90% coverage on
   changed files.
2. **Webhook auth:** wrong/missing `Authorization` → 401 (constant-time compare); correct → 200.
3. **Dedup:** same RevenueCat `event.id` delivered twice → second is a no-op.
4. **Re-fetch + map:** mocked v2 `active_entitlements` (`gives_access:true`, `premium`) → row
   upserts to `premium`/active with correct `expires_at`; no active entitlement → `free`.
5. **Lifecycle:** INITIAL_PURCHASE / RENEWAL / CANCELLATION (active to period end) / EXPIRATION
   (revoked) / BILLING_ISSUE (grace) / PRODUCT_CHANGE / TRANSFER each drive the right final state.
6. **Active-unique:** an Apple grant for a user with a pre-existing active Stripe row → one active
   row (upsert in place, no `user_subscriptions_active_unique` violation).
7. **Stripe seed:** on Stripe sub create, a POST to RC fires with `fetch_token`=sub id +
   `app_user_id`=Supabase id + `X-Platform: stripe`; failure logged, not fatal.
8. **Platform branch (mobile):** iOS renders `<IOSPurchaseFlow>` with NO reachable Stripe purchase
   path; Web/Android render the existing Stripe paywall unchanged.
9. **Identity:** mobile `logIn(supabaseUserId)` on auth resolve, `logOut()` on sign-out, never a
   static id.
10. **Web/Android regression:** existing Stripe subscribe + cancel + Selection/Success flows pass
    unchanged.

## B. On-device + dashboards (needs Prerequisites — before App Store submission)

Requires: RevenueCat project wired (entitlements, Apple + Stripe connected, webhook secret),
App Store Connect IAP products + keys + ASSN v2 → RC, an EAS dev build, a sandbox tester.

11. **Apple sandbox purchase → entitlement:** sandbox tester buys `premium` (monthly) in-app → RC
    validates → RC webhook → `user_subscriptions` upserted (`metadata.source='revenuecat'`,
    store=`app_store`) → app reflects premium (gates open, drawer pill updates).
12. **Trainer SKU:** sandbox buys `individual_trainer` → entitlement grants → coach-mode available.
13. **Cross-rail identity (the headline test):** with one Supabase account, a **Stripe web** purchase
    of `premium` shows as active on the **iOS** app (same App User ID), and an **Apple** purchase
    shows on web — proving RevenueCat merged both rails under the Supabase id.
14. **Restore Purchases:** reinstall, tap Restore → entitlement reinstated.
15. **Manage in App Store:** iOS management opens the App Store subscriptions page (no Stripe portal
    reachable on iOS).
16. **Business tier on iOS:** `small_business`/`medium_enterprise` opens the marketing web CTA, never
    an IAP sheet.
17. **§3.1.1 copy:** no external-purchase steering anywhere in the iOS paywall (compliance record in PR).

## Done

A1–A10 green to merge the branch. B11–B17 verified on the TestFlight/dev build before
`eas submit --profile production --platform ios`. Item 13 (cross-rail identity) is the key
acceptance proof that "RevenueCat fronts both rails" actually works.
