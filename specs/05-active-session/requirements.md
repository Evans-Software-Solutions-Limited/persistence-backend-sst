# 05 — Active Session: Requirements

## Overview

The core workout logging experience. Users start a workout session, log sets (weight, reps, RPE), use rest timers, substitute exercises, and complete or cancel the session. This is the most offline-critical feature — sessions must survive network loss, app backgrounding, and device restarts.

---

## User Stories

### STORY-001: As a user, I want to start a workout session from a workout template

**Acceptance Criteria:**

- [ ] "Start Workout" from workout detail creates a new session
- [ ] Session initialised with exercises from the workout template
- [ ] Session state persisted immediately to local DB
- [ ] Only one active session at a time (warn if another exists)
- [ ] Session screen opens with first exercise ready

### STORY-002: As a user, I want to log sets during my workout

**Acceptance Criteria:**

- [ ] For each exercise: log weight, reps, and optionally RPE (1-10), distance, duration
- [ ] Quick-fill from previous session's values for same exercise
- [ ] Add additional sets beyond the target
- [ ] Mark sets as completed
- [ ] Running total of volume (weight x reps) per exercise
- [ ] Set data saved to local DB on every entry (never lost)

### STORY-003: As a user, I want a rest timer between sets

**Acceptance Criteria:**

- [ ] Configurable rest timer (30s, 60s, 90s, 120s, 180s, custom)
- [ ] Timer starts automatically after completing a set (user preference)
- [ ] Visual countdown with progress ring
- [ ] Notification when rest period completes (even if app backgrounded)
- [ ] Can skip or extend rest timer
- [ ] Default rest time configurable per exercise or globally

### STORY-004: As a user, I want to substitute an exercise during a session

**Acceptance Criteria:**

- [ ] "Swap exercise" option on any session exercise
- [ ] Opens exercise picker filtered by same muscle group
- [ ] Replaces exercise in current session only (workout template unchanged)
- [ ] Previous sets for swapped exercise preserved (marked as swapped)

### STORY-005: As a user, I want to navigate between exercises in my session

**Acceptance Criteria:**

- [ ] Swipe or tap to move between exercises
- [ ] Exercise progress indicator (e.g., 3/6 exercises)
- [ ] Can jump to any exercise (not forced sequential)
- [ ] Superset exercises displayed together

### STORY-006: As a user, I want to complete my workout session

**Acceptance Criteria:**

- [ ] "Finish Workout" button shows session summary
- [ ] Summary: duration, total volume, exercises completed, sets completed, personal records hit
- [ ] Confirmation to save session
- [ ] Session synced to API (queued if offline)
- [ ] Session status set to "completed"
- [ ] New personal records detected and saved

### STORY-007: As a user, I want to cancel/discard a session

**Acceptance Criteria:**

- [ ] "Cancel Workout" with confirmation ("Discard this session?")
- [ ] Session status set to "cancelled"
- [ ] Logged sets still preserved (queryable but not counted for progress)

### STORY-008: As a user, I want my active session to survive app closure

**Acceptance Criteria:**

- [ ] Active session state persisted in SQLite
- [ ] Reopening app restores exact session state (current exercise, logged sets, timer)
- [ ] Session duration includes time while app was closed
- [ ] Resume prompt on next app open ("Continue Push Day?")
- [ ] Works completely offline

### STORY-009: As a user, I want to start a quick/empty session without a template

**Acceptance Criteria:**

- [ ] "Quick Start" option creates empty session
- [ ] Can add exercises on-the-fly from exercise library
- [ ] Otherwise behaves identically to template-based session
