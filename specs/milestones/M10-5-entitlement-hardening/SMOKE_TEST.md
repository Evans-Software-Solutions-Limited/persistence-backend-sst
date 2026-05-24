# M10.5 — Smoke Test (Wave 1)

End-to-end verification for the Wave 1 deliverables — server-side `assertEntitlement` + mobile feature-gate primitives + offline UX on subscription screens. Run against `bun run dev` (or staging post-merge) + an iOS simulator with Stripe test mode configured.

Wave 2 (per-screen integration) ships its own SMOKE_TEST extension when authored.

## Setup (one-time per environment)

1. `git checkout feat/m10-5-entitlement` (or main after merge)
2. Backend:
   ```
   bun install
   bun run dev
   ```
   OR test against staging at `https://api.staging.persistence.evans-software-solutions.com` (post-merge).
3. Stripe test-mode keys + webhook still configured from M10 setup (re-confirmation step).
4. Two test users seeded in Postgres:
   - User A: `basic` tier active, with N-1 workouts already this month (N = basic workout_limit)
   - User B: `premium` tier active, unlimited workouts
   - User C: `free` tier (no `user_subscriptions` row)
5. Mobile:
   ```
   cd packages/mobile
   bun install
   bun run start
   ```
   Open in iOS simulator. iOS Wallet has a test card.
6. `.env`: `EXPO_PUBLIC_API_URL` points at the target backend.

## Walkthrough

### Step 1 — `POST /workouts` enforces workout_limit (User A at limit)

- [ ] Sign in as User A (basic, N-1 workouts)
- [ ] Via the workout creator (or curl with a valid JWT), `POST /workouts` with a valid payload
- [ ] Backend logs: count check fires, `current_count = N-1 < N` → allowed → 201, new workout row, count now N
- [ ] `POST /workouts` again with a new payload → backend now sees `current_count = N >= N` → throws `EntitlementError(reason: "limit", upgrade_to: "premium")`
- [ ] Response: HTTP 402, body shape:
  ```json
  {
    "code": "ENTITLEMENT_DENIED",
    "error": "Subscription does not include this feature",
    "feature": "create_workout",
    "current_tier": "basic",
    "upgrade_to": "premium",
    "upgrade_price_monthly": 14.99
  }
  ```
- [ ] Postgres: only N workouts created (the 402 didn't insert)

**Validates:** AC 9.1, 9.2, 9.3, 9.7

### Step 2 — `POST /sessions/record` enforces on fresh-workout records (User A at limit)

- [ ] Sign in as User A (still at limit from Step 1)
- [ ] `POST /sessions/record` with a payload that creates a fresh workout (no `workoutId` reference) → 402 with the same shape
- [ ] `POST /sessions/record` referencing an existing `workoutId` from earlier → 201 (this isn't a fresh workout, doesn't count)

**Validates:** AC 9.4

### Step 3 — `POST /workouts` succeeds for premium (User B unlimited)

- [ ] Sign in as User B (premium, unlimited)
- [ ] `POST /workouts` succeeds, 201, no entitlement-related path fires

**Validates:** AC 9.3, 9.5 (premium tier sees no gate)

### Step 4 — Free user sees the gate prompt

- [ ] Sign in as User C (free) on the mobile app
- [ ] Navigate to the workout creator
- [ ] (Note: per-screen integration is Wave 2 — for Wave 1 smoke test, navigate manually to a screen that calls `useFeatureGate('create_workout')` OR insert a temp probe in a dev build that renders `<FeatureGatePrompt {...useFeatureGate('create_workout').gateProps} />`)
- [ ] `FeatureGatePrompt` renders showing:
  - Lock icon
  - "Unlimited workouts requires Basic or higher" (or similar — copy is the agent's call)
  - Current tier badge: "Free"
  - Upgrade card: Basic tier with £4.99/month
  - "Upgrade to Basic" primary CTA
  - "Not now" secondary CTA
- [ ] Tap "Upgrade to Basic" → router pushes to `/(auth)/subscription-selection?tier=basic&cycle=monthly` (URL params or state, agent's choice)
- [ ] Selection screen lands with `basic` tier card highlighted

**Validates:** AC 10.1, 10.2

### Step 5 — `SubscriptionBadge` on Profile

- [ ] On the Profile screen (existing M6 surface), confirm a `SubscriptionBadge` chip renders next to the user display name
- [ ] User C (free) sees "Free" chip
- [ ] User B (premium) sees "Premium" chip
- [ ] If you can flip User B to `paymentStatus: 'cancelled'` in the DB without breaking trigger maintenance, badge updates to "Premium · Cancelled"

**Validates:** AC 10.3

### Step 6 — Offline indicator on subscription screens

- [ ] Sign in as any user; navigate to Subscription Selection
- [ ] Wait for tiers to load
- [ ] Enable airplane mode in the simulator (Cmd+H to home, then Settings → Airplane Mode → On)
- [ ] Reopen the app → Subscription Selection still renders (cached `MySubscription` + tiers)
- [ ] "You're offline" banner visible above the tier cards
- [ ] Tap a tier card → alert "You need to be online to manage your subscription. Please reconnect and try again."
- [ ] Apple Pay sheet does NOT mount
- [ ] Disable airplane mode → banner disappears → tap tier → Apple Pay sheet mounts normally

**Validates:** AC 11.1, 11.2, 11.4

### Step 7 — Slow-network indicator (8s)

- [ ] Throttle the simulator network (Settings → Developer → Network Link Conditioner → 3G or worse). Or block requests to your backend with a sleep on the server.
- [ ] Navigate to Subscription Selection (cold cache — clear app first)
- [ ] After ~8 seconds: "Still loading subscription information..." indicator appears below the existing loader
- [ ] When the query eventually resolves, both indicators disappear and the tier cards render

**Validates:** AC 11.3

### Step 8 — 3DS mid-flow network drop

- [ ] Use a Stripe test card that triggers 3DS challenge (`4000 0027 6000 3184`)
- [ ] Subscribe → Apple Pay → backend returns `requires_action: true` + `client_secret`
- [ ] Right before `payments.confirm3DS` is called, enable airplane mode
- [ ] Mobile alerts "Connection lost during payment verification. Please try again." (or similar)
- [ ] State resets so user can retry (selectedTier cleared, processing flag cleared)
- [ ] Webhook eventually times out the `incomplete` Stripe sub via `incomplete_expired` → rolls back local row to prior tier (verify in Postgres after 24h, or trigger manually via Stripe dashboard's "Send test event" for `customer.subscription.deleted`)

**Validates:** AC 11.5, 8.3

### Step 9 — 402 interception in `SSTApiAdapter`

- [ ] In a dev build, capture the network adapter's behaviour on a 402 response. Either:
  - Add a temp probe that logs the `ApiError` shape after a known-failing call (e.g., User A's blocked `POST /workouts`), OR
  - Inspect via a unit test (the existing `sst-api.adapter.test.ts` extension should already cover this)
- [ ] Confirm the `ApiError` carries `entitlement.feature`, `entitlement.currentTier`, `entitlement.upgradeTo`, `entitlement.upgradePriceMonthly` populated from the structured 402 body

**Validates:** AC 10.4

### Step 10 — JWT-only-trust regression check

- [ ] Manually craft a JWT for User A claiming `payment_status: 'active'` and `tier_name: 'premium'` (the JWT can't actually be modified by an attacker without the secret, but for testing we simulate by editing the user's `user_subscriptions` row to `cancelled` AFTER they signed in but BEFORE they call `POST /workouts`)
- [ ] User A's stale JWT still says premium-equivalent claims
- [ ] `POST /workouts` → `assertEntitlement` reads live DB → sees `cancelled` → 402 with reason `'cancelled'`
- [ ] This is the abuse vector M10.5 was built to defend; this step confirms it's closed

**Validates:** AC 9.6 (no JWT-only trust)

## Pass criteria

All 10 steps tick-mark. Network requests + Postgres rows match expectations. No console warnings about missing entitlement fields.

## Known-acceptable

- Wave 2 per-screen integration not yet shipped — for Step 4, navigate manually or use a dev probe
- Some test-card 3DS challenges in Stripe sandbox have flaky webhook timing — re-run if `incomplete_expired` doesn't fire within the expected window

## Rollback plan

- Revert the frontend agent merges first (`m105-mobile-primitives` + `m105-mobile-offline-ux`)
- Backend revert (`m105-backend`) is mostly additive but removes the 402 enforcement on workout creation. Pre-M10.5 behaviour: no limit enforced. Acceptable degradation while the issue is investigated.
- The Wave 1 merge commits should be revertable independently.
