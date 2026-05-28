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

```ts
// microservices/core/src/infra/observability/sentry.ts
import * as Sentry from "@sentry/node";
import { Resource } from "sst";

Sentry.init({
  dsn: Resource.SentryDSN.value,
  environment: Resource.App.stage,
  tracesSampleRate: 0.1,
});

export function wrapHandler<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  return Sentry.AWSLambda.wrapHandler(handler, {});
}
```

Every Lambda entry point wraps its handler with `wrapHandler` (codemod across `microservices/core/src/api/`).

### Source maps

EAS build step uploads source maps via the Sentry CLI:

```yaml
# eas.json (production profile)
build:
  production:
    env:
      SENTRY_AUTH_TOKEN: ${SENTRY_AUTH_TOKEN}
    distribution: store
    autoIncrement: true
    extends: base
    cache:
      key: production
    postPublish:
      - file: sentry-expo/upload-sourcemaps
        config:
          organization: persistence
          project: mobile
```

### Error boundaries

Every screen's container wraps its return in `<ErrorBoundary>` per:

```tsx
// packages/mobile/src/ui/components/ErrorBoundary.tsx
import { Sentry } from "@sentry/react-native";

class ErrorBoundary extends React.Component {
  componentDidCatch(error: Error, info: ErrorInfo) {
    Sentry.captureException(error, { contexts: { react: info } });
  }
  render() {
    if (this.state.hasError) {
      return <ErrorFallback onRetry={this.reset} />;
    }
    return this.props.children;
  }
}
```

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

Defined in App Store Connect + mirrored in `app.config.ts`:

```ts
export const IAP_PRODUCT_IDS = {
  premium_monthly: "app.persistence.premium.monthly",
  premium_annual: "app.persistence.premium.annual",
  trainer_monthly: "app.persistence.trainer.monthly",
  trainer_annual: "app.persistence.trainer.annual",
} as const;
```

### Purchase flow

```ts
// packages/mobile/src/adapters/payments/ios-iap.adapter.ts
import * as RNIap from "react-native-iap";

export async function purchaseSubscription(productId: string) {
  await RNIap.initConnection();
  const products = await RNIap.getSubscriptions({ skus: [productId] });
  if (products.length === 0) throw new Error("Product not found");

  const purchase = await RNIap.requestSubscription({ sku: productId });
  // Send receipt to backend for verification + entitlement grant
  await api.post("/subscriptions/ios-receipt", {
    receipt: purchase.transactionReceipt,
    productId,
  });
}
```

### Backend receipt verification

```ts
// microservices/core/src/application/subscriptions/handlers/ios-receipt.ts
import { wrapHandler } from "../../infra/observability/sentry";

export const handler = wrapHandler(async (event) => {
  const { receipt, productId } = JSON.parse(event.body);
  const verification = await verifyAppleReceipt(receipt);
  if (!verification.valid)
    return {
      statusCode: 402,
      body: JSON.stringify({ error: "invalid_receipt" }),
    };

  // Grant entitlement matching the productId
  await grantEntitlement(
    verification.userId,
    productId,
    verification.expiresAt,
  );

  return { statusCode: 200, body: JSON.stringify({ entitlement: "granted" }) };
});
```

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
