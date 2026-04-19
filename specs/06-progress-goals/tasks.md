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
