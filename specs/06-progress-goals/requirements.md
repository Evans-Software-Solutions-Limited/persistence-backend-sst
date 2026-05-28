# 06 — Progress, Goals & Home: Requirements

> **Spec rewritten from scratch on 2026-05-27** to absorb the May 2026 design package. Prior version (incl. PR #77 — habits / streaks / achievements extension) preserved in git history. Per locked decision from the design audit (option A on Home placement), this spec also OWNS the **Home screen** because Home and Progress/You share 80%+ of their data flow (M4 backend).

---

## Overview

Three things land here:

1. **Home screen (athlete)** — status-first dashboard with the 3-ring TodayHero (Move / Train / Fuel), workout carousel, habits grid, quick log strip, weekly volume bar, recent PRs carousel, optional CoachQuickPeek when in coach mode.
2. **You / Progress screen** — lifetime view: streak hero, milestones row, body trend sparklines, volume stats + by-muscle bars, PR history.
3. **M4 backend** — streak engine, habit completions, goal extensions, achievements, body-measurement tracking, weekly-volume aggregation, PR detection. Per `specs/_shared/cross-cuts.md § 3` (streak engine) + § 5 (notification taxonomy).

Authoritative references:

1. `~/Downloads/handoff/design-source/screens/home.jsx` — Home composition
2. `~/Downloads/handoff/design-source/screens/progress.jsx` — Progress/You composition
3. `~/Downloads/handoff/design-source/prototype-hubs.jsx` lines 152–289 — alternate You hub layout
4. `specs/_shared/cross-cuts.md` § 2, § 3, § 5
5. `docs/design-port-audit.md` § "Progress" + "Home"
6. Legacy V1 reference: `../persistence-mobile/app/(tabs)/home.tsx`, `progress.tsx`, `hooks/api/useGetHome.ts`, `hooks/api/useGetProgress.ts`

---

## Locked decisions

| #   | Decision                | Locked value                                                                                                                                                                                |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Home placement          | This spec owns Home; coach Home variant in `10-trainer-features`.                                                                                                                           |
| 2   | TodayHero rings         | Move (`$primary`) · Train (`$ember`) · Fuel (`$gold`). Move = HealthKit steps. Train = weekly volume vs target. Fuel = daily kcal vs target (gates on M9; until then shows `--` + 0% fill). |
| 3   | Habit grid              | TrueCoach-style 7-day grid per `home.jsx:227–268`. Tap-to-toggle inline from Home.                                                                                                          |
| 4   | Streak engine           | Per `_shared/cross-cuts.md § 3` verbatim. Types: `workout_streak`, `habit_streak`, `measurement_streak`, `nutrition_streak` (M9-gated).                                                     |
| 5   | Achievement triggers    | Per cross-cuts § 3.6. Weekly: 1/2/4/8/12 wks. Daily: 7/14/28/60/90 days.                                                                                                                    |
| 6   | Freeze tokens           | Per cross-cuts § 3.5. 1 per 4 successive completed periods. Cap 4. Auto-spend on miss.                                                                                                      |
| 7   | PR detection            | Existing V2 logic — exact-rep-match per `feedback_pr_detection_legacy_parity.md`. No Epley estimates on achievements. 1rm/3rm/5rm/10rm only on exact reps.                                  |
| 8   | Body measurement source | `body_measurements` table (existing). Streak source: `measurement_streak`.                                                                                                                  |
| 9   | Volume-by-muscle        | Aggregated server-side from session sets joined to exercise primary-muscle tagging. Cached daily; recomputed on session completion.                                                         |
| 10  | Offline behaviour       | Reads from SQLite cache first; mutations queue + optimistic. Streak counts derived client-side from cached `habit_completions` until engine reconciles.                                     |
| 11  | M4 endpoint audit       | See `design.md § Backend audit` — splits existing-from-PR-#77 vs net-new.                                                                                                                   |

---

## User stories

### STORY-001: As an athlete on Home, I want a 3-ring TodayHero showing Move / Train / Fuel so I see today's status at a glance

**Acceptance Criteria:**

- 1.1 [ ] Home renders `<TodayHero>` per `home.jsx:83–120` — `<MultiRing size={120} stroke={9}>` with three rings + centred TODAY eyebrow + mono percent + 4-up `<MicroPill>` strip (streak / water / strain / sleep).
- 1.2 [ ] Ring percentages: Move = `dailySteps/goalSteps` (HealthKit hooks preserved). Train = `weeklyVolumeKg/targetVolumeKg` (`useGetWeeklyVolume()`). Fuel = `dailyKcal/targetKcal` (M9 hook; until M9 ships, ring fades to 0% + shows `--`).
- 1.3 [ ] Tap on `<RingLegend>` navigates to corresponding tab/screen.
- 1.4 [ ] Centre TODAY% = average of rings, mono with `tnum`+`zero`.
- 1.5 [ ] 4-up MicroPill row: streak (`$ember`), water (`$primary`), strain (`$accentTrainer`), sleep (`$success`). Placeholders when data missing.

### STORY-002: As an athlete on Home, I want today's workout carousel, habits grid, quick log strip, weekly volume bar, and recent PRs

**Acceptance Criteria:**

- 2.1 [ ] `<WorkoutCarousel>` renders 3 `<WorkoutCarouselCard>`s (from `01-design-system`) per `home.jsx:181–223`. Data: `useGetMyWorkouts()`.
- 2.2 [ ] `<HabitsGrid>` per `home.jsx:227–268` — inline tap-to-toggle each habit cell. Data: `useGetHabits()` + `useToggleHabitDay()`. Today's column highlighted with `$primary` eyebrow.
- 2.3 [ ] `<QuickLogStrip>` per `home.jsx:271–294` — 4 buttons (Weigh in / Log meal / Water / Mood) opening the matching sheets / routes.
- 2.4 [ ] `<WeeklyVolume>` per `home.jsx:297–338` — `<Card>` with stat header (kg total + ▲% vs last week) + 7-day bar chart. Today's bar dashed `$primary`. Data: `useGetWeeklyVolume()`.
- 2.5 [ ] `<PRCarousel>` per `home.jsx:341–372` — horizontal scroll of gold-gradient `<PRCard>` cards. Data: `useGetRecentPRs(limit=5)`.
- 2.6 [ ] `<CoachQuickPeek>` per `home.jsx:374–393` — only renders when `useUserMode().mode === 'coach'`. Content owned by `10-trainer-features`; slot + gate live here.

### STORY-003: As an athlete on You / Progress, I want a lifetime view of streak, milestones, body trends, training volume, PR history

**Acceptance Criteria:**

- 3.1 [ ] Header: `<HeaderBar large title="Progress" eyebrow="LIFETIME · N WORKOUTS" leading={<Avatar onPress={openDrawer}/>} trailing={<IconBtn icon={<IconCalendar/>}/>}>` per `progress.jsx:19–25` + `prototype-hubs.jsx:155–161`.
- 3.2 [ ] `<StreakHero>` per `progress.jsx:73–110` — ember-gradient `<Card>`, 80×80 fire icon, display-xl mono streak + longest, freeze-token sub-card with "Use" Btn.
- 3.3 [ ] `<MilestonesRow>` per `progress.jsx:112–139` — 5 badge cells, tone-gradient when earned (0.45 opacity when not), glow dot top-right when earned.
- 3.4 [ ] `<BodyTrend>` per `progress.jsx:141–194` — two `<Card>`s side-by-side: weight sparkline (SVG path + area fill + last-point dot) + body fat bar chart. Data: `useGetBodyMeasurements(window: 30)`.
- 3.5 [ ] `<VolumeStats>` per `progress.jsx:196–225` — 3-up `<Stat>` grid + horizontal volume-by-muscle bars. Data: `useGetVolumeStats()`.
- 3.6 [ ] `<PRHistory>` per `progress.jsx:227–259` — vertical list of medal-icon rows with lift / date / delta / weight. Data: `useGetPRHistory()`.
- 3.7 [ ] Each section uses `<Section>` from `01-design-system`.

### STORY-004: As an athlete, I want to tap-toggle a habit day from Home

**Acceptance Criteria:**

- 4.1 [ ] Cell tap calls `useToggleHabitDay({ goalId, date })`.
- 4.2 [ ] Mutation queues offline + optimistic update.
- 4.3 [ ] Streak engine fires server-side on success (per `_shared/cross-cuts.md § 3`). Cache invalidates → streak count refreshes.
- 4.4 [ ] Future days locked (non-interactive).
- 4.5 [ ] Past-day backfill allowed (within streak rules).
- 4.6 [ ] Cell visual states map to `<HabitTile>` from `01-design-system`: `done` / `today` / `missed` / `locked`.

### STORY-005: As an athlete, I want to log a body measurement from Home's Quick Log strip

**Acceptance Criteria:**

- 5.1 [ ] Tap "Weigh in" opens a `<BottomSheet>` titled "Weigh in" / eyebrow "QUICK LOG" / accent primary.
- 5.2 [ ] Fields: weight numeric input (kg/lb toggle), optional body-fat numeric input, date picker (default today, max yesterday), notes textarea, Save CTA.
- 5.3 [ ] Save fires `POST /measurements` (existing). Triggers `measurement_streak` evaluation server-side.
- 5.4 [ ] Offline: queue + optimistic cache update.
- 5.5 [ ] On success, sheet closes; body-trend sparkline reflects new value on next You/Progress open.

### STORY-006: As an athlete, my workout streak advances when I complete a session

**Acceptance Criteria:**

- 6.1 [ ] `PUT /sessions/:id { endedAt }` (per `05-active-session`) triggers backend `evaluateStreaks(userId, 'workout_logged', ts)` per cross-cuts § 3.4.
- 6.2 [ ] Engine advances `current_count` + `last_period_end` on period rollover (Sunday user-local). `longest_count` updated on exceed.
- 6.3 [ ] Milestone threshold hit → insert `user_achievements` row + emit `streak_milestone` notification per cross-cuts § 5.
- 6.4 [ ] Achievement icon mapping in `design.md`.
- 6.5 [ ] Nightly cron at 02:00 UTC: missed periods spend freeze tokens or break streak.

### STORY-007: As an athlete, my habit streaks advance per completion

**Acceptance Criteria:**

- 7.1 [ ] `POST /habit-completions` triggers `evaluateStreaks(userId, 'habit_completed', ts)`.
- 7.2 [ ] Daily period rollover at user-local midnight.
- 7.3 [ ] Idempotent: unique `(user_id, goal_id, date_trunc('day', completed_at))` per cross-cuts § 3.3.
- 7.4 [ ] Achievement triggers + notification per STORY-006 pattern.

### STORY-008: As an athlete, my measurement streak advances per weigh-in

**Acceptance Criteria:**

- 8.1 [ ] `POST /measurements` triggers `evaluateStreaks(userId, 'measurement_logged', ts)`.
- 8.2 [ ] Weekly period rollover. Threshold: ≥ 1 measurement per period.
- 8.3 [ ] Achievement triggers + notification per pattern.

### STORY-009: As an athlete, my recent PRs show on Home carousel + You/Progress history

**Acceptance Criteria:**

- 9.1 [ ] PR detection runs server-side on session completion, exact-rep-match per `feedback_pr_detection_legacy_parity.md`.
- 9.2 [ ] PRs persist to `personal_records` with `(user_id, exercise_id, rep_target, weight, achieved_at)`.
- 9.3 [ ] `GET /users/me/prs?limit=5&order=achieved_at desc` for Home carousel.
- 9.4 [ ] `GET /users/me/prs?limit=20&order=achieved_at desc` for You/Progress history.
- 9.5 [ ] Rendered via `<PRCard>` from `01-design-system`.

### STORY-010: As a developer, I want a clear audit of which M4 endpoints already exist vs need to be added

**Acceptance Criteria:**

- 10.1 [ ] Endpoint audit in `design.md § Backend audit` — splits existing-from-PR-#77 vs net-new.
- 10.2 [ ] Where shape needs extending, additive only (no breaking changes).
- 10.3 [ ] New endpoints land via additive Drizzle migrations per cross-cuts § 6.

### STORY-011: As an offline athlete, Home + You render from cache; mutations queue

**Acceptance Criteria:**

- 11.1 [ ] All Home + You reads via cached repository.
- 11.2 [ ] Habit toggles + measurements queue + write optimistically to SQLite.
- 11.3 [ ] Streak counts computed client-side until engine reconciles; server-wins on conflict.
- 11.4 [ ] PR carousel + history read from cached `personal_records`.

---

## Out of scope

- **Coach Home / Coach You variants** — owned by `10-trainer-features`. This spec gates `<CoachQuickPeek>`; coach Home content lives in 10.
- **M9 Fuel ring data** — owned by `13-nutrition-tracking`. Fuel ring placeholder until M9 ships.
- **Trainer-assigned goals UI attribution** — owned by `10-trainer-features`. This spec defines goal model + read pattern.
- **Notification rendering / inbox** — owned by `09-notifications-social`. This spec emits events per cross-cuts § 5.
- **Light theme.**

---

## Dependencies and what this spec unlocks

**Depends on:**

| Spec                    | What's consumed                                                                                                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-design-system`      | `<MultiRing>`, `<Ring>`, `<Bar>`, `<Card>`, `<Btn>`, `<Pill>`, `<IconBtn>`, `<Avatar>`, `<HeaderBar>`, `<BottomSheet>`, `<Stat>`, `<MicroPill>`, `<RingLegend>`, `<PRCard>`, `<HabitTile>`, `<WorkoutCarouselCard>`, `<Section>`, tokens, mono font, Lucide icons |
| `14-navigation`         | `useUserMode` (CoachQuickPeek gating), Avatar trigger for ProfileDrawer, Home + You tab slots                                                                                                                                                                     |
| `_shared/cross-cuts.md` | § 2 (trainer-assigned goals), § 3 (streak engine + habits + freeze tokens + achievements), § 5 (notifications)                                                                                                                                                    |

**Unlocks:**

| Downstream spec         | What it can do once 06 lands                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `05-active-session`     | Session completion auto-triggers streak + PR detection                                        |
| `08-profile-settings`   | Drawer "Achievements" count reads from `user_achievements`                                    |
| `10-trainer-features`   | Coach client-detail screen reuses `<StreakHero>` + `<BodyTrend>` + `<VolumeStats>` composites |
| `13-nutrition-tracking` | Nutrition streak plugs into engine; Fuel ring on Home gets real data                          |

---

## Open questions

None. All 11 decisions locked.

---

_End of `06-progress-goals/requirements.md` · 2026-05-27 (rewritten from scratch)_
