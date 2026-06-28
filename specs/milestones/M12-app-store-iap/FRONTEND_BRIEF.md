# M12 Subscriptions — FRONTEND (mobile) brief (agent 2)

> RevenueCat-fronted. Adds the `react-native-purchases` SDK and a native iOS purchase path; KEEPS
> the existing Stripe paywall on Web/Android unchanged. First step:
> `git fetch && git reset --hard origin/<branch>`.
>
> **Read first:** `BRIEF.md` (model, the identity rule, tier↔entitlement table, §3.1.1). Reuse the
> existing Selection/Success presenters, cards, tier model and `useMySubscription` — this is a new
> iOS purchase mechanism behind the existing paywall, **not** a Selection-UI rebuild.

## Fidelity guard (CLAUDE.md migration intent)

Do NOT restyle `SubscriptionSelectionPresenter`. Cards, role/billing toggles, current-status card,
cancel flow stay pixel-identical. New UI only: the iOS purchase trigger, Restore Purchases, "Manage
in App Store". Changing card layout/copy beyond §3.1.1 wording → stop and flag.

## Deliverable 1 — SDK install + config

- `npx expo install react-native-purchases react-native-purchases-ui` in `packages/mobile`. Native
  module → needs the EAS **dev build** (Expo Go only runs RC's mock "Preview API mode"). Note in PR.
- Add the Expo config-plugin entry (confirm exact string against the pinned SDK version).
- `Purchases.configure({ apiKey: <iOS public SDK key> })` at app start (iOS only). The **public**
  SDK key is client-safe; the `sk_` secret key is backend-only (never ship it).

## Deliverable 2 — identity wiring (THE load-bearing piece)

After auth resolves, call `Purchases.logIn(<supabaseUserId>)`; on sign-out call `Purchases.logOut()`.
**App User ID MUST equal the Supabase user id** — this is what merges a user's Stripe (web) and
Apple (iOS) purchases into one entitlement. Never configure with a static/anonymous id before login.
Wire it as a small bootstrap sibling to the existing auth bootstraps in `app/_layout.tsx`
(self-gates on a resolved userId).

## Deliverable 3 — iOS purchase flow + platform branching

`SubscriptionSelectionPresenter`:

```tsx
if (Platform.OS === "ios") return <IOSPurchaseFlow />; // RevenueCat
return <StripePaywall />; // existing Web/Android path, UNCHANGED
```

`<IOSPurchaseFlow>` renders the same plan cards and, on tier-select:

- `Purchases.getOfferings()` → pick the package for the chosen tier + billing cycle (map our tier →
  RC entitlement/package; mirror backend `entitlements.ts`).
- `Purchases.purchasePackage(pkg)`; on success read `customerInfo.entitlements.active[...]`.
- **Stripe + Apple Pay are disabled/unreachable on iOS** (the `@stripe/stripe-react-native` purchase
  path must not render on iOS) — Apple §3.1.1.
- On success reuse the existing Success route + invalidate `useMySubscription` so entitlement +
  coach-mode switch behave exactly as today. (Server truth lands via the RC webhook → our table; the
  client may briefly rely on `getCustomerInfo()` — that's fine, `useMySubscription` reconciles.)

Business tiers on iOS (`small_business` / `medium_enterprise`): purchasable via Apple IAP —
monthly-only for launch (no yearly Apple products exist yet). Selecting a business tier on the yearly
billing cycle shows the "not available on a yearly basis yet" alert, which is correct. Never show
"subscribe at our website" wording (§3.1.1).

## Deliverable 4 — Restore Purchases (iOS)

CTA → `Purchases.restorePurchases()`; invalidate `useMySubscription`; surface result. (Apple
requires a restore path for IAP.)

## Deliverable 5 — "Manage in App Store" (iOS management view)

On iOS, the management affordance (reached from the profile drawer → `/(auth)/subscription-selection`,
now wired) shows **"Manage in App Store"** → `Linking.openURL("https://apps.apple.com/account/subscriptions")`
(Apple manages IAP subs; we can't cancel them ourselves). Web/Android keep the Stripe management flow.

## Deliverable 6 — §3.1.1 copy review

Audit every iOS-rendered paywall string: no external-purchase steering, no Stripe/website "subscribe
here" language. Capture before/after copy in the PR for the compliance record.

## Web (packages/web) — minimal

Web Stripe purchases are tracked into RevenueCat **server-side** (backend seeds the sub id +
`app_user_id`), so the web client needs **no RC SDK**. Only requirement: the Stripe Customer/sub must
carry the Supabase user id so the backend seed binds identity correctly (backend owns this — verify
the id is present at checkout/webhook time).

## Tests (90% on changed files; mock `react-native-purchases` + the api port)

- Identity: `logIn(supabaseUserId)` on auth resolve; `logOut()` on sign-out; never a static id.
- Platform branch: iOS renders `<IOSPurchaseFlow>` with NO reachable Stripe purchase path;
  Web/Android render the existing Stripe paywall unchanged (testID/snapshot parity).
- Purchase: success → entitlement read + `useMySubscription` invalidated; failure → surfaced, no crash.
- Restore: calls `restorePurchases`, invalidates subscription query.
- Business-tier iOS monthly: purchase flows through IAP; yearly billing cycle → "not available on a yearly basis" alert (expected — no yearly product).

## Gate (from repo root)

`bun run prettier:check && bun run typecheck && bun run lint && bun run build && bun run test:unit`

- `bun --filter @persistence/web test:unit`. Full on-device sandbox e2e closes once Prerequisites
  land — see `SMOKE_TEST.md`.
