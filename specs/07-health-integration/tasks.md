# 07 — Health Integration: Tasks

## Phase 1: Domain & Ports

- [ ] Define `HealthPort` interface with all methods
- [ ] Define `HealthPermissionStatus`, `HealthWeight`, `HealthError` types
- [ ] Create mock health adapter for tests
- [ ] Write tests for mock adapter

## Phase 2: iOS Adapter (HealthKit)

- [ ] Add `@kingstinct/react-native-healthkit` dependency
- [ ] Create `HealthKitAdapter` implementing `HealthPort`
- [ ] Implement permission request (steps, calories, body mass, heart rate)
- [ ] Implement data reads (steps today, calories today, latest weight, heart rate)
- [ ] Implement body weight write
- [ ] Handle HealthKit not available (simulator, older iOS)
- [ ] Write tests with mock HealthKit module

## Phase 3: Android Adapter (Health Connect)

- [ ] Add `react-native-health-connect` / `expo-health-connect` dependency
- [ ] Create `HealthConnectAdapter` implementing `HealthPort`
- [ ] Implement permission request
- [ ] Implement data reads
- [ ] Handle Health Connect not installed (redirect to Play Store)
- [ ] Write tests

## Phase 4: UI — Permission Flow

- [ ] Create `HealthPermissionsPresenter` (explanation of each data type, request button)
- [ ] Create `HealthPermissionsContainer` (checks current status, requests permissions)
- [ ] Create `app/(app)/health-permissions.tsx` screen
- [ ] Write tests

## Phase 5: UI — Dashboard Tiles

- [ ] Create `StepsTile` presenter (step count, progress ring)
- [ ] Create `CaloriesTile` presenter (calorie count)
- [ ] Create `HealthConnectionStatus` component (connected/not connected)
- [ ] Create `useHealthData()` hook (rate-limited reads, caches in state)
- [ ] Integrate tiles into dashboard presenter
- [ ] Write tests

## Phase 6: Body Weight Sync

- [ ] Create UI for importing health weight into measurements
- [ ] Implement write-back from app measurements to HealthKit (opt-in)
- [ ] Write tests for import/export flow

## Phase 7: Settings & Disconnect

- [ ] Add health connection settings in profile/settings
- [ ] Implement disconnect (clear cache, stop reads)
- [ ] Write tests

## Phase 8: Quality Gates

- [ ] All health tests pass with 90% coverage
- [ ] Quality gates pass
