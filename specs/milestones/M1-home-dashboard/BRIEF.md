# M1 — Home / Dashboard (incl. HealthKit)

## Why this milestone

M0 closed the exercise-library wire drift — the mobile app now talks to the SST backend end-to-end for the Exercises tab. But the first thing a user sees after sign-in is still the **Home tab**, and Home is currently a diagnostic screen (API health check + sync status cards at [app/(app)/(tabs)/index.tsx](../../../packages/mobile/app/(app)/(tabs)/index.tsx)) with zero product content.

M1 ships the real Home tab:

1. **Backend `GET /dashboard` returns everything Home needs in one call.** Today the handler returns recent workouts + active goals + latest measurement + streak + PR count + nullable `steps` / `energy`. It does **not** return the user's first name, subscription tier, PR-of-the-week, or workouts-this-month / last-month. The legacy `getHome()` in `persistence-mobile/lib/supabase/queries/progressQueries.ts` is the shape contract — audit it, extend the backend to match.
2. **Mobile ports `HomeContainer` + `HomePresenter` 1:1 from legacy.** Greeting, subscription badge, goals section, workouts carousel, MyProgress tile grid, RecentActivity list. V2 tokens only, staggered entry animations, 3-memo container pipeline (established in M0).
3. **Real `ExpoHealthKitAdapter`, simulator-mock fallback, Android stub.** Replace the no-op `StubHealthAdapter` with production adapters. The simulator mock is non-negotiable — M0 established that smoke tests run on iOS simulator, and without deterministic mock data the StepsTile is empty.
4. **5-minute TTL offline cache for the dashboard payload.** Same pattern as M0's reference-list cache (24h), tuned shorter because dashboard data is user-specific and shifts every session.

This is the second milestone under the parallel-agent model. M0 proved the shape — two branches off main, spec-first commits, independent review, gated on a shared smoke test.

## Parent specs

- [`../../06-progress-goals/`](../../06-progress-goals/) — dashboard section (STORY-005, STORY-007). Extended in commits 1–2 of this branch sequence with the `DashboardPayload` contract, the `cached_dashboard` SQLite row, and `HomeContainer` / `HomePresenter` structure.
- [`../../07-health-integration/`](../../07-health-integration/) — platform adapter matrix (STORY-007). Extended in commits 3–4 with the `ExpoHealthKitAdapter` / `SimulatorMockHealthAdapter` / `AndroidStubHealthAdapter` split and the selection function.

## Spec alignment

This milestone closes these sections of the parent specs:

- `06-progress-goals/design.md` § Dashboard backend contract (M1), § Dashboard mobile architecture (M1)
- `06-progress-goals/requirements.md` STORY-005 AC 5.1–5.12, STORY-007 AC 7.1–7.9
- `06-progress-goals/tasks.md` Phase 4a (backend `/dashboard` expansion), Phase 4b (mobile Home + dashboard cache)
- `07-health-integration/design.md` § M1 scope: platform adapter matrix
- `07-health-integration/requirements.md` STORY-007 AC 7.1–7.7
- `07-health-integration/tasks.md` Phase 2 (M1 iOS + simulator), Phase 3 (Android stub only), Phase 5 (M1 dashboard tiles)

## Scope summary

### Backend

- Extend `DashboardData` to the full `DashboardPayload` shape per parent-spec §. Add sub-queries for profile slice / subscription slice / recent workouts / recent activity / active goals with progress / PR-of-the-week.
- Run all sub-queries in parallel via `Promise.all` in `DashboardRepository.getDashboard`.
- Emit numeric `weightKg` / `bodyFatPercentage` (not Drizzle numeric strings).
- Handler-level tests: happy path, 401, empty-state user, PR-of-the-week tie-breaking.
- **Single-envelope response** (`{ data: DashboardPayload }`) — no list endpoints added, so no double-envelope handling for M1.

### Frontend

- New domain model `Dashboard` (`packages/mobile/src/domain/models/dashboard.ts`) mirroring `DashboardPayload`.
- New `ApiPort.getDashboard` + `StoragePort.getCachedDashboard / cacheDashboard / getDashboardAge`.
- New SQLite `cached_dashboard` table (user_id PK, payload JSON, synced_at), 5-min TTL via `DASHBOARD_STALE_AFTER_MS`.
- New application query `dashboard.query.ts` with `getDashboardQuery` + `refreshDashboard`.
- New `useDashboard` hook mirroring `useReferenceLists`.
- Port `HomePresenter` + section presenters (`GreetingSection`, `GoalsSection`, `YourWorkoutsSection`, `MyProgressSection`, `RecentActivitySection`, `SubscriptionBadge`, `StepsTodayTile`, `PROfTheWeekCard`) 1:1 from `persistence-mobile/components/home/`. V2 tokens only.
- New `HomeContainer` with the 3-memo pipeline (cachedPayload → viewModel → animationStyles) and pull-to-refresh.
- Replace diagnostic content at `app/(app)/(tabs)/index.tsx` with `<HomeContainer />`.
- Real `ExpoHealthKitAdapter` (`@kingstinct/react-native-healthkit`) + `SimulatorMockHealthAdapter` + `AndroidStubHealthAdapter`; selection in `adapters/health/index.ts`.
- `useHealthData` hook with 5-min rate limit and app-foreground re-read.
- Staggered entry animation using `useStaggeredEntry(index)` established in M0.

## Success criteria (review gate)

Done when **all** of these pass against `bun run dev` on a real simulator:

1. Sign in as a seeded user. Home tab renders the greeting with the user's first name (not email).
2. Subscription badge renders the tier name; free-tier users see the "Upgrade" CTA.
3. Recent workouts carousel shows up to 10 templates (own + assigned + default), same ordering as legacy `getMyWorkouts`.
4. RecentActivity list shows completed sessions from the last 7 days; empty state renders when there are none.
5. MyProgress grid renders `workoutsThisMonth` / `workoutsLastMonth` from the backend. Streak tile shows the correct consecutive-day count.
6. StepsTile renders the simulator-mock step count (`4812`) with a `$success` dot — proves the `ExpoHealthKitAdapter` → simulator fallback path works.
7. PR-of-the-week card renders when the seeded user has a PR in the last 7 days; fully omitted when none exists.
8. Pull-to-refresh on the scroll view bypasses the TTL, refetches `/dashboard`, updates the cache, and updates visible values.
9. Kill + relaunch app: Home tab renders **instantly** from the cached payload (no spinner), then silently background-refreshes.
10. Go offline (airplane mode), relaunch app: Home renders from cache with a stale indicator / timestamp (the last-synced caption).
11. Backend handler has ≥ 90% coverage on happy path, 401, empty-state, and PR-of-the-week tie-breaking.

Plus the per-PR quality gates (prettier / typecheck / lint / build / test, 90% coverage on changed files).

## Agent briefs

Two parallel agent tracks. Each reads its own brief plus the parent specs and any referenced code files.

- **Backend:** [`BACKEND_BRIEF.md`](./BACKEND_BRIEF.md)
- **Frontend:** [`FRONTEND_BRIEF.md`](./FRONTEND_BRIEF.md)
- **Smoke test:** [`SMOKE_TEST.md`](./SMOKE_TEST.md)

Each PR lives on its own branch off fresh `main`:

- Backend: `feat/m1-backend-dashboard`
- Frontend: `feat/m1-mobile-home`

PRs are independently reviewable and independently merged. Whichever merges first, the other rebases onto main and re-runs its smoke test against the combined state. Final e2e smoke test (the full 11 steps in [`SMOKE_TEST.md`](./SMOKE_TEST.md)) runs after both are merged.

Coordinate on the shared wire-format contract up front — specifically the `DashboardPayload` shape documented in `06-progress-goals/design.md` § Dashboard backend contract. The frontend can scaffold against the `InMemoryApiAdapter` while the backend PR is in review.

## Explicit non-goals for M1

- **No active-workout popover.** Legacy had `WorkoutPopover` for tapping a recent workout card to see exercises. M1 renders the card but tapping routes to `/workouts` (stub). Real popover is M3 Workouts.
- **No measurement editor / goal editor wiring.** M1 renders `activeGoals` and `latestMeasurement` but the tiles are read-only. Editing lights up in M4 Progress.
- **No body-weight write-back.** `writeBodyWeight` stays stubbed; lights up in M6.
- **No Health Connect on Android.** Android ships with `AndroidStubHealthAdapter` only — the StepsTile renders "Not available on Android yet".
- **No `/health-permissions` screen.** The "Connect Health" CTA on the denied-state tile routes to a placeholder — the real screen is 07-health-integration Phase 4, post-M1.
- **No dashboard visual redesign.** Port 1:1 from legacy; M11 handles polish.
- **No AI PT integration.** The AI PT button (if ported) Alerts on tap per legacy.
- **No basal / standTime health tiles.** Active calories only; other two render placeholder zeros. M4 revisits.
- **No heart-rate tile.** Read is implemented (available for M4) but no M1 UI consumes it.

## Cross-cutting notes (carry into the briefs)

- **Single-envelope response.** `GET /dashboard` is a single object. The mobile adapter's `requestEnvelope<T>` unwraps one `data` layer. There is no pagination on any M1 endpoint, so the double-envelope pattern (established for M0 list endpoints) does NOT apply here. Backend agent must not wrap the payload twice; frontend agent must not double-unwrap. Flag in PR review if either drifts.
- **Staggered entry animations** (`useStaggeredEntry` from M0) sequence the five sections. Same 80 ms-per-section cadence as the exercise list — no new animation tokens.
- **3-memo container pipeline** pattern from M0: `cachedPayload` → `viewModel` → `animationStyles`. Keeps the Home tab responsive on re-renders even as `useHealthData` re-ticks every 5 min.
- **5-min vs 24h TTL.** Reference-list cache is 24h because it rarely changes server-side; dashboard is 5 min because it shifts every completed session. The TTLs are separate constants (`REFERENCE_LIST_STALE_AFTER_MS` / `DASHBOARD_STALE_AFTER_MS`); do not share.
- **V2 tokens are canonical.** Do not import legacy `persistence-mobile/constants/colors.ts` values. Use `$primary`, `$success`, `$warning`, `$error`, `$colorMuted` and `neutral0`–`neutral1000` — see `specs/_agent.md`.
- **SST dev stage** runs in `sst dev` proxy mode against the `bradleysimms-evans` stage. CloudWatch is empty when the local `sst dev` target isn't running; real logs show in the local terminal. Mirror M0 `HANDOVER.md` § "SST dev vs deploy".

## Open decisions resolved in this brief pass

- **Where does `firstName` come from?** Derived server-side from `profile.fullName` (first whitespace-delimited token), not a new DB column. Keeps the column list unchanged and avoids a migration for a cosmetic field.
- **Is subscription in `/dashboard` or a separate call?** Bundled into `/dashboard`. Legacy fetched subscription separately (`useGetUserSubscription`); M1 collapses it into one call to cut render-blocking requests on Home.
- **What is "PR-of-the-week"?** The single highest-impact PR (per the `recordType` weighting in the parent spec) achieved in the last 7 days. `null` when none. Not a list — Home shows one card.
- **Does Home handle active-session resumption?** No. M3 Workouts. M1 renders recent workouts but tapping routes to the Workouts tab placeholder.
