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

- [ ] AC 5.1 — Greeting with user's first name pulled from `profile.fullName` (falls back to "Lifter" when null)
- [ ] AC 5.2 — Recent workout templates (own + assigned + defaults) render as a horizontal carousel, limit 10
- [ ] AC 5.3 — Recent completed sessions (last 7 days) render as the RecentActivity section, most recent first
- [ ] AC 5.4 — Active goals summary with progress indicator and target unit, ordered by priority
- [ ] AC 5.5 — Weekly workout count / streak tiles render with correct counts sourced from the backend
- [ ] AC 5.6 — Subscription tier badge renders; free-tier users see an "Upgrade" CTA
- [ ] AC 5.7 — PR-of-the-week card renders the highest-impact PR achieved in the last 7 days; omitted entirely when none exists
- [ ] AC 5.8 — `GET /dashboard` returns a single-envelope response (`{ data: DashboardPayload }`) and always populates every top-level field (empty arrays / null objects rather than omitted keys)
- [ ] AC 5.9 — Dashboard data loads from the local 5-minute TTL cache instantly on cold start; a background refresh fires when the cache is stale or missing
- [ ] AC 5.10 — Pull-to-refresh bypasses the TTL, refetches `/dashboard`, and updates the cache
- [ ] AC 5.11 — Unauthenticated `GET /dashboard` returns 401 (JWT middleware contract)
- [ ] AC 5.12 — Sections enter with a staggered fade on mount (Greeting → Goals → YourWorkouts → MyProgress → RecentActivity), matching the M0 exercise-list animation timing

### STORY-006: As a user, I want progress data available offline

**Acceptance Criteria:**

- [ ] Measurements cached locally
- [ ] Records cached locally
- [ ] Goals cached locally
- [ ] New entries created offline, synced when online
- [ ] Dashboard renders from cache on cold start

### STORY-007: As a backend consumer, I want `GET /dashboard` to carry every field Home needs in one call

**Acceptance Criteria:**

- [ ] AC 7.1 — Response body includes `profile`, `subscription`, `recentWorkouts`, `recentActivity`, `activeGoals`, `progress`, `prOfTheWeek`, `latestMeasurement` (shape per `design.md` § Dashboard backend contract)
- [ ] AC 7.2 — `recentActivity` covers completed sessions from the last 7 days, most recent first
- [ ] AC 7.3 — `recentWorkouts` merges own + assigned + default templates, limit 10, preserving legacy ordering
- [ ] AC 7.4 — `activeGoals` is sourced from `user_goals WHERE is_active = true`, joined to `goal_types` for display
- [ ] AC 7.5 — `subscription.isFreeTier` follows the legacy rule (no active sub, `tierName = 'free'`, or expired `cancelled`)
- [ ] AC 7.6 — `prOfTheWeek` is the highest-ranked PR from the last 7 days with deterministic tie-breaking (see design §); `null` when the window has no records
- [ ] AC 7.7 — `latestMeasurement` emits numeric `weightKg` / `bodyFatPercentage` (not strings), timestamp in ISO8601 UTC
- [ ] AC 7.8 — Handler executes its sub-queries in parallel (`Promise.all`) so Lambda cold-start latency stays bounded
- [ ] AC 7.9 — Handler coverage ≥ 90% (per the backend gate): happy path, 401, empty-state user (zero workouts / goals / records), and PR-of-the-week tie-breaking
