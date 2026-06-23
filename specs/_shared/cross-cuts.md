# Cross-cutting primitives — shared spec definitions

**Audience:** authors of feature specs that touch trainer-on-behalf actions, trainer-assigned goals, streaks, AI-gated features, or the cross-feature notification taxonomy.

**Status:** authored 2026-05-25, all open decisions resolved 2026-05-25. Locked for downstream-spec citation.

---

## Purpose

Three feature specs touch the same primitives:

- `06-progress-goals` — goals, streaks, achievements
- `10-trainer-features` — PT log-on-behalf, PT-assigned goals/workouts/nutrition
- `13-nutrition-tracking` — nutrition log (Tier A), PT-set client nutrition targets (cross-cut), AI photo + LLM (Tier B / M9.5)

Rather than each spec defining the shared primitive in its own `design.md` and inevitably drifting, this document is the **single source of truth** for: trainer-on-behalf logging, trainer-assigned goal pattern, the audit log, the streak engine, habit completions, AI-feature entitlement gating, and the cross-feature notification taxonomy.

## How downstream specs cite this document

Use the form: `per specs/_shared/cross-cuts.md § N.M`.

Downstream specs **implement** these primitives — they do not re-define them. If a downstream spec needs to deviate, it must propose an update to this doc first and references must follow the updated section.

This file is append-only in intent (see `_agent.md` § Spec-first discipline rule 7). When refining a primitive, append a "**Revised YYYY-MM-DD:**" block under the affected section rather than rewriting in place.

---

## 1. Trainer on-behalf actions

### 1.1 The `logged_by_user_id` column pattern

Three tables grow a nullable `logged_by_user_id uuid REFERENCES profiles(id)` column:

- `workout_sessions` (consumed by `10-trainer-features` STORY-010 + cross-cut with `05-active-session`)
- `body_measurements` (consumed by `10-trainer-features` STORY-011 + cross-cut with `06-progress-goals`)
- `nutrition_entries` (consumed by `10-trainer-features` STORY-012 + cross-cut with `13-nutrition-tracking`; the table itself ships in M9 — Nutrition spec defines the column at table-creation time)

Semantics:

- `NULL` — the row's `user_id` self-logged it.
- non-`NULL` — the named user logged the row on behalf of `user_id`. Today this is always a trainer with an active relationship; the column is intentionally not enum-typed so future use cases (admin, AI assistant) inherit the same shape without migration.

This is **not an impersonation pattern.** No JWT acts-as-user, no token swap. The trainer's own JWT authenticates the request; the endpoint enforces a relationship check (§ 1.3) and writes the trainer's `sub` into `logged_by_user_id` while the row's `user_id` is the client.

### 1.2 Trainer-scoped endpoint convention

Every on-behalf write goes through a `/trainers/me/clients/:clientId/...` route. The body shape mirrors the user's own self-write route exactly so the same request validator can be reused.

Worked examples (referenced by downstream specs; not exhaustive):

| Self route                | Trainer-on-behalf route                                 | Defined in                                                                 |
| ------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------- |
| `POST /sessions`          | `POST /trainers/me/clients/:clientId/sessions`          | `10-trainer-features`                                                      |
| `POST /measurements`      | `POST /trainers/me/clients/:clientId/measurements`      | `10-trainer-features`                                                      |
| `POST /nutrition/entries` | `POST /trainers/me/clients/:clientId/nutrition/entries` | `10-trainer-features` (Tier C deferred — M8 ships only `nutrition/target`) |
| `PUT /nutrition/targets`  | `PUT /trainers/me/clients/:clientId/nutrition/target`   | `10-trainer-features` § Trainer-set nutrition                              |
| `POST /goals`             | `POST /trainers/me/clients/:clientId/goals`             | `10-trainer-features` + `06-progress-goals`                                |

**Locked 2026-05-25:** GET routes are also doubled (`GET /trainers/me/clients/:clientId/sessions`, etc.). Parity with self-write routes, reusable handler patterns. An aggregate client-detail endpoint is a Tier B optimisation, not v1.

### 1.3 Authorization helper

Backend exposes a shared helper used by every `/trainers/me/clients/:clientId/...` handler:

```
assertTrainerCanActForClient(trainerId, clientId): asserts active relationship exists OR throws 403
```

Implementation reads `pt_client_relationships` filtered by `trainer_id`, `client_id`, `status='active'`. Tested once in `application/relationships/__tests__/`; consumed by every downstream handler that takes a `clientId` in path.

Role check is layered on top: the auth middleware already validates JWT and surfaces `user.role`; the trainer routes additionally assert `role IN ('personal_trainer', 'physiotherapist')` before the relationship check. Misordered role check vs relationship check is a common foot-gun — the helper enforces order.

### 1.4 Audit log — `trainer_actions_audit`

Every on-behalf write also writes one row to a new audit table:

```
trainer_actions_audit
  id              uuid pk
  trainer_id      uuid not null fk profiles
  client_id       uuid not null fk profiles
  action_type     enum  -- see § 1.4.1
  target_table    text not null  -- e.g. 'workout_sessions'
  target_row_id   uuid not null
  payload         jsonb not null  -- the request body the trainer sent
  created_at      timestamptz default now()

  index (client_id, created_at desc)
  index (trainer_id, created_at desc)
```

#### 1.4.1 `action_type` enum values

- `workout_logged_on_behalf`
- `measurement_logged_on_behalf`
- `nutrition_entry_logged_on_behalf` (M9.5 / Tier C)
- `goal_assigned`
- `nutrition_target_set`
- `workout_assigned`
- `client_note_added`
- `client_note_updated`
- `client_note_deleted`

Append-only enum. New on-behalf actions get a new value; old values are never removed.

#### 1.4.2 Write-through middleware

Each on-behalf handler calls `auditTrainerAction({ trainerId, clientId, actionType, targetTable, targetRowId, payload })` as the final step **inside the same transaction** as the row write. If the audit insert fails, the entire action 500s and the row write rolls back. We never have a row in `workout_sessions.logged_by_user_id IS NOT NULL` without a corresponding audit entry.

#### 1.4.3 Retention

**Locked 2026-05-25:** **forever** — (a) volume is low (one row per trainer write, not per read), (b) supports both client trust ("show me what my trainer did") and compliance ("the trainer claims they didn't do X — prove it"), (c) S3-export-and-truncate is available as a v2 lever if storage ever becomes meaningful.

### 1.5 UI attribution

When `logged_by_user_id IS NOT NULL`, the row's detail UI on the client side renders a small badge: `Logged by Coach Bradley on 25 May`. The trainer's display name comes from `profiles.display_name`; if the trainer has since deactivated the relationship the row still attributes — the column is a historical record, not a live reference.

Client cannot delete or edit on-behalf rows directly. Edits go via the trainer (who can re-log) or via the client communicating out-of-band to ask the trainer to remove it.

**Locked 2026-05-25:** trainer-side only for v1. No in-app "request removal" affordance — the client communicates with their trainer through whatever channel they already use.

---

## 2. Trainer-assigned goals

### 2.1 The `assigned_by_user_id` column pattern

`user_goals` grows a nullable `assigned_by_user_id uuid REFERENCES profiles(id)` column.

Semantics:

- `NULL` — the user self-set the goal.
- non-`NULL` — a trainer assigned the goal to this user; the relationship must have been active at insert time (enforced by the same § 1.3 helper).

Goal-assignment writes also produce an audit row (`action_type = 'goal_assigned'`).

### 2.2 Visibility and edit rules

- **Trainer:** can edit, mark complete, or delete any goal where `assigned_by_user_id = self.id`. Trainer cannot touch goals where `assigned_by_user_id` is `NULL` or belongs to a different trainer.
- **Client:** can view all their goals regardless of assigner. Can mark complete on any goal. Can edit / delete only goals they self-set. For trainer-assigned goals, the client can request removal (out of band) but cannot delete directly.
- UI attribution: `Goal set by Coach Bradley` rendered next to the goal title when `assigned_by_user_id IS NOT NULL`.

**Locked 2026-05-25:** No. The client cannot mark a trainer-assigned goal inactive from the app. To request unassignment, the client communicates with their trainer out-of-band (text, in-person, gym chat); the trainer deactivates the goal via their own dashboard. No "request unassignment" affordance in v1 — this mirrors § 1.5's posture on on-behalf rows.

---

## 3. Streak engine

The streak engine is **separate from `user_goals`**. It tracks period-based streaks against multiple primitive event types (a workout logged, a habit completed, a measurement recorded). A streak optionally points at the goal that drives it.

### 3.1 Streak types

`streak_type_enum` values:

- `workout_streak` — periods = weeks; period satisfied when ≥ N sessions logged that week. N is the goal's `target_value`.
- `habit_streak` — periods = days OR weeks (per-goal); period satisfied when a `habit_completion` row exists with `goal_id = self.id` in the period.
- `measurement_streak` — periods = weeks; period satisfied when ≥ 1 `body_measurement` row exists for the user in the period.
- `nutrition_streak` — periods = days; period satisfied when daily calorie total falls within target ± tolerance (tolerance default ±10%). Requires `13-nutrition-tracking` to be live.

**Locked 2026-05-25:** weekly for `workout_streak` and `measurement_streak`; daily for `habit_streak` and `nutrition_streak`. The granularity mirrors the cadence of the underlying event — workouts/weigh-ins are illness- and travel-resilient on a weekly basis (Nike Run Club pattern); habits and nutrition logging happen daily, so the streak grain matches.

### 3.2 `user_streaks` table

```
user_streaks
  id                  uuid pk
  user_id             uuid not null fk profiles
  streak_type         enum streak_type_enum not null
  source_goal_id      uuid null fk user_goals  -- which goal drives this streak
  period              enum ('daily','weekly','monthly') not null
  current_count       integer not null default 0
  longest_count       integer not null default 0
  last_period_end     date not null            -- last period evaluated
  freeze_tokens       integer not null default 0
  status              enum ('active','broken','paused') not null default 'active'
  created_at          timestamptz default now()
  updated_at          timestamptz default now()

  unique (user_id, source_goal_id) where source_goal_id is not null
  index  (user_id, status)
```

A user has at most one `user_streak` row per `source_goal_id`. A user can also have ad-hoc streaks not tied to a goal (`source_goal_id IS NULL`), e.g. an app-level "training week" streak.

### 3.3 `habit_completions` table

Per-day check-offs for habit goals:

```
habit_completions
  id            uuid pk
  user_id       uuid not null fk profiles
  goal_id       uuid not null fk user_goals
  completed_at  timestamptz not null
  value         numeric null  -- optional numeric (e.g. cups of water, minutes meditated)

  unique (user_id, goal_id, date_trunc('day', completed_at))
  index  (user_id, goal_id, completed_at desc)
```

The streak engine reads from this table when computing `habit_streak` types.

### 3.4 Period computation

A period is satisfied **on the day after `period_end_date`** when the engine evaluates whether the period's threshold was met.

- For `period = 'weekly'`, the period ends Sunday 23:59:59 user-local time. **Locked 2026-05-25:** evaluated against user-local time — store `profiles.timezone` (text, IANA TZ identifier, default `Europe/London`), nightly cron computes period rollover per user. Matches Strava / Apple Fitness; avoids the unfair early/late rollover that pure UTC would cause for non-UK users.

Evaluation runs:

1. **On-write** — every event that could satisfy a streak triggers a streak-engine call (e.g. `POST /sessions` calls `evaluateStreaks(userId, eventType='workout_logged', ts)`). Engine checks all `user_streaks` rows for that user where `streak_type` matches; if today is a new period boundary, advances `current_count` and `last_period_end`.
2. **Nightly cron (Lambda scheduled)** — at 02:00 UTC, sweep all active streaks whose `last_period_end < yesterday` and mark the period as missed (apply freeze token if available; else status → `broken`).

The cron handles the case where no event fires within a period — the on-write hook doesn't know "nothing happened today" without being triggered by something.

### 3.5 Freeze-token economy

- Earn: 1 token per 4 successive completed periods (4 weeks of weekly streak = 1 token; 28 days of daily streak = 1 token).
- Cap: 4 tokens maximum per streak. Beyond that the user is far enough ahead that the safety net is irrelevant; tokens earned over the cap are silently discarded (no UI message — avoids loss-aversion friction).
- Spend: automatic. When the nightly cron detects a missed period and `freeze_tokens > 0`, it decrements tokens by 1, keeps `status = 'active'`, does NOT advance `current_count`, and emits a `freeze_token_applied` notification (§ 5).
- Surface: small badge on the streak tile showing token count. No animation on spend — quiet recovery feels better than celebrating a miss.

**Locked 2026-05-25:** 1 token per 4 successive completed periods, cap 4. Confirmed against the Nike Run Club + Streaks app patterns.

**Future considerations (out of scope for v1, captured here so the model can grow into them):**

- **Planned-holiday mode** — let the user pre-declare a vacation date range. During declared holiday periods, streaks shift to `status='paused'` and resume on the user-set return date rather than spending tokens. Fairer than asking freeze tokens alone to absorb known travel.
- **Earn-extra-token via ad or engagement** — watch a short ad OR complete a goal-aligned bonus action to mint an extra token. Doubles as a revenue lever and a non-ad alternative path; worth revisiting once base streak engagement metrics are in.

### 3.6 Achievement triggers

When `current_count` advances to a milestone, the engine inserts a `user_achievements` row and fires a `streak_milestone` notification (§ 5).

**Locked 2026-05-25:**

| Streak type                   | Milestone thresholds                                                             |
| ----------------------------- | -------------------------------------------------------------------------------- |
| Weekly (workout, measurement) | 1 wk, 2 wks, 4 wks (1 mo), 8 wks (~2 mo), 12 wks (~3 mo)                         |
| Daily (habit, nutrition)      | 7 days (1 wk), 14 days (2 wks), 28 days (4 wks), 60 days (~2 mo), 90 days (3 mo) |

Front-loads engagement in the first 3 months. Beyond 3 months, milestones intentionally stop — users still streaking after 3 months are intrinsically motivated and don't need a notification push. Adding 6-month and 1-year tiers is a v2 decision once retention data lands.

**Achievement visual:** fitness-themed icons per milestone tier (flame, dumbbell, lightning, medal, crown — concrete asset selection deferred to UI implementation). Data layer stores `achievement_type` + `tier`; presenter maps tier → icon. Displays in the user's achievements grid + a small badge next to their profile name when a fresh milestone is earned.

### 3.7 Revised 2026-06-23 — habit setup: collection streak, coach authorship, two-way sync (owned by `18-habit-setup`)

`18-habit-setup` extends habit streaks. This block amends §§ 3.1–3.6 for habit streaks; workout/measurement/nutrition streaks are unchanged except where noted. Authority for the full design is `specs/18-habit-setup/design.md`. (Supersedes the earlier per-habit / cheat-day draft — the landed prototype settled a collection model with days/week slack instead.)

**Five fixed categories:** Water (daily, litres), Gym (weekly, sessions — reuses `workout_streak`), Steps (daily, steps — HealthKit), Sleep (daily, hours — HealthKit), Calories (daily, kcal ± leniency — reuses `nutrition_streak`, M9-gated). Each is a seeded `goal_types` row (`category='habit'`) + a `user_goals` row + a `habit_configs` row.

**`habit_configs` (new table):** `(user_id, goal_id unique, category, target_value, unit, period, completion_rule, days_per_week, tolerance_pct)`. `period` ∈ {daily, weekly}; `completion_rule` ∈ {`count`, `value_gte`, `within_tolerance`}. **No cheat-days column** — `days_per_week` (1–7, NULL for Gym) is the slack: a daily habit's week is met when its daily target is hit on ≥ `days_per_week` days.

**Per-habit weekly satisfaction (amends § 3.1):** `count` → ≥ `target_value` qualifying events in the week (Gym sessions); `value_gte` → ≥ `days_per_week` days whose summed `value ≥ target_value` (Water/Steps/Sleep; `habit_completions.value` required); `within_tolerance` → ≥ `days_per_week` days within `target ± tolerance_pct%` (Calories, M9-gated — ignored until then).

**Collection streak (amends § 3.1/3.2 — habit streaks are now one weekly collection streak, not per-goal):** a single `user_streaks` row (`streak_type='habit_streak'`, `source_goal_id=NULL`, `period='weekly'`) counts all enabled habits together. A week is satisfied when **every enabled habit's weekly target is met**. Per-goal habit-streak rows are not created (Gym still has its own `workout_streak` for the Train ring).

**Forgiveness (reuses the M4 engine — the collection streak is weekly, so its existing "1 token per missed period" already means "1 token = 1 week off"; no new column). On weekly evaluation, in order:** (1) **Holiday pause** — week intersects a `streak_holidays` range → `paused`. (2) **Satisfied** → advance, maybe earn a token (1 per 4 weeks, cap 4), milestone. (3) **Missed** → emit `streak_at_risk`; spend 1 token per missed week if available (`freeze_token_applied`), else **break**. A proactive "skip this week" is a manual spend (`POST /users/me/streaks/:id/use-token`) advancing `last_period_end` over the current week, −1 token, no count change.

**Holiday / skip weeks (resolves the § 3.5 "planned-holiday mode" v2 item):** `streak_holidays (user_id, goal_id NULL=all, start_date, end_date)`, **managed from Home** (not the setup screen), applies to all habits. Scheduled **≥ 24 h in advance** (`start_date >= today + 1 day`, user-local — prevents retro-declaring over a missed week); can be **ended early** (truncate to today); a wholly-past one is immutable.

**Coach authorship (uses § 1.2 trainer-scoped routes + § 2 `assigned_by_user_id`):** a coach with an active relationship sets a client's habits via `/trainers/me/clients/:clientId/habits/...`, stamping `assigned_by_user_id` + a `goal_assigned` audit row. Coach-set habits are **complete-only** for the client; the edit-lock is conditioned on an **active** relationship, so when it ends the habits transfer to the client (stay active, streak unbroken, attribution kept).

**Two-way HealthKit sync — DB is the source of truth:** Water (r/w), Sleep (r), Steps (r), Weight (r/w, M6) and Calories (M9) sync between Apple Health and the backend via the **device acting as a bridge** (the backend never touches HealthKit). The canonical value lives in the DB (`habit_completions.value` / `body_measurements` / `nutrition_entries`) so **trainers read it** via § 1.2 GET routes. The device source-tags its own HK writes to avoid echo double-counting. Health-port/adapter deltas owned by `07-health-integration`.

**Config-edit timing (anti-gaming):** habit-config edits (raise/lower target, change days/week, enable, disable) take effect at the **next week boundary** — symmetric. The in-progress week is always scored against the config effective at its Monday start (`effective_from` gate + a `pending_config`/`pending_from` promoted by the weekly cron). New values are saved + shown immediately; a fresh habit is loggable now but joins the collection requirement next Monday. Closes mid-week **rescue**, **ratchet**, and **disable-to-dodge**.

**Anti-gaming:** no future-day / prior-week completions (prior weeks immutable); counts/tokens advance only via the engine; `value` range-validated per category. See `18-habit-setup/design.md § 6`.

**No new notification types.** Habit setup emits only the existing § 5 streak events (`streak_milestone`, `streak_at_risk`, `freeze_token_applied`).

---

## 4. AI feature entitlement gating

Tier B Nutrition (AI photo recognition, LLM free-text estimation) and future AI features (workout coach, programme generator) gate behind the `aiAccess` boolean on `subscription_tiers` shipped in M10.5.

### 4.1 Endpoint guard pattern

Any endpoint that consumes a paid AI inference call MUST call `assertEntitlement(ctx.userId, 'aiAccess')` as the first line after auth. The helper lives in `microservices/core/src/application/entitlements/` and was shipped in M10.5.

On entitlement denial:

- HTTP 402 Payment Required
- Body: `{ code: 'ENTITLEMENT_DENIED', entitlement: 'aiAccess', message, upgradeUrl }`

This shape is **identical** to the M10.5 / M10.6 contract — the mobile sync queue's 402 handler (per M10.6 `MOBILE_BRIEF`) recognises it automatically. AI-gated mutations queued offline-then-flushed will surface as `blocked_entitlement` entries with no additional client work.

### 4.2 Logging usage for billing analytics

**Locked 2026-05-25:** yes — every AI inference call writes one row to `ai_usage_log` with `(user_id, endpoint, request_size_bytes, response_size_bytes, ms, created_at)`. Cheap to maintain, gives us a basis to model cost per active user, and supports a future per-call quota tier (out of scope today per § 4.3).

### 4.3 Out-of-scope (today)

- Per-call rate limiting (e.g. "10 photo recognitions per day") — `aiAccess` is binary for now. Quota model is M9.5 follow-up at earliest.
- Free-tier trial of AI features (e.g. "5 free recognitions") — same.

---

## 5. Cross-feature notification taxonomy

These notification event types are emitted by the three downstream specs and consumed by `09-notifications-social` (M7). When this list grows, M7's spec absorbs the additions; M7's `requirements.md` is the canonical list of _user-facing_ notification surfaces.

| Event                                                          | Type enum                                | Emitter spec            | Default opt-in | Deep link                    |
| -------------------------------------------------------------- | ---------------------------------------- | ----------------------- | -------------- | ---------------------------- |
| Streak milestone hit                                           | `streak_milestone`                       | `06-progress-goals`     | on             | `/progress`                  |
| Streak about to expire (last day of period, not yet satisfied) | `streak_at_risk`                         | `06-progress-goals`     | on             | `/progress`                  |
| Freeze token auto-applied                                      | `freeze_token_applied`                   | `06-progress-goals`     | on             | `/progress`                  |
| Goal milestone (% of target)                                   | `goal_milestone`                         | `06-progress-goals`     | on             | `/progress/goals/:id`        |
| Goal assigned by trainer                                       | `goal_assigned_by_trainer`               | `10-trainer-features`   | on             | `/progress/goals/:id`        |
| Workout assigned by trainer                                    | `workout_assigned` (existing in DB enum) | `10-trainer-features`   | on             | `/workouts/:id`              |
| Workout logged on behalf                                       | `workout_logged_on_behalf`               | `10-trainer-features`   | on             | `/sessions/:id`              |
| Measurement logged on behalf                                   | `measurement_logged_on_behalf`           | `10-trainer-features`   | on             | `/progress/measurements/:id` |
| Nutrition target set by trainer                                | `nutrition_target_set_by_trainer`        | `10-trainer-features`   | on             | `/nutrition/targets`         |
| Daily nutrition target hit                                     | `daily_nutrition_target_hit`             | `13-nutrition-tracking` | off (noisy)    | `/nutrition`                 |

**Locked 2026-05-25:** opt-in defaults per the table above — conservative-on for trainer + streak events, off for the noisiest daily-target hit. Each can be overridden in user preferences (M7 owns the preferences UI; this doc owns the default values).

Adding a new value to the `notification_type` DB enum is a M7 migration responsibility — downstream specs that introduce new event types must call out the enum addition in their `design.md § Notification triggers` so M7 can sequence the migration.

---

## 6. Migration sequencing

Schema migrations originating in this doc are owned by the first milestone to need them, not by `_shared`. Recommended ordering:

| Migration                                                                 | Owner milestone       | Notes                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `user_goals.assigned_by_user_id`, `target_value`, `current_value`, `unit` | M4 (Goals extensions) | Goals spec drives. Other specs read.                                                                                                                                                                                     |
| `user_streaks`, `habit_completions`, `streak_type_enum`                   | M4                    | Same.                                                                                                                                                                                                                    |
| `workout_sessions.logged_by_user_id`                                      | M4                    | Cheap additive column; lands with Progress migration block.                                                                                                                                                              |
| `body_measurements.logged_by_user_id`                                     | M4                    | Same.                                                                                                                                                                                                                    |
| `nutrition_entries` (table created with `logged_by_user_id` from day 1)   | M9                    | Created by Nutrition spec; the column is built-in.                                                                                                                                                                       |
| `nutrition_targets` (table)                                               | M9                    | Owned by Nutrition spec; PT spec writes via cross-cut.                                                                                                                                                                   |
| `trainer_actions_audit` + `action_type_enum`                              | M8                    | First milestone to actually populate it. M4 lands `logged_by_user_id` but does not have on-behalf endpoints yet, so audit-log writes are M8's. M4's column ships nullable so no backfill is needed when M8 lights it up. |

M4 carries the largest migration block. This is fine — M4 is mostly mobile work; the backend migration is a small surface area.

---

## 7. Decisions — resolved index

All resolved 2026-05-25. Future amendments use the "Revised YYYY-MM-DD" append pattern per § Purpose.

| §     | Decision                                              | Locked value                                                                              |
| ----- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1.2   | Trainer GET routes                                    | Doubled — every self GET has a `/trainers/me/clients/:id/...` sibling                     |
| 1.4.3 | Audit retention                                       | Forever (S3-export-and-truncate available as a v2 lever if storage grows)                 |
| 1.5   | Client "request removal" affordance on on-behalf rows | No, v1 — trainer-side only                                                                |
| 2.2   | Can client mark trainer-assigned goal inactive in-app | No — client communicates out-of-band, trainer deactivates                                 |
| 3.1   | Default streak granularity                            | Weekly for workout/measurement, daily for habit/nutrition                                 |
| 3.4   | Period timezone                                       | User-local — store `profiles.timezone`, default `Europe/London`                           |
| 3.5   | Freeze-token economy                                  | 1 per 4 periods, cap 4. Holiday-mode + ad/engagement earn flagged as v2 considerations    |
| 3.6   | Milestone thresholds                                  | Weekly: 1/2/4/8/12; Daily: 7/14/28/60/90. Fitness-themed achievement icon next to profile |
| 4.2   | Log AI inference calls                                | Yes, `ai_usage_log` table                                                                 |
| 5     | Notification opt-in defaults                          | Conservative-on per § 5 table                                                             |
