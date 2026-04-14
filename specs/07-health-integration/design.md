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
