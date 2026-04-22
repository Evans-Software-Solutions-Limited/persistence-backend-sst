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
