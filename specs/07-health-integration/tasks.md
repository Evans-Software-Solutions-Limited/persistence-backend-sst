# 07 — Health Integration: Tasks

## Current state (2026-04-19)

**Shipped: ~1 of ~30 tasks complete. Stub adapter only.**

What's there:

- `HealthPort` interface at `src/domain/ports/health.port.ts` with `HealthPermissionStatus`, `HealthWeight`, `HealthError` types (shipped as part of 00-guardrails).
- `StubHealthAdapter` at `src/adapters/health/stub.adapter.ts` — returns `unavailable` for every method. Placeholder to keep DI happy.

Nothing real is built: no HealthKit adapter, no Health Connect adapter, no permission-request screen, no dashboard tiles, no weight-sync flow.

Parent milestone: **M1 Home / dashboard (incl HealthKit)** — bundles the real `ExpoHealthKitAdapter` (iOS) + Android stub + simulator-mock fallback with the dashboard rollout so Home ships with real step/calorie data from the start.

## Phase 1: Domain & Ports

- [ ] Define `HealthPort` interface with all methods
- [ ] Define `HealthPermissionStatus`, `HealthWeight`, `HealthError` types
- [ ] Create mock health adapter for tests
- [ ] Write tests for mock adapter

## Phase 2: iOS Adapter (HealthKit) — M1 scope

Traces to `design.md` § M1 scope: platform adapter matrix and
`requirements.md` STORY-007 AC 7.1 / 7.2 / 7.4 / 7.6 / 7.7.

- [x] Add `@kingstinct/react-native-healthkit` dependency to `packages/mobile`
- [x] Add iOS native-build config (Info.plist `NSHealthShareUsageDescription` + `NSHealthUpdateUsageDescription`)
- [x] Create `ExpoHealthKitAdapter` at `packages/mobile/src/adapters/health/expo-healthkit.adapter.ts` implementing `HealthPort`
- [x] Implement permission request (steps, active energy, body mass, heart rate)
- [x] Implement reads: `getStepsToday`, `getActiveCaloriesToday`, `getLatestBodyWeight`, `getHeartRateLatest`
- [x] Stub `writeBodyWeight` to return `fail(UNAVAILABLE)` in M1 (lights up M6)
- [x] Handle HealthKit not available (older iOS, entitlements missing) — return appropriate `HealthError`
- [x] Create `SimulatorMockHealthAdapter` at `packages/mobile/src/adapters/health/simulator-mock.adapter.ts` with deterministic values (AC 7.2)
- [x] Create `adapters/health/index.ts` `createHealthAdapter()` selection function (AC 7.4)
- [x] Wire new adapter into `AdapterProvider`
- [x] Write tests with a mock HealthKit native module; maintain ≥ 90% coverage

## Phase 3: Android Adapter (Health Connect)

**M1 scope:** ship `AndroidStubHealthAdapter` only. Full Health Connect
integration deferred past M1 (post-M4 candidate).

Traces to `requirements.md` STORY-007 AC 7.3 + 7.4.

- [x] Create `AndroidStubHealthAdapter` at `packages/mobile/src/adapters/health/android-stub.adapter.ts` — `isAvailable: false`, reads return `fail(UNAVAILABLE)`, permission request resolves as no-op success

**Deferred past M1:**

- [ ] Add `react-native-health-connect` / `expo-health-connect` dependency
- [ ] Create real `HealthConnectAdapter` implementing `HealthPort`
- [ ] Implement permission request
- [ ] Implement data reads
- [ ] Handle Health Connect not installed (redirect to Play Store)
- [ ] Write tests

## Phase 4: UI — Permission Flow

- [ ] Create `HealthPermissionsPresenter` (explanation of each data type, request button)
- [ ] Create `HealthPermissionsContainer` (checks current status, requests permissions)
- [ ] Create `app/(app)/health-permissions.tsx` screen
- [ ] Write tests

## Phase 5: UI — Dashboard Tiles — M1 scope

Traces to `design.md` § M1 scope > UI tiles live vs not-yet-connected
and `requirements.md` STORY-007 AC 7.5 + 7.6 (plus 06-progress-goals
STORY-005 AC 5.12 for animation).

- [x] Create `StepsTile` presenter (step count, last-synced caption, `$success` dot when granted)
- [x] Add "Connect Health" CTA variant for denied / not-determined state (AC 7.5)
- [x] Add "Not available on Android yet" variant for Android / web (AC 7.3)
- [x] Create `useHealthData()` hook at `packages/mobile/src/ui/hooks/useHealthData.tsx` with 5-min rate limit + app-foreground re-read (AC 7.6)
- [x] Integrate `StepsTile` into `HomePresenter` MyProgress section
- [x] Wire active-energy read into MyProgress (single tile for M1; basal / standTime remain placeholder zeros per design §)
- [x] Write presenter + hook tests; maintain ≥ 90% coverage

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
