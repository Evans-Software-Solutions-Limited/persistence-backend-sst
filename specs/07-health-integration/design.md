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

| Platform                  | Adapter                      | M1 scope                                                                                                                              | Notes                                                                                                                                                                                  |
| ------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iOS (device / real build) | `ExpoHealthKitAdapter`       | Read steps today, active calories today, latest body weight, heart rate; permission request + status; `isAvailable()`; `disconnect()` | Uses `@kingstinct/react-native-healthkit`, already used by legacy. `writeBodyWeight` is a no-op that returns `fail(UNAVAILABLE)` in M1 — wired in M6 when measurement editor ships.    |
| iOS simulator             | `SimulatorMockHealthAdapter` | Same surface as iOS, returns deterministic non-zero numbers (steps: 4812, active cal: 312, weight: 74.5 kg, hr: 62 bpm)               | Simulator reports HealthKit as `isAvailable: false` in practice; fallback adapter keeps smoke-testing unblocked. Selected when `Platform.OS === "ios" && __DEV__ && !Device.isDevice`. |
| Android                   | `AndroidStubHealthAdapter`   | `isAvailable: false`; every read returns `fail(UNAVAILABLE)`; permission request is a no-op success                                   | Android M1 scope is "does not crash, renders an empty health tile with 'Not available on Android yet'". Real Health Connect adapter is deferred past M1.                               |
| Tests                     | `MockHealthAdapter`          | Existing in-memory adapter with configurable return values                                                                            | Unchanged from Phase 1 stub pattern.                                                                                                                                                   |

### Selection logic

Picked once at `AdapterProvider` construction, not per-hook:

```ts
// adapters/health/index.ts
export function createHealthAdapter(): HealthPort {
  if (Platform.OS === "ios") {
    if (__DEV__ && !Device.isDevice) return new SimulatorMockHealthAdapter();
    return new ExpoHealthKitAdapter();
  }
  if (Platform.OS === "android") return new AndroidStubHealthAdapter();
  return new StubHealthAdapter(); // web / fallback
}
```

The `StubHealthAdapter` from 00-guardrails remains — the simulator-mock and Android-stub adapters are new and explicit replacements so the health surface is coherent on every target.

### Why simulator-mock is M1-critical

The V2 smoke-test flow runs on an iOS simulator (established in M0). Without a simulator-mock fallback, the dashboard's StepsTile renders empty or the tile swallows permission-denied errors, and the review gate "mocked step count renders" from the M1 brief sketch fails. Mock values are deterministic so simulator builds are visually stable across reviewers.

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
