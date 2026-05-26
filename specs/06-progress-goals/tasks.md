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

- [x] Create `packages/mobile/src/domain/models/dashboard.ts` with `DashboardPayload` and nested types; export from `domain/models/index.ts`
- [x] Add `ApiPort.getDashboard()` signature; implement in `SSTApiAdapter` and `InMemoryApiAdapter`
- [x] Add `StoragePort` dashboard cache methods (`getCachedDashboard`, `cacheDashboard`, `getDashboardAge`); implement in `SQLiteStorageAdapter` + in-memory stub
- [x] Add `cached_dashboard` SQLite migration (user_id PK, payload JSON, synced_at)
- [x] Create `packages/mobile/src/application/queries/dashboard.query.ts` — `getDashboardQuery` (cache-first) + `refreshDashboard` (writes through)
- [x] Create `useDashboard` hook (mirrors `useReferenceLists` shape — exposes `payload`, `isStale`, `isRefreshing`, `refresh`)
- [x] Port `HomePresenter` from `persistence-mobile/components/home/HomePresenter/` (1:1 copy with V2 tokens)
- [x] Port section presenters: `GreetingSection`, `GoalsSection`, `YourWorkoutsSection`, `MyProgressSection`, `RecentActivitySection`, `SubscriptionBadge`, `StepsTodayTile`, `PROfTheWeekCard`
- [x] Create `HomeContainer` with the 3-memo pipeline (cachedPayload → viewModel → animationStyles)
- [x] Wire pull-to-refresh (AC 5.10)
- [x] Replace diagnostic content in `app/(app)/(tabs)/index.tsx` with `<HomeContainer />`
- [x] Presenter unit tests (each section)
- [x] Container tests: cache-hit, stale refresh, offline path, pull-to-refresh (AC 5.9 / 5.10)
- [x] Maintain ≥ 90% coverage on changed files

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

---

## Phase 9 — Habits, streaks, achievements (appended 2026-05-26)

Implements STORY-008 through STORY-016. Sequenced across two milestones:

- **Phase A (M4)** — Mobile + backend schema + endpoints owned by `06-progress-goals`. Backend lands the schema migration + the new endpoints; mobile lands the consumer-side UI on top.
- **Phase B (M8)** — Cross-cut wiring consumed by `10-trainer-features` (trainer-assigned goals). Goals defines the column shape and attribution; PT implements the on-behalf write path. Minimal ownership here; the bulk of M8 work lives in the PT spec.

Each task traces to a STORY AC and a design § B.\* section.

---

### Phase A — M4 mobile + backend schema (Goals owns)

**Spec-update commits (FIRST commits on the M4 branch — non-negotiable; M4 BACKEND_BRIEF.md § "Spec-update commit" sets the precedent):**

- [ ] **A.0.a** Backend agent's spec-update commit (per M4 BACKEND_BRIEF § Spec-update commit) — already in scope; ensure it does not conflict with this appendix.
- [ ] **A.0.b** Frontend agent's spec-update commit (per M4 FRONTEND_BRIEF) — same.

#### A.1 Schema migration — `user_goals` extension

Traces to STORY-016 (AC 16.1, 16.6) + § B.1 + cross-cuts § 2.1 + cross-cuts § 6.

- [ ] **A.1.1** Drizzle schema: extend `userGoals` in `packages/db/src/schema.ts` with `targetValue: decimal("target_value", { precision: 12, scale: 3 })`, `currentValue: decimal("current_value", { precision: 12, scale: 3 })`, `unit: text("unit")`, `assignedByUserId: uuid("assigned_by_user_id").references(() => profiles.id)`.
- [ ] **A.1.2** SQL migration file at `packages/db/migrations/<timestamp>_user_goals_extension.sql` — idempotent `ALTER TABLE` + index per § B.1. Test forward + backward.
- [ ] **A.1.3** Update `microservices/core/src/application/repositories/goalRepository.ts` to project new fields on all reads (list / get) and accept them on writes (create / update).
- [ ] **A.1.4** Update `microservices/core/src/application/repositories/dashboardRepository.ts` `getActiveGoalsWithProgress` to read `targetValue` / `currentValue` / `unit` from `user_goals` directly — REMOVE the M1 defensive `0 / 0` zeros (`design.md` line ~211) once the migration lands. Maintain backward compat: NULL columns fall back to `0` / `""`.
- [ ] **A.1.5** Test: existing `goalRepository.test.ts` + `dashboardRepository.test.ts` pass with the new field projections.

#### A.2 Streak engine — tables + on-write + cron

Traces to STORY-009 + STORY-010 + STORY-011 + § B.2 + cross-cuts § 3.

- [ ] **A.2.1** Drizzle schema: add `userStreaks` table per cross-cuts § 3.2 (id, user_id, streak_type, source_goal_id, period, current_count, longest_count, last_period_end, freeze_tokens, status, created_at, updated_at + unique index on (user_id, source_goal_id) + index on (user_id, status)).
- [ ] **A.2.2** Drizzle schema: add `streakTypeEnum` (`workout_streak`, `habit_streak`, `measurement_streak`, `nutrition_streak`) + `streakStatusEnum` (`active`, `broken`, `paused`).
- [ ] **A.2.3** SQL migration for both — idempotent. Foreign key `source_goal_id → user_goals.id ON DELETE CASCADE` per § B.2.
- [ ] **A.2.4** Application service: `microservices/core/src/application/streaks/streakService.ts` — exports `evaluateStreaks(userId, eventType, ts, opts)` per cross-cuts § 3.4. Pure functions for period-rollover math (`isPeriodBoundary`, `nextPeriodEnd`, `isPeriodSatisfied`) + side-effect entry that does the DB updates.
- [ ] **A.2.5** Repository: `microservices/core/src/application/repositories/streakRepository.ts` — CRUD on `user_streaks` + a `findActiveByUser(userId)` query for the cron.
- [ ] **A.2.6** Cron handler: `microservices/core/src/application/streaks/streakCronHandler.ts` — SST cron resource (02:00 UTC nightly per cross-cuts § 3.4) iterates active streaks, applies missed-period logic + freeze tokens.
- [ ] **A.2.7** On-write hook: every `POST /sessions` completion handler calls `streakService.evaluateStreaks(userId, 'workout_logged', ts)`. Every `POST /goals/:id/completions` (see A.4) calls `evaluateStreaks(userId, 'habit_completed', ts, { goalId })`. Every `POST /measurements` calls `evaluateStreaks(userId, 'measurement_logged', ts)`.
- [ ] **A.2.8** Tests: 90% coverage on `streakService.ts` (pure-function tests for period math, table-driven cases for milestone thresholds), `streakRepository.ts` (CRUD), `streakCronHandler.ts` (missed-period without tokens → broken; missed-period with tokens → decrement). Include all 5 weekly milestones + all 5 daily milestones per cross-cuts § 3.6.

#### A.3 Achievements seed + emission

Traces to STORY-014 + § B.7 + cross-cuts § 3.6.

- [ ] **A.3.1** Seed migration: 10 `achievements` rows per § B.7. `ON CONFLICT (name) DO NOTHING`.
- [ ] **A.3.2** Streak service: on milestone-crossing, insert `user_achievements` row + emit `streak_milestone` notification via the notifications port. Unique constraint per `schema.ts:543` makes the insert idempotent.
- [ ] **A.3.3** New endpoint: `GET /achievements/me` per § B.12. Handler at `microservices/core/src/application/achievements/list/achievementsListHandler.ts`. Repository at `microservices/core/src/application/repositories/achievementRepository.ts`.
- [ ] **A.3.4** Tests: 90% coverage on achievementRepository + handler — happy path, ordering by `unlocked_at DESC`, ownership scoping.

#### A.4 Habit completions endpoint

Traces to STORY-008 + § B.3 + § B.12 + cross-cuts § 3.3.

- [ ] **A.4.1** Drizzle schema: add `habitCompletions` table per cross-cuts § 3.3 (id, user_id, goal_id, completed_at, value + unique on (user_id, goal_id, day) + index on (user_id, goal_id, completed_at DESC)).
- [ ] **A.4.2** SQL migration — idempotent. FK `goal_id → user_goals.id ON DELETE CASCADE`.
- [ ] **A.4.3** Handler: `microservices/core/src/application/goals/completions/goalsCompletionsCreateHandler.ts` — `POST /goals/:id/completions` per § B.12 wire shape. Includes goal-type validation (only `habit_generic` accepts). Idempotent insert via `ON CONFLICT`.
- [ ] **A.4.4** Repository method: `goalRepository.recordCompletion(userId, goalId, value, completedAt)`.
- [ ] **A.4.5** Handler invokes `streakService.evaluateStreaks(userId, 'habit_completed', completedAt, { goalId })` in the same transaction.
- [ ] **A.4.6** Tests: 90% coverage. Happy path, idempotent retry, wrong goal-type → 422, wrong user → 404, missing goal → 404.

#### A.5 Streak read + admin endpoints

Traces to STORY-009 + § B.12.

- [ ] **A.5.1** Handler: `microservices/core/src/application/streaks/streaksListHandler.ts` — `GET /streaks?goal_id=` per § B.12. Returns the user's streak (or list when goal_id omitted).
- [ ] **A.5.2** Handler: `microservices/core/src/application/streaks/streaksManualEvalHandler.ts` — `POST /streaks/:id/manual-eval` per § B.12. Admin-only (`role = 'admin'` check after auth).
- [ ] **A.5.3** Tests: 90% coverage. Ownership scoping, admin role check, manual-eval idempotency.

#### A.6 Step-goal write-back endpoint

Traces to STORY-012 (AC 12.3, 12.4) + § B.4.

- [ ] **A.6.1** Drizzle schema: add `dailyActivityData` table (`user_id`, `date`, `steps`, `active_calories`) with composite PK `(user_id, date)`. Idempotent migration.
- [ ] **A.6.2** Handler: `microservices/core/src/application/goals/healthSync/goalsHealthSyncHandler.ts` — `PATCH /goals/:id/health-sync` per § B.4. Ownership + goal-type assertion (`daily_steps`).
- [ ] **A.6.3** Upsert `daily_activity_data` + update `user_goals.current_value` + invoke `evaluateStreaks(userId, 'step_target_hit', ts, { goalId })` when `value >= target_value`.
- [ ] **A.6.4** Tests: 90% coverage. Happy path, upsert (re-sync same day), wrong goal-type → 422.

#### A.7 Goal-types + new goal_types seed

Traces to STORY-011 + STORY-012 + STORY-013 + § B.8.

- [ ] **A.7.1** Seed migration: 11 `goal_types` rows per § B.8. `ON CONFLICT (name) DO NOTHING`.
- [ ] **A.7.2** Update `microservices/core/src/application/goals/create/goalsCreateHandler.ts` to (a) accept `targetValue`, `unit` in the body; (b) when the new goal_type has an auto-streak per § B.2, insert the paired `user_streaks` row in the same transaction.
- [ ] **A.7.3** Body validator: `targetValue` required for quantitative goal-type family (STORY-016 AC 16.4). Reject 422 on empty.
- [ ] **A.7.4** Update goalsCreateHandler tests + goalRepository tests for the auto-streak insertion path.

#### A.8 Notification enum migration

Traces to STORY-009 + STORY-010 + STORY-014 + STORY-015 + § B.13 + cross-cuts § 5.

- [ ] **A.8.1** Drizzle schema + SQL migration: extend the `notification_type` enum with `streak_milestone`, `streak_at_risk`, `freeze_token_applied`, `goal_milestone`, `goal_assigned_by_trainer` (the latter is M8-emitted but the enum lands in M4 so M8 doesn't carry a Goals-domain migration).
- [ ] **A.8.2** Streak service emits the four streak-related notifications per § B.13. M7 implementation owns the preferences UI; M4 only emits.

#### A.9 Mobile — domain models

Traces to STORY-008 / 009 / 010 / 011 / 012 / 016 + § B.11.

- [ ] **A.9.1** `packages/mobile/src/domain/models/streak.ts` — `UserStreak`, `StreakType`, `StreakStatus` types. Mirrors backend wire shape.
- [ ] **A.9.2** `packages/mobile/src/domain/models/habitCompletion.ts` — `HabitCompletion` type.
- [ ] **A.9.3** `packages/mobile/src/domain/models/achievement.ts` — `Achievement` type with tier + family.
- [ ] **A.9.4** Extend `packages/mobile/src/domain/models/goal.ts` with `targetValue: number | null`, `currentValue: number | null`, `unit: string | null`, `assignedByUserId: string | null`, `assignedByDisplayName: string | null` (the display name is denormalised onto the API response for STORY-015 AC 15.1).

#### A.10 Mobile — ports + adapters

Traces to STORY-008 / 009 / 010 / 011 / 012 / 014 + § B.11 + § B.12.

- [ ] **A.10.1** Extend `packages/mobile/src/domain/ports/api.port.ts`:
  - `recordHabitCompletion(goalId: string, value?: number): Promise<Result<HabitCompletion, ApiError>>`
  - `getStreaks(goalId?: string): Promise<Result<UserStreak[], ApiError>>`
  - `getAchievements(): Promise<Result<Achievement[], ApiError>>`
  - `syncGoalFromHealth(goalId: string, value: number, recordedFor: string): Promise<Result<UserGoal, ApiError>>`
- [ ] **A.10.2** Implement in `sst-api.adapter.ts` (thin wrappers over `requestEnvelope<T>`).
- [ ] **A.10.3** Implement in `__tests__/in-memory-api.adapter.ts` for container tests.
- [ ] **A.10.4** Extend `StoragePort` with `cached_streaks` + `cached_achievements` tables. 5-min TTL for streaks (matches dashboard); ∞ TTL for achievements (re-fetched on Profile mount only, since they're append-only).
- [ ] **A.10.5** Add SQLite migrations for the two cache tables.

#### A.11 Mobile — application queries + commands

Traces to STORY-008 / 009 / 010 / 011 / 012 / 014.

- [ ] **A.11.1** `packages/mobile/src/application/queries/streaks.query.ts` — `getStreaksQuery(userId)` (cache-first) + `refreshStreaks(api, storage, userId)`.
- [ ] **A.11.2** `packages/mobile/src/application/queries/achievements.query.ts` — same shape.
- [ ] **A.11.3** `packages/mobile/src/application/commands/recordHabitCompletion.ts` — offline-queued mutation per sync-worker pattern (M2 learning); writes optimistically to local `cached_habit_completions`.
- [ ] **A.11.4** `packages/mobile/src/application/commands/syncStepGoalFromHealth.ts` — debounced (max 1/5min per goal) push to `PATCH /goals/:id/health-sync`.

#### A.12 Mobile — UI: streak tile (Home)

Traces to STORY-009 + § B.11.1.

- [ ] **A.12.1** `packages/mobile/src/ui/components/home/StreakTile.tsx` — pure presenter per § B.11.1. Props: `streak: UserStreak`, `onPress: () => void`.
- [ ] **A.12.2** Wire into `HomePresenter` above `GoalsSection`. Container fetches via `useStreaks` hook.
- [ ] **A.12.3** Accessibility: `accessibilityLabel` per § B.11.1, `accessibilityRole="button"`.
- [ ] **A.12.4** Presenter tests: rendering states (active / broken / paused), freeze-token badge counts (0 / 1 / 4), longest_count display.

#### A.13 Mobile — UI: habit completion grid (Goal detail)

Traces to STORY-008 + § B.11.2.

- [ ] **A.13.1** `packages/mobile/src/ui/components/goals/HabitCompletionGrid.tsx` — pure presenter per § B.11.2.
- [ ] **A.13.2** Wire into `GoalDetailPresenter` for `goal_type = 'habit_generic'`.
- [ ] **A.13.3** Tap-to-toggle → fires `recordHabitCompletion` mutation. Long-press → opens "log value" sheet for habits with `target_value`.
- [ ] **A.13.4** Accessibility per § B.11.2 — cell-level labels, grid role, focus order.
- [ ] **A.13.5** Presenter tests: today-cell tap, future-cell disabled, value-display, color contrast.

#### A.14 Mobile — UI: badge celebration

Traces to STORY-014 (AC 14.3, 14.4) + § B.11.3.

- [ ] **A.14.1** `packages/mobile/src/ui/components/achievements/BadgeCelebration.tsx` — modal overlay per § B.11.3.
- [ ] **A.14.2** Trigger logic in `HomeContainer` + `GoalDetailContainer`: on mount, check `cached_achievements` for any with `unlockedAt` newer than last-consumed timestamp (stored in AsyncStorage). Show overlay; on dismiss, update consumed timestamp.
- [ ] **A.14.3** Haptic + spring animation per § B.11.3.
- [ ] **A.14.4** Accessibility per § B.11.3 — `accessibilityRole="alert"`, focus trap.
- [ ] **A.14.5** Component tests: render, dismiss, accessibility-announcement firing.

#### A.15 Mobile — UI: achievements grid (Profile)

Traces to STORY-014 (AC 14.5, 14.6) + § B.11.4.

- [ ] **A.15.1** `packages/mobile/src/ui/containers/AchievementsContainer.tsx` + `ui/presenters/AchievementsPresenter.tsx`. Fetches via `useAchievements` hook.
- [ ] **A.15.2** Grouped horizontal carousels (`FlashList` per M11) per § B.11.4.
- [ ] **A.15.3** Wire into `ProfilePresenter` as a new section.
- [ ] **A.15.4** Badge-next-to-name display (STORY-014 AC 14.6) — pure presenter helper that picks the highest-tier `unlocked` achievement and renders the tier icon inline in `GreetingTile` + `ProfileHeader`.
- [ ] **A.15.5** Tests: container fetch, presenter rendering, locked/unlocked card variants.

#### A.16 Mobile — UI: goal detail extension + step-goal CTA

Traces to STORY-012 + STORY-015 + STORY-016 + § B.11.5 + § B.11.6.

- [ ] **A.16.1** Extend `GoalDetailPresenter` per § B.11.5: circular progress ring (SVG, animated stroke-dashoffset), streak tile inline, trainer-attribution label, gating affordances per STORY-015 AC 15.2.
- [ ] **A.16.2** `packages/mobile/src/ui/components/HealthConnectionBadge.tsx` — reusable per § B.11.6.
- [ ] **A.16.3** Wire step-goal flow: `GoalDetailContainer` reads HealthKit on mount + `AppState` resume; debounces and fires `syncStepGoalFromHealth`.
- [ ] **A.16.4** Empty-state CTA for permission-denied / no-HealthKit (STORY-012 AC 12.6).
- [ ] **A.16.5** Tests: presenter (with / without target_value, trainer-assigned variant), container (HealthKit-mock integration test).

#### A.17 Quality gates (Phase A)

- [ ] **A.17.1** Backend: prettier / typecheck / lint / build / test all pass. ≥ 90% coverage on every touched file in `microservices/core/src/application/streaks/`, `application/goals/`, `application/achievements/`, `application/repositories/`.
- [ ] **A.17.2** Mobile: same gates, ≥ 90% global aggregate.
- [ ] **A.17.3** Smoke test: SMOKE_TEST.md walkthrough per M4 milestone — habit creation → check-off → streak increments → milestone triggers celebration → achievement appears on Profile.

---

### Phase B — M8 cross-cut wiring (PT spec consumes; minimal Goals work)

Goals owns the column shape (already landed in Phase A: `assigned_by_user_id`). PT spec (`10-trainer-features`) implements the on-behalf write path + the trainer-side UI. The Goals tasks below are minimal — they cover the read-side surfacing of trainer-assigned goals in the user's own Goals UI.

Traces to STORY-015 + cross-cuts § 2.

- [ ] **B.1** Confirm `assigned_by_user_id` column lands in M4 per A.1.1 (this is the column 10-trainer-features writes to in M8). No new schema work in B.
- [ ] **B.2** Goals list / get API: project the trainer's `display_name` via join when `assigned_by_user_id IS NOT NULL`. New response field `assignedByDisplayName: string | null` per A.9.4. Maintain backward compat: when the column is NULL the field is `null`.
- [ ] **B.3** `GoalListPresenter` + `GoalDetailPresenter` render the `Goal set by Coach <display_name>` attribution per STORY-015 AC 15.1 — gated on `goal.assignedByDisplayName != null`.
- [ ] **B.4** `GoalDetailPresenter`'s Edit / Delete affordances gated per STORY-015 AC 15.2 (hide Edit; disable Delete with explanation sheet). Mark-complete remains available (AC 15.3).
- [ ] **B.5** Goal-assigned-by-trainer notification (`goal_assigned_by_trainer` per cross-cuts § 5) — the enum value lands in M4 per A.8.1; the M8 PT spec owns the emission point (the trainer's `POST /trainers/me/clients/:id/goals` handler).
- [ ] **B.6** Tests: presenter renders attribution + gated affordances correctly for `assigned_by_user_id` non-null vs null. Goal-list integration test covers the join projection.

#### B.7 Quality gates (Phase B)

- [ ] **B.7.1** Backend: prettier / typecheck / lint / build / test pass; ≥ 90% coverage on goal repository changes.
- [ ] **B.7.2** Mobile: same.
- [ ] **B.7.3** Smoke (covered in M8's SMOKE_TEST.md): trainer assigns goal → client receives notification → opens Goal detail → sees attribution + correct affordance gating.
