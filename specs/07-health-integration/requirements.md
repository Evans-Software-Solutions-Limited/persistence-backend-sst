# 07 — Health Integration: Requirements

## Overview

Sync health data (steps, calories, body weight, active energy) from Apple HealthKit (iOS) and Google Health Connect (Android). Data supplements the progress tracking features.

**Dependencies:** Progress & Goals milestone (06) for measurement display. HealthKit/Health Connect native modules.

---

## User Stories

### STORY-001: As an iOS user, I want to connect Apple HealthKit

**Acceptance Criteria:**

- [ ] Health permissions request screen explaining what data is needed and why
- [ ] Request read permissions for: steps, active energy, body mass, heart rate
- [ ] Request write permissions for: body mass (to sync from app measurements)
- [ ] Permission state persisted (don't re-ask after granting)
- [ ] Graceful handling if user denies permissions

### STORY-002: As an Android user, I want to connect Google Health Connect

**Acceptance Criteria:**

- [ ] Health Connect permissions request
- [ ] Same data types as iOS: steps, calories, body mass, heart rate
- [ ] Handle Health Connect not installed (redirect to Play Store)
- [ ] Permission state persisted

### STORY-003: As a user, I want to see today's steps and calories on the dashboard

**Acceptance Criteria:**

- [ ] Steps today tile on dashboard
- [ ] Active calories today tile on dashboard
- [ ] Data refreshed on app foreground (rate-limited, max once per 5 minutes)
- [ ] "No data" state if permissions not granted
- [ ] "Connect Health" CTA if not yet connected

### STORY-004: As a user, I want health-sourced body weight synced to my measurements

**Acceptance Criteria:**

- [ ] If HealthKit/Health Connect has body weight data, surface latest reading
- [ ] Option to import health weight into app's measurement log
- [ ] No automatic overwrite — user confirms import
- [ ] Bi-directional: app measurements can write to HealthKit (user opt-in)

### STORY-005: As a user, I want to disconnect health integration

**Acceptance Criteria:**

- [ ] "Disconnect" option in settings
- [ ] Clears local health data cache
- [ ] Stops sync
- [ ] Does not revoke OS-level permissions (user must do that in settings)

### STORY-006: As a user, I want health data to work with poor connectivity

**Acceptance Criteria:**

- [ ] Health data read from device (no network needed)
- [ ] Cached locally for dashboard display
- [ ] No battery drain from health polling

### STORY-007: As an M1 user on any platform, I want the dashboard's step tile to render without crashing

**Acceptance Criteria:**

- [ ] AC 7.1 — On iOS (device or simulator): `ExpoHealthKitAdapter` provides `getStepsToday`, `getActiveCaloriesToday`, `getLatestBodyWeight`, `getHeartRateLatest`, `requestPermissions`, `getPermissionStatus`, `isAvailable`, `disconnect`. The permission grant sheet covers the full legacy read + write scope (steps, walking distance, basal energy, active energy, exercise minutes, stand time, body mass, body fat %, heart rate). `writeBodyWeight` returns `fail(UNAVAILABLE)` in M1 (lights up M6).
- [ ] AC 7.2 — On iOS simulator: HealthKit reports `isAvailable: false` and tiles render the existing "Health not available on this iOS build" copy. The earlier `SimulatorMockHealthAdapter` was removed in PR #38 follow-up — simulator builds now show live empty state honestly rather than a fixture.
- [ ] AC 7.3 — On Android: `AndroidStubHealthAdapter` reports `isAvailable: false`; reads return `fail(UNAVAILABLE)`; dashboard renders a muted "Not available on Android yet" tile.
- [ ] AC 7.4 — Selection logic lives in `adapters/health/index.ts` — `createHealthAdapter()` picks the correct implementation once at provider construction.
- [ ] AC 7.5 — Denied / not-determined permission state renders a "Connect Health" CTA tile on the dashboard; tap navigates toward `/health-permissions` (destination is a placeholder until Phase 4 ships the screen).
- [ ] AC 7.6 — `useHealthData()` rate-limits reads to one per 5 minutes; re-reads fire on app-foreground transitions.
- [ ] AC 7.7 — M1 coverage ≥ 90% on `adapters/health/*` and `ui/hooks/useHealthData*`; test adapters are the `MockHealthAdapter` + `InMemoryHealthAdapter` pattern.
