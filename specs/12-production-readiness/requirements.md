# 12 — Production Readiness: Requirements

> **Spec rewritten from scratch on 2026-05-28** to absorb (a) the polish-phase work from the May 2026 design package and (b) App Store + production readiness items previously scoped under M11 + the never-created `14-app-store-readiness/` ledger reference. Prior version preserved in git history.

---

## Overview

The final ship-readiness phase. Six pillars:

1. **Design system retirement** — delete the four `*LegacyTheme` files left behind by `01-design-system` Phase 5 cleanup.
2. **Accessibility audit** — VoiceOver / TalkBack walk-through across every screen; touch-target verification; reduced-motion behaviour.
3. **Performance audit** — FlashList where lists exceed 20 items, `expo-image` adoption, animation budgets, lazy loading, memoisation.
4. **Observability** — Sentry wired with source maps; logging discipline; error boundaries on every screen.
5. **Release infrastructure** — EAS build profiles, app metadata, screenshots, App Store + Play Store submission readiness.
6. **App Store IAP compliance** — final review of Stripe ↔ App Store IAP boundary (paid premium / subscription via Apple's IAP per App Store guideline §3.1.1 for digital goods inside iOS).

This spec is the **terminal** milestone — everything else lands first.

Authoritative references:

1. `~/Downloads/handoff/CLAUDE_CODE_MIGRATION_PLAN.md` § Phase 5 — Polish, a11y, cleanup
2. `specs/01-design-system/requirements.md` STORY-005 AC 5.3 (legacy theme deletion deferred here)
3. `specs/_agent.md § UI/UX Design Quality` (60fps scroll, skeleton loaders, optimistic UI, dark-mode intent)
4. App Store Review Guidelines (current at submission time)
5. Google Play developer policies (current)

---

## Locked decisions

| #   | Decision                   | Locked value                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Theme files to retire      | `homeLegacyTheme`, `workoutsLegacyTheme`, `subscriptionLegacyTheme`, `profileLegacyTheme`. Codemodded to token references in Phase 1; file deletion happens here.                                                                                                                                                                                                                                                        |
| 2   | List perf threshold        | Lists with ≥ 20 rows use `@shopify/flash-list`. Smaller lists stay on `FlatList`.                                                                                                                                                                                                                                                                                                                                        |
| 3   | Image library              | `expo-image` everywhere user-uploaded photos render (avatars, exercise photos, recipe photos). Native `<Image>` only for static assets.                                                                                                                                                                                                                                                                                  |
| 4   | Reduced motion             | Every animation respects `useReducedMotion()`. Ring fills jump to final state. Bottom sheets snap instead of slide. Pulse animations stop.                                                                                                                                                                                                                                                                               |
| 5   | Sentry                     | `@sentry/react-native` for mobile, `@sentry/aws-serverless` for SST Lambda (v8 successor to `@sentry/serverless`; built on `@sentry/node`; exposes `Sentry.wrapHandler` for AWS Lambda). Source maps uploaded on every EAS build via the `@sentry/react-native/expo` config plugin (NOT the deprecated Classic-Expo `postPublish` hook). PII scrubbed at ingest (no user emails or trainer client names in breadcrumbs). |
| 6   | EAS build profiles         | `development` (Expo Go), `preview` (internal QA / TestFlight), `production` (App Store / Play Store). Each profile has its own env binding.                                                                                                                                                                                                                                                                              |
| 7   | IAP boundary               | iOS App Store version uses Apple IAP via `react-native-iap` for subscription purchase. Stripe flow shipped in M10 is preserved for web + sideloaded Android. Receipts validated server-side; entitlement granted on receipt verify. App Store guideline §3.1.1 compliance audited before submission.                                                                                                                     |
| 8   | App metadata               | Screenshots for all required device sizes (iPhone 6.7" / 6.5" / 5.5", iPad 12.9"). Marketing copy + privacy policy URL (lives at `(app)/profile/terms` route, exposed via static export for App Store policy URL field).                                                                                                                                                                                                 |
| 9   | Light theme                | OUT of scope for v1 launch. Dark-only ship per `01-design-system` locked decision #6. Light theme is a v2 spec.                                                                                                                                                                                                                                                                                                          |
| 10  | Production-readiness gates | A PR cannot merge to `main` in the M11+ window without (a) `bun run typecheck && bun run lint && bun run build && bun run test:unit && bun --filter @persistence/web test:unit` clean, (b) 90% coverage on changed files, (c) screenshot pair on visual PRs, (d) Sentry test event from the staging build.                                                                                                               |

---

## User stories

### STORY-001: As a user, I want the app's visual style to be consistent — no legacy theme remnants

**Acceptance Criteria:**

- 1.1 [ ] Files deleted: `packages/mobile/src/ui/theme/legacy/homeLegacyTheme.ts`, `workoutsLegacyTheme.ts`, `subscriptionLegacyTheme.ts`, `profileLegacyTheme.ts`. Implements locked decision #1.
- 1.2 [ ] All import references to the deleted files removed (compile error reveals any leftover). Per-file allow-list removed from the `no-raw-hex-colors` ESLint rule.
- 1.3 [ ] Visual review confirms every screen still renders correctly post-deletion. Screenshots before vs after per touched screen.

### STORY-002: As a user with a screen reader, I want every interactive element labelled and every screen navigable

**Acceptance Criteria:**

- 2.1 [ ] Manual VoiceOver walk-through (iOS) + TalkBack walk-through (Android) covers every screen in the app: Home, Train, Fuel, You, ProfileDrawer, all sub-pages, Active session, Sub-sheets (Scan, Snap, Quick add, Targets, Add client, etc.).
- 2.2 [ ] Every pressable has an `accessibilityLabel`. Where context-dependent (e.g. set-row reps input mid-session), the label includes context: "Reps for set 2, Bench Press".
- 2.3 [ ] Tab bar announces `mode` + label per tab: "Athlete mode, Home tab, 1 of 4" / "Coach mode, Clients tab, 2 of 4, badge 3 needs attention".
- 2.4 [ ] Forms (Edit profile, Targets, Create exercise, etc.) announce field labels + validation errors.
- 2.5 [ ] Dynamic content (timer in active session, ring fill animations) does NOT spam VoiceOver — set to `accessibilityLiveRegion="none"` except where the live update is critical (rest timer countdown completion).
- 2.6 [ ] Touch-target audit: every interactive element measures ≥ 44pt (or 36pt in confirmed dense-row contexts per `01-design-system` locked decision #5).

### STORY-003: As a user with motion sensitivity, I want animations to respect the OS reduce-motion setting

**Acceptance Criteria:**

- 3.1 [ ] `<Ring>` + `<MultiRing>` skip the 800ms fill animation when `useReducedMotion()` is true (final state rendered instantly).
- 3.2 [ ] `<Bar>` width transition skipped under reduced motion.
- 3.3 [ ] `<BottomSheet>` switches from slide animation to snap (instant) under reduced motion.
- 3.4 [ ] `<ActiveWorkoutBar>` pulsing dot stops pulsing under reduced motion.
- 3.5 [ ] Tab bar accent crossfade (cyan ↔ violet on mode switch) skips the 200ms `withTiming`.
- 3.6 [ ] Reanimated's `useReducedMotion()` checked once at component mount; effects react to the value via `useEffect` if it changes mid-session.

### STORY-004: As a user on a list with 100+ entries, scrolling stays smooth

**Acceptance Criteria:**

- 4.1 [ ] Lists ≥ 20 rows use `<FlashList>` with `estimatedItemSize` set. Per locked decision #2.
- 4.2 [ ] Verified surfaces: Exercises list (potentially 100+), Notifications list, Trainer Clients list, Recipes/Meals lists, PR history.
- 4.3 [ ] Each list ships with a memoised row component. Heavy composites (`<ClientRow>`, `<ExerciseCard>`, `<PRCard>`, `<NotificationRow>`) wrapped in `React.memo`.
- 4.4 [ ] 60fps scroll verified on iPhone 8 simulator + Pixel 5 emulator (lowest-spec test devices).

### STORY-005: As a user, images load quickly without jank

**Acceptance Criteria:**

- 5.1 [ ] `expo-image` adopted everywhere user-uploaded photos render. Native `<Image>` only for bundled static assets.
- 5.2 [ ] Blur-up placeholders + `priority="low"` for off-screen images.
- 5.3 [ ] Recipe / exercise / meal photo uploads compressed client-side before upload (target ≤ 800KB).

### STORY-006: As a developer, I want errors and exceptions surfaced in Sentry

**Acceptance Criteria:**

- 6.1 [ ] `@sentry/react-native` initialised at app launch (before any other code). DSN configured per EAS profile.
- 6.2 [ ] `@sentry/node` initialised in every SST Lambda handler.
- 6.3 [ ] Source maps uploaded on every EAS build via the Sentry CLI step.
- 6.4 [ ] Every screen wrapped in an error boundary that reports to Sentry + renders a "Something went wrong" fallback with a Reload Btn.
- 6.5 [ ] PII scrubbing: no user emails, no trainer client names, no Session.id in breadcrumbs or fingerprints. `beforeSend` hook redacts.
- 6.6 [ ] Test event verified in Sentry dashboard from each EAS profile (development / preview / production).

### STORY-007: As a developer, I want a clean EAS build pipeline

**Acceptance Criteria:**

- 7.1 [ ] `eas.json` profiles per locked decision #6: development / preview / production. Each profile bound to: Expo channel, env file, Sentry DSN, App Store track (preview → TestFlight, production → App Store).
- 7.2 [ ] CI step builds the `preview` profile on every PR merge to `main` and posts the build URL to Slack `#brad-claude-agents`.
- [ ] **7.3** Production build runs locally via `eas build --profile production` after a tagged release.
- 7.4 [ ] EAS Submit configured for both stores. iOS submission requires App Store Connect API key; Android requires Play Console JSON key.

### STORY-008: As a user buying premium on iOS, I want to pay through Apple IAP per App Store policy

**Acceptance Criteria:**

- 8.1 [ ] Subscription purchase flow on iOS routes through `react-native-iap` against Apple IAP. Stripe Mobile flow is **disabled on iOS** at runtime.
- 8.2 [ ] Server-side receipt verification: iOS app sends receipt to `POST /subscriptions/ios-receipt`; backend verifies with Apple, grants entitlement.
- 8.3 [ ] Web + Android (sideload) preserve the Stripe flow shipped in M10.
- 8.4 [ ] Subscription management on iOS shows "Manage in App Store" CTA instead of Stripe Customer Portal.
- 8.5 [ ] Restore Purchases CTA on iOS calls `react-native-iap.getAvailablePurchases()` + restores entitlement.
- 8.6 [ ] Compliance review: every paywall language reviewed against App Store Guideline §3.1.1 (no "click here to subscribe at our website" copy on iOS).

### STORY-009: As a developer, I want App Store + Play Store assets ready for submission

**Acceptance Criteria:**

- 9.1 [ ] Screenshots for all required device sizes: iPhone 6.7" / 6.5" / 5.5", iPad 12.9". Optional Android sizes.
- 9.2 [ ] App icon at all required sizes (per `expo-asset` icon set + `app.json`).
- 9.3 [ ] Marketing copy reviewed: short description, long description, keywords, support URL, privacy policy URL.
- 9.4 [ ] Privacy policy URL: static export of `(app)/profile/terms` route to a public web URL (lives in the `web/` package's marketing site or a dedicated static host).
- 9.5 [ ] Age rating questionnaire completed (App Store + Play Store).
- 9.6 [ ] Demo account credentials prepared for App Store review.

### STORY-010: As a developer, I want every merge gated on the full quality bar per locked decision #10

**Acceptance Criteria:**

- 10.1 [ ] CI runs the full gate on every PR: `prettier:check`, `typecheck`, `lint`, `build`, `test:unit` for mobile + core + web.
- 10.2 [ ] CI blocks merge if any check fails or coverage on changed files falls below 90%.
- 10.3 [ ] Visual PRs require before/after screenshots (manual reviewer check, not enforced by CI).
- 10.4 [ ] Pre-launch checklist (e2e smoke test on TestFlight build, no Sentry P1 errors over 7 days, no failed health checks) completed before App Store submission.

---

## Out of scope

- **Light theme** — v2 (locked decision #9).
- **Onboarding redesign** — auth + sign-up flows in `02-auth-flow` are out of scope for the design-port refresh in this milestone. Polish only.
- **Marketing site** — web package's marketing site lives in `apps/web/`. Privacy policy export is owned here; the rest of the marketing site is separate.
- **A/B testing infrastructure** — post-launch.
- **Localisation** — English-only for v1.

---

## Dependencies and what this spec unlocks

**Depends on:**

| Spec                                   | What's consumed                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| `01-design-system`                     | Locked decision #8 — `*LegacyTheme` files queued for deletion HERE.                    |
| All `04`/`05`/`06`/`08`/`10`/`13`/`14` | Every surface must be polished here; depends on each having shipped its content first. |
| `09-notifications-social`              | Sentry breadcrumb scrubbing rules cover notification payloads.                         |
| `11-payments-subscriptions`            | Stripe paywall preserved for web/Android; iOS replaces with Apple IAP.                 |

**Unlocks:**

| Outcome                  | Description                                                                 |
| ------------------------ | --------------------------------------------------------------------------- |
| **App Store submission** | All assets + IAP compliance + Sentry observability + accessibility baseline |
| **v1 launch**            | The final ship-readiness gate                                               |

---

## Open questions

None. All 10 decisions locked. App Store guideline changes between now and submission may require revisits — handled as `Revised YYYY-MM-DD:` appends.

---

_End of `12-production-readiness/requirements.md` · 2026-05-28 (rewritten from scratch)_
