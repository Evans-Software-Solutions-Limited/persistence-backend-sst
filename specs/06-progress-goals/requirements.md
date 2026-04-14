# 06 — Progress & Goals: Requirements

## Overview

Track body measurements, personal records, and goals. Visualize progress over time. Goals are user-defined targets (strength, weight loss, habit building) with completion tracking.

---

## User Stories

### STORY-001: As a user, I want to log body measurements

**Acceptance Criteria:**

- [ ] Log: weight, body fat %, chest, waist, hips, arm, thigh measurements
- [ ] Date-stamped entries
- [ ] View measurement history as list and chart
- [ ] Most recent measurement shown prominently
- [ ] Offline creation (queued for sync)

### STORY-002: As a user, I want to see my personal records

**Acceptance Criteria:**

- [ ] Personal records auto-detected from completed sessions
- [ ] Record types: 1RM, 3RM, 5RM, 10RM, max reps, max weight, best time, longest distance
- [ ] Records shown per exercise
- [ ] New PR notification in session summary
- [ ] PR history with dates

### STORY-003: As a user, I want to create and track goals

**Acceptance Criteria:**

- [ ] Goal types: strength, endurance, weight_loss, muscle_gain, habit_building, custom
- [ ] Create goal: name, type, target value, target date (optional), notes
- [ ] Goal status: active, completed, abandoned
- [ ] Progress indicator (% toward target)
- [ ] Mark goal as completed or abandoned
- [ ] Goal list with filters (active, completed, all)

### STORY-004: As a user, I want to see progress visualizations

**Acceptance Criteria:**

- [ ] Weight/measurement trend chart (line graph over time)
- [ ] Exercise strength progression chart (weight over sessions for a given exercise)
- [ ] Volume per session trend
- [ ] Goal progress bars
- [ ] Time range selector (1 week, 1 month, 3 months, 6 months, 1 year, all time)

### STORY-005: As a user, I want a dashboard summarising my recent activity

**Acceptance Criteria:**

- [ ] Greeting with user's name
- [ ] Recent workout sessions (last 7 days)
- [ ] Active goals summary
- [ ] Weekly workout count / streak
- [ ] Quick actions: start workout, log measurement, browse exercises
- [ ] Data loads from local cache instantly, refreshes in background

### STORY-006: As a user, I want progress data available offline

**Acceptance Criteria:**

- [ ] Measurements cached locally
- [ ] Records cached locally
- [ ] Goals cached locally
- [ ] New entries created offline, synced when online
- [ ] Dashboard renders from cache on cold start
