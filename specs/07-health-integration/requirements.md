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
