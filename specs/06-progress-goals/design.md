# 06 — Progress & Goals: Technical Design

## Domain Models

```typescript
// src/domain/models/measurement.ts
export interface BodyMeasurement {
  id: string;
  userId: string;
  measuredAt: string;
  weight: number | null;
  bodyFatPercentage: number | null;
  chest: number | null;
  waist: number | null;
  hips: number | null;
  arm: number | null;
  thigh: number | null;
  notes: string | null;
}

// src/domain/models/record.ts
export interface PersonalRecord {
  id: string;
  userId: string;
  exerciseId: string;
  exerciseName: string;
  recordType: RecordType;
  value: number;
  achievedAt: string;
  sessionId: string;
}

export type RecordType =
  | "1rm"
  | "3rm"
  | "5rm"
  | "10rm"
  | "max_reps"
  | "max_weight"
  | "best_time"
  | "longest_distance";

// src/domain/models/goal.ts
export interface Goal {
  id: string;
  userId: string;
  name: string;
  goalType: GoalType;
  targetValue: number | null;
  currentValue: number | null;
  targetDate: string | null;
  status: GoalStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type GoalType =
  | "strength"
  | "endurance"
  | "weight_loss"
  | "muscle_gain"
  | "habit_building"
  | "custom";
export type GoalStatus = "active" | "completed" | "abandoned";
```

## Domain Services

```typescript
// src/domain/services/progressService.ts
export function calculateGoalProgress(goal: Goal): number; // 0-100%
export function detectNewRecords(
  sessionSets: ExerciseSet[],
  existingRecords: PersonalRecord[],
  exerciseId: string,
): PersonalRecord[];
export function calculateWeeklyStats(
  sessions: WorkoutSession[],
  startDate: Date,
): WeeklyStats;
export function calculateStreak(sessions: WorkoutSession[]): number;
export function prepareMeasurementChart(
  measurements: BodyMeasurement[],
  field: keyof BodyMeasurement,
  range: TimeRange,
): ChartData;
export function prepareStrengthChart(
  sessions: WorkoutSession[],
  exerciseId: string,
  range: TimeRange,
): ChartData;
```

## UI Components

```
containers/DashboardContainer.tsx            # Aggregates all dashboard data
presenters/DashboardPresenter.tsx            # Dashboard layout
containers/MeasurementListContainer.tsx      # Measurement history
presenters/MeasurementListPresenter.tsx      # Measurement list/chart
containers/MeasurementEditorContainer.tsx    # Log new measurement
presenters/MeasurementEditorPresenter.tsx    # Measurement form
containers/GoalListContainer.tsx             # Goal list with filters
presenters/GoalListPresenter.tsx             # Goal list UI
containers/GoalEditorContainer.tsx           # Create/edit goal
presenters/GoalEditorPresenter.tsx           # Goal form
containers/RecordListContainer.tsx           # Personal records by exercise
presenters/RecordListPresenter.tsx           # Records UI
components/ProgressChart.tsx                 # Generic line chart component
components/GoalProgressBar.tsx               # Goal % indicator
components/StatCard.tsx                      # Dashboard stat tile
components/RecentSessionCard.tsx             # Session summary for dashboard
components/QuickActions.tsx                  # Dashboard action buttons
```

## Charting

Use `react-native-svg` for simple charts (line, bar). Avoid heavy charting libraries — keep bundle small. Chart component is a presenter (receives data points, renders SVG).

## Offline Strategy

- All progress data cached locally
- New measurements/goals created offline, synced when online
- Personal records computed locally from session data
- Dashboard assembled from local cache (zero network dependency on cold start)

---

## Dashboard backend contract (M1)

`GET /dashboard` is the single aggregation endpoint powering the Home tab. Added M1 to unblock `HomeContainer` without requiring the mobile to fan out across five separate endpoints on tab mount. The response is a single object; the outer `data` envelope wraps it once — this is the **single-envelope** shape (`{ data: DashboardPayload }`), not the paginated double-envelope (`{ data: { data: [...], meta } }`) used for list endpoints. No M1 endpoint returns a paginated list, so no double-envelope handling is needed for this milestone.

### Response shape

```ts
type DashboardPayload = {
  profile: {
    id: string;
    fullName: string | null;
    firstName: string | null; // derived server-side from fullName for the greeting
    preferredUnits: "metric" | "imperial";
  };
  subscription: {
    tierName: string | null; // null = no active subscription (treated as free tier client-side)
    isFreeTier: boolean;
    isTrainerTier: boolean;
    status: "active" | "trialing" | "cancelled" | "past_due" | null;
  };
  recentWorkouts: Array<{
    id: string;
    name: string | null;
    description: string | null;
    estimatedDurationMinutes: number | null;
    createdBy: string;
    isAssigned: boolean; // true when assigned_by_type is set
    assignedByType: "personal_trainer" | "physiotherapist" | null;
  }>; // limit 10, user's own + assigned + default templates, ordered as legacy `getMyWorkouts`
  recentActivity: Array<{
    workoutSessionId: string;
    workoutId: string | null;
    workoutName: string;
    completedAt: string; // ISO8601 UTC
    durationSeconds: number | null;
  }>; // completed sessions in the last 7 days, most recent first
  activeGoals: Array<{
    id: string;
    title: string; // e.g. the goalType.displayName plus target
    current: number;
    target: number;
    unit: string;
    priority: number;
    targetDate: string | null;
  }>; // active only, ordered by priority
  progress: {
    workoutsThisMonth: number;
    workoutsLastMonth: number;
    streak: number; // consecutive-day streak, same algorithm as pre-M1 dashboard
    personalRecordsCount: number;
  };
  prOfTheWeek: {
    exerciseId: string;
    exerciseName: string;
    recordType: RecordType;
    value: number;
    unit: string;
    achievedAt: string;
  } | null; // single highest-impact PR in the last 7 days, null if none
  latestMeasurement: {
    id: string;
    weightKg: number | null;
    bodyFatPercentage: number | null;
    measuredAt: string; // ISO8601 UTC
  } | null;
};
```

### Derivations and sources

- `profile` — `profiles` table; `firstName` is the first whitespace-delimited token of `fullName`, or `null` when `fullName` is null. Whitespace is matched by `/\s+/` (covers non-ASCII whitespace); empty / whitespace-only `fullName` yields `firstName = null`.
- `subscription` — latest row in `user_subscriptions` joined to `subscription_tiers` on `tier_name`. The live Supabase schema stores the enum-shaped subscription status under `user_subscriptions.payment_status` (values: `"active" | "trialing" | "cancelled" | "past_due" | "pending"`) — there is **no** `user_subscriptions.status` column. The handler maps `payment_status` → the payload's `status` field, collapsing `"pending"` to `null` (nothing to surface) and leaving the four business-meaningful values as-is.
- `subscription.isFreeTier` follows the legacy rule:
  - `true` when the user has no `user_subscriptions` row,
  - `true` when the joined `subscription_tiers.tier_name = 'free'`,
  - `true` when `payment_status = 'cancelled'` AND (`expires_at` is non-null AND `expires_at <= now`),
  - `false` otherwise (active, trialing, past_due within grace, pending with a tier, or cancelled-but-still-in-paid-window).
- `subscription.isTrainerTier` — `subscription_tiers.is_trainer_tier` on the joined row; `false` when there's no row.
- `recentWorkouts` — concatenation in this order (legacy `getMyWorkouts` ordering): (1) user's own `workouts` (`created_by = :userId`, most recent first); (2) workouts assigned via `workout_assignments` where `client_id = :userId` (assignment recency, most recent first); (3) default templates (`created_by = SYSTEM_USER_ID` sentinel or `visibility = 'public'` fallback when assignments / owned are sparse). The union is truncated to the first 10 after deduplicating on `workout.id`. `isAssigned` is `true` iff the workout came via section (2).
- `assignedByType` — derived from the assigning trainer's role. For assigned workouts, the handler looks up the trainer's `profiles.role`: `"personal_trainer"` → `"personal_trainer"`, `"physiotherapist"` → `"physiotherapist"`, any other role → `null`. The live Supabase `workout_assignments` table has no dedicated `assigned_by_type` column (schema drift from the legacy API shape); using `profiles.role` is the authoritative source for the derived label. If a future migration adds the column, this derivation collapses to a direct projection.
- `recentActivity` — `workout_sessions` with `status = 'completed'` and `completed_at >= now - windowDays`, joined to `workouts` for the template name fallback (`workout_sessions.name || workouts.name`). Ordered by `completed_at DESC`. `workoutId` is the session's `workout_id` FK (nullable — the join is `LEFT`).
- `activeGoals` — `user_goals` where `is_active = true`, joined to `goal_types` for display. The live Supabase schema exposes `user_goals { id, user_id, goal_type_id, priority, is_active, target_date, notes }` — it has **no** `title`, `target_value`, `current_value`, or `unit` columns. The handler derives the payload fields from the join as follows:
  - `title` — `goal_types.description || goal_types.name` (category-typed display string).
  - `current` — `0` (schema has no stored progress; tracked client-side in M4).
  - `target` — `0` (schema has no stored target; tracked client-side in M4).
  - `unit` — `goal_types.category ?? ""` (closest available descriptor).
  - `priority` — `user_goals.priority ?? 1`.
  - `targetDate` — `user_goals.target_date` (stored as `text`).
  - Ordering: `priority ASC` (lower number = higher priority, matching legacy).
  - Spec follow-up — if / when M4 adds goal-progress tracking, extend `user_goals` with `target_value` / `current_value` / `unit` and update this derivation accordingly. M1 ships with defensive zeros so the mobile progress-bar presenter renders "0 / 0" gracefully.
- `progress.workoutsThisMonth` / `workoutsLastMonth` — count of `workout_sessions` with `status = 'completed'` bucketed by the `completed_at` UTC calendar month (`YYYY-MM` equal to the current month / the previous month at handler time).
- `progress.streak` — existing `calculateStreak` algorithm (unchanged from the pre-M1 repository). Lives as `getProgressStats`'s internal helper post-refactor.
- `progress.personalRecordsCount` — count of rows in `personal_records` for user (unchanged).
- `prOfTheWeek` — the `personal_records` row with `achieved_at >= now - windowDays`, picked by sorting candidates in application code by `achieved_at DESC`, then `recordType` rank (`1rm` = 8, `3rm` = 7, `5rm` = 6, `10rm` = 5, `max_weight` = 4, `max_reps` = 3, `best_time` = 2, `longest_distance` = 1) DESC, then `id` ASC as a final deterministic tiebreaker. Joined to `exercises` for `exerciseName`. `null` when the window is empty. The weighting is extracted as a pure `rankPersonalRecord(row)` helper so the test can assert determinism without seeding a DB.
- `latestMeasurement` — most recent `body_measurements` row by `measured_at DESC`. Numeric fields (`weight_kg`, `body_fat_percentage`) are coerced from Drizzle `numeric` strings to JavaScript `number` at the repo layer, not the mobile adapter. `measuredAt` is ISO8601 UTC.
- `prOfTheWeek.value` — also coerced from Drizzle `numeric` string to `number` at the repo layer.

### Status codes

- `200` — authenticated user. Response always has every field; empty collections are `[]`, absent objects are `null`. No partial responses.
- `401` — missing / invalid JWT.
- `500` — surfaced by the global Elysia error handler (M0) with the `cause` chain in dev stages.

### Handler and repository

- Handler: `microservices/core/src/application/dashboard/dashboardHandler.ts` (extend) — JWT-auth, no route params.
- Repository: `DashboardRepository.getDashboard(userId)` gains the subscription / recent-workouts / recent-activity / PR-of-the-week / active-goal-with-progress queries. Keep each sub-query behind a private method for test seams.
- All queries run in a single `Promise.all` to keep latency bounded on Lambda cold start.

### Non-goals (tracked for M4)

- Body-weight / steps tiles derived from backend. Health telemetry stays device-local (`07-health-integration`).
- Goal history, measurement charts, PR list UI (M4 Progress milestone).
- Workout CRUD modifications. The dashboard reads whatever `workouts` already returns.

---

## Dashboard mobile architecture (M1)

### Offline cache

Backend payload is cached in a new SQLite row keyed by `user_id`. TTL **5 minutes**, shorter than the reference-list cache (24h) because dashboard data is user-specific and shifts with every completed session.

```sql
CREATE TABLE IF NOT EXISTS cached_dashboard (
  user_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,  -- JSON-serialised DashboardPayload
  synced_at TEXT NOT NULL
);
```

`StoragePort` gains three methods that mirror the reference-list cache pattern:

```ts
getCachedDashboard(userId: string): CachedDashboard | null;
cacheDashboard(userId: string, payload: DashboardPayload): void;
getDashboardAge(userId: string): string | null;
```

### Application query

`packages/mobile/src/application/queries/dashboard.query.ts` — cache-first, background refresh when stale. Mirrors `getReferenceListQuery` shape:

```ts
export const DASHBOARD_STALE_AFTER_MS = 5 * 60 * 1000;

export function getDashboardQuery(
  storage: StoragePort,
  userId: string,
  now?: () => number,
): { payload: DashboardPayload | null; isStale: boolean };

export async function refreshDashboard(
  api: ApiPort,
  storage: StoragePort,
  userId: string,
): Promise<Result<DashboardPayload, ApiError>>;
```

### API port addition

```ts
// on ApiPort
getDashboard(): Promise<Result<DashboardPayload, ApiError>>;
```

`SSTApiAdapter.getDashboard` is a plain `GET /dashboard` with envelope unwrap — no UUID translation required (no reference-list-typed fields on the payload).

### Domain model

`packages/mobile/src/domain/models/dashboard.ts` holds `DashboardPayload` and its nested types, re-using `RecordType` from `record.ts`. No domain services — the payload is a view model and does not fan out to command/query code beyond the offline cache.

### UI structure

```
containers/HomeContainer.tsx     # Fetches dashboard + health data, wires taps
presenters/HomePresenter.tsx     # Pure; takes the full view-model
components/home/GreetingTile.tsx
components/home/SubscriptionBadge.tsx
components/home/GoalsSection.tsx
components/home/YourWorkoutsSection.tsx   # horizontal carousel
components/home/MyProgressSection.tsx     # tile grid
components/home/RecentActivitySection.tsx
components/home/StepsTile.tsx             # backed by HealthPort, see 07
components/home/PROfTheWeekCard.tsx
```

Ported 1:1 from `persistence-mobile/components/home/*` — same section order (Greeting → Goals → YourWorkouts → MyProgress → RecentActivity) and copy. V2 tokens only (`$primary #00D4FF`, etc — see `specs/_agent.md`). No visual redesign; that's M11.

### Entry animations

Each section uses `useStaggeredEntry(index)` (established in M0 exercise list) so the tiles fade in sequentially on mount. `HomePresenter` wraps each section in an `<Animated.View style={useStaggeredEntry(i)}>`.

### Container data pipeline

Follows the 3-memo pattern established in M0:

1. `cachedPayload` — `useMemo` over `storage.getCachedDashboard(userId)`, recomputes only when `cacheVersion` ticks.
2. `viewModel` — derives the presenter-shaped props from `cachedPayload` + live `HealthPort` readings. Cheap; recomputes when either input changes.
3. `animationStyles` — per-section staggered entry styles memoised on mount.

### Pull-to-refresh

Presenter accepts `onRefresh: () => Promise<void>` and `isRefreshing: boolean`. Container implementation calls `refreshDashboard` + re-reads `HealthPort` step/calorie values.

### Non-goals for M1

- Active workout popover (remain stubbed; reopening an active session is M3 Workouts milestone).
- Inline measurement logging from the tile (M4).
- Goal progress bars wired to real goal API — for M1, `activeGoals` is sourced from the backend but the only mutations are "Mark complete / abandoned" placeholders, rendered but non-functional.
- AI PT button (cosmetic, Alert on tap as in legacy).

---

## Appendix B — Habits, streaks, achievements (appended 2026-05-26 for M4 + M8)

This appendix extends the spec with the domain model for habit goals, streak tracking, freeze tokens, training-frequency goals, HealthKit-sourced step goals, calorie / macro goal cross-cuts, achievements, and the quantitative `target_value` / `current_value` / `unit` extension to `user_goals`. It implements STORY-008 through STORY-016 and consumes the shared primitives defined in `specs/_shared/cross-cuts.md` (§ 2 trainer-assigned goals, § 3 streak engine, § 5 notification taxonomy, § 6 migration sequencing).

Sections are append-only per `specs/_agent.md` § Spec-first discipline rule 7. The original `Goal` / `GoalType` / `GoalStatus` domain models above remain valid; the additions below extend them.

---

### § B.1 Schema migration — `user_goals` extension

Per `specs/_shared/cross-cuts.md` § 2.1 and § 6, the M4 milestone adds the following nullable columns to `user_goals`:

```sql
ALTER TABLE user_goals
  ADD COLUMN IF NOT EXISTS target_value       numeric(12, 3),
  ADD COLUMN IF NOT EXISTS current_value      numeric(12, 3),
  ADD COLUMN IF NOT EXISTS unit               text,
  ADD COLUMN IF NOT EXISTS assigned_by_user_id uuid REFERENCES profiles(id);

CREATE INDEX IF NOT EXISTS user_goals_assigned_by_idx
  ON user_goals (assigned_by_user_id)
  WHERE assigned_by_user_id IS NOT NULL;
```

**Rationale:**

- `target_value` / `current_value` / `unit` close gap 4 in [`specs/milestones/M4-progress/BRIEF.md`](../milestones/M4-progress/BRIEF.md) (M4 dashboard's `activeGoals` payload currently defaults `target` / `current` to `0` per design.md line ~211 — this migration replaces the defensive zeros with real values). Satisfies STORY-016 AC 16.1.
- `assigned_by_user_id` lands the cross-cuts § 2.1 column. M4 ships it nullable; cross-cuts § 6 puts the actual on-behalf writer logic in M8 (PT spec).
- All four columns nullable — no backfill, no migration downtime. Pre-migration rows preserve M1 dashboard's defensive `0 / 0` rendering.
- Idempotent (`IF NOT EXISTS`) per CLAUDE.md § Database & Migrations.

**Drizzle schema edit (M4 implementation work, NOT this spec extension):**

```typescript
// packages/db/src/schema.ts — M4 implementation will add:
targetValue: decimal("target_value", { precision: 12, scale: 3 }),
currentValue: decimal("current_value", { precision: 12, scale: 3 }),
unit: text("unit"),
assignedByUserId: uuid("assigned_by_user_id").references(() => profiles.id),
```

**Wire format:** `current_value` is server-managed per STORY-016 AC 16.5 — the client never PATCHes it directly. Updates flow from the source-of-truth subsystem per goal_type:

| `goal_type`                                                      | `current_value` source                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `weekly_workout_count`                                           | Count of completed sessions in current week (on-write via `POST /sessions`)          |
| `daily_steps`                                                    | HealthKit step total for current day (write-back from mobile; see § B.4)             |
| `daily_calories` / `daily_protein` / `daily_carbs` / `daily_fat` | Daily total from `nutrition_entries` (M9, owned by `13-nutrition-tracking`)          |
| `body_composition`                                               | Latest `body_measurements` row's relevant field (e.g. weightKg, bodyFatPercentage)   |
| `strength_pr`                                                    | Latest `personal_records` value for the linked exercise                              |
| `habit_generic`                                                  | Implicit (the existence of today's `habit_completion` is the satisfaction)           |
| `custom`                                                         | Client-supplied via `PATCH /goals/:id { currentValue }` — only allowed for this type |

---

### § B.2 Streak engine domain model

This spec **consumes** the streak engine defined in cross-cuts § 3. It does not redefine `user_streaks`, `streak_type_enum`, period semantics, freeze-token economy, or milestone thresholds — all live in cross-cuts.

What this spec owns:

1. **Which goal types create streaks automatically.** When a `user_goals` row is inserted with a `goal_type` in the table below, the goal-create handler also inserts a paired `user_streaks` row (single transaction) per cross-cuts § 3.2:

   | `goal_type`                                                      | Auto-streak `streak_type` | `period`                                         |
   | ---------------------------------------------------------------- | ------------------------- | ------------------------------------------------ |
   | `weekly_workout_count`                                           | `workout_streak`          | `weekly`                                         |
   | `daily_steps`                                                    | `habit_streak`            | `daily`                                          |
   | `daily_calories` / `daily_protein` / `daily_carbs` / `daily_fat` | `nutrition_streak`        | `daily`                                          |
   | `weekly_weigh_in`                                                | `measurement_streak`      | `weekly`                                         |
   | `habit_generic`                                                  | `habit_streak`            | `daily` OR `weekly` (user-chosen at create time) |

   Goal types not in this table (`strength_pr`, `body_composition`, `custom`) do NOT auto-create a streak. They are point-in-time / quantitative goals, not cadence goals.

2. **Streak deletion cascade.** Deleting a `user_goals` row cascades to delete its paired `user_streaks` row via FK `ON DELETE CASCADE` on `user_streaks.source_goal_id`. The cascade is intentional — the streak's identity is tied to the goal; deleting the goal kills the streak. (Past `habit_completions` rows also cascade per cross-cuts § 3.3.)

3. **Goal-detail view of the streak.** Goal detail renders the streak tile (`current_count` / `longest_count` / `freeze_tokens` per cross-cuts § 3.2) using `GET /streaks?goal_id=:id` (see § B.12). For point-in-time goals (no auto-streak), the tile is omitted.

4. **Achievement consumption.** Achievement inserts (cross-cuts § 3.6) are read by this spec's `GET /achievements/me` endpoint (§ B.12) and rendered in the Profile achievements grid (§ B.11).

---

### § B.3 Habit goal subsystem

`habit_completions` table per cross-cuts § 3.3 (defined there; not re-defined here).

**Goal-create flow for habit goals (`goal_type IN ('habit_generic')`):**

1. Client `POST /goals` body includes `goalType`, `name`, optional `targetValue` (e.g. 8 = "8 cups of water"), optional `unit` (e.g. `'cups'`), cadence (`'daily' | 'weekly'`).
2. Handler inserts `user_goals` row + paired `user_streaks` row (`streak_type = 'habit_streak'`, `period = cadence`) in one transaction.

**Habit completion flow:**

- `POST /goals/:id/completions` — request body `{ value?: number; completedAt?: ISO8601 }`.
- Handler enforces ownership (`user_goals.user_id = JWT sub`) per CLAUDE.md § Data Isolation, then inserts a `habit_completions` row.
- The unique constraint `(user_id, goal_id, date_trunc('day', completed_at))` per cross-cuts § 3.3 makes the insert idempotent — duplicate same-day taps return 200 (or 201, depending on conflict behaviour — see § B.12 wire shape) without erroring.
- Insert triggers the cross-cuts § 3.4 on-write streak evaluation.

**Daily-grid presenter (Goal detail):**

- Renders the last 30 days as a 7-wide × 5-tall grid (or `Math.ceil(30 / 7)`).
- The most recent 7 cells ("this week") render at 44pt (touch-target minimum per WCAG 2.1 AA AAA tap area); the prior 21 cells render at 28pt (read-only at distance).
- Tap on a present-day or past-day cell toggles completion: tap-to-toggle on TODAY only fires `POST /goals/:id/completions`; past cells are read-only (we don't allow back-dating completions in v1 — discourages gaming).
- Cell visual: filled = `$primary` colour with optional `value` label, unfilled = `$muted` outline. Future-day cells render disabled.
- Accessibility: each cell has `accessibilityLabel="<dayName>, <completed | not completed>"`; the grid container has `accessibilityRole="list"`.

**Value field semantics:** the optional `value` numeric on `habit_completions` (per cross-cuts § 3.3) supports quantitative habits (cups, minutes, reps). Rendering rule: cell shows `<value>` when `target_value` is also set; otherwise cell is binary checkmark-style. Satisfaction predicate for the streak engine: any `habit_completion` row exists for the day — `value` is not gated; partial progress still satisfies the period. (Rationale: gym habits like "drink water" benefit from a low-friction "any progress counts" rule; over-engineering thresholds creates abandonment risk per the Habitica anti-pattern noted in research.)

---

### § B.4 Step goals + HealthKit integration

Leverages the already-shipped `packages/mobile/src/adapters/health/expo-healthkit.adapter.ts` (`getStepsToday`, `getStepsLastNDays`, `getActiveCaloriesToday`). M1 stub is more mature than the ROADMAP implies; what's missing is the goal layer.

**Mobile read path (current_value sync):**

```
HomeContainer / GoalDetailContainer mount
  └─> HealthPort.getStepsToday() : Result<number, HealthError>
       └─> updates the active `daily_steps` goal's view-model `currentValue` in memory

AppState 'active' transition
  └─> same as above (re-read on resume)

Pull-to-refresh
  └─> same as above
```

**Backend write-back path (streak satisfaction):**

The streak engine needs to satisfy the day's period even when the mobile app is closed. M4 implementation adds a periodic write-back from mobile → backend:

- New backend route: `PATCH /goals/:id/health-sync` — body `{ value: number; recordedFor: ISO8601 date }`. Handler:
  1. Ownership-check (`user_goals.user_id = JWT sub`).
  2. Asserts `goal_type IN ('daily_steps', 'daily_calories' /* future */)`.
  3. Upserts the day's row in a new (or existing — pick at impl) `daily_activity_data` table: `(user_id, date, steps, active_calories)`.
  4. Updates `user_goals.current_value` for today's row.
  5. Invokes cross-cuts § 3.4 on-write streak evaluation.

- Mobile: a foreground `useEffect` in `HomeContainer` debounces step writes (max 1 write per 5 minutes per goal); the sync queue (per M10.6 mobile brief) absorbs offline-writes and replays on reconnect.
- Background write-back (true zero-app-open case) is out of scope for M4 — relies on iOS Background App Refresh which is not configured in this app. Document as a v2 follow-up.

**Weekly aggregation for streak satisfaction:** for `daily_steps` goals the streak engine satisfies the day period when `current_value >= target_value`. The weekly view (Goal detail's mini-bar-chart) aggregates the last 7 days from `daily_activity_data` via `GET /goals/:id/history?range=7d` (extends the existing `progressHistoryHandler`).

**Permission edge cases:**

- Permission denied → `HealthPort.getStepsToday()` returns `Err({ kind: 'PermissionDenied' })`. Goal detail renders the empty-state CTA per STORY-012 AC 12.6.
- Android Health Connect not installed → `getStepsToday` returns `Err({ kind: 'NotAvailable' })`. Same CTA, different copy.
- iOS user revokes permission post-create → same `PermissionDenied`; goal remains queryable but `current_value` freezes at last-known.

---

### § B.5 Training-frequency goals

A new `goal_types` row seeded in M4:

```sql
INSERT INTO goal_types (id, name, description, category, icon_name)
VALUES (
  gen_random_uuid(),
  'weekly_workout_count',
  'Train N times per week',
  'frequency',
  'calendar-check'
) ON CONFLICT (name) DO NOTHING;
```

**Domain rules (cross-references STORY-011):**

- `target_value` (1–7): sessions per week the user commits to.
- `current_value`: count of `workout_sessions` with `status = 'completed'` AND `completed_at` inside the current ISO week (Mon–Sun in user-local time per cross-cuts § 3.4).
- Paired `user_streaks` row: `streak_type = 'workout_streak'`, `period = 'weekly'`.
- Period satisfaction: `current_value >= target_value` (NOT strict equality — overshooting also satisfies; rewards consistency, not metronome-precision).
- On-write trigger: `POST /sessions` completion handler invokes `evaluateStreaks(userId, eventType='workout_logged', ts)` per cross-cuts § 3.4.

**Multiple workout-frequency goals per user:** allowed but discouraged in UI. Backend places no uniqueness constraint; the `user_goals_user_goal_type_idx` already prevents the same `goalTypeId` twice. UI shows a tip "You already have a weekly workout goal — edit that one?" if the user tries to create a second.

---

### § B.6 Calorie / macro goal cross-cut (with `13-nutrition-tracking`)

Per cross-cuts § 3.1 `nutrition_streak`: daily period satisfied when daily calorie / macro total falls within `target_value ± 10%`.

**Cross-cut boundary:**

- `06-progress-goals` (this spec) owns: the `goal_types` rows for `daily_calories` / `daily_protein` / `daily_carbs` / `daily_fat`; the `user_goals` row creation; the paired `user_streaks` row.
- `13-nutrition-tracking` owns: the `nutrition_targets` table; the `nutrition_entries` table; the daily-total rollup; the satisfaction-check helper that this spec's cron consumes.

**Reference, not duplication:** the goal stores `target_value` ON the `user_goals` row (write-through from the `nutrition_targets` row at goal-create time AND on every `PUT /nutrition/targets`). The goal-create handler:

1. Looks up the user's current `nutrition_targets` row.
2. Inserts `user_goals` with `target_value = nutrition_targets.daily_calories` (or relevant macro).
3. Inserts the paired `user_streaks` row.

When the user updates `nutrition_targets`, a background job (M9 implementation) syncs the new `target_value` into any linked `user_goals` rows. Single source of truth lives in `nutrition_targets`; the cache lives on `user_goals` for fast Goal-list rendering without a join.

**M4 status:** the `goal_types` seed rows ship; the create-goal UI gates the four nutrition types behind a feature flag (per STORY-013 AC 13.4) until M9 lights up `nutrition_targets` and the daily-total rollup.

---

### § B.7 Achievement / badge system

`user_achievements` (already in `packages/db/src/schema.ts:530`) gains population on streak milestones per cross-cuts § 3.6.

**M4 schema audit:** the existing `user_achievements` table joins to `achievements` (a static catalog table at `schema.ts:519`). For streak-milestone achievements, M4 seeds 10 `achievements` rows (5 weekly tiers × 2 streak types collapsed into one tier per cross-cuts § 3.6 — i.e. weekly thresholds at 1/2/4/8/12 wks, daily thresholds at 7/14/28/60/90 days, mapped to 10 distinct `achievement.name` rows):

```
streak_weekly_tier_1   "First Week"           1 wk
streak_weekly_tier_2   "Two-Week Builder"     2 wks
streak_weekly_tier_3   "Monthly Mover"        4 wks
streak_weekly_tier_4   "Eight-Week Forge"     8 wks
streak_weekly_tier_5   "Quarter-Year Crown"   12 wks
streak_daily_tier_1    "Seven-Day Spark"      7 days
streak_daily_tier_2    "Two-Week Habit"       14 days
streak_daily_tier_3    "Four-Week Forge"      28 days
streak_daily_tier_4    "Two-Month Burn"       60 days
streak_daily_tier_5    "Quarterly Crown"      90 days
```

Naming intentionally drifts from generic ("Achievement 1") into fitness-themed verbiage per CLAUDE.md (premium gym-app aesthetic, not generic UI).

**Insert flow (cross-cuts § 3.6):**

1. Streak engine advances `current_count` past a milestone threshold.
2. Engine queries `achievements` for the matching tier (e.g. `name = 'streak_weekly_tier_3'`).
3. Inserts `user_achievements (user_id, achievement_id, unlocked_at)`.
4. Emits `streak_milestone` notification (cross-cuts § 5).
5. The `unique (user_id, achievement_id)` index per `schema.ts:543` makes the insert idempotent — re-evaluating the same milestone doesn't re-emit.

**Visual: tier → icon mapping** (rendered by presenters, not stored — `iconName` lives on `achievements.icon_url` or we add a column TBD at M4 impl):

| Tier | Icon (Tamagui / lucide-react-native) | Color token |
| ---- | ------------------------------------ | ----------- |
| 1    | `flame`                              | `$orange9`  |
| 2    | `dumbbell`                           | `$blue9`    |
| 3    | `zap` (lightning)                    | `$yellow9`  |
| 4    | `medal`                              | `$purple9`  |
| 5    | `crown`                              | `$gold9`    |

Five tiers map 1:1 across weekly + daily families.

---

### § B.8 Goal-types seed list

Concrete seed list for `goal_types`. M4 implementation work — this section is the contract.

| `name`                 | `description`                            | `category`  | `iconName`       | Has auto-streak (§ B.2)  |
| ---------------------- | ---------------------------------------- | ----------- | ---------------- | ------------------------ |
| `strength_pr`          | Hit a personal record on a specific lift | `strength`  | `trophy`         | No                       |
| `weekly_workout_count` | Train N times per week                   | `frequency` | `calendar-check` | Yes (workout_streak)     |
| `daily_steps`          | Walk N steps per day                     | `activity`  | `footprints`     | Yes (habit_streak)       |
| `daily_calories`       | Eat within N kcal per day                | `nutrition` | `flame`          | Yes (nutrition_streak)   |
| `daily_protein`        | Eat N g protein per day                  | `nutrition` | `egg`            | Yes (nutrition_streak)   |
| `daily_carbs`          | Eat N g carbs per day                    | `nutrition` | `wheat`          | Yes (nutrition_streak)   |
| `daily_fat`            | Eat N g fat per day                      | `nutrition` | `droplet`        | Yes (nutrition_streak)   |
| `weekly_weigh_in`      | Weigh yourself N times per week          | `body`      | `scale`          | Yes (measurement_streak) |
| `habit_generic`        | A custom daily or weekly habit           | `habit`     | `check-circle`   | Yes (habit_streak)       |
| `body_composition`     | Reach a body-fat % or weight target      | `body`      | `target`         | No                       |
| `custom`               | A free-form goal with manual progress    | `custom`    | `flag`           | No                       |

Seed is idempotent (`ON CONFLICT (name) DO NOTHING`).

---

### § B.9 `aiGoals` reconciliation — recommendation

**Context:** `packages/db/src/schema.ts:694` exposes a parallel `aiGoals` table with `targetMetrics jsonb`, `currentProgress jsonb`, `status goalStatusEnum`, `goalType goalTypeEnum`, `isAiGenerated boolean`. It pre-dates `user_goals` extensions and was never spec'd.

**Recommendation: keep `aiGoals` as a separate AI-coach-only domain.** Do NOT merge into `user_goals`.

**Rationale:**

1. **Different write authority.** `user_goals` rows are user-or-trainer-set (per cross-cuts § 2). `aiGoals` rows are LLM-generated suggestions the user has not yet committed to. Conflating the two muddies the data lineage — "did the user actually set this goal?" becomes ambiguous.
2. **Different lifecycle.** `aiGoals` rows can be dismissed without affecting streaks, achievements, or trainer attribution. `user_goals` rows are first-class commitments. The state machines differ.
3. **`targetMetrics jsonb` is a shape-discovery surface.** The AI coach explores rich goal shapes ("lose 5kg by August AND hit 100kg bench AND walk 10k/day") that don't map cleanly onto the scalar `target_value` / `unit` columns. Keeping it flexible avoids forcing every AI-suggested goal into the lowest-common-denominator scalar.
4. **AI-acceptance flow.** When the user accepts an AI suggestion, the impl writes a `user_goals` row from the `aiGoals` row's `targetMetrics` (one-time projection). The `aiGoals` row stays for history.

**Future consideration:** if telemetry shows that AI-generated goals materially overlap with user-set goals in shape, revisit. For M4–M8, ship the AI surface independently and keep the data domains separate.

**Implication for this spec:** all M4 STORY-008–016 work targets `user_goals` and its new columns. `aiGoals` is out of scope for M4. Future AI-coach milestone (TBD, post-M8) extends `aiGoals` in its own spec.

---

### § B.10 `primaryGoalId` reconciliation — recommendation

**Context:** `profiles.primaryGoalId` (`schema.ts:234`) FK to `goal_types.id` exists in the schema; no spec mentions it.

**Recommendation: adopt for dashboard prominence.**

**Rationale:**

- The Home dashboard surfaces a list of "active goals" — but the legacy mobile UI (per `persistence-mobile/components/home/`) elevates ONE goal as the user's headline goal. The schema column was added with this in mind but never wired.
- Surfacing a "primary goal" prevents the goals section becoming a never-shrinking list. Users typically have ONE goal they actually care about (strength PR, weight loss, habit-build) and 1–3 secondary commitments.
- Adoption is cheap: existing column, existing FK; what's needed is (a) a setter UI ("Pin this as your main goal" sheet action) and (b) sort-by-`primary` on the dashboard's `activeGoals` payload.

**Implementation surface (not in M4 by default — flagged as a follow-up):**

- `POST /profile/primary-goal { goalTypeId }` — sets `profiles.primary_goal_id`.
- Dashboard's `getActiveGoalsWithProgress` (`design.md` § Dashboard backend contract) sorts by `(goalTypeId = primary_goal_id) DESC, priority ASC` — the primary surfaces first.
- Goal-list UI gains an "Edit primary goal" sheet on long-press of any goal.

**M4 status:** documented here so the schema isn't ghost-knowledge. Implementation deferred to M4.5 or M5 as appetite allows. Cross-cuts.md is not affected.

---

### § B.11 UI architecture — new screens

This section is a frontend-design pass for the net-new surfaces introduced by STORY-008 through STORY-016. Channels the `/frontend-design` skill principles (premium gym-app aesthetic, distinctive visual identity, Tamagui tokens, spring physics, haptic celebration) and the `design:accessibility-review` skill (WCAG 2.1 AA — contrast 4.5:1 normal text / 3:1 UI, touch ≥ 44×44pt, `accessibilityLabel` on every interactive element, focus order, no color-only conveyance).

Reuse existing components from `packages/mobile/src/ui/components/` (Card, Button, StatCard from M1, ProgressBar from M0) wherever possible.

#### § B.11.1 Streak tile (Home dashboard)

**Placement:** Top of `MyProgressSection` (above the workouts-this-month tile), or as a new section above Goals. To be confirmed against legacy in M4 implementation; this spec recommends "as a peer of GoalsSection, above it."

**Information architecture (top → bottom):**

1. Streak-type icon (cross-cuts § 3.1 mapping) + streak type label (`Workouts` / `Habits` / `Weigh-ins` / `Nutrition`)
2. `current_count` rendered XXL (96pt, `$primary` colour token), followed by unit (`weeks` / `days`)
3. `longest_count` rendered S (12pt, `$mutedColor`) — `Best: 12 weeks`
4. Freeze-token badge in top-right corner: small flame-shaped pip + count (visible even at 0, faint outline; full-fill at ≥1)
5. Fire icon to the left of `current_count` when `status = 'active'` AND `current_count > 0`; greyed out when `status = 'broken'`; replaced with calendar icon when `status = 'paused'`

**Primary affordances:**

- Tap → deep-link to source goal's detail screen (or to `/progress` if no source goal — see STORY-009 AC 9.4).
- Long-press → reveals "Hide this streak" sheet (v2; not in M4).

**Visual language hints:**

- Background: `$backgroundStrong` with `$primary`-tinted gradient (subtle, 5% opacity overlay) when streak is active; flat `$backgroundHover` when broken.
- Border: 1pt `$borderColor` softened; on celebration, briefly pulses `$primary` (spring physics, 300ms damping 0.6).
- Typography: `$heading` for `current_count`, `$body` for `Best:`, `$caption` for streak-type label.

**Accessibility:**

- `accessibilityLabel="Workout streak: 4 weeks. Personal best: 12 weeks. 2 freeze tokens available."`
- `accessibilityRole="button"`
- Touch target: full tile, ≥ 44pt height.
- The fire / calendar / freeze icons are paired with a text label (color-only conveyance avoided).

#### § B.11.2 Habit completion grid (Goal detail)

**Information architecture:**

- 30-day grid: 5 rows × 6 columns OR 4 rows of 7 cols + 1 trailing row of 2. Recommend the 4×7+2 layout for visual symmetry (matches weekday grouping).
- Week-grouping headers above each row of 7 (e.g. `Apr 28 – May 4`).
- Within a week row, days are Mon → Sun left → right (user-local ordering).
- The CURRENT week's row is larger (44pt cells) and pinned to the top; the prior 3 weeks render below at 28pt (read-only at distance).

**Primary affordances:**

- Tap on the TODAY cell → fires `POST /goals/:id/completions`. Optimistic update (cell fills immediately; reverts on API error).
- Tap on any other cell → opens a sheet showing the existing completion details (date, value, time). NO back-dating UI in v1.
- Long-press on TODAY cell with `target_value` set → opens a "log value" sheet (numeric input for `value` field per cross-cuts § 3.3).

**Visual language hints:**

- Filled cell: `$primary` background, white checkmark icon (16pt) centered; if `value` is set and `target_value` exists, replace checkmark with `<value>` text in `$bodyStrong`.
- Unfilled cell (past day, not future): `$backgroundHover` background, no border, no icon. Visual weight low.
- Future-day cells: `$mutedBackground`, dashed border, `$mutedColor` text. Disabled (no `onPress`).
- Today's cell pre-tap: `$backgroundStrong` background, `$primary` 2pt border (pulsing 1Hz to indicate the affordance).
- Today's cell post-tap: spring-animates to filled state (Tamagui `enterStyle`, damping 0.6, mass 1.2). Haptic `Haptics.impactAsync(Light)` on the tap.

**Accessibility:**

- Each cell: `accessibilityLabel="<dayName>, <month> <day>, <completed | not completed | future>"` with `accessibilityRole="button"` for past/today cells and `accessibilityState={{ disabled: true }}` for future.
- Grid container: `accessibilityRole="grid"`.
- Focus order: today first, then current week's other days L → R, then prior weeks descending row-by-row.
- Color + shape: filled cells carry both a color shift AND an explicit checkmark icon; the disabled-future cells carry both a color shift AND a dashed border.

#### § B.11.3 Badge celebration (post-milestone)

**When it fires:** the first Home or Goal-detail mount after a `streak_milestone` notification has been received. Local "consumed" flag stored in `AsyncStorage` keyed by `achievement_id` (so the overlay does not re-fire on subsequent mounts).

**Information architecture (modal overlay, ~80% screen height):**

1. Tier icon (per § B.7 mapping) at 144pt, centered.
2. Tier title in `$heading` (e.g. "Monthly Mover").
3. Threshold label in `$body` (e.g. "4 weeks of consistent workouts").
4. Streak summary in `$caption` (e.g. "Your current streak: 4 weeks").
5. Single primary CTA button: "Keep going" → dismisses.
6. Secondary text button: "Share" → opens iOS / Android share sheet with a pre-filled message + brand image. (Share copy: deferred to UX-copy pass — placeholder "I just hit a 4-week workout streak on Persistence!")

**Animation:**

- Mount: icon scales from 0.5 → 1.0 with spring (damping 0.5, mass 1, stiffness 180) over 400ms. Backdrop fades in 150ms before the icon mounts.
- Haptic: `Haptics.notificationAsync(Success)` at icon-mount frame.
- Icon micro-loop: subtle 1Hz pulse (scale 1.0 ↔ 1.05) until dismissed.
- Dismiss: backdrop fades out 200ms, modal slides down 250ms.

**Accessibility:**

- `accessibilityRole="alert"` on the modal container; auto-announces the tier title + threshold on mount via `AccessibilityInfo.announceForAccessibility`.
- "Keep going" button: `accessibilityLabel="Dismiss celebration"`.
- Backdrop tap dismisses (also `accessibilityRole="button"` with label "Dismiss").
- Focus traps to the modal until dismissed (per VoiceOver / TalkBack conventions).

#### § B.11.4 Achievements grid (Profile)

**Placement:** new section on Profile screen, below the existing personal-info area, above (or replacing) the empty placeholder.

**Information architecture:**

- Section header: "Achievements" + total-count badge (`12 unlocked`).
- Grouped-by-streak-type: `Workouts`, `Habits`, `Weigh-ins`, `Nutrition`. Each group is a horizontal carousel of badge cards, chronological-DESC (most recent unlock first).
- Each badge card: 96pt × 120pt — icon (per § B.7), tier title, unlock date.
- Locked tiers render as outlined-only versions (faint grey icon, lock overlay, "Locked" label). Visual progression hints at what's next.

**Primary affordances:**

- Tap on a badge card → opens a sheet with the achievement details (title, threshold, unlocked date, share button).
- Long-press on a locked badge → tooltip "Reach 8 weeks of workouts to unlock."

**Visual language hints:**

- Carousel uses `FlashList` horizontal (perf budget per M11). Snap-to-card.
- Unlocked cards: tier-color background tint (10% opacity), full-color icon.
- Locked cards: `$mutedBackground`, `$mutedColor` icon at 50% opacity, lock-icon overlay top-right.
- Group headers: `$subtitle` with a tier-icon prefix (matching the group's primary streak icon).

**Accessibility:**

- Each card: `accessibilityLabel="<tier title>. Unlocked <date>"` or `"<tier title>. Locked. Reach <threshold> to unlock."`
- Carousel container: `accessibilityRole="list"`.
- Horizontal-scroll affordance announced via VoiceOver scroll hint.

#### § B.11.5 Goal detail extension

The existing `GoalDetailContainer` / `GoalDetailPresenter` (M4 implementation) extends to render:

- `target_value` / `current_value` / `unit` (when present per STORY-016 AC 16.2) as a prominent header card with a circular progress ring (AC 16.3). Ring uses `react-native-svg` (already in deps from M1) — animated stroke-dashoffset fills on mount.
- Streak tile (§ B.11.1 variant — smaller, inline) when the goal has a paired `user_streaks` row.
- Habit completion grid (§ B.11.2) when `goal_type = 'habit_generic'`.
- "Goal set by Coach X" attribution label (per STORY-015 AC 15.1) when `assigned_by_user_id IS NOT NULL`.
- For step / nutrition / measurement goals: the "Connected to Apple Health" / "Linked to nutrition targets" / "Latest weigh-in: X" sub-cards.

**Edit affordance gating per STORY-015 AC 15.2:** hide "Edit" and disable "Delete" with explanation sheet when goal is trainer-assigned. "Mark complete" remains available (AC 15.3).

#### § B.11.6 Step goal — "Connected to Apple Health" indicator

A reusable `<HealthConnectionBadge source="apple_health" | "health_connect">` component lives in `packages/mobile/src/ui/components/`. Renders a small horizontal pill:

- Apple Health logo (16pt) + label "Connected to Apple Health" + a checkmark or warning icon depending on permission state.
- Tap → opens system Health settings via `Linking.openURL('x-apple-health://')` (iOS) or the Android equivalent.

Used on Goal detail for `daily_steps` goals. Reusable for future `daily_calories` (when paired with HealthKit nutrition import).

---

### § B.12 Backend endpoints to add

The implementation surface for the M4 backend work. Listed here as the contract; M4's `BACKEND_BRIEF.md` is the existing source for the M4-specific gap-fills.

#### `POST /goals/:id/completions` — record a habit completion

```
POST /goals/:id/completions
Authorization: Bearer <jwt>
Content-Type: application/json

{
  value?: number;           // optional numeric (cups, minutes, etc.)
  completedAt?: string;     // ISO 8601 UTC; defaults to now()
}

Response 201: { "data": HabitCompletion }
Response 200: { "data": HabitCompletion }   // existing same-day row returned idempotently
Response 404: { "error": "Goal not found" } // wrong user OR missing
Response 422: { "error": "Goal type does not accept completions" }  // e.g. strength_pr
```

**Behaviour:**

- Ownership-check (`user_goals.user_id = JWT sub`).
- Assert `goal_type IN ('habit_generic', /* future habit-family types */)`.
- Insert via `ON CONFLICT (user_id, goal_id, date_trunc('day', completed_at)) DO UPDATE SET value = EXCLUDED.value` so re-taps update the optional `value` field.
- Invoke cross-cuts § 3.4 on-write streak evaluation in the same transaction (atomicity per cross-cuts § 1.4.2 audit pattern).

#### `GET /streaks?goal_id=:id` — fetch a user's streak by source goal

```
GET /streaks?goal_id=<uuid>
Authorization: Bearer <jwt>

Response 200: { "data": UserStreak | null }
```

When `goal_id` is omitted, returns `{ data: UserStreak[] }` — all the user's streaks. Filtered always by `user_id = JWT sub`.

#### `POST /streaks/:id/manual-eval` — admin / debug endpoint

```
POST /streaks/:id/manual-eval
Authorization: Bearer <jwt>

Response 200: { "data": UserStreak }   // post-evaluation state
Response 403: { "error": "Forbidden" } // non-admin caller
```

Only callable by `role = 'admin'`. Forces a streak evaluation for the row regardless of period-rollover state. Diagnostic tool — never invoked by the mobile app.

#### `GET /achievements/me` — fetch the user's earned achievements

```
GET /achievements/me
Authorization: Bearer <jwt>

Response 200: {
  "data": Array<{
    id: string;
    achievementId: string;
    name: string;       // e.g. "streak_weekly_tier_3"
    title: string;      // e.g. "Monthly Mover"
    tier: 1 | 2 | 3 | 4 | 5;
    streakFamily: 'weekly' | 'daily';
    unlockedAt: string; // ISO 8601 UTC
  }>;
}
```

Joined `user_achievements` → `achievements`; ordered by `unlocked_at DESC`. Consumed by the Profile achievements grid.

#### `PATCH /goals/:id/health-sync` — periodic write-back from HealthKit

See § B.4 for the full behaviour. Body: `{ value: number; recordedFor: ISO8601 date }`.

---

### § B.13 Notification triggers

Per cross-cuts § 5, the following notifications are emitted by this spec's M4 backend:

| Trigger                                                              | `notification_type`        | Emitted by                                                   |
| -------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------ |
| Streak `current_count` advances past a milestone threshold           | `streak_milestone`         | Streak engine on-write (cross-cuts § 3.6)                    |
| Current day is the last day of a period AND period not yet satisfied | `streak_at_risk`           | Nightly cron at 18:00 user-local                             |
| Nightly cron applies a freeze token                                  | `freeze_token_applied`     | Nightly cron at 02:00 UTC (cross-cuts § 3.4 + § 3.5)         |
| `current_value` crosses ≥ 50% / ≥ 80% / ≥ 100% of `target_value`     | `goal_milestone`           | Goal-update path (whichever flow updates `current_value`)    |
| `assigned_by_user_id` is set (a trainer assigns a goal)              | `goal_assigned_by_trainer` | Trainer's `POST /trainers/me/clients/:id/goals` (M8 surface) |

The M7 notification-types DB enum already contains `workout_assigned` (and likely others — verify in M4 impl). M4 work that introduces NEW enum values (`streak_milestone`, `streak_at_risk`, `freeze_token_applied`, `goal_milestone`, `goal_assigned_by_trainer`) must include the enum-value migration; M7 owns the user-facing preferences surface.

**Default opt-in per cross-cuts § 5:** all of the above default ON.
