# 10 — Trainer Features: Requirements

> **Spec rewritten from scratch on 2026-05-27** to absorb the May 2026 design package. Prior version (PR #78 — on-behalf logging, audit, programmes, UI extension) preserved in git history.

---

## Overview

The coach-mode surface for personal trainers + physiotherapists. Three pillars:

1. **Coach mode IA** — Home / Clients / Programs / You tab spec (via `useUserMode().mode === 'coach'`). Coach screens replace athlete screens in the same tab slots.
2. **On-behalf actions** — trainer logs workouts, measurements, nutrition entries, and assigns goals/workouts/nutrition targets ON BEHALF of clients. All audited per `_shared/cross-cuts.md § 1`.
3. **Coach-only surfaces** — Coach Home (business dashboard), Clients list + detail, Programs library + detail, Client notes, Trainer settings.

All cross-cutting primitives (trainer-on-behalf, audit log, trainer-assigned goals, notifications) follow `specs/_shared/cross-cuts.md` verbatim.

Authoritative references:

1. `~/Downloads/handoff/design-source/screens/coach.jsx` — Coach You (business dashboard) + Programs screen + Clients screen
2. `~/Downloads/handoff/design-source/screens/client-detail.jsx` — full Client Detail screen + AI Summary card
3. `~/Downloads/handoff/design-source/screens/extra.jsx` lines 188–328 — Clients list (alt layout) + Programs list (alt layout)
4. `~/Downloads/handoff/CLAUDE_CODE_MIGRATION_PLAN.md` § Phase 3 — Coach Home / Clients / Client detail / Programs / Coach You
5. `specs/_shared/cross-cuts.md` § 1 (trainer on-behalf) + § 2 (trainer-assigned goals) + § 5 (notifications)
6. Legacy V1: `../persistence-mobile/app/(tabs)/clients.tsx`, `components/trainer/`

---

## Locked decisions

| #   | Decision                             | Locked value                                                                                                                                                                                   |
| --- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Coach mode visibility                | Trainer-tier subscription gates eligibility (`useUserMode().isTrainerEligible`); runtime `mode === 'coach'` gates tab visibility (per `14-navigation`).                                        |
| 2   | Coach tab spec                       | Home / Clients (with badge) / Programs / You — per `phone.jsx:85`                                                                                                                              |
| 3   | Coach accent                         | `$accentTrainer` violet — applied by `<TabBar>` mode prop                                                                                                                                      |
| 4   | On-behalf pattern                    | `logged_by_user_id` nullable column on `workout_sessions` + `body_measurements` + `nutrition_entries` (M9). Endpoint convention `POST /trainers/me/clients/:clientId/...` per cross-cuts § 1.2 |
| 5   | Audit log                            | `trainer_actions_audit` table per cross-cuts § 1.4. Append-only. Retention: forever (cross-cuts § 1.4.3)                                                                                       |
| 6   | Goal assignment                      | `assigned_by_user_id` on `user_goals` per cross-cuts § 2                                                                                                                                       |
| 7   | Visibility / edit rules              | Per cross-cuts § 2.2 — trainer can edit own assignments; client can mark complete but not edit/delete                                                                                          |
| 8   | UI attribution                       | `Logged by Coach Bradley` badge on rows where `logged_by_user_id IS NOT NULL`. Trainer name from `profiles.display_name`                                                                       |
| 9   | Programs IA                          | `(app)/(tabs)/programs.tsx` lists user's authored programs; `(app)/programs/[id].tsx` is the detail editor                                                                                     |
| 10  | Coach Home reuses athlete primitives | `<StreakHero>` + `<BodyTrend>` + `<VolumeStats>` + `<MultiRing>` (donut variant) reused from `06-progress-goals`; coach-specific composites layered on top                                     |
| 11  | M8 lifecycle                         | Spec implements M8 backend + frontend in lockstep. Programs require backend tables; Clients list requires backend relationships table extension.                                               |

---

## User stories

### STORY-001: As a trainer in coach mode, I want a Coach Home dashboard showing my business + clients + own training + programs

**Acceptance Criteria:**

- 1.1 [ ] Route `(app)/(tabs)/index.tsx` branches on `useUserMode().mode === 'coach'` → renders `<CoachHomeContainer>`. Athlete `<HomeContainer>` from `06-progress-goals` is unchanged.
- 1.2 [ ] Coach Home layout per `coach.jsx:12–48`: header (eyebrow COACH + title "Your practice" + avatar with COACH badge) → mode-switch card → business stats grid → client overview donut → "your training" peek → program stats → recent activity feed.
- 1.3 [ ] Business stats per `coach.jsx:86–133`: 2×2 grid of `<Card>`s — Active Clients (with month-over-month delta), Avg Adherence (with delta), Client PRs (this month), Retention (90d %). All in `$mono` numerics.
- 1.4 [ ] Client overview per `coach.jsx:135–191`: donut chart (`<DonutMini>` — spec-local SVG composite) with segments by adherence band (Strong / Wobbling / At Risk); legend with counts.
- 1.5 [ ] "Your training" peek: small card showing trainer's own current streak + last workout summary — reads from athlete-mode hooks (`useGetUserStreak`, `useGetLastSession`). Lets the trainer flip back to athlete mode while staying in context.
- 1.6 [ ] Program stats: 1-2 row summary of active programs + clients assigned.
- 1.7 [ ] Recent activity: feed of last 5–10 client events (PR achieved, session logged, missed day, etc.). Data: `GET /trainers/me/recent-activity`.

### STORY-002: As a trainer, I want a Clients list tab showing all my clients with status + adherence

**Acceptance Criteria:**

- 2.1 [ ] Route `(app)/(tabs)/clients.tsx` renders `<ClientsListContainer>` when `mode === 'coach'`. Layout per `extra.jsx:190–241`.
- 2.2 [ ] Header: `<HeaderBar large title="Clients" eyebrow="COACHING · 8 ACTIVE" trailing={<IconBtn icon={<IconPlus/>} tone="primary"/>}>` (Plus opens "Add client" sheet — see STORY-005).
- 2.3 [ ] Summary chip row per `extra.jsx:212–216`: 3 `<SummaryChip>`s (from `01-design-system`) — Need attention / New PR / Programme ends.
- 2.4 [ ] `<SearchBar>` for client name filter.
- 2.5 [ ] `<Segmented>` per `extra.jsx:229`: `Active | All | Archive` (3 options — locked decision #9 in 01 allows this).
- 2.6 [ ] Client list: `<ClientRow>` (from `01-design-system`) per client per `extra.jsx:257–285`. Tap row → `(app)/clients/[id].tsx`.
- 2.7 [ ] Data: `useTrainerClients()` — server endpoint per cross-cuts § 1.2 (`GET /trainers/me/clients`).
- 2.8 [ ] Cache: offline-first via SQLite per V2 pattern.

### STORY-003: As a trainer, I want a Client Detail screen showing their workouts / progress / measurements / nutrition / AI summary

**Acceptance Criteria:**

- 3.1 [ ] Route `(app)/clients/[id].tsx` renders `<ClientDetailContainer>`. Full-screen route (not a tab).
- 3.2 [ ] Layout per `client-detail.jsx`: header with client name + status badge + back IconBtn; tab strip (Overview / Workouts / Nutrition / Notes / Settings); per-tab content.
- 3.3 [ ] **Overview** tab: AI Summary card + Streak hero (reused from `06-progress-goals`) + Body trend (reused) + Volume stats (reused) + recent PRs.
- 3.4 [ ] **Workouts** tab: assigned workouts list + recent sessions list. Trainer can tap "Log session for client" → on-behalf session creator flow.
- 3.5 [ ] **Nutrition** tab: nutrition targets card + recent days summary. Trainer can edit targets via "Edit targets" Btn → on-behalf nutrition-target PUT.
- 3.6 [ ] **Notes** tab: list of trainer's private notes about the client + Add Note Btn. Each note: timestamp + text + edit/delete affordances.
- 3.7 [ ] **Settings** tab: relationship status (active / archived) + assigned-since date + programs assigned + archive button.
- 3.8 [ ] AI Summary card: `<Card>` with `<IconSparkles>` + summary text + "Regenerate" Btn. Data: `useClientAISummary(clientId)`. Out of scope until later — see STORY-014.

### STORY-004: As a trainer, I want to log a workout on behalf of a client (M8)

**Acceptance Criteria:**

- 4.1 [ ] From Client Detail → Workouts tab → "Log session for client" → opens active session screen with `withClient` + `retroactive` props set (per `05-active-session` STORY-004).
- 4.2 [ ] `retroactive: true` if the session is dated in the past; `false` for "training live with" sessions.
- 4.3 [ ] Submit posts to `POST /trainers/me/clients/:clientId/sessions` per cross-cuts § 1.2.
- 4.4 [ ] Backend asserts `assertTrainerCanActForClient(trainerId, clientId)` per cross-cuts § 1.3.
- 4.5 [ ] Backend writes `logged_by_user_id = trainerId` on the session row + emits audit row per cross-cuts § 1.4 with `action_type = 'workout_logged_on_behalf'`.
- 4.6 [ ] Client receives `workout_logged_on_behalf` notification per cross-cuts § 5.
- 4.7 [ ] Client's own view of the session shows attribution badge: "Logged by Coach Bradley" per cross-cuts § 1.5.

### STORY-005: As a trainer, I want to add a new client to my roster

**Acceptance Criteria:**

- 5.1 [ ] From Clients list header `<IconBtn icon={<IconPlus/>}>` → opens `<AddClientSheet>` `<BottomSheet>`.
- 5.2 [ ] Sheet content: email input (required) + optional name + optional starting program selector + Invite Btn.
- 5.3 [ ] Submit fires `POST /trainers/me/clients` with `{ clientEmail, startingProgramId? }`.
- 5.4 [ ] Backend creates a pending `pt_client_relationships` row + emails the client an invite link.
- 5.5 [ ] On success, sheet closes; pending row appears in Clients list with `<Pill tone="ember">PENDING</Pill>`.

### STORY-006: As a trainer, I want to assign a workout to a client (existing pattern from PR #78)

**Acceptance Criteria:**

- 6.1 [ ] From Client Detail → Workouts tab → "Assign workout" Btn → opens `<AssignWorkoutSheet>` with workout picker.
- 6.2 [ ] Submit fires `POST /trainers/me/clients/:clientId/workout-assignments` (existing endpoint per V2 / PR #78).
- 6.3 [ ] Audit row written per cross-cuts § 1.4 with `action_type = 'workout_assigned'`.
- 6.4 [ ] Client receives `workout_assigned` notification (per cross-cuts § 5 — already in DB enum).

### STORY-007: As a trainer, I want to assign goals to a client per cross-cuts § 2

**Acceptance Criteria:**

- 7.1 [ ] From Client Detail → Overview tab → "Assign goal" Btn → `<AssignGoalSheet>`.
- 7.2 [ ] Sheet inputs: goal type (workout / habit / measurement) + target_value + period + description.
- 7.3 [ ] Submit fires `POST /trainers/me/clients/:clientId/goals` per cross-cuts § 1.2.
- 7.4 [ ] Backend writes `user_goals` row with `assigned_by_user_id = trainerId` per cross-cuts § 2.1.
- 7.5 [ ] Audit row with `action_type = 'goal_assigned'`.
- 7.6 [ ] Client receives `goal_assigned_by_trainer` notification per cross-cuts § 5.
- 7.7 [ ] Visibility + edit rules per cross-cuts § 2.2: trainer can edit/complete/delete; client can mark complete but not edit/delete.
- 7.8 [ ] Client-side UI attribution per cross-cuts § 2.2: "Goal set by Coach Bradley" rendered next to goal title.

### STORY-008: As a trainer, I want to set nutrition targets for a client per cross-cuts § 1.2

**Acceptance Criteria:**

- 8.1 [ ] From Client Detail → Nutrition tab → "Edit targets" Btn → opens `<EditNutritionTargetsSheet>` (composes the same form from `13-nutrition-tracking` Fuel Targets screen).
- 8.2 [ ] Submit fires `PUT /trainers/me/clients/:clientId/nutrition/target` per cross-cuts § 1.2.
- 8.3 [ ] Audit row with `action_type = 'nutrition_target_set'`.
- 8.4 [ ] Client receives `nutrition_target_set_by_trainer` notification per cross-cuts § 5.

### STORY-009: As a trainer, I want to log measurements on behalf of a client (M8)

**Acceptance Criteria:**

- 9.1 [ ] From Client Detail → Overview → "Log measurement" Btn → reuses the same `<WeighInSheet>` from `06-progress-goals` STORY-005 but with client context.
- 9.2 [ ] Submit fires `POST /trainers/me/clients/:clientId/measurements` per cross-cuts § 1.2.
- 9.3 [ ] Backend writes `body_measurements.logged_by_user_id = trainerId`.
- 9.4 [ ] Audit row `measurement_logged_on_behalf`.
- 9.5 [ ] Client receives `measurement_logged_on_behalf` notification.

### STORY-010: As a trainer, I want a Programs library + detail editor

**Acceptance Criteria:**

- 10.1 [ ] Route `(app)/(tabs)/programs.tsx` lists trainer's authored programs per `coach.jsx` ProgramsScreen + `extra.jsx:290–328`.
- 10.2 [ ] Each program card: name + duration (weeks) + days/wk + accent left border + clients-assigned pill + chevron.
- 10.3 [ ] Header search + filter chips for active / drafts.
- 10.4 [ ] "+ New programme" CTA (dashed-border Btn) → `(app)/programs/create.tsx`.
- 10.5 [ ] Detail route `(app)/programs/[id].tsx` (editor): name + description + weeks → days → workouts; assign-clients table.
- 10.6 [ ] Endpoints: `GET /trainers/me/programs`, `POST /trainers/me/programs`, `PUT /trainers/me/programs/:id`, `DELETE /trainers/me/programs/:id`, `POST /trainers/me/programs/:id/assign` (assign program to client).
- 10.7 [ ] Tables: `programs (id, trainer_id, name, description, weeks_count, days_per_week, created_at)`, `program_weeks (id, program_id, week_number)`, `program_days (id, program_week_id, day_number, workout_id)`, `program_assignments (id, program_id, client_id, started_at, current_week)`.

### STORY-011: As a trainer, I want to add private notes about clients per cross-cuts

**Acceptance Criteria:**

- 11.1 [ ] Client Detail → Notes tab → list of notes + Add Note Btn.
- 11.2 [ ] `<AddNoteSheet>` `<BottomSheet>`: textarea + Save.
- 11.3 [ ] Endpoints: `POST /trainers/me/clients/:clientId/notes`, `GET .../notes`, `PUT .../notes/:noteId`, `DELETE .../notes/:noteId`.
- 11.4 [ ] Table: `trainer_client_notes (id, trainer_id, client_id, body text, created_at, updated_at)`.
- 11.5 [ ] Audit rows per cross-cuts § 1.4 with action_types `client_note_added`, `client_note_updated`, `client_note_deleted`.
- 11.6 [ ] **Visibility:** trainer-only. Clients NEVER see these notes (private record).

### STORY-012: As a trainer, I want a Coach You screen (= You tab in coach mode) showing my own training plus business stats plus mode switch

**Acceptance Criteria:**

- 12.1 [ ] Route `(app)/(tabs)/you.tsx` branches on `useUserMode().mode === 'coach'` → renders `<CoachYouContainer>` from this spec.
- 12.2 [ ] Same layout pattern as Coach Home (STORY-001) but emphasises trainer's own training + freeze-token / streak / PR personal data.
- 12.3 [ ] Mode-switch card same as drawer's (`08-profile-settings § <ModeSwitchCardPresenter>`) — re-used for prominent in-screen flip.
- 12.4 [ ] Athlete view of "You" remains owned by `06-progress-goals`.

### STORY-013: As a client, I want my view of trainer-attributed actions to show the attribution badge per cross-cuts § 1.5

**Acceptance Criteria:**

- 13.1 [ ] Session detail screen (`05-active-session` Summary + history) renders attribution badge when `logged_by_user_id IS NOT NULL`: "Logged by Coach {name} on {date}".
- 13.2 [ ] Goal cards on Home + You/Progress render "Goal set by Coach {name}" when `assigned_by_user_id IS NOT NULL`.
- 13.3 [ ] Nutrition target card renders "Set by Coach {name}" when `set_by_user_id IS NOT NULL`.
- 13.4 [ ] Measurement row in body-trend renders the same when `logged_by_user_id IS NOT NULL`.
- 13.5 [ ] Client can NOT edit/delete these rows. Trailing chevron is replaced with a "view only" badge or context-menu showing "Ask coach to remove" (out-of-band per cross-cuts § 1.5 — surfaces this in the UI but the action is out-of-app).

### STORY-014: AI summary card (Tier B — deferred but contract specified)

**Acceptance Criteria:**

- 14.1 [ ] `useClientAISummary(clientId)` hook returns `{ summary?: string; lastGeneratedAt?: Date; canRegenerate: boolean }`.
- 14.2 [ ] Until the AI service is implemented, hook returns `{ summary: undefined, canRegenerate: false }` and the card shows: "AI summary coming soon".
- 14.3 [ ] When wired: card shows summary text + `<IconSparkles>` + "Regenerate" Btn (rate-limited; consumes `aiAccess` entitlement per cross-cuts § 4).
- 14.4 [ ] `POST /trainers/me/clients/:clientId/ai-summary/regenerate` → ai-usage-log row + entitlement check + LLM call.

---

## Out of scope

- **AI summary LLM implementation** — Tier B (M9.5+). Contract specified; backend / LLM integration is later.
- **Trainer-to-client messaging / inbox** — Option 4 nav had an Inbox tab. Out of scope for Option 3.
- **Bulk-assign workouts/goals/programs** — Tier B; flagged as M8.5 follow-up.
- **Athlete-mode surfaces (Home, You/Progress, Train, Fuel)** — owned by their respective specs. This spec ships coach-mode variants.

---

## Dependencies and what this spec unlocks

**Depends on:**

| Spec                    | What's consumed                                                                                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-design-system`      | All foundation + composite primitives (esp. `<Avatar>` with COACH badge, `<ClientRow>`, `<SummaryChip>`, `<MultiRing>`, `<Stat>`, `<Pill>`, `<BottomSheet>`, `<Segmented>`) |
| `14-navigation`         | `useUserMode` (mode gating), Clients + Programs tab slots                                                                                                                   |
| `08-profile-settings`   | `<ModeSwitchCardPresenter>` reused in Coach Home + Coach You                                                                                                                |
| `06-progress-goals`     | `<StreakHero>`, `<BodyTrend>`, `<VolumeStats>` for Client Detail's Overview tab                                                                                             |
| `05-active-session`     | Trainer banner slot wired here; `withClient` + `retroactive` props                                                                                                          |
| `13-nutrition-tracking` | Nutrition Targets form reused inside Edit Targets sheet                                                                                                                     |
| `_shared/cross-cuts.md` | § 1 (on-behalf), § 2 (goals), § 4 (AI entitlement), § 5 (notifications)                                                                                                     |

**Unlocks:**

| Downstream spec           | What it can do once 10 lands                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `06-progress-goals`       | Client-side UI attribution badges (STORY-013) — implementation can be added here OR a cross-cut amendment |
| `09-notifications-social` | Notification triggers from this spec emit per cross-cuts § 5                                              |

---

## Open questions

None. All 11 decisions locked.

---

_End of `10-trainer-features/requirements.md` · 2026-05-27 (rewritten from scratch)_
