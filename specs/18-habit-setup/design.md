# 18 — Habit Setup: Design

> Architecture for habit creation/configuration, the **collection** streak model, coach-authored habits, and **two-way HealthKit sync with the DB as source of truth**. Reconciled 2026-06-23 to the landed hi-fi prototype (`~/Downloads/habit_design/`).
>
> Extends the locked streak model — read alongside `specs/_shared/cross-cuts.md § 3` **and** its "Revised 2026-06-23" block. Health-layer extensions are owned by `07-health-integration` and cited here.

---

## 1. Domain model

A **habit** is an existing `user_goals` row whose `goal_type` is one of the five seeded habit categories, plus a `habit_configs` row carrying its target, days/week, and (calories) leniency. There is **one collection streak** for the user — a single `user_streaks` row (`streak_type='habit_streak'`, `source_goal_id = NULL`, `period='weekly'`) that counts every enabled habit together. Per-habit streak rows are **not** created.

```
goal_types (existing lookup)        ← seed 5: water/gym/steps/sleep/calories (category='habit')
   ▲ goal_type_id
user_goals (existing)               ← one per enabled category. assigned_by_user_id = coach (or NULL = self)
   ▲ goal_id (1:1)
habit_configs (NEW)                 ← target_value, unit, period, completion_rule, days_per_week, tolerance_pct
                                       (no cheat-days column — days/week IS the slack)

user_streaks (existing, REUSED)     ← ONE collection row (source_goal_id NULL, habit_streak, weekly); no new column
habit_completions (existing)        ← value = litres / steps / hours; the HealthKit↔DB bridge target
body_measurements (existing)        ← Weight (two-way HK); nutrition_entries (M9) ← Calories
streak_holidays (NEW)               ← all-habits planned pause, MANAGED FROM HOME
```

### 1.1 Category map

| Category | `goal_types.name` | period | `completion_rule`  | days/week (default) | Target bounds (default)                                      | Tone / icon          | Streak source                  |
| -------- | ----------------- | ------ | ------------------ | ------------------- | ------------------------------------------------------------ | -------------------- | ------------------------------ |
| Water    | `water`           | daily  | `value_gte`        | 1–7 (5)             | 0.1–20 l, step 0.1 (2)                                       | primary / droplet    | `habit_completions.value` (HK) |
| Gym      | `gym`             | weekly | `count`            | — (n/a)             | 1–14 ×/wk, step 1 (3)                                        | ember / dumbbell     | logged `workout_sessions`      |
| Steps    | `steps`           | daily  | `value_gte`        | 1–7 (6)             | 1000–30000, step 500 (8000)                                  | trainer / footprints | `habit_completions.value` (HK) |
| Sleep    | `sleep`           | daily  | `value_gte`        | 1–7 (6)             | 1–24 h, step 0.5 (8)                                         | success / moon       | `habit_completions.value` (HK) |
| Calories | `calories`        | daily  | `within_tolerance` | 1–7 (6)             | read-only from Nutrition (2000) + leniency 0–50% step 5 (10) | gold / flame         | `nutrition_entries` (M9)       |

Tones map to the existing `HabitTileTone` union + the prototype's `theme.css`. Gym's "completion" is a logged `workout_session`, not a `habit_completions` row — `habit_configs` stores its weekly sessions target so the engine/grid know the bar.

---

## 2. Schema deltas

Owner migration `supabase/migrations/20260623120000_habit_setup_schema.sql` (idempotent, forward/back safe); mirrored in `packages/db/src/schema.ts`. _(Migrations live under `supabase/migrations/` — the DB is Supabase.)_

### 2.1 New enums

```sql
CREATE TYPE habit_category_enum AS ENUM ('water','gym','steps','sleep','calories');
CREATE TYPE habit_completion_rule_enum AS ENUM ('count','value_gte','within_tolerance');
```

### 2.2 `habit_configs`

```sql
CREATE TABLE habit_configs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  goal_id          uuid NOT NULL REFERENCES user_goals(id) ON DELETE CASCADE,
  category         habit_category_enum NOT NULL,
  target_value     numeric NOT NULL,
  unit             text NOT NULL,                  -- 'l' | 'x' | 'steps' | 'h' | 'kcal'
  period           text NOT NULL,                  -- 'daily' | 'weekly'
  completion_rule  habit_completion_rule_enum NOT NULL,
  days_per_week    integer,                         -- 1..7 for daily habits; NULL for Gym (weekly)
  tolerance_pct    numeric,                         -- calories leniency; NULL otherwise
  effective_from   date NOT NULL,                   -- first week-start (Mon) this habit counts toward the streak
  pending_config   jsonb,                           -- a queued edit (target/days_per_week/tolerance/enabled)
  pending_from     date,                            -- the Monday a queued edit promotes; NULL = no pending change
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT habit_configs_goal_uq     UNIQUE (goal_id),
  CONSTRAINT habit_configs_user_cat_uq UNIQUE (user_id, category),
  CONSTRAINT habit_configs_period_chk  CHECK (period IN ('daily','weekly')),
  CONSTRAINT habit_configs_dpw_chk     CHECK (days_per_week IS NULL OR days_per_week BETWEEN 1 AND 7),
  CONSTRAINT habit_configs_target_chk  CHECK (target_value > 0)
);
CREATE INDEX habit_configs_user_idx ON habit_configs (user_id);
```

> No `cheat_days` column. The prototype expresses slack as `days_per_week` (hit 5/7 ⇒ 2 misses allowed) — a positive target, not a negative budget. Coach authorship reuses `user_goals.assigned_by_user_id` (cross-cuts § 2) — no new column.

### 2.3 `streak_holidays` (managed from Home)

```sql
CREATE TABLE streak_holidays (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  goal_id     uuid REFERENCES user_goals(id) ON DELETE CASCADE, -- NULL = all habits (the prototype default)
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT streak_holidays_range_chk CHECK (end_date >= start_date)
);
CREATE INDEX streak_holidays_user_idx ON streak_holidays (user_id, start_date);
```

> The 24 h-advance rule (`start_date >= today + 1 day`, user-local) is handler-enforced, not a SQL CHECK (`today` is tz-relative). The CHECK only guards range ordering. The setup screen does not write this table — **Home** does (locked decision 11); the endpoints live here for cohesion.

### 2.4 `user_streaks` — reused as-is (no new column)

The **collection** habit streak is a single existing-shape row: `(user_id, streak_type='habit_streak', source_goal_id=NULL, period='weekly')`. **No schema change.** Because the streak is _weekly_, the M4 engine's existing "1 freeze token per missed period" already implements "a token = a week off" — a `freeze_until` window would be redundant. A proactive "skip this week" is a manual token spend that advances `last_period_end` over the current week without incrementing the count (§ 4.2). Enabling the first habit must **create** this row (nothing seeds `user_streaks` today).

### 2.5 Seed `goal_types`

```sql
INSERT INTO goal_types (name, description, category, icon_name) VALUES
  ('water',    'Daily hydration habit', 'habit', 'droplet'),
  ('gym',      'Weekly training habit', 'habit', 'dumbbell'),
  ('steps',    'Daily steps habit',     'habit', 'footprints'),
  ('sleep',    'Nightly sleep habit',   'habit', 'moon'),
  ('calories', 'Daily calorie habit',   'habit', 'flame')
ON CONFLICT (name) DO UPDATE SET category = EXCLUDED.category, icon_name = EXCLUDED.icon_name;
```

---

## 3. Backend contract

Auth via Supabase JWT → `requireAuth` → `getUser(ctx)`; owner-scoped by `userId`. New handlers under `microservices/core/src/application/habits/`.

### 3.1 Self routes

| Method            | Route                               | Purpose                                                                                                                                                                                                                       |
| ----------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`             | `/users/me/habits/config`           | All five categories with `{ category, enabled, goalId?, assignedByCoach: bool, locked: bool, config? }`.                                                                                                                      |
| `PUT`             | `/users/me/habits/:category/config` | Enable + configure (upsert). Body `{ targetValue, daysPerWeek?, tolerancePct? }`. **403 if the habit is coach-locked** (assigned + active relationship).                                                                      |
| `DELETE`          | `/users/me/habits/:category`        | Disable (soft, `is_active=false`). 403 if coach-locked.                                                                                                                                                                       |
| `POST`            | `/users/me/streaks/:id/use-token`   | Manual freeze spend (extends 06 STORY-008). Retroactive: covers missed weeks (existing `spendTokenManually`). Proactive "skip this week": spend 1 token, advance `last_period_end` over the current week, no count increment. |
| `GET/POST/DELETE` | `/users/me/habits/holidays`         | List / declare (≥24 h-advance 422) / end-early (truncate active → today) or cancel (not-yet-started) / 409 if past. **Called from Home**, not setup.                                                                          |

`PUT` transaction: resolve `goal_type_id` from `:category` → upsert `user_goals` (reactivate if soft-deleted) → upsert `habit_configs` (server sets `period` + `completion_rule` from § 1.1; client can't pick) → ensure the single collection `user_streaks` row exists → validate bounds (422). **Edit timing per § 4.5:** a first-time enable writes the live config with `effective_from = next Monday`; an edit to an already-effective habit (incl. disable) writes `pending_config` + `pending_from = next Monday` and leaves the live row untouched so the in-progress week keeps its bar. The response echoes both the live + pending config so the UI can show the new value with a "Starts Monday" tag. Closed weeks are never re-scored (§ 6).

### 3.2 Trainer routes (coach authorship — cross-cuts § 1.2 doubling)

| Method   | Route                                                    | Purpose                                                                                                                        |
| -------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET`    | `/trainers/me/clients/:clientId/habits/config`           | Coach reads the client's habit config + completion values **from the DB** (STORY-006 AC 6.5).                                  |
| `PUT`    | `/trainers/me/clients/:clientId/habits/:category/config` | Coach sets/edits — stamps `user_goals.assigned_by_user_id = trainerId`, writes a `goal_assigned` audit row (cross-cuts § 1.4). |
| `DELETE` | `/trainers/me/clients/:clientId/habits/:category`        | Coach disables a habit it assigned.                                                                                            |
| `GET`    | `/trainers/me/clients/:clientId/habit-completions`       | Completion history for the client (trainer dashboard).                                                                         |

Every trainer route runs `assertTrainerCanActForClient(trainerId, clientId)` first (cross-cuts § 1.3 — role check then active-relationship check). A coach may edit/disable only habits where `assigned_by_user_id = self`.

### 3.3 Completion endpoints (extend existing)

`POST` / `DELETE /habit-completions` (`createHabitCompletionHandler.ts`): accept `value` (required for `value_gte`/`within_tolerance`; range-validated per category); derive `local_completed_date` server-side (keep #117 grain); reject future-day + outside-current-week; idempotent on `(user_id, goal_id, local_completed_date)`; fire `evaluateStreaks(userId, 'habit_completed', ts)`. These are also where the **device's HealthKit bridge** writes imported HK values (§ 7).

---

## 4. Streak engine — collection model

Touches `application/streaks/engine.ts` + `evaluate.ts` + `period.ts` + `cron.ts`. Amends cross-cuts § 3 (see § 3.7 "Revised 2026-06-23").

### 4.1 Per-habit weekly satisfaction

For a given Mon–Sun week and an enabled habit, `weekMet(habit, week)`:

- `value_gte` daily (Water/Steps/Sleep): count days in the week whose summed `value >= target_value`; met when that count `>= days_per_week`.
- `within_tolerance` daily (Calories): same, where a day qualifies when its kcal total is within `target ± tolerance_pct%`. **M9-gated — treated as met (ignored) until Nutrition ships** so it can't block the collection streak prematurely.
- `count` weekly (Gym): met when qualifying `workout_sessions` in the week `>= target_value`.

### 4.2 Collection streak + forgiveness

The collection week is **satisfied when every enabled habit's `weekMet` is true** (STORY-003 AC 3.2 — flagged tunable: a softer "≥ N of M habits" rule is a one-line change if Brad wants it later). On the weekly evaluation (nightly cron rollover + on-write), in order:

1. **Holiday pause** — the week intersects an active `streak_holidays` range → `status='paused'`, neutral (no count change, no token spend).
2. **Satisfied** — every enabled habit met → advance `current_count`, update `longest_count`, maybe earn a token (1 per 4 successive weeks, cap 4), fire `streak_milestone` at thresholds.
3. **Missed week(s) → freeze token** — not satisfied: the existing M4 engine spends **1 token per missed week** (a weekly streak makes "1 token = 1 week off"). Emit `streak_at_risk` + `freeze_token_applied`, keep `active`, advance `last_period_end` over the covered week(s).
4. **Break** — not enough tokens → `status='broken'`, `current_count=0` (then the next satisfied week restarts it at 1 per the M4 revive path).

This is the M4 cron/engine behaviour **unchanged** — the only new piece for habits is `weekMet`/collection satisfaction in `isPeriodSatisfied` (§ 4.1). A proactive "skip this week" (the prototype's freeze CTA) is the manual spend in § 3.1 (advance `last_period_end` over the current week, −1 token, no count change).

> `streak_at_risk` is also emitted mid-week (the prototype's at-risk banner): when the remaining days can no longer satisfy every habit's days/week target and no token is queued.

### 4.3 Pending-config promotion

The nightly cron's weekly rollover **promotes pending config edits**: for every `habit_configs` row with `pending_from <= today`, copy `pending_config` into the live columns (and `user_goals.is_active` for an enable/disable), then clear `pending_config`/`pending_from`. This is the single point where deferred edits become effective. Holiday resume is the existing M4 path (a `paused` streak returns to `active` once the range passes).

### 4.4 Config-edit timing (anti-gaming — locked decision 12)

The in-progress week is **scored against the config that was effective at its Monday start** — never the live value mid-week. Mechanism:

- The engine, scoring week W for a habit, uses the live `habit_configs` row **only if `effective_from <= weekStart(W)`**; a habit whose `effective_from` is in the future (a fresh enable) is **not yet part of the collection requirement** (it's loggable, just not scored).
- Edits to an already-effective habit are queued (`pending_config`/`pending_from = next Monday`, § 3.1) and promoted by the § 4.3 rollover — so lowering a target, cutting days/week, or disabling **cannot change the current week's bar**.
- This closes the three edit-gaming vectors together: **rescue** (can't lower this week's target), **ratchet** (lower-then-raise both land on Mondays, the failed week still fails), and **disable-to-dodge** (a habit you disable mid-week stays in this week's collection requirement until Monday). Symmetric: raises defer too, for one predictable rule.

### 4.5 Notifications

No new enum values. Emits existing cross-cuts § 5 events: `streak_at_risk` (slack exhausted), `freeze_token_applied` (window opened), `streak_milestone` (threshold). Holiday/freeze pause/resume and pending-config promotion are silent.

---

## 5. Coach authorship + relationship end

- **Edit-lock predicate:** a habit is locked to the client when `assigned_by_user_id IS NOT NULL` **and** an active `pt_client_relationships` row exists between the client and that assigner. Self-routes (§ 3.1) compute this and 403 on a locked habit; the `GET /config` returns `locked` + `assignedByCoach` so the UI can render attribution + disable controls.
- **Relationship end (locked decision 6):** because the lock is **computed from relationship status**, ending the relationship needs **no data migration** — the predicate flips to false, the habit stays active, the client can now edit it, and `assigned_by_user_id` is retained as history ("was set by Coach X"). The coach simultaneously loses access (fails `assertTrainerCanActForClient`). The collection streak is untouched. `10-trainer-features` owns the relationship-deactivation flow; this spec only relies on the predicate.
- **Audit + attribution:** every coach write logs `goal_assigned` (cross-cuts § 1.4) and renders "Set by Coach X" (§ 1.5 / § 2.2).

---

## 6. Anti-gaming (consolidated)

| Safeguard                                                                                                             | Where                                                              | AC       |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------- |
| No future-day / prior-week completion                                                                                 | completion handler (server-local day)                              | 8.1      |
| Config edits effective next Monday; current week scored at week-start config (closes rescue/ratchet/disable-to-dodge) | pending-config promoted by cron (§ 4.3/4.4); `effective_from` gate | 8.2      |
| Holidays ≥ 24 h ahead; end-early truncates (never erases)                                                             | `POST`/`DELETE /holidays`                                          | 8.3      |
| Counts/tokens advance only via engine                                                                                 | no client-writable count; snapshot-pinned conditional writes (M4)  | 8.4      |
| `value` range-validated per category                                                                                  | completion handler                                                 | 8.5      |
| Device de-dupes its own HK writes (echo)                                                                              | health bridge source-tagging                                       | 8.5, § 7 |
| One completion per user/goal/local-day                                                                                | existing `habit_completions_user_goal_local_day_uq`                | —        |

---

## 7. Two-way HealthKit sync — DB is the source of truth

**Principle (locked decision 7):** the **DB is canonical**. HealthKit is device-local, so a value that only lives in HK is invisible to trainers and to the streak engine. The **device acts as a two-way bridge** between HealthKit and the DB; the backend never talks to HealthKit.

### 7.1 Data flow

```
 Apple Watch / Health app / 3rd-party  ─┐
                                         ├─► HealthKit (device) ◄──► [device bridge] ──► our DB (canonical) ──► UI · streak engine · TRAINERS
 in-app log (e.g. "+250 ml water")  ─────┘         (mirror)              (offline queue)
```

- **In-app log** (Water): write the value to the DB via the completion endpoint (offline queue) **and** mirror a sample to HealthKit (so Apple Health is consistent).
- **HK → DB**: on app foreground / habit-screen open / background delivery, the device reads HK aggregates (water today, last night's sleep, today's steps, latest weight) and pushes **externally-sourced** values to the DB.
- **DB → everything**: UI, the streak engine, and **trainers** (via § 3.2 GET routes) all read the DB. Trainers never touch the client's HK.

### 7.2 Echo / no double-count (STORY-005 AC 5.3)

Every sample the app writes to HK is **source-tagged** (HK exposes the writing source/bundle id + a sample UUID; we record UUIDs of our writes locally). When reading HK back, the bridge **excludes the app's own samples** and pushes only genuinely-external ones to the DB. The DB value for a day = in-app logs + external HK samples, never the app's write counted twice.

### 7.3 Direction per metric (locked decision 8)

| Metric   | HK identifier              | Direction                                          | DB home                   |
| -------- | -------------------------- | -------------------------------------------------- | ------------------------- |
| Water    | `DietaryWater`             | read **+ write**                                   | `habit_completions.value` |
| Sleep    | `SleepAnalysis` (category) | **read only** (Watch/trackers write it)            | `habit_completions.value` |
| Steps    | `StepCount`                | **read only** (device-tracked; already read in 07) | `habit_completions.value` |
| Weight   | `BodyMass`                 | read **+ write** (reuses M6 `writeBodyWeight`)     | `body_measurements`       |
| Calories | `DietaryEnergyConsumed`    | read **+ write**, **owned by Nutrition / M9**      | `nutrition_entries`       |

### 7.4 Port + adapter (owned by `07-health-integration`)

`HealthPort` grows: `getDietaryWaterToday()`, `writeDietaryWater(litres, date)`, `getSleepLastNight()` (hours), `getStepsToday()` (exists). The `ExpoHealthKitAdapter` adds `DietaryWater` (r/w) + `SleepAnalysis` (r) to the read/write permission scopes; requested through the existing 07 permission flow. Android Health Connect = later platform pass (stub today). 07's `design.md` absorbs these as a "Revised" note; 18 cites it.

### 7.5 Offline

HealthKit is on-device, so reads/writes succeed offline. The resulting `habit_completions`/`body_measurements` row still flows through the existing sync queue; server wins on reconcile.

---

## 8. Offline behaviour

Per `_agent.md` § Offline-First; server wins.

- **Cache:** `cached_habit_configs (user_id, category, goal_id, target_value, unit, period, completion_rule, days_per_week, tolerance_pct, effective_from, pending_config, pending_from, enabled, assigned_by_coach, locked)`. `StoragePort` grows `getHabitConfigs`/`upsertHabitConfig`/`removeHabitConfig`.
- **Commands** (mirror `toggle-habit.command.ts` — optimistic + enqueue + `invalidateHome`): `configureHabitCommand`, `disableHabitCommand`. An edit writes the **pending** config locally (so the UI shows the new value + "Starts Monday") without changing the value the offline streak scores this week; freeze spend reuses 06's `useFreezeToken`. Holiday commands live on Home.
- A habit configured offline writes a `local-` goal id; the drain swaps it and the grid de-dupes on `category` (AC 9.3).
- **`deriveStreak` rework:** computes the **collection** weekly streak from cached completions + configs (+ holidays). Per-habit `weekMet` then "all enabled habits met" per week, walking back from the current week; **scores each week against the config effective at that week's start** (`effective_from` + any promoted `pending_config`), honours holiday neutrality; preserves `localCompletedDate` precedence (#117). Signature becomes `deriveCollectionStreak(habits[], completionsByGoal, today, { holidays })`. Best-effort mirror; server reconciles.

---

## 9. FE structure (UNBLOCKED — prototype landed)

Recreate `~/Downloads/habit_design/habit-setup.jsx` in RN/Tamagui per `_agent.md` container/presenter split. Pixel targets + tokens: the prototype `README.md` + `theme.css`.

- **Screen / container:** `HabitSetupContainer` wires `useGetHabitConfig()`, `useConfigureHabit()`, `useDisableHabit()`, `useSpendFreezeToken()` (06), and `onAdjustNutrition` → navigate to the Fuel-Targets editor (`fuel-targets.jsx`, M9). Renders `HabitSetupPresenter`.
- **Presenters (pure):**
  - `HabitSetupPresenter` — header + `StreakSection` + five `HabitCard`s (order water, gym, steps, sleep, calories) + footer note → Home for holidays.
  - `StreakSectionPresenter` — collection streak hero + 4 freeze-token slots + at-risk banner + freeze CTA (`onSpendFreeze`). At-risk gradient/border per README.
  - `HabitCardPresenter` — `Switch`, target `Stepper` (or gold deep-link button for Calories), `WeekFreq` row (daily habits), leniency `Stepper` (calories). **Coach-locked state**: when `locked`, disable the controls + show "Set by Coach X". Disabled (off) collapses to the header.
  - Primitives `Switch`, `Stepper`, `WeekFreq`, `Row` — map to design-system equivalents (Card, Btn, Pill, IconBtn) where they exist; otherwise port from `ui.jsx`. New icons: `IconMoon`, `IconSteps`, `IconFootprints`.
- **Coach view:** the same screen rendered for a `:clientId` in coach mode wires the § 3.2 trainer routes; controls write on the client's behalf and show attribution.
- **Navigation:** Home empty-state CTA + "Manage habits" affordance (STORY-007).

---

## 10. Test plan

**Backend (Vitest, ≥90% on touched files):** per-habit `weekMet` for each rule incl. days/week thresholds; collection "all enabled met"; forgiveness (holiday → satisfied/earn → missed-week token spend → break) reusing the M4 engine; proactive skip-week manual spend; coach edit-lock (locked rejects self-edit; unlocks when relationship inactive); trainer-route auth (role + active `pt_client_relationships`); completion value-required/range/future-day/prior-week; pending-config promotion at rollover; migration forward/back + idempotent seed. Render real SQL via `PgDialect` for built queries (mocked-DB blind spot, `reference_drizzle_groupby_param_bug`).

**Health (07, Jest):** Water r/w + Sleep r adapter methods; echo de-dup (app-written samples excluded on read); permission-scope extension; offline read/write.

**Mobile (Jest, ≥90% global):** `deriveCollectionStreak` (rules, days/week, holiday + freeze neutrality, `localCompletedDate` precedence); commands (optimistic + enqueue + `local-` reconcile + `invalidateHome`); hooks cache-first; presenters incl. coach-locked + at-risk + Calories deep-link states.

---

_End of `18-habit-setup/design.md` · reconciled 2026-06-23_
