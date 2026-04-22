# M1 — Smoke Test

End-to-end verification walkthrough for Milestone 1. Run against `bun run dev` (SST backend local) + the mobile app on a real iOS simulator, NOT against in-memory adapters. Both PRs must be merged (or staged on a shared `m1-home-dashboard` base branch) before the full 11-step run. Partial runs against one PR at a time are acceptable for agent self-verification.

Every step maps to one or more acceptance criteria in the parent specs — the AC number is listed inline.

## Setup (one-time per environment)

1. `git checkout feat/m1-mobile-home` (or `main` if both M1 PRs are merged)
2. Backend:
   ```
   bun install
   bun run dev  # SST stage bradleysimms-evans — wait for the "Ready!" banner
   ```
3. Database: ensure Supabase dev DB is reachable. Confirm seed data exists for the test user (workouts, sessions, active goals, at least one PR in the last 7 days, a latest measurement, a subscription row).
4. Mobile — HealthKit requires a native build:
   ```
   cd packages/mobile
   bun install
   LANG=en_US.UTF-8 npx expo run:ios
   ```
   This performs a one-time `prebuild` that installs the `@kingstinct/react-native-healthkit` pod. Wait for the simulator to launch.
5. Confirm `.env` has `EXPO_PUBLIC_API_URL` pointing at the local SST Lambda URL (check the backend's `Ready!` line).

## Walkthrough

### Step 1 — Sign in renders the greeting (STORY-005 AC 5.1)

- [ ] Sign in as the seeded test user
- [ ] Home tab renders on landing
- [ ] Greeting reads "Hello, {firstName}" (or the legacy copy) using the user's first name derived from `profile.fullName` — NOT the email prefix
- [ ] If the seeded user has no `fullName`, the greeting falls back to "Lifter" (legacy copy); document the fallback path if hit

### Step 2 — Subscription badge + free-tier CTA (AC 5.6)

- [ ] Subscription badge renders with the user's tier name (e.g. "Pro", "Free", "Trainer")
- [ ] If the user is on the free tier, an "Upgrade" CTA is visible and tappable; tap routes to `/auth/subscription-selection` (or placeholder)
- [ ] If the user is on a paid tier, a "Manage" link / CTA renders instead
- [ ] Inspect network logs: the `/dashboard` response for this user has `subscription.isFreeTier` matching the badge state

### Step 3 — Recent workouts carousel (AC 5.2, backend AC 7.3)

- [ ] MyWorkouts / YourWorkouts section renders a horizontal carousel
- [ ] Carousel shows up to 10 templates: user's own + assigned + default
- [ ] Card ordering matches the legacy `getMyWorkouts` (own first, then assigned, then defaults)
- [ ] Network inspect: `recentWorkouts` in the `/dashboard` response is the source of truth (no separate `GET /workouts` call fired on Home tab mount)

### Step 4 — Recent activity list (AC 5.3, backend AC 7.2)

- [ ] RecentActivity section renders completed sessions from the last 7 days
- [ ] Most recent session at the top; empty state renders gracefully for a freshly-seeded user with no completions
- [ ] Each row shows the workout name (template name fallback on ad-hoc sessions) + completedAt timestamp formatted in the user's locale

### Step 5 — MyProgress tile grid (AC 5.5, backend AC 7.1)

- [ ] `workoutsThisMonth` + `workoutsLastMonth` tiles render with correct counts
- [ ] Streak tile shows the correct consecutive-day count (derived from `DashboardRepository.calculateStreak`)
- [ ] Body weight / body fat tiles render from `latestMeasurement` (numeric values, not NaN from Drizzle string parsing)
- [ ] Active energy tile renders the simulator-mock `312` value (from `SimulatorMockHealthAdapter.getActiveCaloriesToday`)
- [ ] Basal / standTime tiles render placeholder zeros (per parent-spec non-goals; documented)

### Step 6 — StepsTile renders mock data (AC 5.5, health AC 7.2)

- [ ] StepsTile shows `4812` steps (the deterministic simulator-mock value)
- [ ] Tile has a `$success` dot — proves `permissionStatus.steps === "granted"` in the mock
- [ ] No "Connect Health" CTA renders (would indicate the real `ExpoHealthKitAdapter` was selected on the simulator instead of the mock — a selection bug)
- [ ] Check `__DEV__ && !Device.isDevice` logic by attaching a log to the factory: simulator path should take `SimulatorMockHealthAdapter`

### Step 7 — PR-of-the-week card (AC 5.7, backend AC 7.6)

- [ ] If the seeded user has ≥1 PR in the last 7 days, a PR-of-the-week card renders with exerciseName + recordType + value + unit + achievedAt
- [ ] If the user has no PRs in the window, the card is **entirely omitted** (not rendered with "—" placeholder)
- [ ] Insert two PRs at the same `achievedAt` with different `recordType` — card shows the higher-ranked one (e.g. `1rm` wins over `5rm`)

### Step 8 — Pull-to-refresh (AC 5.10)

- [ ] Pull down on the scroll view — `RefreshControl` spinner appears
- [ ] Inspect network logs: `GET /dashboard` fires regardless of cache age
- [ ] Values on the tiles update (create a new completed session via the Workouts placeholder or direct DB insert, pull to refresh, confirm the count ticks up)
- [ ] Cached `cached_dashboard` row in SQLite updates (`synced_at` advances)
- [ ] StepsTile also re-reads from `useHealthData.refresh()` during pull

### Step 9 — Cold-start cache-first render (AC 5.9)

- [ ] Kill the app (fully terminate, not background)
- [ ] Relaunch
- [ ] Home renders **instantly** with the cached payload (no spinner, no blank placeholder)
- [ ] Background refresh fires shortly after — inspect network logs for a `GET /dashboard` call ~100 ms after mount
- [ ] If the cache is ≥ 5 min old the refresh fires immediately; if fresher, it still fires but the user sees no visible re-render

### Step 10 — Offline / stale path (AC 5.9, AC 7.11 on 07)

- [ ] Toggle simulator airplane mode on (or kill the backend)
- [ ] Kill the app, relaunch
- [ ] Home renders the cached payload with a "last synced" caption or timestamp
- [ ] Pull-to-refresh fails gracefully — error surfaces in the UI, cache is preserved
- [ ] Toggle airplane mode off; pull-to-refresh succeeds and the stale indicator clears

### Step 11 — Backend wire-format regression check (AC 5.8, backend AC 7.1)

- [ ] Inspect the raw `GET /dashboard` response body
- [ ] Response is `{ "data": { ...DashboardPayload } }` — **single envelope**, not `{ "data": { "data": {...}, "meta": {...} } }`
- [ ] Every top-level field is present even for the empty-state user (collections are `[]`, objects are `null`)
- [ ] `weightKg` and `bodyFatPercentage` arrive as JSON numbers, not strings
- [ ] `prOfTheWeek.value` also arrives as a number
- [ ] No `steps` / `energy` fields on the payload (removed per parent spec)

## Pass criteria

All 11 steps tick-mark without manual intervention (beyond the prescribed taps / reloads). Network requests and SQLite rows match expectations. No console warnings about Health adapter selection failures or cached-payload JSON parse errors.

## Known-acceptable failures (not blockers)

- **Typed-routes warning** — after adding `/health-permissions` placeholder or any new nested route, TypeScript may warn until `.expo/types/router.d.ts` regenerates on the first `expo run:ios`.
- **HealthKit entitlement prompt** — on first device build, iOS prompts for HealthKit usage. Simulator skips this (SimulatorMockHealthAdapter path).
- **Initial prebuild delay** — first `npx expo run:ios` takes 2–5 minutes installing pods. Subsequent runs are fast.
- **Staggered animation visible pop** — 80 ms per section × 5 = 400 ms total. Feels fast but visible. Do not "fix" during smoke test; polish is M11.

## Rollback plan

If M1 smoke test fails repeatedly after good-faith debugging:

1. **Revert the frontend PR first** (backend changes are additive — new fields on `/dashboard` don't break other callers).
2. If the backend needs reverting too, `git revert` the commit range on `feat/m1-backend-dashboard`. The reverted payload is a strict subset of the new one; existing callers (there are none today besides mobile) continue to work.
3. The pre-M1 Home tab is the diagnostic screen — the app continues to work against the rest of the backend (exercises, workouts placeholder, profile) even without Home.
