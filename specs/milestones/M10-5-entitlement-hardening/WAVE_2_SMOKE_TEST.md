# M10.5 Wave 2 — Smoke Test

End-to-end verification for Wave 2 — per-screen feature-gate integration. Run AFTER Wave 1's [SMOKE_TEST.md](./SMOKE_TEST.md) has passed and Wave 2's three agent merges have landed.

## Setup

Same as Wave 1 setup, plus:

- Three test users seeded:
  - **U-Free**: `free` tier, no subscription row
  - **U-Premium**: `premium` tier, active, well under any limits
  - **U-Trainer-Pro**: `individual_trainer_pro` tier, active
- A fourth test user **U-Basic-AtLimit**: `basic` tier, at or just under monthly workout limit (set up via direct DB insert + a few real workouts created via the API)

## Walkthrough

### Step 1 — Exercise creator gate (free user)

- [ ] Sign in as U-Free
- [ ] Navigate to Exercises tab → tap `+` to create a custom exercise
- [ ] Creator screen mounts → `FeatureGatePrompt` renders immediately (no form shown)
- [ ] Prompt shows: lock icon, "Custom exercises require Basic or higher", current "Free" badge, upgrade card for Basic + £4.99/month, "Upgrade to Basic" CTA
- [ ] Tap "Upgrade to Basic" → routes to `/(auth)/subscription-selection?tier=basic` (or similar) → Selection screen lands with Basic highlighted

**Validates:** AC 4.6, 10.2

### Step 2 — Exercise creator allowed (premium user)

- [ ] Sign in as U-Premium
- [ ] Same flow: Exercises tab → `+` → creator screen
- [ ] Form mounts normally (no gate prompt)
- [ ] Fill in fields → submit → 201, exercise saved
- [ ] List refresh shows the new exercise under "My Exercises"

**Validates:** AC 4.6 (premium path)

### Step 3 — Workout creator warning + gate (basic at limit)

- [ ] Sign in as U-Basic-AtLimit (1 workout remaining)
- [ ] Workouts tab → "Create workout" CTA → form mounts
- [ ] Warning banner visible: "1 workout remaining this month — Upgrade to Premium for unlimited"
- [ ] Fill in + submit → 201 success (still within limit)
- [ ] Create another workout → form mounts → on submit, server returns 402 → mobile catches the `ApiError` with `entitlement` field → swaps form for `FeatureGatePrompt`
- [ ] Prompt shows: "Unlimited workouts requires Premium", "Upgrade to Premium" CTA

**Validates:** AC 4.6, 9.3, 10.4

### Step 4 — AI workout option gated (free user)

- [ ] Sign in as U-Free → Workouts tab → "Create workout"
- [ ] If creator has AI / manual mode toggle: AI option shows `FeatureGatePrompt` overlay or disabled state with the gate
- [ ] Manual option works normally (subject to Step 1's exercise gate)
- [ ] Sign in as U-Premium → same screen → AI option enabled (stub today; will route through real AI when that ships)

**Validates:** AC 4.6 (ai_workout stub)

### Step 5 — Progress tab analytics gate (free user)

- [ ] Sign in as U-Free → Progress tab
- [ ] Basic session list / weight tracker visible
- [ ] PR carousel section: `FeatureGatePrompt` compact variant in place
- [ ] Volume chart section: same
- [ ] Sign in as U-Premium → same tab → all sections render their data normally

**Validates:** AC 4.6 (Progress integration)

### Step 6 — Health integration gate (free user)

- [ ] Sign in as U-Free → Home tab
- [ ] Health tiles section locked with `FeatureGatePrompt`
- [ ] Sign in as U-Premium → same tab → health tiles render (HealthKit data if permission granted)

**Validates:** AC 4.6 (health integration)

### Step 7 — Profile SubscriptionBadge

- [ ] Each test user → Profile tab → confirm correct badge appears next to display name:
  - U-Free: grey "Free" chip
  - U-Premium: gold "Premium" chip
  - U-Trainer-Pro: purple "Individual Trainer · Pro" chip (or similar)
  - U-Basic-AtLimit: blue "Basic" chip
- [ ] Place a user into `payment_status: 'cancelled'` with `expires_at` in the future → badge updates to show "· Cancelled" suffix
- [ ] Place a user into `payment_status: 'trialing'` → "· Trial" suffix

**Validates:** AC 10.3

### Step 8 — Trainer Clients tab visibility + gate

- [ ] Sign in as U-Free → tab bar shows 4 tabs (no Clients)
- [ ] Sign in as U-Trainer-Pro → tab bar shows 5 tabs (Clients visible)
- [ ] Tap Clients tab → placeholder ("M8 coming soon" or similar) renders (or whatever the M10.5 Wave 2 stub decided)
- [ ] Sign in as U-Premium (user tier, not trainer) → tap a deep-link to /clients (if such routing exists outside the tab bar) → `FeatureGatePrompt` with "Upgrade to a Trainer tier" CTA

**Validates:** AC 4.6, 6.1

### Step 9 — Mid-session tier change

- [ ] Sign in as U-Free → navigate to Exercises tab → see exercise list normally
- [ ] In a separate terminal, run a backend-only flow that grants U-Free a Premium subscription (insert into `user_subscriptions`)
- [ ] Mobile app: pull to refresh on Profile (or wait for `useMySubscription` stale-time to elapse + return to Profile)
- [ ] `SubscriptionBadge` updates from "Free" to "Premium"
- [ ] Re-tap Exercises tab `+` button → form mounts (no longer gated)

**Validates:** state refresh on tier change; AC 5.6

### Step 10 — 402 path: client thinks allowed, server denies

- [ ] Set up: U-Premium signs in. Mobile cache says Premium. Then in DB, change their `user_subscriptions.payment_status` to `cancelled` AND set `expires_at` to a date in the past (or just delete the row).
- [ ] Mobile (without refresh) attempts to create a workout
- [ ] Server's `assertEntitlement` reads live DB → free tier → 402
- [ ] Mobile catches the structured 402 → `FeatureGatePrompt` swaps in for the form
- [ ] Prompt uses the SERVER's verdict (current_tier = "free"), not the cached client-side state

**Validates:** AC 4.6, 9.6, 10.4 (server wins on disagreement)

## Pass criteria

All 10 steps tick-mark. No silently-locked features (every paywalled feature shows a prompt). No paywall UI custom to a screen — every gate uses `FeatureGatePrompt`.

## Known-acceptable

- Some screens may not yet exist on this branch if upstream milestones haven't shipped (M1 home dashboard, M4 progress sections, etc.). Those agents flag and skip; the gates are added once the actual screens land.
- Tab-bar tier-change visibility may have a brief flicker (state propagation through navigator). Acceptable.

## Rollback plan

- Revert the relevant Wave 2 agent's merge commit. Each agent's slice is independently revertable.
- Wave 1 primitives + backend stay; gates simply aren't wired in until a re-spawn.
