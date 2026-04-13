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
