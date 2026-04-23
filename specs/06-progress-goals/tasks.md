# 06 — Progress & Goals: Tasks

## Current state (2026-04-19)

**Shipped: 0 of ~45 tasks complete on mobile. Not started.**

What's there:

- **Backend** — `dashboardHandler`, `progressStatsHandler`, `progressRecordsHandler`, `progressHistoryHandler`, `recordsListHandler`, `measurementsCreateHandler`, `measurementsListHandler`, and full goals CRUD (`create/list/get/update/delete`) all exist and are wired into `api.ts`. Response shapes vs legacy Home/Progress expectations are unverified — likely needs field expansion.
- **Mobile** — `(tabs)/progress.tsx` and `(tabs)/index.tsx` (home): home is a diagnostic screen; progress is `<ComingSoon />`.

Nothing else built: no domain models for `BodyMeasurement`/`PersonalRecord`/`Goal`, no queries/commands, no presenters, no PR carousel, no trend chart, no measurement editor.

Parent milestones:

- **M1 Home / dashboard (incl HealthKit)** — covers the dashboard tile grid + greeting + recent activity + PR-of-the-week (drawn from this spec's dashboard section).
- **M4 Progress** — covers the PR carousel, stat tiles, trend chart, measurement list + editor.

## Phase 1: Domain

- [ ] Create `BodyMeasurement`, `PersonalRecord`, `Goal` models
- [ ] Create `RecordType`, `GoalType`, `GoalStatus` types
- [ ] Implement `calculateGoalProgress()` (percentage toward target)
- [ ] Implement `detectNewRecords()` (compare sets against existing PRs)
- [ ] Implement `calculateWeeklyStats()` (sessions, volume, duration in a week)
- [ ] Implement `calculateStreak()` (consecutive days/weeks with workouts)
- [ ] Implement `prepareMeasurementChart()` (data points for chart rendering)
- [ ] Implement `prepareStrengthChart()` (weight progression for an exercise)
- [ ] Write tests for all progress domain services

## Phase 2: Ports & Adapters

- [ ] Extend `ApiPort` with measurement, record, and goal CRUD
- [ ] Extend `StoragePort` with measurement, record, and goal cache
- [ ] Implement in SST API adapter
- [ ] Implement SQLite tables (measurements, records, goals)
- [ ] Write adapter tests

## Phase 3: Application Layer

- [ ] Create measurement queries and commands (list, create)
- [ ] Create record queries (list by exercise, detect new)
- [ ] Create goal queries and commands (list, create, update status)
- [ ] Create dashboard query (aggregates recent sessions, active goals, stats)
- [ ] Write tests

## Phase 4: UI — Dashboard

- [ ] Create `StatCard` presenter (icon, value, label)
- [ ] Create `RecentSessionCard` presenter (workout name, date, summary)
- [ ] Create `QuickActions` presenter (start workout, log measurement, browse exercises)
- [ ] Create `GoalProgressBar` presenter (name, progress %, target)
- [ ] Create `DashboardPresenter` (greeting, stats, recent sessions, goals, quick actions)
- [ ] Create `DashboardContainer` (fetches all dashboard data from cache)
- [ ] Create `app/(app)/(tabs)/index.tsx` as dashboard screen
- [ ] Write tests

## Phase 4a: Backend `/dashboard` expansion (M1)

Traces to `design.md` § Dashboard backend contract and `requirements.md` STORY-007 (AC 7.1–7.9).

- [x] Extend `DashboardData` type in `microservices/core/src/application/repositories/dashboardRepository.ts` to match `DashboardPayload` (profile, subscription, recentWorkouts, recentActivity, activeGoals, progress, prOfTheWeek, latestMeasurement)
- [x] Add `getProfileSlice(userId)` repo method (select `fullName`, derive `firstName`, `preferredUnits`)
- [x] Add `getSubscriptionSlice(userId)` repo method (join `user_subscriptions` + `subscription_tiers`; apply legacy `isFreeTier` rule)
- [x] Add `getRecentWorkouts(userId, limit = 10)` repo method (own + assigned + default, ordered as legacy)
- [x] Add `getRecentActivity(userId, windowDays = 7)` repo method (completed sessions joined to `workouts`)
- [x] Add `getActiveGoalsWithProgress(userId)` repo method (active only, joined to `goal_types`, priority-ordered)
- [x] Add `getPROfTheWeek(userId, windowDays = 7)` repo method with deterministic tie-breaking per design §
- [x] Wire all sub-queries into a single `Promise.all` in `getDashboard`
- [x] Emit numeric `weightKg` / `bodyFatPercentage` (convert Drizzle numeric strings to `number`)
- [x] Handler-level tests: happy path, 401, empty-state user, PR-of-the-week tie-breaking (AC 7.9)
- [x] Repository tests covering each sub-query with seed data
- [x] Maintain ≥ 90% coverage on `dashboardRepository.ts` + `dashboardHandler.ts`

## Phase 4b: Mobile Home screen + dashboard cache (M1)

Traces to `design.md` § Dashboard mobile architecture and `requirements.md` STORY-005 (AC 5.1–5.12).

- [ ] Create `packages/mobile/src/domain/models/dashboard.ts` with `DashboardPayload` and nested types; export from `domain/models/index.ts`
- [ ] Add `ApiPort.getDashboard()` signature; implement in `SSTApiAdapter` and `InMemoryApiAdapter`
- [ ] Add `StoragePort` dashboard cache methods (`getCachedDashboard`, `cacheDashboard`, `getDashboardAge`); implement in `SQLiteStorageAdapter` + in-memory stub
- [ ] Add `cached_dashboard` SQLite migration (user_id PK, payload JSON, synced_at)
- [ ] Create `packages/mobile/src/application/queries/dashboard.query.ts` — `getDashboardQuery` (cache-first) + `refreshDashboard` (writes through)
- [ ] Create `useDashboard` hook (mirrors `useReferenceLists` shape — exposes `payload`, `isStale`, `isRefreshing`, `refresh`)
- [ ] Port `HomePresenter` from `persistence-mobile/components/home/HomePresenter/` (1:1 copy with V2 tokens)
- [ ] Port section presenters: `GreetingSection`, `GoalsSection`, `YourWorkoutsSection`, `MyProgressSection`, `RecentActivitySection`, `SubscriptionBadge`, `StepsTodayTile`, `PROfTheWeekCard`
- [ ] Create `HomeContainer` with the 3-memo pipeline (cachedPayload → viewModel → animationStyles)
- [ ] Wire pull-to-refresh (AC 5.10)
- [ ] Replace diagnostic content in `app/(app)/(tabs)/index.tsx` with `<HomeContainer />`
- [ ] Presenter unit tests (each section)
- [ ] Container tests: cache-hit, stale refresh, offline path, pull-to-refresh (AC 5.9 / 5.10)
- [ ] Maintain ≥ 90% coverage on changed files

## Phase 5: UI — Measurements

- [ ] Create `MeasurementEditorPresenter` (form with weight, body fat, body measurements)
- [ ] Create `MeasurementEditorContainer` (form state, validation, save)
- [ ] Create `ProgressChart` component (SVG line chart, time range selector)
- [ ] Create `MeasurementListPresenter` (chart + history list)
- [ ] Create `MeasurementListContainer` (fetches measurements)
- [ ] Create screens: `app/(app)/progress/index.tsx`, `app/(app)/progress/measurements.tsx`
- [ ] Write tests

## Phase 6: UI — Goals

- [ ] Create `GoalEditorPresenter` (form: name, type, target, date)
- [ ] Create `GoalEditorContainer` (form state, save)
- [ ] Create `GoalListPresenter` (list with filter tabs, progress bars)
- [ ] Create `GoalListContainer` (fetches goals, manages filter)
- [ ] Create screens: `app/(app)/goals/index.tsx`, `app/(app)/goals/create.tsx`
- [ ] Write tests

## Phase 7: UI — Personal Records

- [ ] Create `RecordListPresenter` (records grouped by exercise, record type badges)
- [ ] Create `RecordListContainer` (fetches records)
- [ ] Create screen: `app/(app)/progress/records.tsx`
- [ ] Write tests

## Phase 8: Quality Gates

- [ ] All progress/goals tests pass with 90% coverage
- [ ] Quality gates pass
