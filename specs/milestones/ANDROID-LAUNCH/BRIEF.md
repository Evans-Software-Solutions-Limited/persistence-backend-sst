# Android Launch Readiness — Audit & Plan

**Written 2026-08-07** against `main` @ `15658da`. Audit of `packages/mobile`,
`eas.json`, the two mobile workflows and the backend purchase rail, for a Google
Play submission running alongside the open iOS release.

> **Verdict: not submittable today.** Four hard blockers, all in `packages/mobile`
> config + two small code paths. **The backend needs approximately zero work** — the
> RevenueCat rail is already store-agnostic. The bulk of the remaining effort is
> Brad's Play Console / RevenueCat dashboard setup, which has never been started.

> ⚠ **Scope note.** This is an audit + plan. **No code has been changed.** Every
> item below is unbuilt.

---

## 0. What is already true — do not redo

Genuinely more than expected. The port was written platform-neutral in most places.

| Area | State | Evidence |
| --- | --- | --- |
| **Backend purchase rail** | **Store-agnostic already.** Entitlements are keyed on RevenueCat `lookup_key` (≡ our `tier_name`); `store` is carried as a passthrough `string \| null`, never branched on. A Play purchase flows through the identical webhook + sync path. | `microservices/core/src/application/revenuecat/entitlements.ts:77,91,148`, `revenueCatClient.ts:121` |
| **Shared catalog** | `packages/subscription-catalog` has no platform coupling. | `src/index.ts` |
| **Subscription legal copy** | Already Android-aware — renders "Google Play account" / "Google Play subscription settings" on Android. Written deliberately for a future Play submission. | `SubscriptionLegalFooter.tsx:69-71` |
| **Notification channel** | Android 8+ `default` channel is created at root layout, idempotent. | `app/_layout.tsx:267` |
| **Push registration** | Already reports `platform: "android"`; `devices.platform` is free-text, no enum to widen. | `usePushNotifications.tsx:38`, `schema.ts:1756` |
| **Fonts** | Per-weight Geist faces loaded explicitly — the correct Android pattern (Android does not synthesise weights from a single face). | `useAppFonts.ts` |
| **Shadows** | 28 of 32 shadow-using components already pair `elevation`. | see § 5 for the 4 that don't |
| **Icons** | Adaptive icon + monochrome + `edgeToEdgeEnabled: true` all declared. | `app.json` |
| **EAS build** | Both profiles already set `android.buildType: "app-bundle"` and a resource class. | `eas.json` |
| **Workflows** | Both mobile workflows already accept `platform: android` as a dispatch input. | `.github/workflows/mobile-build-*.yml` |
| **Variants** | `app.config.ts` already sets a per-variant `android.package`, so staging/dev install side-by-side. | `app.config.ts` |

---

## 1. Hard blockers — Play will reject, or the upload won't be accepted

### B1 · `targetSdkVersion: 34` is below Play's floor 🔴

`app.json` → `expo-build-properties` pins `compileSdkVersion: 35`,
**`targetSdkVersion: 34`**, `buildToolsVersion: "35.0.0"`.

Google Play has required **API 35** for new apps and updates since 31 Aug 2025, and
the floor moves to **API 36 on 31 Aug 2026 — three weeks out.** An AAB targeting 34
is rejected by the Play Console at upload time, before review.

**Fix:** raise to `compileSdkVersion: 36` / `targetSdkVersion: 36` /
`buildToolsVersion: "36.0.0"`. Do not aim at 35 — it buys three weeks.

⚠ **This is not a one-line change in effect.** `edgeToEdgeEnabled: true` is already
set (the main API-35 migration requirement, so that half is done), but at API 36
edge-to-edge stops being opt-out-able and the 16 KB page-size requirement applies to
native libs. Expo SDK 55 / RN 0.83 handles the latter; the former needs the
full-screen visual pass in § 5. **Budget a device pass, not a config edit.**

### B2 · There is no Android purchase rail, and the fallback copy violates Play policy 🔴

Two hard gates, then a policy problem:

1. `createPurchasesAdapter()` returns `undefined` unless `Platform.OS === "ios"`
   (`providers.tsx:71`).
2. `RevenueCatPurchasesAdapter.configure()` hard-returns on non-iOS
   (`revenuecat.adapter.ts:60`).
3. There is **no `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`** in either `eas.json` profile —
   only `EXPO_PUBLIC_REVENUECAT_IOS_KEY`, and it's read unconditionally at
   `providers.tsx:75`.

So Android falls through to `SubscriptionCatalogueContainer`, and tapping any tier
fires:

> **"Not available on this device"** — "Subscriptions are purchased through the App
> Store in the iOS app. Open Persistence on your iPhone or iPad to subscribe."
> — `SubscriptionSelectionContainer.tsx:222-224`

**That copy cannot ship.** Steering users to complete a purchase through another
channel is a direct Google Play **Payments policy** breach — it's the exact mirror of
the anti-steering rule Apple applies. It has to become either a real Play Billing
purchase (recommended) or an honest "not available on Android yet" with **no**
alternative channel named.

⚠ **And this now bites harder than when it was written.** #362 set `is_active = true`
on all six tiers. An Android build off current `main` renders a live six-tier paywall
that cannot transact — structurally the same failure as the open iOS **2.1(b)**
rejection, on the other store.

### B3 · Health Connect permissions are declared with zero implementation 🔴

`app.json` declares **14** `android.permission.health.*` permissions (steps, distance,
BMR, active calories, exercise, weight, body fat — read + write).

Against that: `react-native-health-connect` is **not a dependency**, and
`createHealthAdapter()` returns `AndroidStubHealthAdapter` on Android — which answers
`isAvailable: false`, `denied` to every permission, and `unavailable` to every read
(`src/adapters/health/android-stub.adapter.ts`). Health Connect was explicitly
"deferred past M1" and never picked up.

Play gates `android.permission.health.*` behind a **Health Connect declaration form**
that is only approved for apps that demonstrably use the data. Declaring them against
a stub is a rejection, and it also drags the app into the more onerous Health data
policy review.

**Two ways out:**
- **(a) Strip the permissions for v1 — recommended.** The stub already renders honest
  "not available on Android yet" states (`StepsTodayTile.tsx:18`), so nothing breaks.
  Fastest path to a first submission. Costs nothing on iOS — HealthKit is configured
  separately via `ios.entitlements`.
- **(b) Build the Health Connect adapter** behind `HealthPort` and file the
  declaration form. Real scope; the port abstraction is already in place so it's a
  clean adapter swap, but the form has a review turnaround measured in days.

### B4 · The Terms of Use link points at Apple's EULA 🟠

`TERMS_OF_USE_URL = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/"`
(`src/domain/models/legal.ts:25`), and `SubscriptionLegalFooter` renders it on
**both** rails — so a Play user tapping "Terms of Use (EULA)" at the point of
purchase gets Apple's standard licence agreement.

Wrong on the facts, and Play requires the terms governing the purchase to be the
ones that actually apply.

**Fix is small:** `SERVICE_TERMS_URL` (`https://…/terms`) already exists in the same
file. Make `TERMS_OF_USE_URL` platform-aware — Apple's stdeula on iOS, our own
`/terms` on Android — and update the docstring, which currently states the Apple URL
as an invariant.

---

## 2. Product-ID naming — get this wrong and it grants the wrong tier silently ⚠

`tierFromProductId` is an **order-sensitive substring ladder** and
`billingCycleFromProductId` decides yearly-vs-monthly by looking for the substrings
`annual` or `year` (`src/domain/services/purchaseOfferings.ts:41-79`). Both are
platform-neutral and will work for Play — **but only under a naming constraint that
nobody has written down yet.**

On Play, RevenueCat returns `productIdentifier` as **`<productId>:<basePlanId>`**, not
the bare product id it returns on iOS.

**Therefore, when creating the Play products:**
- Product ids must mirror iOS byte-for-byte: `app.persistence.premium`,
  `app.persistence.premium_plus`, `app.persistence.trainer.individual`,
  `app.persistence.start_up_coach_plus`, `app.persistence.coach`,
  `app.persistence.coach_pro`.
- Base plans **must be named `monthly` and `annual`**.

⚠ **If a base plan is named `p1y` (Play's default suggestion), `billingCycleFromProductId`
finds neither `annual` nor `year` and silently returns `monthly`** — an annual
purchase recorded as a monthly one, with no error anywhere. This is the same class as
the M19-P0 premium/premium_plus misclassification called out in that file's own
docstring.

---

## 3. Pipeline & store setup — no code, but nothing ships without it

All Brad's. **None of it has been started.**

| # | Item | Notes |
| --- | --- | --- |
| 3.1 | **Google Play Console app** | Doesn't exist. Package `com.bradleyevans96.persistence` is unclaimed on Play. |
| 3.2 | **Android signing** | `eas credentials` has never generated a keystore. `docs/mobile-release-pipeline.md:148` says so: *"Android build is wired but unsigned."* |
| 3.3 | **`submit.*.android` in `eas.json`** | Absent — both `submit` blocks are iOS-only. Needs a Play service-account JSON + `track`. |
| 3.4 | **Android submit step in workflows** | Both `eas submit` steps are hardcoded `--platform ios`, and their `if:` conditions gate on `platform == 'ios' \|\| 'all'`. An `android`/`all` dispatch **builds but never submits, silently.** |
| 3.5 | **FCM V1 service account → EAS** | Not uploaded. Push is silently dead on Android until it is — `getExpoPushTokenAsync` will fail and the registration path swallows it as a `console.warn` by design (`usePushNotifications.tsx`, AC 4.5). |
| 3.6 | **Play Data Safety form** | The Android analogue of the iOS privacy manifest. **`app.config.ts`'s `IOS_PRIVACY_MANIFESTS` is a ready-made source** — the 11 collected data types map almost 1:1 onto the Data Safety categories. Don't re-derive it. |
| 3.7 | **Web account-deletion URL** | Play requires a **web-accessible** deletion route *in addition to* the in-app flow. The in-app flow exists (Guideline 5.1.1(v) work, `useDeleteAccountFlow.ts`); the public web page does not. Needs a route on the marketing site. |
| 3.8 | **RevenueCat Android app** | New app in the RC project, Play Billing credentials, the six products attached to the **same `default` offering** the iOS rail reads (`revenuecat.adapter.ts:44`). |
| 3.9 | **Store listing assets** | `assets/icons/` has iOS + adaptive icons only. Play needs a **1024×500 feature graphic**, phone screenshots, and — since `supportsTablet: true` — 7" and 10" tablet screenshots. |

---

## 4. Android UI review — what I could check, and what I could not

⚠ **I could not run the app.** This container has no Android SDK (`ANDROID_HOME`
unset, no `adb`/`emulator`), and the mobile package's dependencies did not finish
installing, so I could not run the jest-expo Android preset either. **Everything in
this section is static analysis. None of it is device-verified, and the list is not
exhaustive** — an emulator pass will find more.

### Found statically

**4.1 · Four components have iOS shadows with no Android `elevation`** — they render
flat on Android while their 28 siblings don't, so this is an oversight, not a
deliberate pattern:
- `src/ui/components/foundation/TabBar.tsx`
- `src/ui/components/composite/WorkoutCarouselCard.tsx`
- `src/ui/components/composite/RingLegend.tsx`
- `src/ui/presenters/ActiveWorkoutBarPresenter.tsx`

**4.2 · Zero `BackHandler` usage anywhere in `src/` or `app/`.** Android hardware and
gesture back is entirely default expo-router behaviour. Needs an explicit pass on the
screens where back should be trapped or should confirm: the active session, the
gorhom bottom sheets, the Mealprint wizard, and any modal with unsaved state. On iOS
there is no equivalent affordance, so this has never been exercised.

**4.3 · No `intentFilters` in `app.json` → no Android App Links.** The custom scheme
(`persistencemobile`) works, but `https://` links won't open the app the way
`associatedDomains` does on iOS. **Check the Supabase password-reset flow first** — if
it emits an `https://` link, reset is broken on Android.

**4.4 · The notification icon will render as a white blob.** `expo-notifications` is
configured with `icon: "./assets/icons/adaptive-icon.png"` — a full-colour asset.
Android draws notification icons as a **silhouette from the alpha channel**, so a
full-colour source becomes a solid white square. The same asset is also passed as
`android.adaptiveIcon.monochromeImage`, which has the same problem for themed
launcher icons. **Needs a dedicated monochrome/alpha asset.**

**4.5 · 14 `KeyboardAvoidingView` call sites pass `behavior={undefined}` on Android.**
That's the conventional correct choice under `adjustResize` — but combined with
`edgeToEdgeEnabled: true` it commonly under-shoots and leaves the focused input
behind the keyboard. **This is the most likely visible defect class on Android and
only a device can settle it.** Note STATE.md already records the Mealprint wizard's
`KeyboardAvoidingView` as **unverified even on iOS** (the simulator had a hardware
keyboard attached) — so that screen is unproven on both platforms.

---

## 5. The plan

Ordered. Phase B is deliberately **iOS-safe** — every change is either Android-only
config or platform-conditional — so it can land while the iOS release is still in
review.

### Phase A · Decisions (Brad, blocking)

- [ ] **A1. Does v1 Android ship a purchase rail, or launch read-only?**
  *Recommend: ship Play Billing.* Read-only means an install base that can't convert,
  and the "not available" screen still has to be rewritten either way (B2) — so
  read-only saves the RC/Play setup only, not the code.
- [ ] **A2. Health Connect — strip (§ B3a) or build (§ B3b)?** *Recommend strip for
  v1.* The declaration-form turnaround is the schedule risk, not the adapter.
- [ ] **A3. When?** *Recommend: start Phase B + C now, submit only after iOS is
  approved.* iOS has an **open third rejection** (2.1(a) coach code, 2.1(b) RC
  offering — see STATE.md). Adding a second store's config to a launch with an
  unresolved rejection multiplies the ways it goes wrong, and B2's fix depends on the
  same RevenueCat `default` offering that 2.1(b) is already blocked on.

### Phase B · Code — one PR, Android-only surface

- [ ] **B1.** `expo-build-properties` → `compileSdkVersion: 36`, `targetSdkVersion: 36`,
      `buildToolsVersion: "36.0.0"`.
- [ ] **B2.** Per A2 — remove the 14 `android.permissions` health entries, **or** add
      `react-native-health-connect` + a `HealthConnectAdapter` behind `HealthPort`.
- [ ] **B3.** `TERMS_OF_USE_URL` → platform-aware (`SERVICE_TERMS_URL` on Android).
      Update the docstring, which asserts the Apple URL as invariant.
- [ ] **B4.** Per A1 — either wire the Android rail (`EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`
      in both `eas.json` profiles; drop the two `Platform.OS !== "ios"` guards at
      `providers.tsx:71` and `revenuecat.adapter.ts:60`; select the key by platform at
      `providers.tsx:75`), **or** rewrite the `handleTierSelect` alert copy at
      `SubscriptionSelectionContainer.tsx:222-224` to name **no** alternative channel.
- [ ] **B5.** Add `elevation` to the four components in § 4.1.
- [ ] **B6.** Dedicated monochrome notification/launcher icon asset (§ 4.4).
- [ ] **B7.** `intentFilters` for App Links + the `assetlinks.json` on the marketing
      site — **after** confirming what the Supabase reset flow emits (§ 4.3).
- [ ] **B8.** Android back-handling pass (§ 4.2).
- [ ] Gates: `bun run prettier:check` · `typecheck` · **`expo lint` from
      `packages/mobile`** (STATE.md: CI has caught a mobile lint error that the scoped
      root lint missed) · `bun run test:unit` (90 % threshold) · `bun run build`.

### Phase C · Store + dashboard setup (Brad, parallel with B)

- [ ] **C1.** Create the Play Console app; claim `com.bradleyevans96.persistence`.
- [ ] **C2.** `eas credentials` → generate + back up the Android keystore. **Losing
      this means never updating the listing again.**
- [ ] **C3.** Create the six subscriptions + base plans — **naming per § 2**.
- [ ] **C4.** RevenueCat: Android app, Play Billing credentials, six products attached
      to the **`default`** offering.
- [ ] **C5.** Play service-account JSON → EAS; add `submit.staging.android` +
      `submit.production.android` to `eas.json`.
- [ ] **C6.** FCM V1 service account JSON → EAS (§ 3.5).
- [ ] **C7.** Data Safety form, sourced from `app.config.ts`'s privacy manifest (§ 3.6).
- [ ] **C8.** Web account-deletion page + declare the URL (§ 3.7).
- [ ] **C9.** Store listing assets (§ 3.9).

### Phase D · Pipeline

- [ ] **D1.** Add an Android submit step to both mobile workflows, gated on
      `platform == 'android' || 'all'`. Today an `android` dispatch **builds and
      silently never submits** (§ 3.4).
- [ ] **D2.** First internal-testing-track build off the `staging` profile.

### Phase E · Device QA (needs a real Android device — an emulator will not settle 4.5)

- [ ] **E1.** Cold start, sign-up, sign-in. ⚠ Apple Sign In is iOS-gated
      (`SignInContainer.tsx:42`) — **Android has email/password only.** Confirm that's
      acceptable, or add Google Sign-In.
- [ ] **E2.** Purchase a tier end-to-end; confirm the webhook lands the right
      `tier_name` **and the right billing cycle** (§ 2 is the trap).
- [ ] **E3.** Every `KeyboardAvoidingView` screen with the software keyboard (§ 4.5) —
      the Mealprint wizard first, it's unproven on both platforms.
- [ ] **E4.** Edge-to-edge pass at API 36: status/nav bar insets on every full-screen
      surface, bottom sheets, the tab bar.
- [ ] **E5.** Hardware + gesture back on every modal and the active session (§ 4.2).
- [ ] **E6.** Push notification receive + tap deep-link.
- [ ] **E7.** Health tiles render the honest "not available" state without crashing.
- [ ] **E8.** Offline → online sync (SQLite queue) — same paths as iOS, unexercised on
      Android.

### Phase F · Submit

- [ ] **F1.** Internal testing → closed → production, per Play's staged rollout.
- [ ] **F2.** ⚠ **Do not submit while the six tiers are `is_active = true` and the Play
      products aren't live** — that reproduces the iOS 2.1(b) failure on Play.

---

## 6. Honest summary of effort

| Phase | Who | Rough size |
| --- | --- | --- |
| A — decisions | Brad | an hour |
| B — code | agent, one PR | ~1 day if A2 = strip; +several days if A2 = build Health Connect |
| C — store setup | Brad | 1–2 days spread over Play/RC review turnarounds |
| D — pipeline | agent | ~2 hours |
| E — device QA | Brad + agent | 1–2 days, **needs a physical Android device** |
| F — submit | Brad | Play review is typically faster than Apple's |

**The critical path is C, not B** — Play Console review of the app listing, and (if A2
= build) the Health Connect declaration form, are the long poles. Start C the day A is
decided.

**The single most schedule-relevant fact:** `targetSdkVersion` must be **36** by
31 Aug 2026. Shipping to 35 now means redoing the native pass within weeks.
