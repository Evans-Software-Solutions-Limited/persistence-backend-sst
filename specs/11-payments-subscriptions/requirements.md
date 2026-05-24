# 11 — Payments & Subscriptions: Requirements

## Overview

Subscription management with Stripe. Eight tiers across two role tracks (regular user / personal trainer). Subscription state controls feature access (paywalled features). Subscription state is **server-authoritative** — never guessed offline.

The buy / upgrade / downgrade / cancel flow is custom-built (no Stripe Checkout, no Stripe Customer Portal). Payment-method collection is done in-app via Apple Pay (Stripe's `usePlatformPay`), returning a `payment_method_id` that the backend uses to drive subscription creation directly against the Stripe API. The Stripe webhook handler is the source of truth for eventual sub-state cleanup (cancel-of-old after change-of-tier, rollback on `incomplete_expired`, payment-status flips after 3DS).

This shape was inherited from the legacy `persistence-mobile` app and ratified during the V2 port (see `specs/milestones/M10-subscriptions/` for the milestone-level contract).

## Current state (2026-05-23)

- **Backend webhook + outbound endpoints shipped** in PRs #69 + #70. `POST /subscriptions`, `POST /subscriptions/:id/cancel`, `POST /stripe/webhook` (6 event handlers), reconcile script.
- **Mobile `ApiPort.createSubscription` + `cancelSubscription`** shipped as part of PR #70.
- **Mobile screens not yet ported** — buy / cancel / upgrade / downgrade UI still lives in legacy `persistence-mobile`. M10 ports them against the SST adapter surface.
- **Backend reads not yet shipped** — `GET /subscription-tiers`, `GET /subscriptions/me`. Required for the M10 frontend port.

## Tier model

Eight named tiers across a role toggle. The free tier is the default starting state; never shown as a buyable card.

### User-facing tiers

| `tier_name` | `display_name` | Trial     | Notes                                                   |
| ----------- | -------------- | --------- | ------------------------------------------------------- |
| `free`      | Free           | n/a       | Default starting state. Limited workouts, no AI access. |
| `basic`     | Basic          | none      | Limited monthly workouts, 1 AI workout/month            |
| `premium`   | Premium        | **7-day** | Unlimited workouts, 6 AI workouts/month, Reps Gym Buddy |

### Trainer-facing tiers

Three "sizes" × two levels each = six trainer tiers. All have client slot allowances + analytics + reporting; all Pro variants additionally include AI Buddy and a 14-day trial.

| `tier_name`                   | `display_name`                 | Trial      | Notes                               |
| ----------------------------- | ------------------------------ | ---------- | ----------------------------------- |
| `individual_trainer_standard` | Individual Trainer (Standard)  | none       | Smallest client slot count          |
| `individual_trainer_pro`      | Individual Trainer (Pro)       | **14-day** | + AI Buddy + AI supported reporting |
| `small_business_standard`     | Small Business (Standard)      | none       | Mid client slot count               |
| `small_business_pro`          | Small Business (Pro)           | **14-day** | + AI Buddy + AI supported reporting |
| `medium_enterprise_standard`  | Medium / Enterprise (Standard) | none       | Largest client slot count           |
| `medium_enterprise_pro`       | Medium / Enterprise (Pro)      | **14-day** | + AI Buddy + AI supported reporting |

Tier names + display names + features + Stripe price IDs are stored in the `subscription_tiers` table (see [`packages/db/src/schema.ts:241`](../../packages/db/src/schema.ts)). The mobile app reads this catalog via `GET /subscription-tiers` — no hard-coding.

## User Stories

### STORY-001: As a user, I want to see available subscription tiers

**Acceptance Criteria:**

- [ ] AC 1.1 — Subscription selection screen shows two stacked sets of cards behind a role toggle ("I'm a User" / "I'm a Trainer"); role defaults to current `profile.role` (trainer roles → trainer toggle; else user)
- [ ] AC 1.2 — User toggle: `basic` and `premium` cards stack vertically. `free` is never rendered as a card.
- [ ] AC 1.3 — Trainer toggle: three dual-tier cards (`individual_trainer`, `small_business`, `medium_enterprise`), each showing a `Standard` column and a `Pro` column side-by-side with their respective prices
- [ ] AC 1.4 — Billing cycle toggle (monthly / yearly with "Save 20%" label) at the top of the card list; prices update to reflect the selected cycle; yearly cards show a strikethrough of `price_monthly × 12` next to the actual yearly price when savings exist
- [ ] AC 1.5 — Current-plan badge appears on the card matching the user's `tier_name`; the same card's Subscribe CTA is dimmed (still tappable for re-acquire / reinstate)
- [ ] AC 1.6 — Trial banner ("7-day free trial" or "14-day free trial") appears on the `premium` card and on the `Pro` column of trainer cards when the user is eligible (trial flags unused) and not currently on that tier
- [ ] AC 1.7 — Tier features list per card is derived from `subscription_tiers` columns + `features` JSONB (workout limit / AI access / Gym Buddy / client slots / analytics)
- [ ] AC 1.8 — Loading state shows the Persistence logo loader and "Loading subscription options..."; error state shows the error message + a Retry button that refetches the catalog
- [ ] AC 1.9 — Selection screen is reachable both from the auth flow (post-sign-up) and from inside the app (Profile → Subscription)

### STORY-002: As a user, I want to subscribe to a paid tier

**Acceptance Criteria:**

- [ ] AC 2.1 — Tapping a tier card on the selection screen triggers the embedded `PaymentMethodForm`, which immediately presents the Apple Pay sheet via `@stripe/stripe-react-native`'s `usePlatformPay()` → `createPlatformPayPaymentMethod`
- [ ] AC 2.2 — Apple Pay sheet shows trial breakdown when eligible (free trial period + recurring amount starting on trial-end date) — implemented via `cartItems` with `paymentType: 'Recurring'` and `startDate` set to trial end
- [ ] AC 2.3 — On Apple Pay success → mobile posts `{ tier_name, billing_cycle, payment_method_id, use_trial }` to `POST /subscriptions` and shows a processing overlay
- [ ] AC 2.4 — Backend creates the subscription with the Stripe SDK, attaches the payment method, and returns `{ success, subscription_id, stripe_subscription_id, payment_status, trial_ends_at, next_billing_date, requires_action, client_secret?, change_type, scheduled, effective_at, is_trial, reinstated? }`
- [ ] AC 2.5 — When `requires_action: true` (3DS), mobile uses `client_secret` with the Stripe mobile SDK's `handleNextAction` to complete the challenge; the eventual `customer.subscription.updated` webhook commits the final `payment_status` server-side
- [ ] AC 2.6 — On success (immediate or post-3DS), router pushes to `/(auth)/success` showing the active tier's benefits + a "Go to Home" CTA (trainer tiers additionally see "Manage Clients")
- [ ] AC 2.7 — Apple Pay cancel returns `code: 'Canceled'` from the Stripe SDK; mobile clears the in-flight tier selection silently (no error alert) so the user can re-select
- [ ] AC 2.8 — Apple Pay failure (other than user-cancel) surfaces the Stripe error message in an alert; the user can retry or pick a different tier
- [ ] AC 2.9 — **Android**: Apple Pay is not available; the buy flow shows "Apple Pay is only available on iOS devices. Please use an iPhone or iPad to complete your subscription." Inline state, no fallback. This matches legacy and reflects the App Store IAP-policy constraint Brad has accepted.

### STORY-003: As a user, I want to manage my subscription

**Acceptance Criteria:**

- [ ] AC 3.1 — Two distinct surfaces: (a) the same Subscription Selection screen (used for buy + change + cancel + reinstate, full role-toggle + comparison view), and (b) a smaller Subscription Management screen accessible from Profile (read-only current plan card + simple Upgrade / Downgrade / Cancel buttons; user tiers only)
- [ ] AC 3.2 — Subscription Management shows: current tier display name, payment status badge (Active / Trial / Cancelled), next billing date OR access-ends date (cancelled), trial end date (when trialing), billing cycle, and trainer client slots (trainer tiers only)
- [ ] AC 3.3 — Upgrade button (`basic` → `premium`) is visible only when current tier is `basic` and status is active/trialing; fires a confirmation alert then `POST /subscriptions` with `{ tier_name, billing_cycle }` (no `payment_method_id` — reuses the customer's default payment method on file with Stripe)
- [ ] AC 3.4 — Downgrade button (`premium` → `basic`) fires `POST /subscriptions` with `{ tier_name: 'basic', billing_cycle }` (no `payment_method_id`); backend schedules the change for end-of-period and response carries `change_type: 'downgrade'`, `scheduled: true`, `effective_at`
- [ ] AC 3.5 — Cancel button fires `POST /subscriptions/:id/cancel` with default body (`cancel_immediately` defaults to false → period-end cancel); shows confirmation alert with the access-ends date
- [ ] AC 3.6 — Reinstate path: when the user has a cancelled-but-still-active subscription, the selection screen shows a "Cancelled" indicator with the end date and the message "Click your plan card to reinstate". Tapping the current tier card fires `POST /subscriptions` with the same `tier_name` + `payment_method_id`, the backend's reinstate-path detects `payment_status: 'cancelled'` on the existing Stripe sub and resumes it
- [ ] AC 3.7 — Scheduled-change indicator: when the user has a downgrade scheduled, the selection screen shows "Scheduled: <next_tier_display_name> (effective <effective_at>)" and "<current_tier> active until <current_period_end>" — derived from `metadata.scheduled_change` on the sub row
- [ ] AC 3.8 — Trainer tier upgrades/downgrades route via the selection screen (not Management) because they cross the role boundary
- [ ] AC 3.9 — All write operations invalidate `['user-subscription']` + `['user-profile']` + `['profile-data']` query caches so dependent screens (Home, Profile) refresh

### STORY-004: As a user, I want features gated by my subscription tier — **lands in M10.5**

**Acceptance Criteria:**

- [ ] AC 4.1 — Free tier: basic workout tracking only, limited exercise library
- [ ] AC 4.2 — Basic tier: limited monthly workouts + 1 AI workout/month
- [ ] AC 4.3 — Premium tier: unlimited workouts + 6 AI workouts/month + Reps Gym Buddy access
- [ ] AC 4.4 — Trainer Standard: client management up to slot limit, analytics + reporting
- [ ] AC 4.5 — Trainer Pro: above + AI Buddy + AI-supported reporting
- [ ] AC 4.6 — Paywalled features show upgrade prompt, not hidden; deep-links to Subscription Selection with the target tier pre-selected
- [ ] AC 4.7 — Subscription state checked from server on app launch + on every premium-only mutation (server-side enforcement is the source of truth)
- [ ] AC 4.8 — `useFeatureGate(feature)` hook returns `{ allowed, reason, gateProps }`; consumers render a `<FeatureGatePrompt>` when not allowed
- [ ] AC 4.9 — M10.5 ships the gate primitives (Wave 1) + per-screen integration across exercise library, progress, health, trainer placeholders (Wave 2). Per-screen integration is not yet wired in this milestone where listed; gate primitives + the assertEntitlement backend helper land first.

### STORY-005: As a user, I want subscription state to be reliable

**Acceptance Criteria:**

- [ ] AC 5.1 — Subscription status fetched from `GET /subscriptions/me` on app launch
- [ ] AC 5.2 — Cached for session duration (2-minute stale-time via Tanstack Query); refetched on screen focus
- [ ] AC 5.3 — Offline: last-known state used; subscription screens show an "offline" indicator (M10.5). No client-side grace-window / `validUntil` enforcement — `expiresAt` is trusted as-is and the server enforces entitlement at every premium-only mutation (see STORY-009).
- [ ] AC 5.4 — Subscription state never granted from local cache when the user has no row in `user_subscriptions` — fall back to synthetic `free` shape from `GET /subscriptions/me`
- [ ] AC 5.5 — Trial eligibility carried in the `GET /subscriptions/me` payload (`has_used_user_trial`, `has_used_trainer_trial`, `is_eligible_user`, `is_eligible_trainer`) — single round-trip
- [ ] AC 5.6 — Mutations (`createSubscription`, `cancelSubscription`) invalidate `['user-subscription']`; the next read pulls fresh server state

### STORY-009: As the platform, I want server-side entitlement enforcement on premium-only mutations (M10.5)

**Acceptance Criteria:**

- [ ] AC 9.1 — A reusable `assertEntitlement(userId, feature)` helper exists at the application layer. It reads the user's current sub + tier features + counts and either returns or throws a structured `EntitlementError`.
- [ ] AC 9.2 — `assertEntitlement` returns `EntitlementError` with shape `{ code: "ENTITLEMENT_DENIED", feature, current_tier, upgrade_to, upgrade_price_monthly? }`. Handlers translate to HTTP 402 with the same payload — chosen over 403 because 402 (Payment Required) is the standard semantic for this case.
- [ ] AC 9.3 — `POST /workouts` calls `assertEntitlement(userId, "create_workout")` BEFORE the create; refuses with 402 when the user is at or above their tier's workout limit
- [ ] AC 9.4 — `POST /sessions/record` calls `assertEntitlement(userId, "create_workout")` BEFORE the transaction; refuses with 402 when the resulting session would push the user past their workout limit (sessions that aren't a fresh workout are exempt)
- [ ] AC 9.5 — Feature enum covers: `create_workout`, `ai_workout` (stub for future), `gym_buddy` (stub), `unlimited_exercise_library` (stub), `trainer_clients` (stub). Each stub returns "allowed: true" today; switches on when the consuming feature ships.
- [ ] AC 9.6 — `assertEntitlement` never reads from the JWT alone — always joins live DB state (profiles + user_subscriptions + subscription_tiers + subscription_limits). Defends against the "valid token but cancelled sub" abuse vector.
- [ ] AC 9.7 — Helper is unit-tested with 100% branch coverage. Handler integration tests cover 402-on-limit + 200-when-unlimited + structured-response-shape.

### STORY-010: As a user, I want clear feedback when I tap a premium feature I don't have access to (M10.5)

**Acceptance Criteria:**

- [ ] AC 10.1 — `useFeatureGate(feature)` hook returns `{ allowed: boolean, reason: 'tier' | 'limit' | 'cancelled' | 'unknown', gateProps: FeatureGatePromptProps }`. Pure function of the cached `MySubscription`; no network in the hot path.
- [ ] AC 10.2 — `FeatureGatePrompt` component renders a paywall card: feature description, upgrade-target tier card, price comparison, "Upgrade to …" CTA that routes to `/(auth)/subscription-selection` with the target tier and billing cycle pre-applied
- [ ] AC 10.3 — `SubscriptionBadge` component renders a small tier chip (Free / Basic / Premium / Trainer*) for use in Profile and elsewhere
- [ ] AC 10.4 — Backend 402 responses are intercepted by `SSTApiAdapter` and converted to a domain `ApiError` with `code: 'ENTITLEMENT_DENIED'` + the same payload fields. Containers can call `useFeatureGate` to re-render the gate component without a second round-trip.
- [ ] AC 10.5 — Feature gate primitives ship in Wave 1 of M10.5 — per-screen integration (exercise library, progress, health, trainer placeholders) ships in Wave 2.

### STORY-011: As a user, I want the subscription screens to behave gracefully on flaky / offline networks (M10.5)

**Acceptance Criteria:**

- [ ] AC 11.1 — Both Subscription Selection and Subscription Management show a small "You're offline" banner when `useOnlineStatus()` reports `false`; cached `MySubscription` + tier catalog still render
- [ ] AC 11.2 — When offline, the buy / change / cancel CTAs are visually disabled but tappable; tap surfaces an alert "You need to be online to manage your subscription" rather than mounting Apple Pay against a doomed network call
- [ ] AC 11.3 — `useSubscriptionTiers` and `useMySubscription` surface a "still working…" indicator if the network call hasn't resolved in 8s (slow-network UX); the underlying request continues
- [ ] AC 11.4 — `createSubscription` and `cancelSubscription` mutations check `useOnlineStatus()` pre-flight and refuse with the same alert before invoking the Apple Pay SDK or the API
- [ ] AC 11.5 — 3DS confirmation (`payments.confirm3DS`) also pre-flight checks online status; if the network drops mid-3DS, the user sees a clear "Connection lost during 3DS confirmation — please try again" alert and the local state resets so they can retry

### STORY-006: As a personal trainer, I want trainer-tier subscription with client slots

**Acceptance Criteria:**

- [ ] AC 6.1 — Subscription Selection role toggle auto-defaults to "Trainer" when `profile.role` is `personal_trainer` or `physiotherapist`
- [ ] AC 6.2 — Trainer cards render via `TrainerSubscriptionCard` — dual-column (Standard / Pro), shared feature list above the column split, separate per-column prices and Subscribe CTAs
- [ ] AC 6.3 — Client slot count is shown prominently on each trainer tier card (e.g., "10 client slots")
- [ ] AC 6.4 — `Pro` columns include a "14-day free trial" banner when the user is trainer-trial-eligible and not currently on that Pro tier
- [ ] AC 6.5 — After successful trainer subscription, success screen offers "Manage Clients" CTA (M8 — Trainer Features) alongside "Go to Home"

### STORY-007: As a user, I want trials applied automatically when eligible

**Acceptance Criteria:**

- [ ] AC 7.1 — Trial eligibility derived from `profiles.has_used_user_trial` (Premium 7-day) and `profiles.has_used_trainer_trial` (Trainer Pro 14-day) — flipped to true the first time a trial is used; never resets
- [ ] AC 7.2 — UI auto-decides — no checkbox. When tapping an eligible tier card, the request to `POST /subscriptions` carries `use_trial: true`; otherwise `use_trial: false`
- [ ] AC 7.3 — Apple Pay sheet itemises trial period (free) + recurring amount with `startDate = today + trial_duration_days` so Apple's billing terms show correctly
- [ ] AC 7.4 — Reinstating a cancelled subscription that's still inside its trial period preserves the remaining trial days (backend's reinstate-path handles this; UI passes the remaining days as `trialDuration`)
- [ ] AC 7.5 — Basic tier and Standard trainer tiers never offer trials; no trial banner ever shown for those tiers

### STORY-008: As a user, I want my failed-payment / 3DS flow handled cleanly

**Acceptance Criteria:**

- [ ] AC 8.1 — When backend returns `requires_action: true` with a `client_secret`, mobile invokes `confirm3DS(clientSecret)` via the Stripe SDK to present the 3DS challenge in a webview
- [ ] AC 8.2 — On 3DS success → backend's `customer.subscription.updated` webhook commits `payment_status: 'active'` (or `trialing`); mobile invalidates `['user-subscription']` to pick up the change
- [ ] AC 8.3 — On 3DS user-cancel or failure → mobile shows an alert and reverts to the selection screen; the subscription row stays in `incomplete` and is reaped by Stripe's `incomplete_expired` transition (~23h) → webhook rolls back to the prior tier
- [ ] AC 8.4 — Cross-mode retry after a partial failure (e.g., DB write failed but Stripe sub created) is idempotent: `POST /subscriptions/:id/cancel` mirrors the webhook's `isAlreadyCanceledError` recovery and returns 200 even when Stripe reports the sub already cancelled — applies to both period-end and immediate branches

### STORY-012: As a user, my offline-created premium-only data is handled cleanly when it can't sync (M10.6)

**Acceptance Criteria:**

- [ ] AC 12.1 — When the sync engine receives HTTP 402 with `code: "ENTITLEMENT_DENIED"` on any sync entry, the entry is marked `blocked_entitlement` with the server's verdict captured (`feature`, `currentTier`, `upgradeTo`, `upgradePriceMonthly`, `blockedAt`). The sync engine continues processing the remaining entries in the queue (one blocked entry does not abort the flush).
- [ ] AC 12.2 — Blocked entries persist in storage across app restarts; status is stable until either (a) the user takes an explicit action (retry / discard) or (b) the user's tier changes to one satisfying the verdict's `upgradeTo`.
- [ ] AC 12.3 — On `useMySubscription` reporting a tier change to a satisfying tier, blocked entries automatically flip back to `pending` and a sync flush is triggered. Successful re-sync updates them to `synced`.
- [ ] AC 12.4 — Home tab (or equivalent always-visible surface) shows a banner when one or more entries are blocked: `"⚠ N items couldn't sync — Upgrade to <tier> [Review]"`. Tap Review → `/sync-blocked` screen.
- [ ] AC 12.5 — `/sync-blocked` screen groups blocked entries by upgrade target tier; each group lists the affected items, "Upgrade to <tier> and retry" CTA, "Discard these items" secondary CTA (with confirmation modal). Discard removes the sync entries AND the local cached data they referenced (where no other entry references that data).
- [ ] AC 12.6 — Non-402 errors (5xx, network failures, validation errors) are NOT classified as `blocked_entitlement` — they fall through to the existing `failed` state and retry normally.
- [ ] AC 12.7 — Tier-hierarchy logic: user-tier upgrades (`basic` → `premium`) do not unblock trainer-tier-required entries and vice versa. Tracks are independent.

## Non-functional requirements

- **Payment data**: Card numbers never touch the mobile app or the backend. The Stripe SDK collects them inside the Apple Pay sheet (which uses iOS biometric auth) and returns only a `payment_method_id` (an opaque Stripe handle).
- **Webhook idempotency**: Webhook handler dedups by Stripe `event_id` via `stripe_webhook_events` table — atomic INSERT before dispatch, release-on-failure for retries. Stripe at-least-once delivery is the contract.
- **Trigger-maintained columns**: `profiles.subscription_id`, `profiles.role`, `subscription_limits.*` are maintained by `update_subscription_limits_trigger` ([`supabase/migrations/004_subscriptions_and_roles.sql:438`](../../supabase/migrations/004_subscriptions_and_roles.sql)). Handler code MUST NOT write to those columns — exception: `profiles.has_used_user_trial` / `has_used_trainer_trial` are written explicitly on trial-using paths (append-only).
- **Tier price/feature changes** require a `subscription_tiers` row update + (sometimes) a Stripe-side price update; mobile picks up the new values on next `GET /subscription-tiers` (10-minute stale-time). No mobile release needed for tier metadata changes.
- **App Store compliance**: Apple Pay is the only payment method offered on iOS for digital subscriptions. Android subscription buy flow is intentionally blocked in V2 (matches legacy).
