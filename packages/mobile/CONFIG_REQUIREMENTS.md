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

| Variable                             | Purpose                          | Status                                                    |
| ------------------------------------ | -------------------------------- | --------------------------------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`           | Supabase project URL (auth only) | **Bradley to provide**                                    |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY`      | Supabase anon key (auth only)    | **Bradley to provide**                                    |
| `EXPO_PUBLIC_API_URL`                | SST API base URL                 | **Bradley to provide** (from `sst dev` or deployed stage) |
| `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key           | **Bradley to provide** (when payments are wired)          |

---

## Integrations — Not Yet Wired (intentionally deferred)

### HealthKit / Health Connect

- iOS entitlements and Info.plist descriptions are **preserved** in app.json
- Android Health Connect permissions are **preserved** in app.json
- The actual health data hooks need to be migrated from the old app when
  the health feature is built on the new foundation
- Dependencies needed: `@kingstinct/react-native-healthkit`, `react-native-health-connect`, `expo-health-connect`

### Stripe / Apple Pay

- Apple Pay merchant ID preserved: `merchant.com.bradleyevans96.persistence`
- Stripe plugin config is **not yet added** to app.json plugins (add when payments feature is built)
- Dependencies needed: `@stripe/stripe-react-native`

### Push Notifications

- Not yet wired in the new foundation
- Dependencies needed: `expo-notifications`
- Device token registration will go through SST API (not direct Supabase RPC)
- Expo push token service configuration is inherited via the Expo project ID

### EAS Build

- No `eas.json` in the new package yet
- When ready, copy build profiles from old app:
  - `development`: internal distribution, dev client
  - `preview`: store distribution for staging
  - `production`: store distribution

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
