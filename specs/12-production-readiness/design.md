# 12 — Production Readiness: Design

> **Spec rewritten from scratch on 2026-05-28.** Pairs with `requirements.md`.

---

## Architecture overview

Polish is a cross-cutting concern, not a feature folder. Changes land across:

```
packages/mobile/
├── app/
│   ├── _layout.tsx                  ← Sentry init + global error boundary
│   └── … (per-route error boundaries)
├── src/
│   ├── ui/
│   │   ├── theme/legacy/            ← DELETED at this milestone
│   │   ├── components/
│   │   │   ├── ErrorBoundary.tsx    ← NEW global wrapper
│   │   │   └── … (memoise heavy composites)
│   │   └── hooks/
│   │       └── useReducedMotionGate.ts  ← shared a11y hook
│   └── adapters/
│       └── observability/
│           └── sentry.adapter.ts    ← NEW

microservices/core/src/
└── infra/observability/
    └── sentry.ts                    ← NEW

eas.json                             ← profiles update
sentry.properties                    ← per-profile DSN
app.json / app.config.ts             ← icons, splash, IAP product IDs
.github/workflows/                   ← CI gates updated
```

---

## `*LegacyTheme` retirement

Files to delete:

```
packages/mobile/src/ui/theme/legacy/homeLegacyTheme.ts
packages/mobile/src/ui/theme/legacy/workoutsLegacyTheme.ts
packages/mobile/src/ui/theme/legacy/subscriptionLegacyTheme.ts
packages/mobile/src/ui/theme/legacy/profileLegacyTheme.ts
```

Procedure (one PR):

1. Run `git grep -l "LegacyTheme" packages/mobile/src/` to find every import site.
2. For each import site: remove the import + replace token references inline (most are already token refs after `01-design-system` codemod — only file deletion remains).
3. Delete the four files.
4. Remove the allow-list entry from `01-design-system`'s `no-raw-hex-colors` ESLint rule.
5. Verify `bun run typecheck` passes — any leaked reference causes a compile error.
6. Screenshots before/after every screen that used to import from the legacy files. Visual diff confirms parity.

---

## Reduced-motion contract

Single shared hook:

```ts
// packages/mobile/src/ui/hooks/useReducedMotionGate.ts
import { useReducedMotion } from "react-native-reanimated";

export type MotionGate = {
  reduced: boolean;
  ringFillMs: number; // 0 when reduced, 800 otherwise
  barFillMs: number; // 0 when reduced, 600 otherwise
  sheetAnimation: "slide" | "snap";
  pulseDots: boolean;
  tabAccentMs: number;
};

export function useReducedMotionGate(): MotionGate {
  const reduced = useReducedMotion();
  return {
    reduced,
    ringFillMs: reduced ? 0 : 800,
    barFillMs: reduced ? 0 : 600,
    sheetAnimation: reduced ? "snap" : "slide",
    pulseDots: !reduced,
    tabAccentMs: reduced ? 0 : 200,
  };
}
```

Foundation primitives in `01-design-system` (`Ring`, `Bar`, `BottomSheet`, `TabBar`, `ActiveWorkoutBar`) consume this hook. Verified during this spec's a11y audit.

---

## Performance audit checklist

Per `requirements.md` STORY-004 + 005.

### Lists ≥ 20 rows → FlashList

Audit + convert these surfaces:

| Surface               | Container                            | Estimated size |
| --------------------- | ------------------------------------ | -------------- |
| Exercises list        | `ExerciseListContainer` (in 04)      | 100+ rows      |
| Notifications list    | `NotificationsListContainer` (in 09) | 100 (LRU)      |
| Trainer Clients list  | `ClientsListContainer` (in 10)       | 1–50           |
| Trainer Programs list | `ProgramsListContainer` (in 10)      | 1–20           |
| Recipes / Meals lists | (in 13)                              | 1–100          |
| PR History            | `PRHistoryPresenter` (in 06)         | 1–50           |

Each gets `estimatedItemSize` based on observed row height. Memoised row component via `React.memo`.

### `expo-image` adoption

Surfaces to migrate:

- Avatar photos (when user uploads — currently initials)
- Exercise photos
- Recipe photos
- Meal photos
- Trainer client avatars

Native `<Image>` retained for: app icon, bundled assets, splash.

### Memoisation pass

Run through each presenter under `src/ui/presenters/` and wrap heavy composite render-trees in `React.memo` where the props are stable references. Reanimated shared values are fine to leave unwrapped (Reanimated handles re-render avoidance internally).

---

## Sentry integration

### Mobile init

```tsx
// app/_layout.tsx (very top)
import * as Sentry from "@sentry/react-native";

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enableAutoSessionTracking: true,
  sessionTrackingIntervalMillis: 30000,
  beforeSend(event) {
    // Strip PII per locked decision #5
    delete event.user?.email;
    delete event.user?.username;
    if (event.contexts?.app) {
      delete (event.contexts.app as Record<string, unknown>).clientName;
    }
    return event;
  },
  tracesSampleRate: 0.2, // 20% of transactions
  attachStacktrace: true,
});
```

### SST Lambda init

Use `@sentry/aws-serverless` (the v8 successor to the legacy `@sentry/serverless`, with first-class AWS Lambda support). `@sentry/node` does NOT export an `AWSLambda` namespace — the `Sentry.AWSLambda.wrapHandler(...)` shape only existed in `@sentry/serverless` v7 and moved to `@sentry/aws-serverless` in v8. Importing from `@sentry/node` directly will crash every Lambda cold start with `TypeError: Cannot read properties of undefined (reading 'wrapHandler')`.

```ts
// microservices/core/src/infra/observability/sentry.ts
import * as Sentry from "@sentry/aws-serverless";
import { Resource } from "sst";

Sentry.init({
  dsn: Resource.SentryDSN.value,
  environment: Resource.App.stage,
  tracesSampleRate: 0.1,
});

export function wrapHandler<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  return Sentry.wrapHandler(handler);
}
```

`@sentry/aws-serverless` depends on `@sentry/node` internally; no need to add `@sentry/node` to the dep list separately.

Every Lambda entry point wraps its handler with `wrapHandler` (codemod across `microservices/core/src/api/`).

### Source maps

EAS build uploads source maps via the **`@sentry/react-native/expo` config plugin** — wired into `app.config.ts`, not `eas.json`. `postPublish` is a Classic-Expo (`expo publish`) hook that `eas-cli` silently ignores; using it means source maps never reach Sentry and every prod stack trace renders as unmapped JS bundle gibberish.

```ts
// app.config.ts
import { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Persistence",
  slug: "persistence",
  plugins: [
    [
      "@sentry/react-native/expo",
      {
        organization: "persistence",
        project: "mobile",
        // SENTRY_AUTH_TOKEN read from EAS env per profile
      },
    ],
    // ... other plugins
  ],
});
```

EAS env binding per profile:

```jsonc
// eas.json
{
  "build": {
    "production": {
      "env": {
        "SENTRY_AUTH_TOKEN": "...", // bound via `eas secret:create` not committed
      },
    },
  },
}
```

The plugin handles source-map upload during the EAS build's metro bundle step. No `postPublish` hook, no manual CLI step. Verify post-build: every Sentry event from the production binary shows symbolicated stack frames in the Sentry dashboard.

### Error boundaries

Every screen's container wraps its return in `<ErrorBoundary>` per:

```tsx
// packages/mobile/src/ui/components/ErrorBoundary.tsx
import * as React from "react";
import * as Sentry from "@sentry/react-native";

type ErrorBoundaryProps = { children: React.ReactNode };
type ErrorBoundaryState = { hasError: boolean };

class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  // React asks every error boundary for the next state via this static method
  // when a descendant throws. Without it, `state.hasError` never flips and the
  // fallback never renders — the original error keeps propagating to the root.
  static getDerivedStateFromError(_error: Error): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    Sentry.captureException(error, { contexts: { react: { ...info } } });
  }

  reset = () => this.setState({ hasError: false });

  render() {
    if (this.state.hasError) {
      return <ErrorFallback onRetry={this.reset} />;
    }
    return this.props.children;
  }
}
```

Three mandatory class members: `state` initialiser (otherwise `this.state` is undefined and the first render throws on `this.state.hasError`); `static getDerivedStateFromError` (React's contract for boundary state transition on child throw); `reset` arrow method (referenced by `<ErrorFallback onRetry={...}>` — without it the retry button is a no-op).

`<ErrorFallback>` uses `<Card>` + `<Btn>` per `01-design-system` for the fallback UI.

---

## EAS build profile structure

```jsonc
// eas.json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "channel": "development",
      "env": { "EXPO_PUBLIC_API_URL": "https://dev-api.persistence.app" },
    },
    "preview": {
      "distribution": "internal",
      "channel": "preview",
      "ios": { "simulator": false },
      "env": { "EXPO_PUBLIC_API_URL": "https://staging-api.persistence.app" },
    },
    "production": {
      "channel": "production",
      "distribution": "store",
      "autoIncrement": true,
      "env": { "EXPO_PUBLIC_API_URL": "https://api.persistence.app" },
    },
  },
  "submit": {
    "production": {
      "ios": { "appleId": "...", "ascAppId": "...", "appleTeamId": "..." },
      "android": {
        "serviceAccountKeyPath": "./play-store-key.json",
        "track": "production",
      },
    },
  },
}
```

Sentry DSN per profile bound via EAS secrets.

---

## iOS IAP integration

Per `requirements.md` STORY-008.

### Native dep

```bash
bun add react-native-iap
cd ios && pod install
```

### Product IDs

Defined in App Store Connect + mirrored in `app.config.ts`. Apple IAP sells a **subset** of `SubscriptionTierName` (`packages/mobile/src/domain/models/subscription.ts:20`) — only the two consumer-shaped tiers (`premium` + `individual_trainer`). The two business-shaped trainer tiers (`small_business` + `medium_enterprise`) require invoicing, multi-seat management, tax IDs, and admin dashboards that Apple IAP does not support, so they remain web-only via the Stripe flow shipped in M10.

```ts
export const IAP_PRODUCT_IDS = {
  premium_monthly: "app.persistence.premium.monthly",
  premium_annual: "app.persistence.premium.annual",
  trainer_individual_monthly: "app.persistence.trainer.individual.monthly",
  trainer_individual_annual: "app.persistence.trainer.individual.annual",
} as const;

// Maps an IAP product purchase back to the SubscriptionTierName for entitlement grant.
// receipt → tier
function productIdToTier(productId: string): SubscriptionTierName {
  if (productId.startsWith("app.persistence.premium.")) return "premium";
  if (productId.startsWith("app.persistence.trainer.individual."))
    return "individual_trainer";
  throw new Error(`Unknown IAP productId: ${productId}`);
}
```

**iOS paywall for business-tier ineligible flows.** When a user on iOS attempts to upgrade to `small_business` or `medium_enterprise` (e.g. via a coach-mode prompt or an admin invite), the paywall renders a "Subscribe at persistence.app to manage clients" CTA with a `Linking.openURL` to the marketing site rather than attempting an IAP purchase. Per `requirements.md` STORY-008 AC 8.6 (App Store Guideline §3.1.1 compliance), the CTA copy avoids "click here to subscribe at our website" wording — instead it frames the action as "Manage your team" / "Upgrade your business plan" and lets the user follow the URL on their own.

### Purchase flow

```ts
// packages/mobile/src/adapters/payments/ios-iap.adapter.ts
import * as RNIap from "react-native-iap";

/**
 * appAccountToken binds the receipt to the signed-in app user at purchase
 * time. The backend handler (below) asserts
 * verification.appAccountToken === ctx.userId as defence-in-depth on top of
 * the JWT auth — without this parameter the backend check is dead code.
 *
 * userId is passed in by the caller (the IOSIAPFlow component reads it via
 * `useAuth().session?.userId` and threads it through). V2's auth lives in
 * `packages/mobile/src/ui/hooks/useAuth.tsx` as a React hook, NOT a Zustand
 * store — Rules of Hooks forbid calling it from this top-level async
 * function, so the parameter passes through the component boundary.
 */
export async function purchaseSubscription(
  productId: string,
  userId: string,
): Promise<void> {
  if (!userId) throw new Error("Not signed in");
  await RNIap.initConnection();
  const products = await RNIap.getSubscriptions({ skus: [productId] });
  if (products.length === 0) throw new Error("Product not found");

  const purchase = await RNIap.requestSubscription({
    sku: productId,
    appAccountToken: userId,
  });

  // Send receipt to backend for verification + entitlement grant.
  await api.post("/subscriptions/ios-receipt", {
    receipt: purchase.transactionReceipt,
    productId,
  });
}
```

Caller pattern in `<IOSIAPFlow>` (a component, so `useAuth()` is allowed):

```tsx
const { session } = useAuth();
const onSubscribe = async (productId: string) => {
  if (!session?.userId) return; // gated upstream by the auth wrapper anyway
  await purchaseSubscription(productId, session.userId);
};
```

### Backend receipt verification

```ts
// microservices/core/src/application/subscriptions/handlers/ios-receipt.ts
import { wrapHandler } from "../../infra/observability/sentry";
import { withAuth } from "../../infra/auth/withAuth";
import { verifyAppleReceipt } from "../verification/apple";
import { grantIosSubscription } from "../subscriptions/grantIosSubscription";
import { productIdToTier } from "../iap/productIds";

export const handler = wrapHandler(
  withAuth(async (event, ctx) => {
    // Trust boundary: BOTH userId AND productId MUST come from a trusted
    // source, not the request body.
    //
    // - userId: from ctx (Supabase JWT). Apple receipts have no notion of
    //   the app's signed-in user. Granting based on a body-supplied or
    //   verifier-implied userId would let any caller replay a valid receipt
    //   against any account.
    //
    // - productId: from `verification.productId` (Apple's signed
    //   `latest_receipt_info[0].product_id`). The body's productId is
    //   either redundant (already implied by the receipt) or — if trusted
    //   — the foothold for a tier-upgrade attack: a user buys the cheapest
    //   SKU (premium_monthly), then POSTs `{ receipt: <their valid premium
    //   receipt>, productId: "app.persistence.trainer.individual.annual" }`.
    //   Receipt verifies, appAccountToken matches, and the spec would grant
    //   the most expensive tier for the price of the cheapest. We require
    //   `body.productId === verification.productId` as a defence-in-depth
    //   assertion (also catches client bugs sending wrong productIds), and
    //   then use `verification.productId` for the tier lookup.
    const { receipt, productId: claimedProductId } = JSON.parse(event.body);

    const verification = await verifyAppleReceipt(receipt);
    if (!verification.valid)
      return {
        statusCode: 402,
        body: JSON.stringify({ error: "invalid_receipt" }),
      };

    // Tier-upgrade defence: cross-check the body's claim against the signed receipt.
    if (verification.productId !== claimedProductId) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "product_id_mismatch",
          message:
            "Body productId does not match the productId Apple signed into the receipt.",
        }),
      };
    }

    // Audit binding: Apple receipts carry an `appAccountToken` set at
    // purchase time (V2 client passes `appAccountToken: userId`). REQUIRED —
    // the previous `verification.appAccountToken && …` short-circuit was
    // fail-open: any receipt without the token (sandbox/TestFlight receipts
    // not set up to pass it, future code paths that forget to, any third-
    // party receipt an attacker can lay hands on) would skip the check and
    // grant the entitlement to whichever JWT submitted the receipt. Fail
    // CLOSED — a missing appAccountToken is treated identically to a
    // mismatched one.
    if (
      !verification.appAccountToken ||
      verification.appAccountToken !== ctx.userId
    ) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: "receipt_account_mismatch" }),
      };
    }

    // originalTransactionId uniqueness: bind it to ctx.userId at first grant
    // and 403 if a different user later submits the same originalTransactionId.
    // Defence-in-depth on top of the appAccountToken check — covers the case
    // where a legitimate purchase later gets replayed by a different user
    // (e.g. account-shared receipt leak). grantIosSubscription performs the
    // upsert into user_subscriptions + ownership assertion atomically; see
    // § grantEntitlement ownership contract.
    const ownership = await grantIosSubscription(
      ctx.userId,
      productIdToTier(verification.productId),
      verification.expiresAt,
      verification.originalTransactionId, // → external_subscription_id
    );
    if (ownership.status === "owned_by_other_user") {
      return {
        statusCode: 403,
        body: JSON.stringify({
          error: "transaction_owned_by_other_user",
        }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ entitlement: "granted" }),
    };
  }),
);
```

`withAuth` is the existing auth-middleware wrapper used by every other authenticated handler in `microservices/core/src/application/**/handlers/*.ts`. The `ctx.userId` it surfaces is the Supabase JWT subject from `event.headers.authorization` — same source as every other write endpoint. Mobile-side, `RNIap.requestSubscription` is updated above to pass `appAccountToken: userId` (where `userId` flows from the component's `useAuth().session?.userId` through the adapter parameter), so the binding is set at purchase time (Apple stores this UUID on the receipt; the verifier returns it for the backend cross-check).

#### `verifyAppleReceipt` return shape

The helper at `microservices/core/src/application/verification/apple.ts` must surface every signed field this handler relies on. Concretely:

```ts
type AppleReceiptVerification = {
  valid: boolean;
  // From the latest unexpired entry of `latest_receipt_info` returned by
  // Apple's verifyReceipt endpoint. NEVER trust client-supplied values for
  // any of these — they're the foothold for tier-upgrade + replay attacks.
  productId: string; // Apple-signed product_id of the active subscription
  originalTransactionId: string; // stable purchase identity across renewals
  expiresAt: Date; // expires_date_ms from Apple's response
  appAccountToken?: string; // optional UUID the client passed at purchase time
};

async function verifyAppleReceipt(
  receipt: string,
): Promise<AppleReceiptVerification>;
```

`productId` is the load-bearing field that closes the tier-upgrade attack (see comment block in the handler). Apple's response includes a `product_id` on each `latest_receipt_info[]` entry; the verifier picks the latest unexpired entry's `product_id` and returns it.

#### `grantEntitlement` ownership contract

**Reconciliation note (Inspector Brad sweep 17):** earlier drafts of this contract wrote to a fictional `entitlements` table. There is no such table. The canonical entitlement state lives in **`user_subscriptions`** (`packages/db/src/schema.ts:293`) — the table `assertEntitlement` (M10.5, `microservices/core/src/application/entitlement/`) reads READ-ONLY and the table the Stripe flow (`subscriptionsCreateHandler`) writes. The iOS-IAP grant MUST write to the same table or the purchase is invisible to every entitlement check. Apple's `original_transaction_id` maps onto the existing `external_subscription_id` column — exactly parallel to how that column already holds the Stripe subscription id.

Live `user_subscriptions` columns this contract touches: `(id, user_id, tier_name, payment_status, expires_at, external_subscription_id, billing_cycle, metadata jsonb, created_at, updated_at)` + the existing partial unique index `user_subscriptions_active_unique ON (user_id) WHERE payment_status IN ('active','pending')` (one active sub per user).

The grant helper performs an **atomic** upsert keyed on `external_subscription_id` and asserts ownership at the DB layer. "Atomic" means a single SQL statement with a uniqueness constraint — never a SELECT-then-INSERT, which is TOCTOU-unsafe.

Required shape:

```ts
type GrantResult =
  | { status: "granted"; userId: string }
  | { status: "renewed"; userId: string } // same user re-submits the same external txn id
  | { status: "owned_by_other_user"; ownerUserId: string }; // 403 from handler

async function grantIosSubscription(
  userId: string,
  tierName: SubscriptionTierName,
  expiresAt: Date,
  originalTransactionId: string, // Apple's original_transaction_id → external_subscription_id
): Promise<GrantResult>;
```

`source` is not a separate key — `external_subscription_id` is globally unique across providers (Apple's numeric `original_transaction_id` and Stripe's `sub_…` ids never collide), so a single UNIQUE on `external_subscription_id` suffices for the replay namespace. Store the provider in `metadata.source = 'ios_iap'` for auditability, not as a key.

**Required schema constraint** (owned by this spec — see `tasks.md` T-12.13 below):

```sql
-- Partial unique: external_subscription_id is nullable (legacy / manual rows).
CREATE UNIQUE INDEX user_subscriptions_external_sub_uq
  ON user_subscriptions (external_subscription_id)
  WHERE external_subscription_id IS NOT NULL;
```

**Required implementation** — single statement, `INSERT … ON CONFLICT` so the atomicity comes from Postgres, not application code. **The `DO UPDATE` must always fire** — a `WHERE` filter produces zero `RETURNING` rows on the cross-user case (the very case the contract exists to detect). Gate via `CASE` inside `SET` so the row gets a self-no-op update on cross-user replay; `RETURNING` then emits one row in every branch and the legitimate owner's data is preserved:

```sql
INSERT INTO user_subscriptions
  (user_id, tier_name, payment_status, expires_at, external_subscription_id, metadata)
VALUES
  ($userId, $tierName, 'active', $expiresAt, $originalTransactionId,
   jsonb_build_object('source', 'ios_iap'))
ON CONFLICT (external_subscription_id) WHERE external_subscription_id IS NOT NULL
DO UPDATE
  -- CASE guards: only overwrite when the existing row's user_id matches the
  -- request. Cross-user replay → each SET expression evaluates to the existing
  -- column value (self-no-op), preserving the legitimate owner's row AND
  -- keeping the statement an UPDATE so RETURNING emits a row.
  SET tier_name      = CASE WHEN user_subscriptions.user_id = excluded.user_id
                            THEN excluded.tier_name
                            ELSE user_subscriptions.tier_name END,
      expires_at     = CASE WHEN user_subscriptions.user_id = excluded.user_id
                            THEN excluded.expires_at
                            ELSE user_subscriptions.expires_at END,
      payment_status = CASE WHEN user_subscriptions.user_id = excluded.user_id
                            THEN 'active'
                            ELSE user_subscriptions.payment_status END,
      updated_at     = now()
RETURNING
  user_id,
  (xmax = 0)                          AS inserted,            -- first grant
  (xmax <> 0 AND user_id = $userId)   AS renewed,             -- same-user re-submit
  (xmax <> 0 AND user_id <> $userId)  AS owned_by_other_user; -- cross-user replay
```

Result-mapping rules (one row ALWAYS returned):

- `inserted` = `true` → `{ status: "granted", userId }`
- `renewed` = `true` → `{ status: "renewed", userId }`
- `owned_by_other_user` = `true` → `{ status: "owned_by_other_user", ownerUserId: row.user_id }` (CASE self-no-op left the owner's row untouched; `row.user_id` is the original owner)

**Interaction with `user_subscriptions_active_unique`** (one-active-per-user): on first IAP grant for a user who already has an active Stripe sub, the existing partial-unique index would be violated. The handler resolves this the same way `subscriptionsCreateHandler` does today — supersede the prior active row (set its `payment_status = 'cancelled'`) inside the same transaction before the IAP upsert. A user ends with exactly one active subscription regardless of provider. (Cross-provider migration UX — "you already subscribe via web" — is a product decision flagged for the M11 IAP brief, not a v1 spec concern.)

**Why this shape**:

1. `INSERT … ON CONFLICT … RETURNING` is one statement → no TOCTOU race. Concurrent requests with the same `external_subscription_id` serialise: first wins the insert, second hits ON CONFLICT.
2. CASE-inside-SET is the ownership assertion: same-user → overwrite; cross-user → self-no-op (row recorded as updated, data unchanged, RETURNING still emits).
3. **Do not use `WHERE` on `DO UPDATE`** — Postgres only emits `RETURNING` rows when the statement actually writes; a filtered-out update emits zero rows, making `owned_by_other_user` undetectable.
4. `xmax = 0` ⇒ newly inserted; otherwise ON CONFLICT branch.

Apple's `original_transaction_id` is stable across renewals + restores, so the UNIQUE on `external_subscription_id` pins the receipt to its first-granting user for the subscription's lifetime. Combined with the handler's fail-closed `appAccountToken` check, IAP receipt replay is closed at two independent layers — handler (token) + database (atomic ON CONFLICT on the real table).

### Stripe gating on iOS

Mobile detects platform at runtime; on iOS, hides Stripe paywall components + routes to IAP flow. Web + Android (sideload) still see Stripe.

```tsx
// SubscriptionSelectionPresenter
if (Platform.OS === "ios") {
  return <IOSIAPFlow />;
}
return <StripePaywall />;
```

---

## A11y audit procedure

Manual pass per screen with VoiceOver + TalkBack. Checklist per screen:

- [ ] Every `<Pressable>` has `accessibilityLabel`.
- [ ] Form fields have label + value + error announced.
- [ ] Live regions only on critical updates (rest timer end, achievement unlock).
- [ ] Focus order matches visual order.
- [ ] No "Image" or "Button" generic announcements (always labelled specifically).
- [ ] Tab bar announces mode + tab name + badge count + position.
- [ ] Tap target ≥ 44pt (verified via developer-tool overlay).

Recorded as a checklist in `docs/a11y-audit-results.md` (companion artifact, not in this spec folder).

---

## App Store + Play Store submission

### Required assets

| Asset                   | Size / format                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| App icon                | 1024 × 1024 PNG (no transparency, no rounded corners)                                                          |
| iPhone 6.7" screenshots | 5–10 PNG at 1290 × 2796                                                                                        |
| iPhone 6.5" screenshots | 5–10 PNG at 1242 × 2688                                                                                        |
| iPhone 5.5" screenshots | 5–10 PNG at 1242 × 2208                                                                                        |
| iPad 12.9" screenshots  | 5–10 PNG at 2048 × 2732                                                                                        |
| App preview videos      | Optional, 1080p MP4, 15–30s                                                                                    |
| Marketing text          | 30-char title, 170-char subtitle, 4000-char description, 100-char promotional text, keywords (100 chars total) |
| Privacy policy URL      | Static export of `(app)/profile/terms` route                                                                   |

### Demo account

Pre-created for App Store review:

- Email: `appstore-review@persistence.app`
- Password: rotating; documented in App Store Connect demo notes
- State: Premium tier active, 2 sample workouts, 1 completed session, 1 PR achieved, 1 active streak

---

## Testing strategy

### Pre-launch checklist (manual, completed before submission)

- [ ] TestFlight build runs end-to-end through every flow.
- [ ] No P1 Sentry errors over the prior 7 days.
- [ ] All health checks (SST + Supabase + Stripe + Apple IAP receipt verifier) green.
- [ ] Demo account flow verified by an external tester.
- [ ] Offline mode: full app usable without network for at least browsing + active session.
- [ ] Subscription purchase flow tested with Apple IAP sandbox account on iOS.
- [ ] Subscription purchase flow tested with Stripe test mode on Android + Web.

### Automated tests

- Sentry init + scrubbing tests.
- Receipt verification handler tests (mocked Apple endpoint).
- ErrorBoundary fallback render tests.

### Coverage

Existing 90% holds across the codebase. This spec doesn't ADD a coverage target — it enforces existing ones via the CI gate per locked decision #10.

---

## Risks + mitigations

| Risk                                                                           | Mitigation                                                                                                                                                                        |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `*LegacyTheme` deletion misses an import site                                  | `bun run typecheck` catches every broken reference at compile time. Per-file allow-list removal exposes any leftover during ESLint.                                               |
| Sentry source maps fail to upload on EAS build                                 | Build step exits non-zero on Sentry CLI failure. Re-run + investigate. Mitigation: keep prior version's source maps available for the rollback window.                            |
| Apple IAP receipt verification fails for sandbox-purchased users in production | Server-side verifier handles BOTH sandbox + production receipts (Apple's verifier returns different responses). Detect via `21007` status code and re-verify against sandbox URL. |
| App Store rejection on §3.1.1 for paywall copy                                 | Compliance review (STORY-008 AC 8.6) reads every paywall string before submission. "Subscribe in our website" or similar is gone from iOS.                                        |
| Sentry PII scrubbing misses fields added after rule was authored               | `beforeSend` denylist is conservative — easier to add fields than to remove. Audit before every major release.                                                                    |
| Reduced-motion gate inconsistently applied across primitives                   | Single shared `useReducedMotionGate()` hook — every primitive consumes from one source. Audit during a11y pass verifies.                                                          |
| EAS production build size exceeds App Store 100MB initial-download limit       | Variable-font slim build for Geist (per `01-design-system` risk note). Compress bundled assets. Lazy-load Sentry on first error.                                                  |

---

_End of `12-production-readiness/design.md` · 2026-05-28 (rewritten from scratch)_
