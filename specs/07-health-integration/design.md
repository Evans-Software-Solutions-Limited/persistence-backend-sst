# 07 — Health Integration: Technical Design

## Architecture

Health is a **driven adapter** implementing the `HealthPort`:

```typescript
// src/domain/ports/health.port.ts
export interface HealthPort {
  isAvailable(): Promise<boolean>;
  requestPermissions(): Promise<Result<HealthPermissionStatus, HealthError>>;
  getPermissionStatus(): Promise<HealthPermissionStatus>;
  getStepsToday(): Promise<Result<number, HealthError>>;
  getActiveCaloriesToday(): Promise<Result<number, HealthError>>;
  getLatestBodyWeight(): Promise<Result<HealthWeight | null, HealthError>>;
  getHeartRateLatest(): Promise<Result<number | null, HealthError>>;
  writeBodyWeight(
    weight: number,
    date: Date,
  ): Promise<Result<void, HealthError>>;
  disconnect(): Promise<void>;
}

export interface HealthPermissionStatus {
  steps: "granted" | "denied" | "not_determined";
  calories: "granted" | "denied" | "not_determined";
  bodyWeight: "granted" | "denied" | "not_determined";
  heartRate: "granted" | "denied" | "not_determined";
}

export interface HealthWeight {
  value: number;
  unit: "kg" | "lbs";
  date: string;
}
```

## Platform Adapters

```
adapters/health/
├── healthkit.adapter.ts        # iOS: @kingstinct/react-native-healthkit
├── health-connect.adapter.ts   # Android: react-native-health-connect
├── mock.adapter.ts             # Tests: returns configurable data
└── index.ts                    # Platform-specific export
```

Platform selection at adapter provider level:

```typescript
import { Platform } from "react-native";
const healthAdapter =
  Platform.OS === "ios" ? new HealthKitAdapter() : new HealthConnectAdapter();
```

## UI Components

```
containers/HealthPermissionsContainer.tsx  # Permission request flow
presenters/HealthPermissionsPresenter.tsx  # Explanation + request UI
components/StepsTile.tsx                   # Dashboard steps display
components/CaloriesTile.tsx                # Dashboard calories display
components/HealthConnectionStatus.tsx      # Connected/disconnected indicator
```

## Data Flow

1. App foreground → `useHealthData()` hook checks if >5 min since last read
2. If stale → reads from HealthKit/Health Connect (device-local, no network)
3. Caches values in local state (not SQLite — health data is ephemeral)
4. Dashboard tiles render from cached values
5. No server sync of raw health data (stays on device)

---

## M1 scope: platform adapter matrix

M1 ships the first real `HealthPort` implementations alongside the Home
screen. Not every adapter goes to full fidelity — only the pieces
needed for the dashboard tiles.

| Platform                  | Adapter                    | M1 scope                                                                                                                                                                                                                                                                           | Notes                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| iOS (device or simulator) | `ExpoHealthKitAdapter`     | Read steps today, walking distance, basal/move energy, active energy, exercise minutes, stand time, latest body weight, body fat %, heart rate; permission request + status; `isAvailable()`; `disconnect()`. Permission scope mirrors the legacy app's IOS_READ + IOS_WRITE sets. | Uses `@kingstinct/react-native-healthkit`, the same library legacy ships. On the iOS simulator HealthKit reports `isAvailable: false`; tiles render the existing "Health not available on this iOS build" copy honestly rather than showing a fixture. `writeBodyWeight` is stubbed — wired in M6 when the measurement editor ships. |
| Android                   | `AndroidStubHealthAdapter` | `isAvailable: false`; every read returns `fail(UNAVAILABLE)`; permission request is a no-op success                                                                                                                                                                                | Android M1 scope is "does not crash, renders an empty health tile with 'Not available on Android yet'". Real Health Connect adapter is deferred past M1.                                                                                                                                                                             |
| Tests                     | `MockHealthAdapter`        | Existing in-memory adapter with configurable return values                                                                                                                                                                                                                         | Unchanged from Phase 1 stub pattern.                                                                                                                                                                                                                                                                                                 |

### Selection logic

Picked once at `AdapterProvider` construction, not per-hook:

```ts
// adapters/health/index.ts
export function createHealthAdapter(): HealthPort {
  if (Platform.OS === "ios") return new ExpoHealthKitAdapter();
  if (Platform.OS === "android") return new AndroidStubHealthAdapter();
  return new StubHealthAdapter(); // web / fallback
}
```

The `StubHealthAdapter` from 00-guardrails remains — the Android-stub adapter is new and explicit so the health surface is coherent on every target. The earlier M1 design included a `SimulatorMockHealthAdapter` that returned deterministic fixtures on the iOS simulator; that adapter was removed in PR #38 follow-up (Brad's preference: always live data, no mock disclosure layer). Smoke-testing on simulator now relies on the real adapter's "not available" fall-through.

### UI tiles: live vs not-yet-connected states

- **Granted + data available** — `StepsTile` renders the value, timestamp, and `$success` dot.
- **Denied / not determined** — renders a "Connect Health" CTA tile. Tap routes to `/health-permissions` (the permission-request screen is still Phase 4 / future work; M1 scope keeps the CTA visible but navigation is a no-op placeholder).
- **Unavailable on this platform** (Android, web) — renders a muted "Not available on Android yet" copy. No CTA.

### Integration with HomeContainer

`HomeContainer` calls the `useHealthData()` hook on mount and at app-foreground transitions (rate-limited to one read per 5 min, same cadence as the dashboard cache TTL). Values merge into the presenter view-model beside the backend `DashboardPayload`. Health data is not mixed into the SQLite `cached_dashboard` row — it stays in hook-local state.

### Non-goals for M1

- **Body weight write-back** — `writeBodyWeight` stays stubbed. Lights up in M6 when measurement editor ships (STORY-004).
- **Health Connect on Android** — deferred. M1 Android renders the "not yet available" tile.
- **Heart-rate tile on dashboard** — read is implemented (`getHeartRateLatest`) but no M1 UI surfaces it; the data is available for M4 Progress.
- **Permission-request screen** — Phase 4 scope. M1 renders the "Connect Health" CTA but the destination is a placeholder.
- **Active calories / basal energy / stand time split** — legacy split these three ways (`activeEnergy`, `moveEnergy`, `standTime`). M1 surfaces `activeEnergy` only via `getActiveCaloriesToday`; other two tiles ship with `0` placeholders in the MyProgress section. M4 Progress revisits.

---

## Revised 2026-06-23 — two-way sync for Habit Setup (cross-cut with `18-habit-setup`)

`18-habit-setup` needs Apple Health data to flow **both ways** with the **DB as the source of truth** (so trainers can read it server-side). The device acts as a bridge; the backend never touches HealthKit. Deltas to this spec's port/adapter:

- **New `HealthPort` methods:** `getDietaryWaterToday()`, `writeDietaryWater(litres, date)`, `getSleepLastNight()` (hours). Steps + body weight read/write already exist here.
- **Permission scope:** add `HKQuantityTypeIdentifierDietaryWater` (read **+ write**) and `HKCategoryTypeIdentifierSleepAnalysis` (**read**) to the `ExpoHealthKitAdapter` scopes; `HKQuantityTypeIdentifierDietaryEnergyConsumed` (read+write) is added by Nutrition at M9. Requested through the existing permission flow.
- **Direction:** Water = read+write, Sleep = read-only (Watch/trackers write it), Steps = read, Weight = read+write (the M6 `writeBodyWeight`).
- **Echo de-dup:** the bridge source-tags the app's own HK writes and excludes them when reading HK back, so a value the app wrote isn't re-imported and double-counted.
- **Persistence (owned by `18`/`06`/`13`-nutrition):** Water/Sleep/Steps → `habit_completions.value`; Weight → `body_measurements`; Calories → `nutrition_entries` (M9). The DB value is canonical; HealthKit is a mirror.
- **Android Health Connect** — still deferred (later platform pass).

Full design + sequencing: `specs/18-habit-setup/design.md § 7`.
