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

- `profile` — `profiles` table; `firstName` is the first whitespace-delimited token of `fullName`, or `null` when `fullName` is null.
- `subscription` — latest row in `user_subscriptions` joined to `subscription_tiers`. `isFreeTier` follows the legacy `isFreeTier` rule: `true` when no active subscription, when the tier's `tierName = 'free'`, or when status is `cancelled` and the billing period has ended.
- `recentWorkouts` — union of: user's own `workouts`, workouts assigned via `workout_assignments`, and default templates. Same ordering and limit (10) as the legacy `getMyWorkouts`.
- `recentActivity` — `workout_sessions` completed within `now - 7d`, joined to `workouts` for the template name fallback.
- `activeGoals` — `user_goals` where `is_active = true`, joined to `goal_types` for display.
- `progress.workoutsThisMonth` / `workoutsLastMonth` — count of completed sessions bucketed by calendar month.
- `progress.streak` — existing `calculateStreak` algorithm in `DashboardRepository` (unchanged).
- `progress.personalRecordsCount` — count of rows in `personal_records` for user (unchanged).
- `prOfTheWeek` — the `personal_records` row with the highest `achievedAt` within `now - 7d`; ties broken by `recordType` weighting (`1rm` > `3rm` > `5rm` > `10rm` > `max_weight` > `max_reps` > `best_time` > `longest_distance`). `null` when no records in the window.
- `latestMeasurement` — most recent `body_measurements` row (numeric fields emitted as `number`, not string, so mobile doesn't parse).

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
