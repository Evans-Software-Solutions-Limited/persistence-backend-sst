# Mobile Foundation — Configuration Requirements

This document lists all configuration, secrets, and identity values that
need to be provided or confirmed before the mobile app can be fully
functional. Items marked **[preserved]** were carried forward from the
existing `persistence-mobile` app.

---

## App Identity (preserved from existing app)

| Setting         | Value                                  | Source                   |
| --------------- | -------------------------------------- | ------------------------ |
| iOS Bundle ID   | `com.bradleyevans96.persistence`       | **[preserved]** app.json |
| Android Package | `com.bradleyevans96.persistence`       | **[preserved]** app.json |
| Expo Project ID | `255d542d-8dae-43c9-8d98-d9a3a325a470` | **[preserved]** app.json |
| Expo Owner      | `bradleyevans96`                       | **[preserved]** app.json |
| Expo Slug       | `persistence`                          | **[preserved]** app.json |
| App Version     | `1.1.1`                                | **[preserved]** app.json |
| URL Scheme      | `persistencemobile`                    | **[preserved]** app.json |

> **Important:** These identifiers are critical for App Store / Play Store
> continuity. Do not change them unless you intend to publish as a new app.

---

## Environment Variables (required in `.env`)

| Variable                             | Purpose                               | Status                                                    |
| ------------------------------------ | ------------------------------------- | --------------------------------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`           | Supabase project URL (auth only)      | **Bradley to provide**                                    |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY`      | Supabase anon key (auth only)         | **Bradley to provide**                                    |
| `EXPO_PUBLIC_API_URL`                | SST API base URL                      | **Bradley to provide** (from `sst dev` or deployed stage) |
| `EXPO_PUBLIC_REVENUECAT_IOS_KEY`     | RevenueCat App Store public SDK key   | Configured for current EAS profiles                       |
| `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` | RevenueCat Google Play public SDK key | **Required in EAS preview + production environments**     |

---

## Native integrations

### HealthKit / Health Connect

- HealthKit and Health Connect are both wired through the shared health port.
- Android declares only the permissions exercised by visible read/write features.
- Health Connect Console declaration copy and device QA live under
  `specs/milestones/ANDROID-LAUNCH/`.

### Stripe / Apple Pay — REMOVED, do not reinstate on iOS

- Removed in full 2026-07-29 after App Review rejected build 38 under
  **Guideline 2.1**: `@stripe/stripe-react-native` links the `StripeApplePay`
  pod (and therefore PassKit) into the binary, and `app.json` declared the
  `com.apple.developer.in-app-payments` entitlement — while no Apple Pay flow
  was reachable, because iOS purchases route to RevenueCat / Apple IAP.
- Gone: the dependency, the entitlement, the merchant ID, the root
  `StripeProvider`, `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`, the payments port and
  adapter, and `PaymentMethodForm`.
- **Do not re-add any of these for an iOS purchase path** — charging a payment
  method for digital goods on iOS is a Guideline 3.1.1 violation. iOS purchasing
  is RevenueCat only.
- Android now goes through RevenueCat (Play Billing), rather than re-linking
  Stripe. `useCreateSubscription` survives as the typed
  client for `POST /subscriptions` if a non-Apple card rail is ever needed.

### RevenueCat / Google Play Billing

- The mobile adapter, native paywall, restore flow and subscription-management
  handoff support both App Store and Google Play.
- Set `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` as an EAS environment variable; it is
  a client-safe `goog_…` public SDK key, never a RevenueCat secret key.
- Google service-account JSON belongs only in RevenueCat/EAS credential stores
  and must never be committed.
- Full Console/product checklist:
  [`REVENUECAT-PLAY-SETUP.md`](../../specs/milestones/ANDROID-LAUNCH/REVENUECAT-PLAY-SETUP.md).

### Push Notifications

- Not yet wired in the new foundation
- Dependencies needed: `expo-notifications`
- Device token registration will go through SST API (not direct Supabase RPC)
- Expo push token service configuration is inherited via the Expo project ID

### EAS Build

- `eas.json` includes `staging` (TestFlight), `play-testing` (production Android
  package against staging services) and `production` (both stores).
- Mobile workflows build and submit each selected platform independently;
  Android submissions are created as drafts until Play verification is complete.
- Full setup walkthrough: [`docs/mobile-release-pipeline.md`](../../docs/mobile-release-pipeline.md).

---

## Asset Placeholders

The following assets from the old app need to be copied or recreated:

- `assets/icons/ios.png` — iOS app icon
- `assets/icons/adaptive-icon.png` — Android adaptive icon
- `assets/icons/splash-icon-light.png` — Light splash screen
- `assets/icons/splash-icon-dark.png` — Dark splash screen

---

## SST API Alignment

The API client (`src/api/client.ts`) targets these SST endpoints:

| Endpoint                           | Method                   | Status            |
| ---------------------------------- | ------------------------ | ----------------- |
| `/health`                          | GET                      | Exists in backend |
| `/profile`                         | GET, PATCH               | Exists in backend |
| `/workouts`                        | GET, POST, PATCH, DELETE | Exists in backend |
| `/sessions`                        | GET, POST, PATCH, DELETE | Exists in backend |
| `/exercises`                       | GET                      | Exists in backend |
| `/sessions/:id/exercises/:id/sets` | POST, PATCH, DELETE      | Exists in backend |
| `/goals`                           | GET, POST, PATCH, DELETE | Exists in backend |

All endpoints verified against `microservices/core/src/api.ts`.
