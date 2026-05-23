# M10 — Smoke Test

End-to-end verification walkthrough for Milestone 10 — Subscriptions & Payments. Run against `bun run dev` (SST backend local — or staging) + the mobile app on a real iOS simulator (Apple Pay is iOS-only). Both PRs must be merged (or a shared milestone branch must include both) before running.

## Setup (one-time per environment)

1. `git checkout feat/m10-integration` (or the shared milestone branch if running pre-merge integration)

2. **Backend** (against local dev OR staging):
   ```
   bun install
   bun run dev   # local — wait for the "Ready!" banner
   ```
   OR test directly against staging at `https://api.staging.persistence.evans-software-solutions.com`.

3. **Stripe test mode**:
   - Confirm `STRIPE_SECRET_KEY` is `sk_test_…` on the target stage
   - Confirm `STRIPE_WEBHOOK_SECRET` is the `whsec_…` issued for the staging webhook endpoint
   - Confirm the Stripe webhook endpoint at `<api-base>/stripe/webhook` is registered against the test-mode account and subscribed to: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.trial_will_end`, `invoice.payment_succeeded`, `invoice.payment_failed`

4. **Stripe price IDs**:
   - Each row in `subscription_tiers` must have a valid `stripe_price_id_monthly` and `stripe_price_id_yearly` matching the test-mode Stripe Products + Prices
   - Confirm via: `SELECT tier_name, stripe_price_id_monthly, stripe_price_id_yearly FROM subscription_tiers WHERE is_active = true`

5. **Database**: ensure the target Postgres (Supabase) has the M0–M9 schema + seeded `subscription_tiers` rows. If empty, run the subscription_tiers seed.

6. **Mobile**:
   ```
   cd packages/mobile
   bun install
   bun run start
   ```
   Open in iOS simulator (NOT Android — buy flow requires Apple Pay).

7. Confirm `.env` has:
   - `EXPO_PUBLIC_API_URL` pointing at the local SST port or staging URL
   - `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` set to `pk_test_…` matching the target Stripe test account

8. **Apple Pay simulator config**:
   - In iOS Simulator → Wallet & Apple Pay → add a test card (cards from the Apple Pay Sandbox documentation; e.g., Visa 4761120000000148)
   - Confirm Apple Pay is supported in the simulator (Settings → Wallet & Apple Pay)

9. **Stripe test cards** for triggering 3DS / failure / success paths:
   - Success (no 3DS): `4242 4242 4242 4242`
   - 3DS-required: `4000 0027 6000 3184`
   - Decline: `4000 0000 0000 0002`
   - These can be added via Apple Pay Sandbox.

## Walkthrough

### Step 1 — First launch + auth flow lands on Subscription Selection

- [ ] Fresh install (clear app data or new simulator)
- [ ] Complete sign-up (legacy flow if M0–M9 don't already route through a sign-up screen; or use a seed user)
- [ ] Post-sign-up router lands on `/(auth)/subscription-selection`
- [ ] Selection screen header reads "Choose your plan"; loading state shows the Persistence logo loader briefly
- [ ] Tier cards render: User toggle shows `basic` + `premium` stacked; Trainer toggle shows three dual-tier (Standard/Pro) cards stacked
- [ ] Network logs: exactly one `GET /subscription-tiers` (public — no Authorization header) and one `GET /subscriptions/me` (authed)

**Validates**: AC 1.1, 1.2, 1.3, 1.9, 5.1, 5.5

### Step 2 — Role toggle + billing cycle toggle

- [ ] Tap "I'm a Trainer" → cards switch to trainer set (3 dual-tier cards)
- [ ] Tap "I'm a User" → cards switch back
- [ ] If user's profile.role is `personal_trainer` or `physiotherapist`, toggle defaults to Trainer on first render
- [ ] Toggle billing cycle from Monthly to Yearly → prices update; yearly cards show strikethrough of `monthlyPrice × 12` next to the actual yearly price
- [ ] Toggle back to Monthly → strikethrough disappears

**Validates**: AC 1.4, 6.1

### Step 3 — Buy a new subscription (premium, with trial)

- [ ] On User toggle, confirm "7-day free trial" banner appears on the `premium` card (trial-eligible user)
- [ ] Tap the `premium` card
- [ ] Apple Pay sheet appears immediately; itemised as:
  - "7-day free trial (starting <today>)" — £0.00 Immediate
  - "£14.99 per month (starting <today + 7d>)" — Recurring with `startDate` 7 days out
- [ ] Confirm Apple Pay with biometric
- [ ] Processing overlay appears ("Processing subscription...")
- [ ] Network logs: `POST /subscriptions` with body `{ tier_name: "premium", billing_cycle: "monthly", payment_method_id: "pm_…", use_trial: true }`
- [ ] Response shape includes `change_type: "new"`, `is_trial: true`, `scheduled: false`, `effective_at: null`, `payment_status: "trialing"`, `trial_ends_at: <ISO 7 days out>`
- [ ] Router pushes to `/(auth)/success`
- [ ] Success screen shows "Subscription Activated!" + benefits list ("Unlimited Workouts")

**Validates**: AC 2.1, 2.2, 2.3, 2.4, 2.6, 7.1, 7.2, 7.3, 8.1 (no 3DS path)

### Step 4 — Verify backend state + webhook fired

- [ ] Postgres: `SELECT id, tier_name, payment_status, trial_ends_at, external_subscription_id FROM user_subscriptions WHERE user_id = '<your-user-id>'` returns one row, `payment_status = 'trialing'`, `trial_ends_at` is 7 days out
- [ ] Postgres: `SELECT subscription_id, role FROM profiles WHERE id = '<your-user-id>'` shows `subscription_id` matches the row above; `role` unchanged (user → user)
- [ ] Postgres: `SELECT event_id, type FROM stripe_webhook_events WHERE type = 'customer.subscription.created' ORDER BY processed_at DESC LIMIT 1` returns the recent event matching this sub
- [ ] Stripe dashboard (test mode) → Customers → your user → Subscriptions → one `trialing` sub

**Validates**: webhook chain end-to-end, trigger maintenance of `profiles.subscription_id`

### Step 5 — Tap "Go to Home" + observe profile/sub state

- [ ] Success screen → tap "Go to Home" → routes to `/(tabs)/home`
- [ ] Home dashboard shows tier-appropriate content (M1 will render this; for M10 just verify the route lands and no errors)
- [ ] Tap Profile tab → Subscription row visible → tap → `/subscription-management` lands

**Validates**: AC 1.9 (Profile entry), navigation wiring

### Step 6 — Subscription Management current-plan card

- [ ] Subscription Management header reads "Subscription Management"
- [ ] Current Plan card shows:
  - tier display name "Premium"
  - "Trial" badge (since payment_status is `trialing`)
  - Trial ends date matching `trial_ends_at`
  - Next billing date (= trial_ends_at for trials)
  - Billing cycle "Monthly"
  - No client-slots row (premium isn't a trainer tier)
- [ ] Downgrade card visible ("Downgrade to Basic"); Upgrade card not visible (already at top user tier)
- [ ] Cancel card visible

**Validates**: AC 3.1, 3.2

### Step 7 — Downgrade (scheduled to period-end)

- [ ] Tap "Downgrade to Basic" → confirmation alert "Your subscription will change at the end of your current billing period. Continue?"
- [ ] Tap Downgrade → network: `POST /subscriptions` with body `{ tier_name: "basic", billing_cycle: "monthly" }` (NO `payment_method_id`)
- [ ] Response includes `change_type: "downgrade"`, `scheduled: true`, `effective_at: <ISO matching current_period_end>`
- [ ] Success alert: "Your subscription will change to Basic on <formatted date>"
- [ ] Subscription Management refreshes (invalidation) — still shows Premium as current plan; could optionally show scheduled-change indicator (legacy doesn't on Management — only on Selection)
- [ ] Open Subscription Selection → scheduled-change indicator visible: "Scheduled: Basic (effective <date>)" + "Premium active until <date>"

**Validates**: AC 3.4, 3.7

### Step 8 — Cancel the scheduled downgrade by re-selecting Premium

(Optional regression check — verify the in-flight marker guard works.)

- [ ] On Selection, tap the Premium card (current plan)
- [ ] Backend should refuse with 409 because `metadata.old_stripe_subscription_id` is set from the scheduled downgrade
- [ ] Mobile shows alert with the error message; selection screen reverts to no-pending state
- [ ] (Alternative: if the legacy UX cancels the scheduled change differently — match legacy. The M10 frontend brief specifies refusal.)

**Validates**: AC 8.4, in-flight marker guard

### Step 9 — Cancel subscription from Selection screen

- [ ] On Subscription Selection, scroll to bottom → "Cancel Subscription" button visible (since canCancel + !isCancelledButActive after waiting out / reverting the scheduled change)
- [ ] Tap Cancel → modal appears: "Cancel Subscription?" with end-date info
- [ ] Tap "Cancel Subscription" → network: `POST /subscriptions/:id/cancel` with empty body (defaults to period-end)
- [ ] Response: `{ success: true, cancelled_at: <ISO>, subscription_ends_at: <current_period_end>, message: ... }`
- [ ] Alert: "Your subscription will remain active until <date>. You'll continue to have access until then."
- [ ] Selection screen invalidates → "Cancelled: Premium" header now shows with "Click your plan card to reinstate" hint
- [ ] Postgres: `user_subscriptions.payment_status = 'cancelled'`, `cancelled_at` populated, `expires_at` = period_end

**Validates**: AC 3.5, 3.6

### Step 10 — Reinstate cancelled-but-still-active subscription

- [ ] On Selection (still showing "Cancelled: Premium") → tap the Premium card
- [ ] Apple Pay sheet appears with the remaining-trial-days breakdown (since the original sub was still in trial)
- [ ] Confirm payment
- [ ] Network: `POST /subscriptions` with the new payment_method_id; backend's reinstate-path detects the cancelled sub and resumes it
- [ ] Response: `change_type: "reinstate"`, `reinstated: true`, `scheduled: false`, `payment_status: "trialing"`
- [ ] Selection invalidates → "Cancelled" indicator gone; "Current: Premium" badge back
- [ ] Postgres: same sub row's `cancelled_at` is now NULL again, `payment_status = 'trialing'`

**Validates**: AC 3.6, 7.4

### Step 11 — Upgrade flow (basic → premium) from Management

- [ ] First, cancel the current premium sub and let it expire (or use a fresh test user starting on `basic`)
- [ ] Manually create a `basic` sub for the test user (via Selection → tap `basic` card → Apple Pay → success)
- [ ] Open Subscription Management → "Upgrade to Premium" card visible (since current is `basic`)
- [ ] Tap Upgrade → confirmation alert "You will be charged a prorated amount immediately. Continue?"
- [ ] Tap Upgrade → network: `POST /subscriptions` with `{ tier_name: "premium", billing_cycle: "monthly" }` (NO `payment_method_id`)
- [ ] Response: `change_type: "upgrade"`, `scheduled: false`, `effective_at: null`, `payment_status: "active"`
- [ ] Success alert: "Your subscription has been upgraded!"
- [ ] Postgres: `user_subscriptions.tier_name = 'premium'`, `subscription_limits.*` updated by trigger

**Validates**: AC 3.3

### Step 12 — 3DS required path

- [ ] Replace the Apple Pay sandbox card with a Stripe 3DS-required test card (via Apple Pay sandbox + simulator config)
- [ ] Pick a fresh tier (e.g., a trainer tier) → tap → Apple Pay
- [ ] Backend response: `requires_action: true`, `client_secret: "pi_…_secret_…"`
- [ ] Mobile presents 3DS challenge sheet (Stripe's `handleNextAction`)
- [ ] Complete the challenge in the sandbox webview
- [ ] Webhook `customer.subscription.updated` fires → `payment_status: 'active'`
- [ ] Mobile refetches `useMySubscription` → success screen + active tier

**Validates**: AC 2.5, 8.1, 8.2

### Step 13 — Apple Pay user-cancel + retry

- [ ] On Selection, tap a tier card → Apple Pay sheet opens
- [ ] Tap "Cancel" on the sheet (don't confirm) → sheet dismisses
- [ ] No alert shown (silent cancel handling)
- [ ] Selected-tier-for-payment state cleared; user can tap a different tier
- [ ] Tap another tier → new Apple Pay sheet opens cleanly
- [ ] Network: only ONE `POST /subscriptions` request fires for the eventually-confirmed tier (no duplicate calls from the cancelled flow)

**Validates**: AC 2.7

### Step 14 — Trainer role + dual-tier card

- [ ] Sign in as a user with `profile.role = 'personal_trainer'` (or toggle to Trainer manually)
- [ ] Selection screen shows 3 dual-tier cards (`individual_trainer`, `small_business`, `medium_enterprise`)
- [ ] Each card shows Standard column + Pro column with separate prices and Subscribe CTAs
- [ ] Pro columns show "14-day free trial" banner when trainer-trial-eligible
- [ ] Tap a Pro column → Apple Pay sheet with 14-day trial breakdown
- [ ] Confirm → success screen → "Manage Clients" CTA appears alongside "Go to Home" (trainer-specific)

**Validates**: AC 1.3, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.4

### Step 15 — Android no-buy state

- [ ] Switch to Android emulator (or device)
- [ ] Open Subscription Selection (read-only OK — cards still render from `/subscription-tiers`)
- [ ] Tap any tier card → `PaymentMethodForm` mounts → renders inline error: "Apple Pay is only available on iOS devices. Please use an iPhone or iPad to complete your subscription."
- [ ] No fallback to Card / Google Pay / Web — intentionally blocked
- [ ] Navigation back works; tier cards still tappable but produce the same error each time

**Validates**: AC 2.9

### Step 16 — Sub state refetched on app launch

- [ ] Force-quit + reopen the app while signed in with an active sub
- [ ] On launch, `useMySubscription` fires `GET /subscriptions/me` once
- [ ] Profile screen shows correct current tier from the response
- [ ] Subscription Management opens with up-to-date plan state

**Validates**: AC 5.1, 5.2

## Pass criteria

All 16 steps tick-mark without manual intervention beyond the prescribed taps. Stripe dashboard reflects each subscription transition. Postgres rows match expectations. No console warnings about missing tier IDs or undefined `payment_status`.

## Known-acceptable failures (not blockers)

- iOS Simulator Apple Pay sandbox is slow on first invocation (~1–2s startup). Subsequent presentations are instant.
- The Stripe webhook may take ~500–1500ms to deliver after `POST /subscriptions` returns; UI invalidation triggers refetch which catches up. If a step's network assertion is flaky here, retry the step.
- Stripe test-mode rate limits: rare bursts of >100 `POST /subscriptions` per minute will throttle. Smoke test doesn't approach this.
- TypeScript route warnings from Expo Router on first launch after the new routes land — restart `expo start` to regenerate `.expo/types/router.d.ts`.

## Rollback plan

If M10 smoke test fails repeatedly after good-faith debugging:

1. **Revert the frontend PR first** — backend extensions are additive (new endpoints + optional body field + new response fields). Backend continues to serve PR #70 callers correctly.
2. If the backend extensions themselves are broken, revert the backend PR — the existing `POST /subscriptions` + `/subscriptions/:id/cancel` + webhook surface from PRs #69 + #70 stays functional.
3. The mobile app pre-M10 doesn't have subscription screens — so a frontend revert puts the user back to legacy `persistence-mobile` if they need to subscribe (no V2 buy path exists pre-M10).

## Manual cleanup between runs

If you're running multiple smoke-test passes against the same user:

```sql
-- In Postgres (target stage):
DELETE FROM user_subscriptions WHERE user_id = '<your-test-user-id>';
UPDATE profiles SET has_used_user_trial = false, has_used_trainer_trial = false WHERE id = '<your-test-user-id>';
```

And in Stripe test mode: customer's active subscriptions can be cancelled via the dashboard for a clean re-run. Reset Apple Pay test-card state in the simulator if Apple Pay behaviour gets stuck.
