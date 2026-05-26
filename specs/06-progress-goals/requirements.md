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

---

## Appendix A — Habits, streaks, achievements (appended 2026-05-26 for M4 + M8)

The following stories extend STORY-003 (goals) into the habit + streak + achievement surface. They consume the shared primitives defined in `specs/_shared/cross-cuts.md` (streak engine § 3, habit completions § 3.3, trainer-assigned goals § 2, achievement triggers § 3.6, notification taxonomy § 5). They do NOT redefine those primitives — they describe the user-facing requirements that drive their implementation in this spec's domain.

### STORY-008: As a user, I want habit goals with daily or weekly check-offs so I can build consistent fitness habits

**Acceptance Criteria:**

- [ ] AC 8.1 — User can create a habit goal by selecting `goal_type` in the `habit_*` family (e.g. `habit_generic`, with cadence chosen at create time: `daily` or `weekly`). Cadence is persisted on the corresponding `user_streaks.period` row per cross-cuts § 3.2.
- [ ] AC 8.2 — Habit goals expose a check-off affordance on Home and on the Goal detail screen. Tapping it creates a `habit_completions` row keyed `(user_id, goal_id, day)` per cross-cuts § 3.3; duplicate taps in the same day are idempotent (no error, no second row).
- [ ] AC 8.3 — A daily-grid presenter on the Goal detail screen renders the last 30 days of completion state (filled / unfilled cells); the most recent 7 cells render larger ("this week") and the prior 21 smaller ("last three weeks").
- [ ] AC 8.4 — Optional `value` field on `habit_completions` (per cross-cuts § 3.3) supports numeric habits (e.g. "8 cups of water", "20 min meditation"); rendered as `value / target` inline with the cell when present.
- [ ] AC 8.5 — Marking a completion satisfies the period for the linked `user_streaks` row per cross-cuts § 3.4 (on-write evaluation); the streak tile updates without a manual refresh.
- [ ] AC 8.6 — Habit goals delete cascades to their `habit_completions` and their linked `user_streaks` row (FK `ON DELETE CASCADE`).

### STORY-009: As a user, I want streak tracking on my habit / workout / measurement / nutrition goals so I can see consistency at a glance

**Acceptance Criteria:**

- [ ] AC 9.1 — A streak tile on Home renders `current_count` / `longest_count` per cross-cuts § 3.2, sourced from `user_streaks` rows for the user. When the user has multiple active streaks, the tile renders the longest-current first; secondary streaks are reachable via Goal detail.
- [ ] AC 9.2 — Each streak surfaces its `streak_type` visually (workout / habit / measurement / nutrition) via icon + colour token (per cross-cuts § 3.1).
- [ ] AC 9.3 — Streak tile shows a "fire" indicator when `current_count > 0` and `status = 'active'`; greys out when `status = 'broken'`; "paused" mode is shown with a calendar icon (reserved for future planned-holiday mode per cross-cuts § 3.5).
- [ ] AC 9.4 — Streaks are scoped per-goal (`source_goal_id` not null) per cross-cuts § 3.2. The system MAY additionally maintain ad-hoc `source_goal_id = NULL` streaks (e.g. "training-week" auto-streak); for v1, only goal-linked streaks are user-visible.
- [ ] AC 9.5 — Tapping the streak tile deep-links to the source goal's detail screen.

### STORY-010: As a user, I want freeze tokens that auto-protect my streak when I miss a period, so a single bad week doesn't reset months of consistency

**Acceptance Criteria:**

- [ ] AC 10.1 — Freeze tokens are earned at 1 token per 4 successive completed periods, capped at 4 per streak (per cross-cuts § 3.5).
- [ ] AC 10.2 — When the nightly cron (cross-cuts § 3.4) detects a missed period AND `freeze_tokens > 0`, it auto-decrements `freeze_tokens` by 1, keeps `status = 'active'`, does NOT advance `current_count`, and emits a `freeze_token_applied` notification (cross-cuts § 5).
- [ ] AC 10.3 — Streak tile renders the freeze-token count as a small badge in the corner of the streak icon. Counts of 0 are rendered as a faint outline, not omitted (so the user knows the slot exists).
- [ ] AC 10.4 — Freeze-token spend is silent in-app (no animation / haptic on the miss-then-thaw) per cross-cuts § 3.5 — the notification carries the message; the UI quietly recovers.
- [ ] AC 10.5 — Tokens earned over the cap of 4 are silently discarded per cross-cuts § 3.5.

### STORY-011: As a user, I want training-frequency goals (e.g. 4 workouts/week) so my streak ties to a meaningful adherence target

**Acceptance Criteria:**

- [ ] AC 11.1 — User can create a goal of type `weekly_workout_count` with `target_value: number` (sessions per week, 1–7).
- [ ] AC 11.2 — Workout-frequency goals create a `user_streaks` row with `streak_type = 'workout_streak'`, `period = 'weekly'` per cross-cuts § 3.1.
- [ ] AC 11.3 — A weekly period is satisfied when the count of `workout_sessions` with `status = 'completed'` AND `completed_at` inside the period is `>= target_value` (cross-cuts § 3.1 references the rule; this AC commits to the count-based satisfaction predicate).
- [ ] AC 11.4 — The Goal detail screen for a `weekly_workout_count` goal renders: `target_value` ("4 workouts/wk"), `current_value` (sessions logged this week so far), week-progress ring filling toward target, current streak tile (cross-cuts § 3.2 source).
- [ ] AC 11.5 — Streak satisfaction happens on `POST /sessions` completion per cross-cuts § 3.4 on-write hook — when the post-write count crosses `target_value`, the engine advances `current_count`.

### STORY-012: As a user, I want step goals populated by HealthKit so I don't have to log them manually

**Acceptance Criteria:**

- [ ] AC 12.1 — User can create a goal of type `daily_steps` with `target_value: number` (steps per day) and `unit = 'steps'`.
- [ ] AC 12.2 — Step counts are sourced from `HealthPort.getStepsToday` / `getStepsLastNDays` (already shipped in `packages/mobile/src/adapters/health/expo-healthkit.adapter.ts`). The mobile container updates `current_value` from HealthKit on every Home or Goal-detail mount + on `AppState` resume.
- [ ] AC 12.3 — A periodic write-back path persists the day's step total to a backend store (whichever the design § settles on — `daily_activity_data` extension recommended; see design.md § Step goals + HealthKit integration) so the streak engine can satisfy periods even when the mobile app is closed.
- [ ] AC 12.4 — When a day's step count first reaches `target_value`, the engine satisfies the day period and may advance the streak (cross-cuts § 3.4 on-write hook fires at the moment the write-back lands).
- [ ] AC 12.5 — Goal detail renders the explicit affordance "Connected to Apple Health" (iOS) / "Connected to Health Connect" (Android) so the user understands where the number is sourced.
- [ ] AC 12.6 — If `HealthPort` is unavailable (permission denied, not on iOS / Android), the goal is creatable but the goal-detail screen renders an empty-state "Connect Apple Health to track this goal" CTA that opens system Health settings via `Linking`.

### STORY-013: As a user, I want calorie / macro goals that reference my nutrition targets (cross-cut with `13-nutrition-tracking`)

**Acceptance Criteria:**

- [ ] AC 13.1 — User can create a goal of type `daily_calories`, `daily_protein`, `daily_carbs`, or `daily_fat` with `target_value: number` and the appropriate `unit` (`'kcal'`, `'g'`, `'g'`, `'g'`).
- [ ] AC 13.2 — Macro / calorie goals reference (do NOT duplicate) the corresponding row in `nutrition_targets` (owned by `13-nutrition-tracking`). When the user updates their nutrition targets, the goal's `target_value` reads-through the linked target — single source of truth.
- [ ] AC 13.3 — A daily period is satisfied per cross-cuts § 3.1 `nutrition_streak`: the daily total falls within `target_value ± 10%`.
- [ ] AC 13.4 — When `13-nutrition-tracking` is not yet live (M9 ship), goal creation for these types is gated behind a feature flag and disabled in the UI; the goal-type seed list still ships in M4 but is not selectable until M9 unlocks nutrition entries.
- [ ] AC 13.5 — Goal detail renders the day's actual total vs the tolerance band visually (over / under / within) and the linked nutrition-target row's name.

### STORY-014: As a user, I want fitness-themed achievement badges when I hit streak milestones so I feel rewarded

**Acceptance Criteria:**

- [ ] AC 14.1 — Streak milestones trigger achievements per cross-cuts § 3.6 thresholds: weekly (1, 2, 4, 8, 12 wks), daily (7, 14, 28, 60, 90 days).
- [ ] AC 14.2 — Achievement insert (cross-cuts § 3.6) emits a `streak_milestone` notification (cross-cuts § 5).
- [ ] AC 14.3 — On the next Home / Goal-detail mount after a fresh milestone, a badge-celebration overlay renders once (fitness-themed icon per tier — flame / dumbbell / lightning / medal / crown); the user dismisses it with tap or swipe, and the overlay does not re-fire on subsequent mounts (consumed-on-display state stored locally).
- [ ] AC 14.4 — Celebration is paired with `Haptics.notificationAsync(Success)` on iOS and the equivalent on Android.
- [ ] AC 14.5 — Achievements grid on Profile renders all earned achievements grouped by streak type, chronological-DESC within each group.
- [ ] AC 14.6 — A small badge renders next to the user's display name in Home greeting + Profile chrome when the user has any active streak `current_count` at or above the milestone of their highest-tier achievement (visual prestige indicator).
- [ ] AC 14.7 — Beyond the 3-month / 12-week tier no additional milestones fire (per cross-cuts § 3.6 — front-loaded engagement); v2 may add 6-month and 1-year tiers as a follow-up.

### STORY-015: As a user, I want to see who set a goal when a trainer assigned it (cross-cut with `10-trainer-features`)

**Acceptance Criteria:**

- [ ] AC 15.1 — When a goal's `assigned_by_user_id` is non-NULL (cross-cuts § 2.1), the Goal list row and Goal detail header render `Goal set by Coach <display_name>` per cross-cuts § 2.2 attribution rule.
- [ ] AC 15.2 — Client cannot delete or edit a trainer-assigned goal's title, type, target, or due date in v1 per cross-cuts § 2.2. The "Edit" affordance is hidden; "Delete" is disabled with a sheet explaining "Ask your coach to remove this goal."
- [ ] AC 15.3 — Client CAN mark a trainer-assigned goal as complete (cross-cuts § 2.2 "Can mark complete on any goal") — completion is a state change owned by both parties, not a destructive edit.
- [ ] AC 15.4 — On goal assignment by the trainer (out-of-band PT spec, M8), the client receives a `goal_assigned_by_trainer` notification (cross-cuts § 5) with deep link `/progress/goals/:id`.

### STORY-016: As a user, I want goals to have `target_value`, `current_value`, and `unit` so progress is quantitative

**Acceptance Criteria:**

- [ ] AC 16.1 — `user_goals` schema gains `target_value numeric(12,3)`, `current_value numeric(12,3)`, `unit text` columns per cross-cuts § 6 (M4 migration). All three nullable so existing rows remain valid (no backfill required).
- [ ] AC 16.2 — Goal list rows render `current_value / target_value <unit>` as the progress label when all three are present; falls back to title-only display when any are NULL (preserves M1 dashboard's M1-shipped defensive `0 / 0` behaviour).
- [ ] AC 16.3 — Goal detail renders a circular progress indicator (ring) when `target_value > 0`; arc fills `min(current_value / target_value, 1.0)`. When `current_value > target_value` the ring renders as a closed ring with an overflow indicator (+%).
- [ ] AC 16.4 — `target_value` is required at create time when the chosen `goal_type` is in the quantitative family (`weekly_workout_count`, `daily_steps`, `daily_calories`, `daily_protein`, `daily_carbs`, `daily_fat`, `body_composition`, `strength_pr`). The UI requires the field and rejects submit on empty.
- [ ] AC 16.5 — `current_value` is server-managed (NOT client-editable). Updates flow from: workout count (`weekly_workout_count`), HealthKit write-back (`daily_steps`), nutrition rollup (`daily_*`), latest measurement (`body_composition`), latest PR (`strength_pr`). The client never writes `current_value` directly.
- [ ] AC 16.6 — A schema migration in M4 adds the three columns. Migration is idempotent (uses `IF NOT EXISTS` per the existing migration discipline in `CLAUDE.md`).
