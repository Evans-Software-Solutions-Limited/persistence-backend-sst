# 18 — Habit Setup: Requirements

> **Net-new feature** (not a port). Authored 2026-06-21; **reconciled 2026-06-23** to the landed hi-fi prototype (`~/Downloads/habit_design/`) + Brad's coach-ownership and HealthKit-sync decisions. This spec fills the gap left by `06-progress-goals`: M4 shipped the habit-completion grid, streak engine, and offline cache, but **there is no way to create or configure a habit**. The Home empty state ("Get started by setting your habits", `packages/mobile/src/ui/presenters/HabitsGridPresenter.tsx:84`) links into a flow that does not exist — its own code comment names this spec as the follow-up.

---

## Overview

Habit Setup is one scrollable screen where an athlete enables/disables and tunes their habits, sees a **single collection streak** across all of them, and spends a **freeze token** to skip a week. Five **fixed** categories ship in v1 (no custom habits):

| Category     | Tone               | Icon       | User sets                                                                 | Unit    | Streak primitive                 |
| ------------ | ------------------ | ---------- | ------------------------------------------------------------------------- | ------- | -------------------------------- |
| **Water**    | `primary` (cyan)   | droplet    | litres/day **+ days/week to hit**                                         | `l`     | `habit` (daily value, HealthKit) |
| **Gym**      | `ember` (orange)   | dumbbell   | sessions/week (the weekly count _is_ the target)                          | `×`     | `workout` (logged sessions)      |
| **Steps**    | `trainer` (violet) | footprints | steps/day **+ days/week to hit**                                          | `steps` | `habit` (daily value, HealthKit) |
| **Sleep**    | `success` (green)  | moon       | hours/night **+ nights/week to hit**                                      | `h`     | `habit` (daily value, HealthKit) |
| **Calories** | `gold`             | flame      | **read-only** kcal goal (owned by Nutrition) **+ days/week + leniency %** | `kcal`  | `nutrition` (M9-gated)           |

The streak is a property of the **whole collection**, not any single habit ("All habits together"). Forgiveness has three layers, none of them a per-habit "cheat day":

1. **Per-habit days/week** — a daily habit's week is met when its daily target is hit on **≥ its days/week target** (e.g. Water 5/7). This is the built-in slack that replaces an explicit cheat-day budget.
2. **Freeze token** — _earned_ automatically (1 per 4 successive completed weeks, cap 4). Spending one **skips the whole week** for every habit (7-day freeze). Auto-applied to save an at-risk streak, or spent manually from this screen.
3. **Holiday / skip week** — a free, user-scheduled pause that lives on **Home** (not this screen), applies to **all** habits, declared **≥ 24 h in advance**, and can be ended early.

**Who can set habits:** the athlete, **and their coach** if an active relationship exists. Coach-set habits are **complete-only** for the client (the client logs them but can't retune/disable them) — reusing the locked trainer-assigned-goal pattern (cross-cuts § 2). The lock is conditioned on an **active** relationship, so when the relationship ends the habits **transfer to the client** (stay active, streak unbroken, attribution kept as history).

**HealthKit is two-way, but the DB is the source of truth.** Water, Sleep, Steps, Weight (and Calories at M9) sync between Apple Health and our backend via the device acting as a bridge; the canonical value lives in our DB so **trainers can read it** from their dashboard. See `design.md § 7`.

This spec **extends** the locked streak model. The amendment is appended to `specs/_shared/cross-cuts.md § 3` as a "Revised 2026-06-23" block; downstream code cites the revised section.

### Authoritative references

1. **Prototype (hi-fi, source of truth):** `~/Downloads/habit_design/` — `habit-setup.jsx` (screen + `HabitSetupScreen`, `HabitCard`, `StreakSection`, `Switch`, `Stepper`, `WeekFreq`, `Row`, `HABIT_CATS`, `HABIT_ORDER`), `README.md` (the handoff), `theme.css`, `ui.jsx`, `icons.jsx`, `fuel-targets.jsx` (the calorie-goal editor the Calories card deep-links to).
2. `specs/_shared/cross-cuts.md` § 1 (trainer on-behalf + scoped routes), § 2 (trainer-assigned goals), § 3 (streak engine) — **and** the "Revised 2026-06-23" block this spec adds.
3. `specs/06-progress-goals/` — habit grid, streak engine, offline cache, `deriveStreak` (the consumers).
4. `specs/07-health-integration/` — the `HealthPort` + adapters this spec extends for two-way Water/Sleep/Calories sync (Weight write already specced there, lands M6).
5. `packages/db/src/schema.ts` — `goal_types`, `user_goals`, `user_streaks`, `habit_completions`, `body_measurements`, `pt_client_relationships`.
6. `microservices/core/src/application/streaks/` + `application/habits/` + `application/relationships/` — engine, habit handlers, the `assertTrainerCanActForClient` helper.
7. `packages/mobile/src/domain/services/streak.service.ts` (`deriveStreak`), `application/commands/toggle-habit.command.ts`, `ui/hooks/useGetHabits.ts`, `ui/presenters/HabitsGridPresenter.tsx`, `adapters/health/*` — the offline + health consumers.

---

## Locked decisions

| #   | Decision             | Locked value                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Placement            | New `18-habit-setup` sibling spec; appends to cross-cuts § 3 rather than re-defining the engine. (Brad, 2026-06-21)                                                                                                                                                                                                                                                                                                                      |
| 2   | Categories           | Fixed **5**: Water, Gym, Steps, Sleep, Calories. No custom habits. (Prototype, 2026-06-23)                                                                                                                                                                                                                                                                                                                                               |
| 3   | Streak grain         | **One collection streak**, weekly, across all enabled habits. Shared freeze tokens. Not per-habit. (Prototype, 2026-06-23)                                                                                                                                                                                                                                                                                                               |
| 4   | Forgiveness          | Per-habit **days/week** target (replaces explicit cheat days) → freeze token (= skip a whole week) → break. Holiday pause sits above all (scheduled on Home, ≥ 24 h ahead, end-early allowed). (Prototype + Brad, 2026-06-23)                                                                                                                                                                                                            |
| 5   | Coach habits         | Coach can set a client's habits (active relationship); coach-set = **complete-only** for the client (cross-cuts § 2). Both self- and coach-set ship in v1. (Brad, 2026-06-23)                                                                                                                                                                                                                                                            |
| 6   | Relationship end     | Coach-set habits **transfer to the client** — stay active, streak unbroken, attribution kept as history; edit-lock lifts because it's conditioned on an _active_ relationship. (Brad, 2026-06-23)                                                                                                                                                                                                                                        |
| 7   | Sync source of truth | **DB is canonical.** HealthKit ↔ DB two-way sync runs on the device as a bridge; trainers read values from the DB. (Brad, 2026-06-23)                                                                                                                                                                                                                                                                                                    |
| 8   | Sync direction       | Water = read+write, Sleep = read-only from HK, Weight = read+write (reuses M6), Steps = read from HK, Calories = via Nutrition/M9. App writes are tagged to avoid echo. (Brad, 2026-06-23)                                                                                                                                                                                                                                               |
| 9   | Calories             | Target is **read-only** here (owned by Nutrition Fuel-Targets, M9). Card deep-links to the editor; shows freq + leniency. Streak evaluation lights up with M9. (Prototype, 2026-06-23)                                                                                                                                                                                                                                                   |
| 10  | Local-day grain      | Keep the `local_completed_date` authoritative grain from #117 verbatim.                                                                                                                                                                                                                                                                                                                                                                  |
| 11  | Holiday UI           | Lives on **Home** (applies to all habits), not on this screen. This screen's footer points there. (Prototype, 2026-06-23)                                                                                                                                                                                                                                                                                                                |
| 12  | Config-edit timing   | **Symmetric — all structural edits (raise/lower target, change days/week, enable, disable) take effect at the next week boundary (Mon, user-local).** The in-progress week is always scored against its start-of-week config. New values are saved + shown immediately; a newly-enabled habit is loggable now but counts toward the streak from the next Monday. Closes mid-week rescue / ratchet / disable-to-dodge. (Brad, 2026-06-23) |

---

## User stories

### STORY-001: As an athlete, I want a habit-setup screen where I tune all five habits and see my collection streak

**Acceptance Criteria:**

- 1.1 [ ] Reached from the Home habits-grid empty-state CTA and a persistent "Manage habits" affordance (STORY-007).
- 1.2 [ ] Renders, top→bottom, per `~/Downloads/habit_design/README.md § Layout`: header (back + `HABIT SETUP` eyebrow + "Your habits" title + intro), a `StreakSection` (collection streak + freeze tokens), five `HabitCard`s in order **water, gym, steps, sleep, calories**, and a footer note pointing to Home for holidays.
- 1.3 [ ] Each `HabitCard` has a `Switch` to enable/disable; disabled cards collapse to the header row (dimmed, neutral icon, no controls).
- 1.4 [ ] Reads cache-first and renders offline with last-synced config + streak (`design.md § 6`).

### STORY-002: As an athlete, I want to set each habit's target and days/week so it appears on my Home grid

**Acceptance Criteria:**

- 2.1 [ ] Enabling a category creates (or reactivates) the backing `user_goals` + `habit_configs` row.
- 2.2 [ ] Target stepper bounds/defaults (prototype `README § Bounds & Defaults`): Water 0.1–20 step 0.1 (2 l); Gym 1–14 step 1 (3 ×/wk); Steps 1000–30000 step 500 (8000); Sleep 1–24 step 0.5 (8 h); Calories read-only from Nutrition (default 2000).
- 2.3 [ ] Daily habits (Water/Steps/Sleep/Calories) expose a `WeekFreq` "days/week to hit it" control, 1–7 (defaults: Water 5, Steps 6, Sleep 6, Calories 6). Gym has **no** frequency row — sessions/week is its target.
- 2.4 [ ] Calories: target is **read-only**; the card deep-links to the Nutrition Fuel-Targets editor (`fuel-targets.jsx`). It also shows a leniency stepper (0–50%, step 5, default 10).
- 2.5 [ ] Saving writes optimistically to cache + enqueues a sync mutation; the habit appears on the Home grid with its category label + tone.
- 2.6 [ ] A category is enabled at most once per user (`unique(user_id, category)`); editing updates in place (idempotent upsert).
- 2.7 [ ] **Edits take effect at the next week boundary for streak scoring** (locked decision 12). The new target/days/week is saved and **shown immediately**; the UI labels a queued change "Starts Monday". A newly-enabled habit is loggable now (appears on the grid) but only joins the collection-streak requirement from the following Monday. The in-progress week is scored against the config that was in force at its Monday start (`design.md § 4.5`).

### STORY-003: As an athlete, I want one streak across all my habits, with freeze tokens to skip a week

**Acceptance Criteria:**

- 3.1 [ ] A single collection `habit` streak is shown (`StreakSection`): current days/weeks, longest, and an at-risk state.
- 3.2 [ ] A week counts toward the collection streak when **every enabled habit meets its weekly target** (daily habits: daily target hit on ≥ its days/week; Gym: ≥ sessions/week; Calories: gated until M9). _(Streak-satisfaction rule — flagged as a tunable assumption in `design.md § 4`.)_
- 3.3 [ ] Freeze tokens are **earned** 1 per 4 successive completed weeks, cap 4 (cross-cuts § 3.5); the count is surfaced as 4 slots.
- 3.4 [ ] Spending a freeze token **skips the current week for all habits** (a 7-day freeze): no break, no count change, emits `freeze_token_applied`. Manual spend from this screen (`onSpendFreeze`) or auto-applied when at risk (`design.md § 4`). Only one freeze window active at a time.
- 3.5 [ ] When the streak is at risk (this week not yet safe and slack exhausted), the `StreakSection` surfaces the warning + promotes the freeze CTA; a `streak_at_risk` notification fires (cross-cuts § 5).

### STORY-004: As an athlete, I want each habit's completion to count correctly

**Acceptance Criteria:**

- 4.1 [ ] Water/Steps/Sleep (`value_gte`, daily): a day is hit when the day's value `>= target` (litres / steps / hours). The habit's week is met when hit on ≥ days/week.
- 4.2 [ ] Gym (`count`, weekly): the week is met when `>= target` qualifying sessions are logged (reuses `workout_streak`).
- 4.3 [ ] Calories (`within_tolerance`, daily): a day is hit when the day's kcal is within `target ± leniency%`; week met on ≥ days/week. M9-gated; until M9 never evaluated.
- 4.4 [ ] A `value_gte`/`within_tolerance` completion **requires** a `value`, range-validated per category before persistence.
- 4.5 [ ] Completion evaluation is identical on server (`engine.ts`) and client (`deriveStreak`).

### STORY-005: As an athlete, I want my habit data to sync two-way with Apple Health, with my backend as the source of truth

**Acceptance Criteria:**

- 5.1 [ ] Logging Water in-app writes the value to **our DB** (offline queue) **and** mirrors it to HealthKit (`DietaryWater`).
- 5.2 [ ] Externally-sourced HealthKit samples (Apple Watch sleep, third-party water/steps, Health-app weight) are read on the device and pushed to the DB, so they count toward habits and are visible to trainers.
- 5.3 [ ] The day's value is reconciled from HealthKit + in-app logs without **double-counting** the app's own writes (writes are source-tagged; `design.md § 7`).
- 5.4 [ ] Sleep and Steps are **read from** HealthKit (apps don't write sleep; steps are device-tracked); Weight is read+write (reuses the M6 `writeBodyWeight`); Calories sync is owned by Nutrition (M9).
- 5.5 [ ] Persistence: Water/Sleep/Steps → `habit_completions.value`; Weight → `body_measurements`; Calories → `nutrition_entries` (M9). The DB value is canonical; HealthKit is a mirror.
- 5.6 [ ] HealthKit permission scope is extended (Water r/w, Sleep r, Dietary Energy r/w at M9); requested through the existing 07 permission flow. Android Health Connect is a later platform pass.

### STORY-006: As a coach, I want to set and manage my client's habits

**Acceptance Criteria:**

- 6.1 [ ] A coach with an **active** relationship can enable/configure a client's habit via the trainer-scoped route (`design.md § 3`), stamping `assigned_by_user_id = coachId` + writing a `goal_assigned` audit row (cross-cuts § 1.4, § 2).
- 6.2 [ ] Coach-set habits render to the client with attribution ("Set by Coach X") and are **complete-only** — the client can log them but cannot retune target/frequency/leniency or disable them (cross-cuts § 2.2).
- 6.3 [ ] The client's edit-lock is conditioned on an **active** relationship with the assigner — not merely on `assigned_by_user_id` being set.
- 6.4 [ ] When the relationship ends, the client's coach-set habits **stay active and unlock to the client** (transfer); the collection streak is unbroken; `assigned_by_user_id` is retained as history (locked decision 6). The coach can no longer edit them (fails `assertTrainerCanActForClient`).
- 6.5 [ ] Trainers read the client's habit config + completion values from the DB via the doubled `GET /trainers/me/clients/:clientId/...` routes (cross-cuts § 1.2).

### STORY-007: As an athlete, I want to open habit setup from Home

**Acceptance Criteria:**

- 7.1 [ ] The Home habits-grid empty-state CTA navigates to the habit-setup screen.
- 7.2 [ ] A persistent "Manage habits" affordance reaches the same screen once habits exist.

### STORY-008: As the system, I want anti-gaming safeguards

**Acceptance Criteria:**

- 8.1 [ ] No completion for a **future** user-local day; completions only within the **current Mon–Sun week up to today** (prior weeks immutable — no backfilling to inflate `longest`).
- 8.2 [ ] Config edits (target/frequency/enable/disable) take effect at the **next week boundary** for streak scoring; the in-progress week is scored against its start-of-week config, and closed weeks keep their recorded outcome. This closes mid-week **rescue** (lower a target to pass a week you were failing), **ratchet** (lower then re-raise), and **disable-to-dodge** (toggle a failing habit off so the collection passes without it). (locked decision 12)
- 8.3 [ ] Holidays scheduled ≥ 24 h ahead; ending one early truncates it to today (a week already missed still counts as missed).
- 8.4 [ ] `current`/`longest`/`freeze_tokens` advance only via the engine — never from a client-supplied count. Freeze windows don't stack.
- 8.5 [ ] Completion `value` is range-validated per category before persistence; the device de-dupes its own HealthKit writes to prevent echo inflation (STORY-005 AC 5.3).

### STORY-009: As an athlete, my setup works fully offline

**Acceptance Criteria:**

- 9.1 [ ] Habit configs cached in SQLite, read cache-first.
- 9.2 [ ] Enable/edit/disable + freeze-spend writes are optimistic and queue (idempotent; server wins on reconcile).
- 9.3 [ ] A habit created offline gets a `local-` id, reconciles to its server id on drain without duplicating the grid row (de-dupe on `category`).
- 9.4 [ ] `deriveStreak` recomputes the collection streak from cached completions + configs (+ holidays + freeze window) until the engine reconciles. HealthKit reads/writes work offline (on-device); the resulting completion still syncs via the queue.

---

## Out of scope (v1)

- **Custom / user-named habits** beyond the fixed five.
- **Holiday scheduling UI on this screen** — it lives on Home (locked decision 11).
- **Writing Sleep/Calories to HealthKit** — Sleep is read-only-from-HK; Calories sync is Nutrition/M9 (locked decision 8).
- **Android Health Connect two-way sync** — later platform pass (adapter is a stub today).
- **Earn-extra-token via ad/engagement** — remains the cross-cuts § 3.5 v2 lever.
- **Per-habit reminder scheduling** — owned by `09-notifications-social` (M7).
- **Calories streak evaluation** before M9 (`13-nutrition-tracking`).

---

_End of `18-habit-setup/requirements.md` · reconciled 2026-06-23_
