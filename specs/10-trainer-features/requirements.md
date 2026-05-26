# 10 — Trainer Features: Requirements

## Overview

Personal trainer (PT) and physiotherapist features: manage clients, assign workouts, view client progress. Only users with `personal_trainer` or `physiotherapist` role see these features.

**Backend dependency:** Trainer/client relationship endpoints and workout assignment endpoints in SST API.

---

## User Stories

### STORY-001: As a trainer, I want to see my client list

**Acceptance Criteria:**

- [ ] "Clients" tab visible only for trainer/physio roles
- [ ] Client list with: name, avatar, last active date, relationship status
- [ ] Filter: active, pending, inactive clients
- [ ] Empty state with "Invite a client" CTA

### STORY-002: As a trainer, I want to invite clients

**Acceptance Criteria:**

- [ ] Invite by email or shareable invite link
- [ ] Invitation creates pending PT-client relationship
- [ ] Client receives notification of invitation
- [ ] Client can accept or decline

### STORY-003: As a client, I want to accept or decline a trainer invitation

**Acceptance Criteria:**

- [ ] Notification for new trainer invitation
- [ ] Accept: relationship becomes active, trainer gains read access
- [ ] Decline: relationship removed
- [ ] View active trainer relationship in profile

### STORY-004: As a trainer, I want to view a client's workout history and progress

**Acceptance Criteria:**

- [ ] Tap client to see their profile summary
- [ ] View client's recent sessions
- [ ] View client's measurements and progress
- [ ] View client's active goals
- [ ] Read-only access (trainer cannot edit client data directly)

### STORY-005: As a trainer, I want to assign workouts to clients

**Acceptance Criteria:**

- [ ] Select workout from trainer's library
- [ ] Assign to one or more clients
- [ ] Assignment includes optional notes and target date
- [ ] Client sees assigned workout in their workout list
- [ ] Assignment status: assigned, in_progress, completed
- [ ] Client notification on new assignment

### STORY-006: As a trainer, I want to manage client relationships

**Acceptance Criteria:**

- [ ] Remove client (terminates relationship)
- [ ] View relationship status (pending, active, inactive)
- [ ] Cannot access client data after relationship terminated

---

## Extension — On-behalf, audit, programmes, attribution (added 2026-05-26)

These stories extend the original six with the trainer-side operational scope. Each cites cross-cutting primitives in `specs/_shared/cross-cuts.md` and tags Tier A (must-ship in M8) vs Tier B (post-M8 follow-up).

Authoritative pattern reminder: **no impersonation.** Every on-behalf action runs against a trainer-scoped endpoint (per `specs/_shared/cross-cuts.md § 1.2`), guarded by `assertTrainerCanActForClient` (§ 1.3), and writes a `trainer_actions_audit` row in the same transaction as the data row (§ 1.4). No JWT swap, no "act-as-user" token.

### STORY-007: As a trainer, I want to set goals for my clients [M8 Tier A]

Cross-cut with `06-progress-goals` STORY-013. Trainer authors a goal and assigns it to a named client; the goal lives on the client's progress dashboard with attribution.

**Acceptance Criteria:**

- [ ] Trainer can author a goal via `POST /trainers/me/clients/:clientId/goals` per `specs/_shared/cross-cuts.md § 1.2`
- [ ] Backend enforces `assertTrainerCanActForClient` per `§ 1.3`; non-active relationship → 403
- [ ] Insert sets `user_goals.assigned_by_user_id = trainer.id` per `§ 2.1`
- [ ] One `trainer_actions_audit` row written with `action_type = 'goal_assigned'` per `§ 1.4`
- [ ] Client receives a `goal_assigned_by_trainer` notification per `§ 5`
- [ ] Trainer-side UI lists goals authored by self per client with edit/complete/delete affordances per `§ 2.2`

### STORY-008: As a trainer, I want to set training-frequency targets for my clients [M8 Tier A]

A frequency target ("4 sessions / week") is a goal of type `workout_count_per_week` (defer goal-type seeds to `06-progress-goals`). This story is an explicit acceptance surface for the specific UX of frequency-target authoring even though the underlying mechanism is STORY-007's goal-assign path.

**Acceptance Criteria:**

- [ ] Trainer goal-author flow includes a "Training frequency" preset that pre-fills `goal_type = workout_count_per_week` and exposes a numeric stepper for sessions/week
- [ ] Target value persists as `user_goals.target_value` per the Goals spec migration block in `specs/_shared/cross-cuts.md § 6`
- [ ] Streak engine creates a corresponding `user_streaks` row with `streak_type = 'workout_streak'` and `source_goal_id` set per `§ 3.2`
- [ ] Client sees the frequency target on their Progress dashboard with "Set by Coach Bradley" attribution per `§ 2.2`
- [ ] Same audit + notification semantics as STORY-007

### STORY-009: As a trainer, I want to set calorie and macro targets for my clients [M8 Tier A]

Cross-cut with `13-nutrition-tracking` STORY-011 and `specs/_shared/cross-cuts.md § 1.2`. The `nutrition_targets` table is owned by Nutrition spec (M9 migration per `§ 6`); the trainer endpoint is owned by this spec.

**Acceptance Criteria:**

- [ ] Trainer can set a target via `PUT /trainers/me/clients/:clientId/nutrition/target`
- [ ] Body shape mirrors the self-write `PUT /nutrition/targets` (calories integer, protein/carbs/fat grams integer)
- [ ] `assertTrainerCanActForClient` enforced per `§ 1.3`
- [ ] One `trainer_actions_audit` row written with `action_type = 'nutrition_target_set'`
- [ ] Client receives a `nutrition_target_set_by_trainer` notification per `§ 5`
- [ ] **Sequencing note:** this story is M8 Tier A but ships LIT-UP only after M9's `nutrition_targets` table lands. M8 lands the trainer endpoint as a stub (501 Not Implemented) wired to a feature flag that flips when M9 deploys, OR M8 defers the endpoint to a post-M9 patch. Decided in M8 BRIEF; not in scope of this requirements doc.
- [ ] Trainer-side UI: macro-split slider (P/C/F % adding to 100) + calorie input + Apply CTA with audit-log success toast

### STORY-010: As a trainer, I want to log a workout on behalf of my client [M8 Tier A]

Cross-cut with `05-active-session`. The named feature from market research (Trainerize, Everfit) — trainer attends a session in person or reviews a client's text message and back-logs the workout for the client's timeline.

**Acceptance Criteria:**

- [ ] Trainer creates a session via `POST /trainers/me/clients/:clientId/sessions` per `§ 1.2`
- [ ] Body shape mirrors self-write `POST /sessions` exactly (same validator reuse per `§ 1.2`)
- [ ] Row written with `workout_sessions.user_id = clientId`, `logged_by_user_id = trainerId` per `§ 1.1`
- [ ] One `trainer_actions_audit` row written with `action_type = 'workout_logged_on_behalf'` in same transaction per `§ 1.4.2`
- [ ] Client receives a `workout_logged_on_behalf` notification per `§ 5`
- [ ] Streak engine fires (per `§ 3.4` on-write hook) — the on-behalf row counts toward the client's workout streak
- [ ] PR detection still fires on the session (it's the client's row, the trainer's `logged_by_user_id` is metadata only)
- [ ] Client cannot directly delete or edit the row per `§ 1.5`

### STORY-011: As a trainer, I want to log a measurement / weight on behalf of my client [M8 Tier A]

Cross-cut with `06-progress-goals`. PT weigh-in, in-person body-composition measurement, etc.

**Acceptance Criteria:**

- [ ] Trainer creates a measurement via `POST /trainers/me/clients/:clientId/measurements` per `§ 1.2`
- [ ] Body shape mirrors self-write `POST /measurements` (weight, body fat %, measurements jsonb, date)
- [ ] Row written with `body_measurements.user_id = clientId`, `logged_by_user_id = trainerId` per `§ 1.1`
- [ ] One `trainer_actions_audit` row with `action_type = 'measurement_logged_on_behalf'` per `§ 1.4`
- [ ] Client receives a `measurement_logged_on_behalf` notification per `§ 5`
- [ ] Streak engine evaluates `measurement_streak` per `§ 3.1`

### STORY-012: As a trainer, I want a structured audit log of every on-behalf action I take, visible to both me and the client [M8 Tier A]

The trust-and-compliance surface that distinguishes us from Trainerize/Everfit per the research pass — neither documents an audit trail; we will.

**Acceptance Criteria:**

- [ ] Trainer can fetch their own audit history via `GET /trainers/me/audit?clientId=&from=&to=`
- [ ] Client can fetch the audit history of actions taken on their account via `GET /users/me/audit/trainer-actions`
- [ ] Backend response includes: trainer name, action_type, target_table, target_row_id, payload (redacted of sensitive fields per implementation), created_at
- [ ] Trainer-side UI: chronological list per client (default 30 days, filters: this week / this month / all time) + global "what I did this week" view per `§ 1.4`
- [ ] Client-side UI: section in profile/settings titled "Actions my trainer took for me" listing the same entries with trainer attribution
- [ ] Retention is forever per `§ 1.4.3` — no auto-truncation
- [ ] No edit/delete affordance on audit entries from any UI surface (append-only)

### STORY-013: As a trainer, I want to add private notes about my clients [M8 Tier A]

The `trainer_client_notes` schema (lines 888-914) already exists; this story spec-covers it. Notes are **trainer-private** — clients cannot see them, regardless of the `is_private` column value (the column is a future-proof flag for trainer-internal sharing within a coaching team).

**Acceptance Criteria:**

- [ ] Trainer can author a note via `POST /trainers/me/clients/:clientId/notes` with `{ noteType, title, content, sessionId? }`
- [ ] `noteType` enum reuses existing `noteTypeEnum` values: progress, injury, milestone, concern, general
- [ ] Optional `sessionId` links the note to a specific workout session
- [ ] Trainer can list notes per client via `GET /trainers/me/clients/:clientId/notes` (filterable by noteType)
- [ ] Trainer can edit via `PATCH /trainers/me/clients/:clientId/notes/:noteId` (own notes only — note's `trainerId` must match `trainer.id`)
- [ ] Trainer can delete via `DELETE /trainers/me/clients/:clientId/notes/:noteId` (same scoping)
- [ ] Client `GET /users/me/notes` does NOT return trainer notes; no surface in client app exposes them
- [ ] Each note CRUD action writes a `trainer_actions_audit` row with action_type ∈ {`client_note_added`, `client_note_updated`, `client_note_deleted`} per `§ 1.4.1`

### STORY-014: As a client, I want to see who set a goal that's been assigned to me [M8 Tier A]

UI attribution per `specs/_shared/cross-cuts.md § 2.2`. The data plumbing comes from STORY-007 / `user_goals.assigned_by_user_id`; this story is the client-facing presentation requirement.

**Acceptance Criteria:**

- [ ] Goal cards on the client's Progress dashboard show "Set by Coach Bradley" when `assigned_by_user_id IS NOT NULL`
- [ ] Trainer's display name is resolved from `profiles.display_name`
- [ ] If the trainer's relationship has since deactivated, the attribution still renders (historical record per `§ 1.5`)
- [ ] Client cannot delete / edit / deactivate a trainer-assigned goal in-app per `§ 2.2`
- [ ] Client CAN mark progress against the goal (e.g. complete a habit-completion check-off) per `§ 2.2`
- [ ] Empty-state copy distinguishes "no goals" from "no trainer-assigned goals"

### STORY-015: As a client, I want to be notified when my trainer logs something on my behalf [M8 Tier A]

Per `specs/_shared/cross-cuts.md § 5`. The notification surfaces are owned by `09-notifications-social` (M7); this story is the trigger spec.

**Acceptance Criteria:**

- [ ] Notification fires on every on-behalf write (STORY-010, STORY-011, plus nutrition entries in Tier C / M9.5)
- [ ] Default opt-in `on` per `§ 5` table
- [ ] User can override opt-in per type in M7's preferences UI
- [ ] Notification title includes the action (e.g. "Coach Bradley logged a workout for you")
- [ ] Deep link routes to the affected row per `§ 5` table (`/sessions/:id`, `/progress/measurements/:id`, etc.)
- [ ] **Enum addition:** `notification_type` enum gains `workout_logged_on_behalf`, `measurement_logged_on_behalf`, `nutrition_target_set_by_trainer`, `goal_assigned_by_trainer`; migration owned by M7 per `§ 5`

### STORY-016: As a trainer, I want to bulk-assign a workout to multiple clients at once [M8 Tier A]

Common operational need (programme prep, "send this week's session to my 8 clients").

**Acceptance Criteria:**

- [ ] Trainer can bulk-assign via `POST /workout-assignments/bulk` with `{ client_ids: uuid[], workout_id, assigned_date, due_date?, trainer_notes? }`
- [ ] `assertTrainerCanActForClient` runs once per `client_id` — any failure rolls back the whole batch (all-or-nothing; partial-success is a v2 nicety, not v1)
- [ ] One `workout_assignments` row inserted per client
- [ ] One `trainer_actions_audit` row inserted per client with `action_type = 'workout_assigned'`
- [ ] Each client receives a `workout_assigned` notification (existing enum value)
- [ ] Trainer-side UI: multi-select on client list + "Assign to selected" CTA opening a modal with workout picker + date inputs
- [ ] Backend enforces a hard cap (proposed 50 clients per call; locked in M8 BRIEF) to prevent abuse + Lambda timeout

### STORY-017: As a trainer, I want to build multi-week workout programmes and assign them to clients [M8 Tier A]

The `workout_programs` / `program_weeks` / `program_workouts` schema (lines 625-668) exists but is unused. This story adopts it.

**Acceptance Criteria:**

- [ ] Trainer can create a programme via `POST /workout-programs` with `{ name, description?, total_weeks }`
- [ ] Trainer can add weeks via `POST /workout-programs/:id/weeks` with `{ week_number, name?, description? }`
- [ ] Trainer can add workouts to a week via `POST /program-weeks/:id/workouts` with `{ workout_id, day_of_week?, sort_order? }`
- [ ] Trainer can list own programmes via `GET /workout-programs?created_by=me`
- [ ] Trainer can assign a programme to one or more clients via `POST /workout-programs/:id/assign` with `{ client_ids: uuid[], start_date }`
  - Backend materialises the programme into N×M `workout_assignments` rows (N = total_weeks, M = workouts/week), spaced from `start_date`
  - Auto-advance is implicit — each week's assignments share the trainer's plan; no continuous scheduler needed
- [ ] Same audit + notification semantics as bulk-assign (STORY-016) per `§ 1.4` and `§ 5`
- [ ] Trainer-side UI: programme builder (tree view: Programme → Weeks → Workouts), drag/reorder, save as template, assign-to-clients modal
- [ ] Client-side: assigned programme workouts appear in the client's normal workout assignment list with no special UI — they are workouts like any other

### STORY-018: As a trainer, I want client check-in forms — a designable weekly questionnaire [M8 Tier B]

Inspired by Everfit's check-in form pattern. Trainer designs a form (weight, photos, free-text questions); client fills weekly; trainer reviews. Schema additions land in Tier B (post-M8 follow-up).

**Acceptance Criteria:**

- [ ] Trainer can design a check-in form template via `POST /check-in-form-templates` with `{ name, fields: jsonb[] }` where each field has `{ key, label, type ∈ ['number','text','photo','choice'], required }`
- [ ] Trainer can assign a template to a client with a cadence (`weekly`, `biweekly`) via `POST /trainers/me/clients/:clientId/check-in-assignments`
- [ ] Client receives a notification when a check-in is due (new notification type: `check_in_due` — proposed; M7 confirms)
- [ ] Client fills via `POST /check-in-submissions` with `{ template_id, answers: jsonb }`
- [ ] Trainer reviews via `GET /trainers/me/clients/:clientId/check-in-submissions`
- [ ] Photo uploads use the existing storage adapter; submissions reference photo IDs not blobs
- [ ] **Schema additions (Tier B):** `check_in_form_templates`, `check_in_submissions` — designed in M8 design.md § Check-in forms; migration owned by the Tier B implementation milestone

