# M4 — Frontend Agent Brief

You are implementing the frontend track of Milestone 4 — Progress. Read the parent [`BRIEF.md`](./BRIEF.md) first, then this brief, then [`BACKEND_BRIEF.md`](./BACKEND_BRIEF.md) for the wire-format contract.

You are working on the React Native / Expo mobile app at `/Users/bradleysimms-evans/Documents/projects/personal/persistence-backend-sst/packages/mobile/`. You are NOT touching the backend — that is the backend agent's responsibility. You may read backend code for context, but every wire-shape question is answered in [`BACKEND_BRIEF.md`](./BACKEND_BRIEF.md) — read it before writing adapter code.

## Authority

- Parent spec: [`../../06-progress-goals/`](../../06-progress-goals/) — requirements + design + tasks. Currently has gaps M4's first commit must close (see § Spec-update commit below). The backend agent's spec-update commit owns gaps 1 / 3 / 5 / 6 / 7; this brief's spec-update commit owns gap 2 (Progress mobile architecture section body) + the mobile-side half of gap 5.
- Mobile architectural rules: [`../../_agent.md`](../../_agent.md) — hexagonal architecture, container/presenter split, ports & adapters, 90% global aggregate coverage non-negotiable.
- Legacy reference app: `/Users/bradleysimms-evans/Documents/projects/personal/persistence-mobile/` — **behavioural source of truth** + the visual port reference. Match flows + UI 1:1. Do NOT copy architecture (legacy is hook-heavy + direct Supabase; V2 is ports/adapters + SST API).

## TL;DR

Build the Progress tab. PR carousel + last-30-days activity tile + measurement trend chart + measurement editor modal + goal list + records list. Cache-first via 5-minute TTL (mirrors M1 dashboard). Offline-first writes via the existing sync queue worker. Port legacy presenters EXACTLY — no aesthetic revamp, no `/frontend-design` polish (that's M11).

PR detection rule is the foot-gun. **Read § "Hazards: PR detection display rule" below before writing any PR-carousel code.**

## Port-1:1 discipline

The legacy app's Progress flow is proven and what real users learned. Your job is to port flows, business logic, copy, and visual layout **exactly**. The `/frontend-design` polish pass is M11 — NOT M4.

Specifically:

- Match legacy copy verbatim (section titles, empty-state strings, modal copy, button labels).
- Match legacy interaction model (tap PR card → no-op / detail; pull-to-refresh; time-range pills; Add Measurement FAB or header button).
- Match legacy chart visual (line + dots, no gradients we didn't have, same x-axis tick density).
- Match legacy section ordering on the Progress screen.
- Match legacy time-range options (`1w / 1m / 3m / 6m / 1y / all`).

If a legacy pattern looks dated (e.g. unanimated tab transitions), note it in the PR description as a follow-up candidate for M11, but **do not refactor it during M4**.

## Spec-update commit (FIRST commit on the branch — non-negotiable)

The backend agent's spec-update commit on the OTHER branch covers most of the gaps. THIS branch's spec-update commit covers the mobile-architecture half. Specifically:

### Edit `specs/06-progress-goals/design.md`

The backend agent's spec-update commit adds a placeholder "Progress mobile architecture (M4)" section. THIS commit fills it out — mirroring the existing "Dashboard mobile architecture (M1)" section's depth.

Required content:

1. **SQLite schema for the new caches**:

   ```sql
   CREATE TABLE IF NOT EXISTS cached_progress (
     user_id TEXT NOT NULL,
     time_range TEXT NOT NULL,                -- '1w' | '1m' | '3m' | '6m' | '1y' | 'all'
     payload TEXT NOT NULL,                   -- JSON: { stats, history, records, latestMeasurement, activeGoals }
     synced_at TEXT NOT NULL,
     PRIMARY KEY (user_id, time_range)
   );

   CREATE TABLE IF NOT EXISTS cached_measurements (
     user_id TEXT PRIMARY KEY,
     payload TEXT NOT NULL,                   -- JSON: BodyMeasurement[] (descending by measuredAt)
     synced_at TEXT NOT NULL
   );

   CREATE TABLE IF NOT EXISTS cached_goals (
     user_id TEXT PRIMARY KEY,
     payload TEXT NOT NULL,                   -- JSON: Goal[] (active + completed, mobile filters)
     synced_at TEXT NOT NULL
   );
   ```

   `cached_personal_records` already exists from M3 — reuse, don't duplicate.

2. **`StoragePort` extensions** (mirrors the dashboard cache contract at storage.port.ts:172-198):

   ```ts
   getCachedProgress(userId: string, timeRange: TimeRange): CachedProgress | null;
   cacheProgress(userId: string, timeRange: TimeRange, payload: ProgressPayload): void;
   getProgressAge(userId: string, timeRange: TimeRange): string | null;
   invalidateProgress(userId: string): void;             // invalidates ALL time-range slots

   getCachedMeasurements(userId: string): BodyMeasurement[] | null;
   cacheMeasurements(userId: string, list: BodyMeasurement[]): void;
   invalidateMeasurements(userId: string): void;

   getCachedGoals(userId: string): Goal[] | null;
   cacheGoals(userId: string, list: Goal[]): void;
   invalidateGoals(userId: string): void;
   ```

3. **5-minute TTL** (`PROGRESS_STALE_AFTER_MS = 5 * 60 * 1000`) — same as dashboard. Measurements + goals caches are written-through on every mutation; reads serve cache instantly + background-refresh when older than TTL.

4. **Query layer** (`packages/mobile/src/application/queries/progress.query.ts`):

   ```ts
   export function getProgressQuery(
     storage: StoragePort,
     userId: string,
     timeRange: TimeRange,
     now?: () => number,
   ): { payload: ProgressPayload | null; isStale: boolean };

   export async function refreshProgress(
     api: ApiPort,
     storage: StoragePort,
     userId: string,
     timeRange: TimeRange,
   ): Promise<Result<ProgressPayload, ApiError>>;
   ```

5. **Time-range presets**: mobile derives `from` / `to` from the preset client-side:

   ```ts
   const RANGE_TO_DAYS = {
     "1w": 7,
     "1m": 30,
     "3m": 90,
     "6m": 180,
     "1y": 365,
     all: Infinity,
   };

   function rangeToFromTo(range: TimeRange): { from: string; to: string } {
     const now = new Date();
     const to = now.toISOString();
     if (range === "all")
       return { from: "1970-01-01T00:00:00.000Z" /* epoch sentinel */, to };
     const fromMs = now.getTime() - RANGE_TO_DAYS[range] * 24 * 60 * 60 * 1000;
     return { from: new Date(fromMs).toISOString(), to };
   }
   ```

6. **Container / presenter file list** — copy from this brief's § Files you will touch. Document each in `design.md` at the section level (no detailed prop typing needed; that lives in the code).

7. **PR detection display rule** (mobile half):

   > The Progress screen's PR carousel + Records list render ONLY `personal_records` rows the backend has written. The mobile MUST NOT compute Epley 1RMs for display. The strength chart (per-exercise trend) IS allowed to consume the Epley-coerced `oneRepMax` value from `GET /progress/strength` because that's a chart trend value across heterogeneous rep ranges, not an achievement claim. Document the discipline in the `ProgressChart` component header comment so a later refactor doesn't blur the distinction.

8. **Sync intent kinds** added for M4:

   ```
   createMeasurement → POST /measurements
   updateMeasurement → PATCH /measurements/:id
   deleteMeasurement → DELETE /measurements/:id
   updateGoalStatus → PATCH /goals/:id { isActive: boolean }
   ```

   Each call to a mutation command writes-through to the local cache, enqueues the intent, calls `storage.invalidateDashboard(userId)` (the Progress tile on Home reads dashboard data, not the new caches), AND invalidates the relevant Progress cache (`invalidateMeasurements` / `invalidateGoals`). Worker drains on next online tick.

Commit message format:

```
docs(M4): mobile architecture for Progress milestone

- design.md: fills "Progress mobile architecture (M4)" section with SQLite schema, StoragePort extensions, 5-min TTL, query layer shape, time-range preset mapping, PR-detection display rule, sync intent kinds
- requirements.md: STORY-006 AC bullets refined for cache-first + 5-min TTL

Spec alignment: closes gap 2 (mobile architecture section body) + mobile-side of gap 5 (time-range presets) from specs/milestones/M4-progress/BRIEF.md § Spec alignment + gaps.

Depends on: backend agent's spec-update commit on the backend branch closing gaps 1, 3, 5 (backend half), 6, 7.
```

ONLY after this commit lands do implementation commits start.

## Hazards: PR detection display rule (NON-NEGOTIABLE)

This is the foot-gun. State it three ways so the implementing agent cannot miss it:

1. **NO Epley estimates on the PR carousel.** A 55kg × 7-rep set must NOT produce a "1 Rep Max: 73.3 kg" card. The achievements / PR screen renders ONLY the canonical records the server has written to `personal_records`. Server emits these via exact-rep-match + `max_weight` + `max_volume` (see [`personalRecordsRepository.ts`](../../../microservices/core/src/application/repositories/personalRecordsRepository.ts)).
2. **Skip first-occurrence.** The server's `recordPRsForSession` already filters out first-occurrence rows from its returned list. Don't add a synthetic "First time! 100kg!" card — there is no such row to render.
3. **Six record types and ONLY six**: `'1rm' | '3rm' | '5rm' | '10rm' | 'max_weight' | 'max_volume'`. If a `'max_reps' | 'best_time' | 'longest_distance'` row appears in the backend response (it shouldn't in M4, but the enum allows them), the presenter handles it gracefully — either skip-render or render with a generic "Personal Record" label — but does NOT mislabel it as a 1RM.

The strength chart (different surface, line chart over time per exercise) IS allowed to render the Epley-coerced `oneRepMax` from `GET /progress/strength` because that's a comparable across rep ranges for trend visualisation, not an achievement card. Annotate the `ProgressChart` source so a future contributor understands the distinction.

If you find yourself writing `weight * (1 + reps / 30)` anywhere in `packages/mobile/src/ui/`, STOP and re-read this section.

## Scope

Six slices. Recommended commit order: spec → domain models + ports → adapter / SQLite → commands → presenters → containers → screen wiring. Land all on the same branch.

### 1. Domain models

Spec: [`design.md` § Domain Models](../../06-progress-goals/design.md).

**Confirm / extend** `packages/mobile/src/domain/models/record.ts`:

- Already exports `PersonalRecord` + `RecordType` from M3.
- Extend the `RecordType` union to include `'max_volume'` (already in the backend wire type — confirm parity).

**New** `packages/mobile/src/domain/models/measurement.ts`:

```ts
export interface BodyMeasurement {
  id: string;
  userId: string;
  measuredAt: string; // ISO 8601 UTC
  weightKg: number | null;
  bodyFatPercentage: number | null;
  chestCm: number | null;
  waistCm: number | null;
  hipsCm: number | null;
  leftArmCm: number | null;
  rightArmCm: number | null;
  leftThighCm: number | null;
  rightThighCm: number | null;
  notes: string | null;
}

export type MeasurementField =
  | "weightKg"
  | "bodyFatPercentage"
  | "chestCm"
  | "waistCm"
  | "hipsCm"
  | "leftArmCm"
  | "rightArmCm"
  | "leftThighCm"
  | "rightThighCm";
```

**New** `packages/mobile/src/domain/models/goal.ts`:

```ts
export interface Goal {
  id: string;
  userId: string;
  goalTypeId: string;
  goalTypeName: string; // joined from goal_types — backend list response must include this; if not, add via slice 6 verification
  priority: number;
  targetDate: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Mobile-derived status — see spec gap 3 (Option B): no separate 'abandoned' state.
export type GoalStatus = "active" | "completed";
export function deriveGoalStatus(goal: Goal): GoalStatus {
  return goal.isActive ? "active" : "completed";
}
```

**New** `packages/mobile/src/domain/models/progress.ts`:

```ts
export type TimeRange = "1w" | "1m" | "3m" | "6m" | "1y" | "all";

export interface ProgressPayload {
  stats: {
    workoutFrequency: number;
    volumeTrend: number[];
    personalRecordCount: number;
    bodyMeasurementTrend: {
      dates: string[];
      weights: (number | null)[];
      bodyFats: (number | null)[];
    };
  };
  history: ProgressHistoryEntry[];
  records: PersonalRecord[];
  prOfTheWeek: PersonalRecord | null; // most recent PR in last 7 days (cached from dashboard payload if available)
  latestMeasurement: BodyMeasurement | null;
  activeGoals: Goal[];
  syncedAt: string;
  timeRange: TimeRange;
}

export interface ProgressHistoryEntry {
  id: string;
  name: string | null;
  startedAt: string | null;
  completedAt: string | null;
  status: "in_progress" | "completed" | "cancelled";
  totalDurationSeconds: number | null;
}

export interface ProgressStrengthPoint {
  sessionId: string;
  sessionCompletedAt: string;
  bestSet: {
    setId: string;
    weightKg: number;
    reps: number;
    oneRepMax: number | null; // Epley — CHART ONLY
    maxVolume: number;
  };
  totalVolume: number;
}

export interface CachedProgress {
  payload: ProgressPayload;
  syncedAt: string;
}
```

Export all from `domain/models/index.ts`.

### 2. Pure domain services

Spec: [`design.md` § Domain Services](../../06-progress-goals/design.md).

**New** `packages/mobile/src/domain/services/progressService.ts`:

- `calculateGoalProgress(goal: Goal): number` — 0-100%. With the deferred schema decision (gap 4), this returns `0` unless a future M-x adds target/current fields. Keep the function pure + ready for later.
- `prepareMeasurementChart(measurements: BodyMeasurement[], field: MeasurementField, range: TimeRange): ChartData` — derives `{ labels: string[]; values: (number | null)[] }` for the SVG chart.
- `prepareStrengthChart(points: ProgressStrengthPoint[], range: TimeRange): ChartData` — same shape, reads `bestSet.oneRepMax` for the y-axis.
- `rangeToFromTo(range: TimeRange): { from: string; to: string }` — exported for the query layer.

100% unit test coverage on this module. Pure functions; trivial.

### 3. Ports + adapters

Spec: [`design.md` § StoragePort extensions / ApiPort extensions](../../06-progress-goals/design.md).

**Extend** `packages/mobile/src/domain/ports/storage.port.ts`:

- Three new caches (progress, measurements, goals) per the spec-update commit's SQLite schema.
- Methods documented in slice 1 of the spec-update content above.

**Extend** `packages/mobile/src/adapters/storage/sqlite.adapter.ts`:

- Three new table creates in `initialize()`.
- Read methods JSON.parse the payload column; write methods JSON.stringify. Same pattern as `cached_dashboard` / `cached_profile_page`.

**Extend** `packages/mobile/src/adapters/storage/__tests__/in-memory-storage.adapter.ts`:

- In-memory mirror for tests. Same shape as the dashboard cache stub.

**ApiPort** additions are already declared by the backend agent's slice 5 commit. Verify the three new methods (`updateMeasurement`, `deleteMeasurement`, `getStrengthHistory`) are wired in the SST adapter. If the backend agent's PR hasn't landed yet, stub them in `InMemoryApiAdapter` mirroring the agreed wire shapes.

### 4. Application queries + commands

Spec: [`design.md` § Application Layer](../../06-progress-goals/design.md).

**New** `packages/mobile/src/application/queries/progress.query.ts`:

- `getProgressQuery(storage, userId, timeRange, now?)` — cache-first; returns `{ payload, isStale }`. `isStale` is true when `synced_at` older than 5 minutes.
- `refreshProgress(api, storage, userId, timeRange)` — runs four parallel API calls (`getStats(from, to)` + `getHistory()` + `getProgressRecords()` + `getMySubscription` for dashboard-level "PR of the week" reuse), packs into `ProgressPayload`, caches, returns Result. The PR-of-the-week + latestMeasurement come from the existing `getDashboard` payload — reuse the dashboard cache to avoid an extra round trip.
- `refreshMeasurements(api, storage, userId)` — `getMeasurements` → cache-write → return list.
- `refreshGoals(api, storage, userId)` — `getGoals` → cache-write → return list.
- `refreshStrengthHistory(api, exerciseId, range)` — no cache for strength history (rare per-exercise drill-in; small payload; freshness > offline). Cold call every time.

Each query function must call `processSyncQueue` BEFORE the GET (M2 learning #1).

**New** `packages/mobile/src/application/commands/progress/`:

- `add-measurement.command.ts` — write-through cache + enqueue `POST /measurements` + invalidate dashboard.
- `update-measurement.command.ts` — write-through cache + enqueue `PATCH /measurements/:id` + invalidate dashboard.
- `delete-measurement.command.ts` — remove from cache + enqueue `DELETE /measurements/:id` + invalidate dashboard.
- `update-goal-status.command.ts` — write-through cache + enqueue `PATCH /goals/:id { isActive: false | true }` + invalidate dashboard.

All four commands follow the M2 pattern: SQLite-write-first → enqueue → return updated optimistic state. ID strategy for new measurements: `local-`-prefixed UUID, swapped by the sync worker post-flush (same pattern as workouts + sessions).

### 5. Hooks

Spec: [`design.md` § Container responsibilities](../../06-progress-goals/design.md).

**New** `packages/mobile/src/ui/hooks/useProgress.ts`:

- Wraps `getProgressQuery` + `refreshProgress`. Exposes `{ payload, isStale, isRefreshing, refresh, timeRange, setTimeRange }`.
- Mirrors `useDashboard.ts` shape exactly. Triple-memo pattern (`cachedPayload` → `viewModel` → `animationStyles`).
- `setTimeRange` triggers re-read from the cache slot for the new range (cache is keyed by `(userId, timeRange)`), background-refreshes if stale.

**New** `packages/mobile/src/ui/hooks/useMeasurements.ts`:

- Wraps measurement queries + commands. Exposes list + `{ add, update, remove, refresh }`.

**New** `packages/mobile/src/ui/hooks/useGoals.ts`:

- Wraps goal queries + status command. Exposes list + `{ updateStatus, refresh }`. Filter state owned by the container; this hook returns the unfiltered list.

**New** `packages/mobile/src/ui/hooks/usePersonalRecords.ts`:

- Wraps `api.getPersonalRecords()` + `storage.cachePersonalRecords` (already exists). Used by both PR carousel + full Records list. Filter params (`exerciseId`, `recordType`) for the Records list.

**New** `packages/mobile/src/ui/hooks/useStrengthChart.ts`:

- Wraps `api.getStrengthHistory(...)`. Stateless (no cache). Exercise-drill-down only — Progress tab doesn't mount this by default.

### 6. UI components + presenters + containers

Spec: [`design.md` § UI Components](../../06-progress-goals/design.md).

#### Reusable components

`packages/mobile/src/ui/components/progress/`:

- `ProgressChart.tsx` — SVG line chart. Pure presenter. Props: `data: ChartData; xLabel: string; yLabel: string; height: number`. Uses `react-native-svg` (already in deps). Header comment documents the Epley-OK-for-chart-trend discipline.
- `TimeRangeSelector.tsx` — horizontal pill row (`1w / 1m / 3m / 6m / 1y / all`). Pure presenter. Props: `value: TimeRange; onChange: (range: TimeRange) => void`.
- `PRCard.tsx` — single PR card (used by the carousel). Pure presenter. Props: `record: PersonalRecord; exerciseName: string`. Renders the record-type badge + value + achieved-at relative time.
- `PRCarousel.tsx` — horizontal scrollable list of `PRCard`s. Pure presenter. Props: `records: PersonalRecord[]; exerciseNameById: Record<string, string>; onPress?: (record) => void`. Empty-state: "Start logging sessions to see your first PR" (match legacy copy).
- `StatTile.tsx` — single stat box (e.g. "Workouts this month: 12"). Pure presenter. Props: `value: number | string; label: string; icon?: IconName`.
- `MeasurementRow.tsx` — single row in the measurement list. Pure presenter. Props: `measurement: BodyMeasurement; onEdit: () => void`.
- `GoalCard.tsx` — single goal card. Pure presenter. Props: `goal: Goal; status: GoalStatus; onMarkComplete: () => void; onReactivate: () => void`.
- `GoalProgressBar.tsx` — pure presenter; props `current: number; target: number; unit?: string`. Mounted only on goals with non-zero target (currently always-zero given gap 4 deferral — keep the presenter ready for future use).

#### Modal forms

`packages/mobile/src/ui/components/progress/`:

- `MeasurementForm.tsx` — pure form presenter. Props: `initial?: Partial<BodyMeasurement>; onSubmit: (input) => void; onCancel: () => void; isSubmitting: boolean`. Inputs for the 9 fields + notes. **Form state in snake_case at the form, camelCase at the boundary** (M2 learning #6).

#### Containers + presenters

`packages/mobile/src/ui/containers/ProgressContainer.tsx` + `packages/mobile/src/ui/presenters/ProgressPresenter.tsx`:

- **Container**: owns `useProgress(timeRange)` + `useMeasurements()` + `useGoals()` + `usePersonalRecords()`. Manages local `timeRange` state. Wires pull-to-refresh. Tap-to-add-measurement opens the modal route.
- **Presenter**: pure. Renders:
  - Section: "Personal Records" — `PRCarousel` (read from `usePersonalRecords()`)
  - Section: "Stats" — `StatTile` row (this-week workouts, this-month workouts, current streak, PR count — sourced from `progress.stats` + dashboard cache)
  - Section: "Measurements" — header with "Add" button + most-recent value + `ProgressChart` (trend) + `TimeRangeSelector`
  - Section: "Goals" — `GoalCard` list with filter tabs (active / completed)
  - Section: "Recent Activity" — last-7-day session list (read from `progress.history`)
- Each section uses `useStaggeredEntry(index)` (same pattern as M1 Home) so they fade in sequentially.

`packages/mobile/src/ui/containers/AddMeasurementContainer.tsx` + `packages/mobile/src/ui/presenters/AddMeasurementPresenter.tsx`:

- **Container**: owns the form state via `useMeasurementForm()` (new hook in this brief). Calls `useMeasurements().add(...)` on submit; navigates back on success or error toast.
- **Presenter**: thin wrapper around `MeasurementForm`. Header, save button, dismiss button.

`packages/mobile/src/ui/containers/EditMeasurementContainer.tsx`:

- Reuses `MeasurementForm`. Pre-fills from the route param's measurement id (cache lookup). Save → `useMeasurements().update(...)`. Delete → `useMeasurements().remove(...)` with confirmation.

`packages/mobile/src/ui/containers/RecordsListContainer.tsx` + `packages/mobile/src/ui/presenters/RecordsListPresenter.tsx`:

- **Container**: owns `usePersonalRecords({ filter })` — filter dropdown for record-type (`all / 1rm / 3rm / 5rm / 10rm / max_weight / max_volume`) + per-exercise filter (optional).
- **Presenter**: pure. Grouped list — section header per exercise, list of `PRCard`s underneath.
- **Empty state copy**: "Log a workout to start tracking PRs" (match legacy). Never "Get your first 1RM!" or similar.

`packages/mobile/src/ui/containers/MeasurementsListContainer.tsx` + `packages/mobile/src/ui/presenters/MeasurementsListPresenter.tsx`:

- **Container**: owns `useMeasurements()` + `timeRange` state.
- **Presenter**: pure. Chart at top + `MeasurementRow` list below. Tap a row → push to EditMeasurement modal.

`packages/mobile/src/ui/containers/GoalListContainer.tsx` + `packages/mobile/src/ui/presenters/GoalListPresenter.tsx`:

- **Container**: owns `useGoals()` + filter state (`active / completed / all`).
- **Presenter**: pure. Filter tabs + `GoalCard` list.

### 7. Screen routes (Expo Router)

`packages/mobile/app/(app)/(tabs)/progress.tsx` — REPLACE the `<ComingSoon />` stub with `<ProgressContainer />`. Same pattern as `app/(app)/(tabs)/index.tsx` post-M1.

`packages/mobile/app/(app)/progress/measurements/index.tsx` — thin wrapper around `<MeasurementsListContainer />`. Pushed from the Progress tab's "Measurements" section "See all" link.

`packages/mobile/app/(app)/progress/measurements/add.tsx` — modal route, `presentation: "modal"`, wraps `<AddMeasurementContainer />`. Pushed from the "Add" button.

`packages/mobile/app/(app)/progress/measurements/[id]/edit.tsx` — modal route, wraps `<EditMeasurementContainer />`. Pushed from tapping a `MeasurementRow`.

`packages/mobile/app/(app)/progress/records.tsx` — wraps `<RecordsListContainer />`. Pushed from the PR carousel's "See all PRs" CTA.

`packages/mobile/app/(app)/progress/goals.tsx` — wraps `<GoalListContainer />`. Pushed from the "Goals" section "See all" link.

`packages/mobile/app/(app)/_layout.tsx` — register the new modal routes with `presentation: "modal"`, `headerShown: false` (in-screen header).

### 8. Wire `/coming-soon` callers (if any reference Progress)

Audit:

- `packages/mobile/src/ui/containers/HomeContainer.tsx` — any callbacks that currently route to `/coming-soon?feature=progress`? Replace with the appropriate Progress route.
- `packages/mobile/app/(app)/coming-soon.tsx` — drop the `progress` entry from the COPY map.

## Out of scope (don't pull in)

Per [`BRIEF.md`](./BRIEF.md) § "Explicit non-goals":

- Epley-estimated 1RMs on the achievements screen (foot-gun rule).
- Goal schema extensions (`target_value`, `current_value`, `unit`, `status`).
- Charting-library swap. `react-native-svg` only.
- Social-progress feed.
- Body-composition photos.
- CSV export.
- HealthKit / Google Fit weight import.
- Achievements / badges system.
- PR push notifications.
- `/frontend-design` aesthetic revamp.

## M1 / M2 / M3 learnings to surface again (do NOT re-discover)

Already paid for in M1–M3. Apply here as well — see [`../M3-active-session/BRIEF.md`](../M3-active-session/BRIEF.md) § "M2 learnings to apply" for the full list. Quick checklist:

1. **Sync queue drains in every refresh** — `useProgress.refresh`, `useMeasurements.refresh`, `useGoals.refresh` must call `processSyncQueue` first.
2. **`useSyncWorker` already runs** in `(app)/_layout.tsx`. Verify your new intent kinds replay.
3. **`storage.invalidateDashboard(userId)` on every mutating command.** Progress mutations affect dashboard data.
4. **`rereadCache`, not `refresh`, for in-tab mutations.** Add Measurement modal → close → measurement should already be in the list cache (write-through). Don't full-refresh.
5. **`useFocusEffect(rereadCache)` on the Progress tab container** so cache invalidations from elsewhere (e.g. session complete writing new PRs) surface on focus.
6. **Form state in snake_case, camelCase at boundary** — `MeasurementForm` inputs.
7. **`generateId` in `useCallback([])`. Tighten downstream `useCallback` deps.**
8. **Falsy zero in JSX `&&`.** Weights, body-fat %, reps all can be 0 (especially edge cases like "logged 0 body fat by mistake"). Use `value != null && <Text>{value}</Text>`.
9. **Picker / multi-step modal: `pageSheet` Modal**, not centered `Popover`. Apply if Measurement Edit needs nested pickers.
10. **Detail surface = real route.** Measurement edit / records list / goals list are real routes, not overlays.
11. **Exercise-tap stacked navigation** if PR card tap opens exercise detail in M5.
12. **Coverage: 90% global aggregate.** New files can dip on branches if aggregate stays ≥ 90.
13. **CI flake mitigations:** `afterEach(jest.restoreAllMocks)`, `mock`-prefixed factories, no re-export-only files, explicit 30s timeouts on cascading-async tests.
14. **TOCTOU** — client-side equivalent: don't trust state across async gaps. Measurement form should disable the Submit button while a save is in flight; double-tap shouldn't double-enqueue.

## Quality gates

```bash
bun run prettier:check
bun run typecheck
bun run lint
bun run build
bun --filter @persistence/mobile test:unit   # 90% global aggregate non-negotiable
```

Total mobile test count after M4: target +60–100 tests from current baseline (track in PR description).

## Files you will touch

```
packages/mobile/app/(app)/(tabs)/progress.tsx                             # replace <ComingSoon /> with <ProgressContainer />
packages/mobile/app/(app)/progress/measurements/index.tsx                 # new — list route
packages/mobile/app/(app)/progress/measurements/add.tsx                   # new — modal route
packages/mobile/app/(app)/progress/measurements/[id]/edit.tsx             # new — modal route
packages/mobile/app/(app)/progress/records.tsx                            # new
packages/mobile/app/(app)/progress/goals.tsx                              # new
packages/mobile/app/(app)/_layout.tsx                                     # register modal routes

packages/mobile/src/domain/models/
  measurement.ts                                                          # new
  goal.ts                                                                 # new
  progress.ts                                                             # new
  record.ts                                                               # extend with 'max_volume' alias check
  index.ts                                                                # re-export

packages/mobile/src/domain/services/
  progressService.ts                                                      # new
  __tests__/progressService.test.ts                                       # new

packages/mobile/src/domain/ports/
  storage.port.ts                                                         # extend with progress + measurement + goal caches

packages/mobile/src/adapters/storage/
  sqlite.adapter.ts                                                       # implement new caches
  __tests__/in-memory-storage.adapter.ts                                  # mirror
  __tests__/sqlite.adapter.test.ts                                        # extend

packages/mobile/src/adapters/api/
  sst-api.adapter.ts                                                      # backend agent already extends; verify your contract
  __tests__/in-memory-api.adapter.ts                                      # backend agent stubs; extend for command tests

packages/mobile/src/application/queries/
  progress.query.ts                                                       # new
  __tests__/progress.query.test.ts                                        # new

packages/mobile/src/application/commands/progress/
  add-measurement.command.ts                                              # new
  update-measurement.command.ts                                            # new
  delete-measurement.command.ts                                            # new
  update-goal-status.command.ts                                           # new
  __tests__/*.test.ts                                                     # new

packages/mobile/src/ui/hooks/
  useProgress.ts                                                          # new
  useMeasurements.ts                                                      # new
  useGoals.ts                                                             # new
  usePersonalRecords.ts                                                   # new
  useStrengthChart.ts                                                     # new
  useMeasurementForm.ts                                                   # new (snake_case form state)
  __tests__/*.test.ts                                                     # new

packages/mobile/src/ui/components/progress/
  ProgressChart.tsx                                                       # new — SVG line chart
  TimeRangeSelector.tsx                                                   # new
  PRCard.tsx                                                              # new
  PRCarousel.tsx                                                          # new
  StatTile.tsx                                                            # new (or reuse existing if compatible)
  MeasurementRow.tsx                                                      # new
  GoalCard.tsx                                                            # new
  GoalProgressBar.tsx                                                     # new
  MeasurementForm.tsx                                                     # new
  __tests__/*.test.tsx                                                    # new

packages/mobile/src/ui/containers/
  ProgressContainer.tsx                                                   # new
  AddMeasurementContainer.tsx                                              # new
  EditMeasurementContainer.tsx                                             # new
  MeasurementsListContainer.tsx                                            # new
  RecordsListContainer.tsx                                                 # new
  GoalListContainer.tsx                                                    # new
  __tests__/*.test.tsx                                                    # new

packages/mobile/src/ui/presenters/
  ProgressPresenter.tsx                                                   # new
  AddMeasurementPresenter.tsx                                              # new
  MeasurementsListPresenter.tsx                                            # new
  RecordsListPresenter.tsx                                                 # new
  GoalListPresenter.tsx                                                    # new
  __tests__/*.test.tsx                                                    # new

# Spec edits (first commit)
specs/06-progress-goals/design.md                                          # fills Progress mobile architecture section
specs/06-progress-goals/requirements.md                                    # STORY-006 AC refinements
specs/milestones/M4-progress/BRIEF.md                                      # append "Frontend spec-update complete" status note
```

## Files you will NOT touch

- Anything under `microservices/` — backend agent's territory.
- [`personalRecordsRepository.ts`](../../../microservices/core/src/application/repositories/personalRecordsRepository.ts) — even reading the source is fine, but the file is the canonical M3 implementation. Don't fork its logic into the mobile.
- The webhook handlers.
- `packages/db/src/schema.ts` — no schema changes (gap 4 defers).
- `infra/` — no SST changes.

## Legacy reference paths

Read each of these in legacy `persistence-mobile/` to understand the proven behaviour. **Do not copy architecture** (legacy uses direct Supabase queries + hook-heavy patterns; V2 is ports/adapters). Do copy: flows, business logic, copy strings, layouts, edge-case handling.

| Legacy file                                | What it tells you                                                                                                                                                                                                  | V2 equivalent                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `app/(tabs)/progress.tsx`                  | The full Progress tab UX. Section order, pull-to-refresh behaviour, empty states, the time-range selector placement, the "Add measurement" CTA placement.                                                          | `ui/containers/ProgressContainer.tsx` + `ui/presenters/ProgressPresenter.tsx`                          |
| `components/progress/*` (whole directory)  | Each section's presenter. PR cards, stat tiles, measurement chart, measurement list rows, goal cards. **Port each 1:1.** Read every file in this directory before writing your first component.                   | `ui/components/progress/*`                                                                             |
| `components/home/PROfTheWeekCard.tsx`      | Layout reference for the PR carousel card (already ported in M1 — reuse / extract the visual into `PRCard.tsx` in M4).                                                                                             | `ui/components/progress/PRCard.tsx`                                                                    |
| `components/measurement/AddMeasurement*` | The add-measurement modal form. Field order, validation rules, dismiss behaviour, save toast.                                                                                                                       | `ui/containers/AddMeasurementContainer.tsx` + `ui/presenters/AddMeasurementPresenter.tsx`              |
| `components/measurement/EditMeasurement*` | Edit + delete affordances. Confirmation modal for delete. Pre-fill rules.                                                                                                                                          | `ui/containers/EditMeasurementContainer.tsx`                                                           |
| `components/goals/*`                       | Goal cards, list filter tabs, mark-complete + reactivate flows.                                                                                                                                                    | `ui/containers/GoalListContainer.tsx` + `ui/presenters/GoalListPresenter.tsx` + `GoalCard.tsx`         |
| `components/records/*`                     | Full PR list. Grouping by exercise. Record-type badges. Empty state.                                                                                                                                               | `ui/containers/RecordsListContainer.tsx` + `ui/presenters/RecordsListPresenter.tsx`                    |
| `hooks/api/useGetProgressStats.ts`         | The legacy `/progress/stats` consumer — what fields it actually reads from the response (informs which fields the V2 `ProgressPayload.stats` needs to surface).                                                    | `application/queries/progress.query.ts` + `ui/hooks/useProgress.ts`                                    |
| `hooks/api/useGetProgressHistory.ts`       | Same for history.                                                                                                                                                                                                  | `application/queries/progress.query.ts`                                                                |
| `hooks/api/useGetMeasurements.ts`          | Same for measurements.                                                                                                                                                                                             | `application/queries/progress.query.ts` + `ui/hooks/useMeasurements.ts`                                |
| `hooks/api/usePostMeasurement.ts`          | Create-measurement mutation. V2 replaces with `useMeasurements().add` + `add-measurement.command.ts`.                                                                                                              | `application/commands/progress/add-measurement.command.ts`                                             |
| `hooks/api/usePostGoal.ts` (or `useGetGoals.ts` / `useUpdateGoal.ts`) | Goal CRUD + status update.                                                                                                                                                                              | `application/commands/progress/update-goal-status.command.ts`                                          |
| `hooks/api/useGetPersonalRecords.ts`       | PR list consumer.                                                                                                                                                                                                  | `ui/hooks/usePersonalRecords.ts`                                                                       |
| `constants/colors.ts`, `constants/theme.ts` | Theme tokens. Match in V2.                                                                                                                                                                                         | `ui/theme/tokens.ts` (already set up post-M1).                                                         |
| `utils/bodyMeasurements.ts`                | Body-measurement format / display helpers. Port directly if framework-agnostic.                                                                                                                                    | `shared/utils/`                                                                                        |
| `utils/dateFormatters.ts`                  | Relative-time strings ("3 days ago"). Already partially in V2 — reuse / extend.                                                                                                                                    | `shared/utils/`                                                                                        |

If you cannot access the legacy app for any reason (permissions, missing checkout), surface the gap in the PR description and request the legacy repo be made available — DO NOT guess at the layouts.

## Inspector Brad expectations

PR #62 burned a real phantom-PR bug from float-precision drift between mobile + backend. Mobile-side, this milestone's Inspector-Brad foot-guns will concentrate on:

- **Epley smuggling onto the achievements screen.** If a TypeScript path lets a future contributor pass a synthesized record into `PRCarousel`, it's a problem.
- **Cache invalidation gaps.** Add measurement → measurement appears in the list (cache write-through) but the PR-of-the-week tile on Home doesn't update (dashboard cache not invalidated).
- **Pull-to-refresh re-mounts the screen** instead of merging. Symptom: scroll position lost on refresh.
- **Container/presenter boundary violations.** Hooks leaking into presenters; presenters with side effects.
- **Falsy-zero in JSX `&&`** on body-fat % rows where 0 is a real-but-rare value.
- **Time-range preset coercion errors.** `all` → epoch-ISO; backend expects `from <= to`; mobile must not send `from = 1970` if backend rejects it (verify the backend default behaviour).
- **Sync queue regressions:** add → close-app → reopen-offline → tap edit → confirm queue still drains in order when reconnected.

TRACE before patching. Same protocol as backend. State the exact code reading + reproduction sequence in commit messages.

## Planned commit shape (post in PR description before pushing implementation commits)

1. `docs(M4): mobile architecture for Progress milestone` — closes gap 2 (mobile architecture section body) + mobile-side of gap 5 (time-range presets).
2. `feat(mobile): progress domain models + pure services` — `BodyMeasurement`, `Goal`, `ProgressPayload`, `progressService.ts`. 100% unit-test coverage.
3. `feat(mobile): SQLite tables + StoragePort extensions for progress/measurements/goals caches` — adapters + in-memory mirror + tests.
4. `feat(mobile): application queries + commands for progress + measurements + goals` — query layer with cache-first 5-min TTL; commands write-through + enqueue.
5. `feat(mobile): progress UI components` — `ProgressChart`, `TimeRangeSelector`, `PRCard`, `PRCarousel`, `StatTile`, `MeasurementRow`, `GoalCard`, `GoalProgressBar`, `MeasurementForm`. Presenter tests.
6. `feat(mobile): ProgressContainer + ProgressPresenter + /progress tab wiring` — replace `<ComingSoon />`. Container integration tests using `InMemoryApiAdapter` + `InMemoryStorageAdapter`.
7. `feat(mobile): AddMeasurement + EditMeasurement modal routes` — modal screens + container + presenter + tests.
8. `feat(mobile): RecordsList + MeasurementsList + GoalList sub-screens` — drill-in routes + container + presenter + tests.

8 commits. Each cites the parent spec section it implements (`Implements: specs/06-progress-goals/design.md § Progress mobile architecture (M4) > SQLite cache shape`, etc.).

If 5 sprawls past ~700 LOC, split components into `5a` (chart + range selector + PR carousel) and `5b` (measurement row + goal card + form).

## Smoke (frontend slice — full e2e in [SMOKE_TEST.md](./SMOKE_TEST.md))

Every PR claim of "done" must include the steps in [`SMOKE_TEST.md`](./SMOKE_TEST.md). At minimum the frontend slice covers:

1. Run mobile in `bun run dev` against staging API.
2. Sign in as a user with completed sessions + a measurement history. Open Progress tab.
3. PR carousel renders (≤ 5 cards) with exact-rep-match record-type badges (`1RM` / `3RM` / `5RM` / `10RM` / `Max Weight` / `Max Volume`). No "Estimated 1RM" labels.
4. Tap "Add Measurement" → modal opens → log a body-fat % entry → save → modal closes → measurement appears in the list with the new value + trend chart updates with the new data point.
5. Edit an existing measurement → save → list refreshes with the new value.
6. Delete a measurement → confirmation → list refreshes without it.
7. Toggle time-range from `1m` → `3m` → `1y` → `all` on the trend chart. Each change repaints the chart smoothly.
8. Tap "See all PRs" → Records list opens. Filter by `1rm` → only `1rm` records show. Filter by exercise → only that exercise's records show.
9. Tap "Goals" → list opens. Mark an active goal complete → goal moves to completed tab.
10. Recent Activity row shows the last 7 days of completed sessions.
11. Offline path: airplane mode → tap Add Measurement → log → save → measurement appears optimistically. Re-enable network → sync worker flushes → measurement reconciles.
12. Backgrounding: open Progress → background → reopen → cache renders instantly (≤ 100ms), background-refresh fires.

Include a Loom or short screenshot reel covering #3, #4, #7, #8, #11 in the PR body.

## Coordinate

If implementation reveals the wire shape needs further changes (e.g. the goal list response is missing `goalTypeName`), surface it on the backend PR before this one lands. Don't translate field shapes silently.

If you discover a need for an endpoint not in [`BACKEND_BRIEF.md`](./BACKEND_BRIEF.md) (e.g. a `GET /measurements/:id` for the Edit modal's pre-fill — though the cache should usually serve this), bridge it via a tiny backend follow-up PR, not by hacking around it client-side.

If the legacy app is not accessible, surface the gap in PR review and request access — do NOT guess at the visual layouts. The port-1:1 rule is non-negotiable.
