# M1 — Frontend Agent Brief

You are implementing the frontend track of Milestone 1 — Home / Dashboard. Read the parent [`BRIEF.md`](./BRIEF.md) first.

You are working on the Expo + Tamagui mobile app at `/Users/bradleysimms-evans/Documents/projects/personal/persistence-backend-sst/packages/mobile/`. You are NOT touching the SST backend — that is the backend agent's responsibility. You may read backend code for contract context but must not modify it.

## Authority

- Parent specs:
  - [`../../06-progress-goals/`](../../06-progress-goals/) — STORY-005 + `design.md` § Dashboard mobile architecture (M1).
  - [`../../07-health-integration/`](../../07-health-integration/) — STORY-007 + `design.md` § M1 scope: platform adapter matrix.
- Mobile architectural rules: [`../../_agent.md`](../../_agent.md) — hexagonal arch, container/presenter split, V2 tokens canonical.
- Workflow discipline: [`../../_agent.md`](../../_agent.md) — spec-first, always.
- If the brief is silent, the parent spec wins. If the parent spec is silent on something the brief describes, that's a spec gap — close it FIRST via a spec update commit, then implement.

## Spec alignment — READ FIRST

The parent-spec commits on this `docs/m1-briefs` branch already landed the `DashboardPayload` domain model, the cache architecture, the `HomePresenter` + section structure, the platform adapter matrix, and the STORY-005 + STORY-007 acceptance criteria. You are implementing against the contract, not extending it.

Every implementation commit must cite the spec section it's implementing in the commit message footer — see [`../M0-integration-baseline/HANDOVER.md`](../M0-integration-baseline/HANDOVER.md) § Concrete commit trace for the template.

If you find a gap while implementing — a presenter prop the spec doesn't describe, a Health adapter method M1 needs that isn't in the matrix — **update the spec first** as a dedicated commit on your branch. Do not silently make a design decision that belongs in the spec.

## Scope

### 1. Domain model + ports

**`packages/mobile/src/domain/models/dashboard.ts`** — NEW

Mirror `DashboardPayload` from `06-progress-goals/design.md` § Dashboard backend contract exactly. Re-use `RecordType` (create it or re-export) for the `prOfTheWeek` field. Export the type + any nested types as named exports. Export from `domain/models/index.ts`.

**`ApiPort.getDashboard()`** — extend `packages/mobile/src/domain/ports/api.port.ts`:

```ts
getDashboard(): Promise<Result<DashboardPayload, ApiError>>;
```

**`StoragePort`** — add three methods mirroring the reference-list cache pattern:

```ts
getCachedDashboard(userId: string): CachedDashboard | null;
cacheDashboard(userId: string, payload: DashboardPayload): void;
getDashboardAge(userId: string): string | null;
```

Where `CachedDashboard = { userId: string; payload: DashboardPayload; syncedAt: string }`.

### 2. Adapters

**`SSTApiAdapter.getDashboard`** — plain `GET /dashboard` with single-envelope unwrap (`requestEnvelope<T>`). No UUID translation — the payload has no reference-list-typed fields. No double-envelope handling (see parent `BRIEF.md` § Cross-cutting notes).

**`InMemoryApiAdapter.getDashboard`** — returns a hand-crafted fixture payload so the container tests run without a backend. Put the fixture at `packages/mobile/src/adapters/api/__tests__/fixtures/dashboard.fixture.ts`. Mirror the shape of real data from the seed DB.

**`SQLiteStorageAdapter`** — add a `cached_dashboard` table migration:

```sql
CREATE TABLE IF NOT EXISTS cached_dashboard (
  user_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  synced_at TEXT NOT NULL
);
```

Implement the three new methods with `JSON.stringify` / `JSON.parse` for the payload. Mirror the reference-list cache pattern at `sqlite.adapter.ts:89` (migration) + `sqlite.adapter.ts:263` (methods).

**`InMemoryStorageAdapter`** — add the three methods backed by a `Map<userId, CachedDashboard>`.

### 3. Application query

**`packages/mobile/src/application/queries/dashboard.query.ts`** — NEW. Mirror `reference-lists.query.ts` shape:

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

`getDashboardQuery` reads cache-first; `isStale` is true when `syncedAt` is older than 5 minutes **or** when no cache row exists. `refreshDashboard` hits the API and writes through to storage on success.

### 4. `useDashboard` hook

**`packages/mobile/src/ui/hooks/useDashboard.tsx`** — mirrors `useReferenceLists`. Exposes:

```ts
{
  payload: DashboardPayload | null;
  isStale: boolean;
  isRefreshing: boolean;
  error: ApiError | null;
  refresh: () => Promise<void>;
}
```

Triggers a background `refreshDashboard` on mount when the cache is stale or missing, and on app-foreground transitions. The 5-min TTL is strictly advisory — `refresh` (pull-to-refresh path) always refetches.

### 5. Health adapters (ship the matrix)

Per `07-health-integration/design.md` § M1 scope: platform adapter matrix.

**`packages/mobile/src/adapters/health/expo-healthkit.adapter.ts`** — NEW. Implements `HealthPort` using `@kingstinct/react-native-healthkit`. Covers:

- `isAvailable()` — wraps the library's availability check.
- `requestPermissions()` — requests read for steps, active energy, body mass, heart rate.
- `getPermissionStatus()` — reads current status.
- `getStepsToday()` — sum of `HKQuantityTypeIdentifierStepCount` samples from 00:00 local to now.
- `getActiveCaloriesToday()` — same range, `HKQuantityTypeIdentifierActiveEnergyBurned`.
- `getLatestBodyWeight()` — most recent `HKQuantityTypeIdentifierBodyMass`.
- `getHeartRateLatest()` — most recent `HKQuantityTypeIdentifierHeartRate`.
- `writeBodyWeight(...)` — **M1 stub:** return `fail({ kind: "health", code: "unavailable", message: "not implemented in M1" })`. Lights up M6.
- `disconnect()` — clears cached permission state.

**`packages/mobile/src/adapters/health/simulator-mock.adapter.ts`** — NEW. Returns deterministic values per the parent spec:

| Method | Value |
| --- | --- |
| `isAvailable` | `true` |
| `requestPermissions` | `ok` with all `"granted"` |
| `getPermissionStatus` | all `"granted"` |
| `getStepsToday` | `ok(4812)` |
| `getActiveCaloriesToday` | `ok(312)` |
| `getLatestBodyWeight` | `ok({ value: 74.5, unit: "kg", date: <today> })` |
| `getHeartRateLatest` | `ok(62)` |
| `writeBodyWeight` | `ok(undefined)` — simulator can pretend it writes |
| `disconnect` | no-op |

**`packages/mobile/src/adapters/health/android-stub.adapter.ts`** — NEW. `isAvailable: false`; every read returns `fail(UNAVAILABLE)`; permission request resolves as no-op success; disconnect is a no-op.

**`packages/mobile/src/adapters/health/index.ts`** — add a `createHealthAdapter()` factory:

```ts
import { Platform } from "react-native";
import * as Device from "expo-device";

export function createHealthAdapter(): HealthPort {
  if (Platform.OS === "ios") {
    if (__DEV__ && !Device.isDevice) return new SimulatorMockHealthAdapter();
    return new ExpoHealthKitAdapter();
  }
  if (Platform.OS === "android") return new AndroidStubHealthAdapter();
  return new StubHealthAdapter();
}
```

Wire this into the `AdapterProvider` — replace the current `StubHealthAdapter` default with `createHealthAdapter()`.

### 6. `useHealthData` hook

**`packages/mobile/src/ui/hooks/useHealthData.tsx`** — NEW. Exposes:

```ts
{
  stepsToday: number | null;
  activeCaloriesToday: number | null;
  latestBodyWeight: HealthWeight | null;
  permissionStatus: HealthPermissionStatus;
  isAvailable: boolean;
  isReading: boolean;
  lastReadAt: string | null;
  requestPermissions: () => Promise<void>;
  refresh: () => Promise<void>;
}
```

Rate-limited to one read per 5 minutes using a `useRef<number>` to track `lastReadAt`. Re-reads on app-foreground transition (use `AppState` from `react-native`).

### 7. Ported UI

Port the following from `persistence-mobile/components/home/`, **1:1** for layout + copy + section ordering, but using V2 tokens and Tamagui primitives (see `specs/_agent.md` for the token table).

```
packages/mobile/src/ui/components/home/
├── GreetingSection.tsx         # userName + subscription badge/CTA
├── SubscriptionBadge.tsx       # tier + upgrade CTA for free tier
├── GoalsSection.tsx            # horizontal list of goal chips with progress
├── YourWorkoutsSection.tsx     # horizontal carousel of recent workout templates
├── MyProgressSection.tsx       # tile grid (workouts/month, streak, body weight, body fat, steps, active energy)
├── RecentActivitySection.tsx   # vertical list of completed sessions
├── StepsTodayTile.tsx          # 3 variants: granted / denied / unavailable
└── PROfTheWeekCard.tsx         # renders when payload.prOfTheWeek is non-null
```

**Container + presenter** (top-level):

- `packages/mobile/src/ui/containers/HomeContainer.tsx` — NEW. Uses `useDashboard`, `useHealthData`, `useAuth`. Produces the view-model for the presenter via the 3-memo pipeline (`cachedPayload` → `viewModel` → `animationStyles`). Handles pull-to-refresh.
- `packages/mobile/src/ui/presenters/HomePresenter.tsx` — NEW. Pure. Receives the full view-model. Renders the five sections wrapped in `<Animated.View style={useStaggeredEntry(i)}>`. Supports `onRefresh` + `isRefreshing` via `RefreshControl`.

**Tab route** — replace `packages/mobile/app/(app)/(tabs)/index.tsx` diagnostic content with `<HomeContainer />`. Keep the file short; the container owns everything.

### 8. Staggered entry animations

Use the `useStaggeredEntry(index)` hook established in M0 (0-based index, 80 ms per section). Five sections → indices 0..4. Each section wraps itself in `<Animated.View style={style}>`.

### 9. Pull-to-refresh

Wrap the scroll view in `RefreshControl`:

```tsx
<ScrollView
  refreshControl={
    <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={...} />
  }
>
```

`onRefresh` calls `useDashboard().refresh()` + `useHealthData().refresh()` in parallel.

### 10. Files you will touch

**Domain:**

- `packages/mobile/src/domain/models/dashboard.ts` — NEW
- `packages/mobile/src/domain/models/index.ts` — export
- `packages/mobile/src/domain/ports/api.port.ts` — `getDashboard`
- `packages/mobile/src/domain/ports/storage.port.ts` — dashboard cache methods
- `packages/mobile/src/domain/models/record.ts` — NEW (or export `RecordType` if it already exists in exercise/domain)

**Application:**

- `packages/mobile/src/application/queries/dashboard.query.ts` — NEW
- `packages/mobile/src/application/queries/__tests__/dashboard.query.test.ts` — NEW
- `packages/mobile/src/application/queries/index.ts` — export

**Adapters:**

- `packages/mobile/src/adapters/api/sst-api.adapter.ts` — `getDashboard`
- `packages/mobile/src/adapters/api/__tests__/in-memory-api.adapter.ts` — stub + fixture
- `packages/mobile/src/adapters/storage/sqlite.adapter.ts` — `cached_dashboard` migration + methods
- `packages/mobile/src/adapters/storage/__tests__/in-memory-storage.adapter.ts` — methods
- `packages/mobile/src/adapters/health/expo-healthkit.adapter.ts` — NEW
- `packages/mobile/src/adapters/health/simulator-mock.adapter.ts` — NEW
- `packages/mobile/src/adapters/health/android-stub.adapter.ts` — NEW
- `packages/mobile/src/adapters/health/index.ts` — `createHealthAdapter`
- `packages/mobile/src/adapters/index.ts` — wire into `AdapterProvider`

**UI:**

- `packages/mobile/src/ui/hooks/useDashboard.tsx` — NEW
- `packages/mobile/src/ui/hooks/useHealthData.tsx` — NEW
- `packages/mobile/src/ui/containers/HomeContainer.tsx` — NEW
- `packages/mobile/src/ui/presenters/HomePresenter.tsx` — NEW
- `packages/mobile/src/ui/components/home/*` — eight section / tile files (see §7)
- `packages/mobile/app/(app)/(tabs)/index.tsx` — replace diagnostic content

**Tests:** co-located `__tests__/` folders; presenter + container + hook + adapter coverage.

**iOS native:**

- Add `NSHealthShareUsageDescription` + `NSHealthUpdateUsageDescription` to `packages/mobile/app.json` or the Expo `Info.plist` config so the HealthKit entitlement is requested when the app installs.
- Run `npx expo prebuild --platform ios` locally once — the Pod install will pull `@kingstinct/react-native-healthkit` native code. Do NOT commit the generated `ios/` directory (already gitignored).

## Files you must NOT touch

- Anything under `microservices/core/` — backend agent territory.
- `packages/db/src/schema.ts` — backend migrations only.
- Other feature-area presenters (exercises, workouts, progress, profile). The only change to `app/(app)/(tabs)/` is the Home index.
- The global V2 token palette. Any new color must be an existing token.

## Quality gates (must pass before PR opens)

- `bun run prettier:check`
- `bun run typecheck` (typed-routes may warn after route adjustments; regenerate `.expo/types/router.d.ts` by restarting the dev server)
- `bun run lint` — 0 errors, 0 warnings in `@persistence/mobile`
- `bun run build`
- `bun run test:unit` — 90% coverage on changed files

## Output expected

- A PR on branch `feat/m1-mobile-home` (branched from fresh `main`)
- PR title: `feat(mobile): home tab + dashboard cache + health adapters (M1)`
- Spec-alignment block at the top of the PR body listing every design.md §, requirements.md AC, and tasks.md Phase 4b / 07-Phase-2 / 07-Phase-3 / 07-Phase-5 item closed.
- PR body ends with a `### How to view` block:
  - Branch checkout + `bun install`
  - `bun run dev` in one terminal (backend)
  - `cd packages/mobile && LANG=en_US.UTF-8 npx expo run:ios` in another (native build required for HealthKit)
  - Sign in → Home tab → verify greeting / subscription / workouts carousel / tiles / recent activity / PR-of-the-week / pull-to-refresh
- Mark relevant Phase 4b items in `specs/06-progress-goals/tasks.md` and Phase 2 / 3 / 5 items in `specs/07-health-integration/tasks.md` as complete.

## Blocking questions (answer before shipping)

1. **`@kingstinct/react-native-healthkit` version** — legacy used this library. Check `persistence-mobile/package.json` for the version that was known to work with Expo 53, pin the same major. If Expo ≥ 54 introduces an incompatibility, flag in PR review rather than silently upgrading.
2. **Simulator detection** — `Device.isDevice` from `expo-device` is the canonical check. Verify it returns `false` on iOS simulator and `true` on physical devices before shipping the selection logic.
3. **HealthKit entitlement on simulator** — iOS simulator reports HealthKit as `isAvailable: false` in practice; the `SimulatorMockHealthAdapter` covers this, but verify the selection function picks the mock **before** `ExpoHealthKitAdapter` constructs anything that would throw on the simulator.
4. **Staggered animation budget** — M0 used 80 ms per section. Five sections → 400 ms total. If that feels sluggish with content-heavy sections, adjust the constant (not the algorithm) and note in PR body.
5. **AppState listener cleanup** — `useHealthData` adds an `AppState` listener. Ensure cleanup on unmount (return-from-effect). A leaked listener across re-mounts causes duplicate reads.

## Non-goals

- No active-workout popover. Tapping a recent workout card routes to `/workouts` (stub / existing placeholder).
- No measurement editor / goal editor / PR detail navigation. Tiles render read-only.
- No `writeBodyWeight` functionality. Stub-returns `unavailable` in M1; lights up M6.
- No `/health-permissions` screen. "Connect Health" CTA on denied tile routes to a placeholder route.
- No Health Connect on Android. `AndroidStubHealthAdapter` only.
- No visual redesign of legacy sections. Port 1:1, V2 tokens only. Polish is M11.
- No heart-rate tile. `getHeartRateLatest` is wired but no M1 UI surfaces it.
- No basal / standTime tiles. M1 ships active energy only; other two are placeholder zeros per parent spec.

## Success criteria

Your PR is mergeable when:

1. Home tab renders the greeting / subscription / workouts carousel / MyProgress grid / RecentActivity / PR-of-the-week for a seeded user on the simulator.
2. StepsTile renders the mock step count (`4812`) on simulator; renders real data on device (where available).
3. Pull-to-refresh bypasses the TTL and updates the UI.
4. Kill + relaunch renders from cache instantly.
5. Airplane mode + relaunch renders cached payload with a "last synced" caption.
6. Quality gates pass.
7. Backend agent's smoke test can execute against your branch (and vice versa).
