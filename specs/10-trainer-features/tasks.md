# 10 — Trainer Features: Tasks

## Current state (2026-04-19)

**Shipped: 0 of ~40 tasks complete. Not started.**

What's there: nothing trainer-specific. Backend has no trainer/PT endpoints; mobile has no client list, invite flow, or role-gated tabs.

Parent milestone: **M8 Trainer features (role-gated)** — adds `GET /trainers/me/clients`, `GET /trainers/me/invitations/pending`, `POST /trainers/me/invite`, `DELETE /trainers/me/invitations/:id`, `POST /workout-assignments`, `GET /trainers/me/stats` with JWT role check; adds a 6th tab `Clients` conditional on `session.role === "personal_trainer" || "physiotherapist"`, `ClientsContainer` + presenter, invite sheet, assign-workout flow. The 6-tab layout is short-term; M11 revisits navigation when nutrition + trainer features both land.

## Phase 1: Domain

- [ ] Create `PTClientRelationship`, `PTRelationshipStatus` models
- [ ] Create `WorkoutAssignment`, `AssignmentStatus` models
- [ ] Write model tests

## Phase 2: Ports & Adapters

- [ ] Extend `ApiPort` with trainer/client methods
- [ ] Implement in SST API adapter
- [ ] Implement in-memory adapter for tests
- [ ] Write adapter tests

## Phase 3: Application Layer

- [ ] Create `GetClientsQuery`
- [ ] Create `InviteClientCommand`
- [ ] Create `RespondToInvitationCommand`
- [ ] Create `GetClientDetailQuery` (profile + sessions + progress)
- [ ] Create `AssignWorkoutCommand`
- [ ] Create `GetAssignmentsQuery`
- [ ] Write tests

## Phase 4: UI — Client List

- [ ] Create `ClientCard` presenter (name, avatar, status, last active)
- [ ] Create `ClientListPresenter` (list with filter tabs, empty state)
- [ ] Create `ClientListContainer` (fetches clients)
- [ ] Create `app/(app)/(tabs)/clients.tsx` screen (conditionally shown)
- [ ] Write tests

## Phase 5: UI — Invite Client

- [ ] Create `InviteClientPresenter` (email input, send button, invite link)
- [ ] Create `InviteClientContainer` (invite flow)
- [ ] Write tests

## Phase 6: UI — Client Detail

- [ ] Create `ClientDetailPresenter` (profile summary, recent sessions, progress, goals)
- [ ] Create `ClientDetailContainer` (fetches client data)
- [ ] Create `app/(app)/clients/[id].tsx` screen
- [ ] Write tests

## Phase 7: UI — Assign Workout

- [ ] Create `AssignWorkoutPresenter` (workout picker, notes, target date, client selector)
- [ ] Create `AssignWorkoutContainer` (form state, assign action)
- [ ] Create `AssignmentCard` component (assignment status, workout name)
- [ ] Write tests

## Phase 8: Client-Side — Accept/Decline Invitation

- [ ] Create invitation notification handler
- [ ] Create accept/decline UI in notifications
- [ ] Display active trainer in profile
- [ ] Display assigned workouts in workout list
- [ ] Write tests

## Phase 9: Role-Based Tab Visibility

- [ ] Conditionally show "Clients" tab for trainer/physio roles
- [ ] Test: regular user doesn't see clients tab
- [ ] Test: trainer sees clients tab
- [ ] Write tests

## Phase 10: Quality Gates

- [ ] All trainer tests pass with 90% coverage
- [ ] Quality gates pass

---

## Extension — M8 Tier A + Tier B (added 2026-05-26)

Phases above (1-10) cover STORY-001..006 and remain canonical. Phases below cover the STORY-007..018 extension. Each task traces to a STORY acceptance criterion and a `design.md` section.

Tier A is the M8 must-ship slice (Brad's named PT features). Tier B is post-M8 follow-up.

---

### Phase A1: Migrations (M8 Tier A)

**Spec:** design.md § 14 — Migration sequencing.

- [ ] **A1.1** — Create migration `add_trainer_actions_audit.sql` adding `action_type_enum` + `trainer_actions_audit` table per `specs/_shared/cross-cuts.md § 1.4`. Indexes on `(client_id, created_at desc)` and `(trainer_id, created_at desc)`. → STORY-012 AC 1
- [ ] **A1.2** — Verify upstream M4 migration `add_logged_by_user_id_columns.sql` adds nullable `logged_by_user_id` to `workout_sessions` and `body_measurements`. If M4 has not yet landed, M8 takes ownership of the column-add migration. → STORY-010 AC 3, STORY-011 AC 3
- [ ] **A1.3** — Verify upstream M4 migration adds nullable `assigned_by_user_id` to `user_goals`. → STORY-007 AC 3
- [ ] **A1.4** — Coordinate with M7 maintainer to add 4 new `notification_type` enum values: `workout_logged_on_behalf`, `measurement_logged_on_behalf`, `goal_assigned_by_trainer`, `nutrition_target_set_by_trainer`. Document in M7's migration block. → STORY-015 AC 6
- [ ] **A1.5** — Idempotency check: re-run all M8-owned migrations on a non-empty DB, verify no data loss + no duplicate constraint errors. → Migrations policy in CLAUDE.md

---

### Phase A2: Backend — shared helpers (M8 Tier A)

**Spec:** design.md § 1.3, § 11.

- [ ] **A2.1** — Create `microservices/core/src/application/relationships/assertTrainerCanActForClient.ts` per `cross-cuts § 1.3`. Reads `pt_client_relationships` filtered by `trainer_id`, `client_id`, `status='active'`. Throws 403 on miss. → STORY-007 AC 2, STORY-010 AC ALL
- [ ] **A2.2** — Unit-test `assertTrainerCanActForClient` in `relationships/__tests__/`. Cover: active relationship → returns row; pending → 403; inactive → 403; terminated → 403; non-existent → 403; wrong direction (client_id and trainer_id swapped) → 403. → CLAUDE.md testing rules
- [ ] **A2.3** — Create `microservices/core/src/application/audit/auditTrainerAction.ts`. Signature: `auditTrainerAction(tx, { trainerId, clientId, actionType, targetTable, targetRowId, payload })`. Inserts one row inside the caller's transaction. → STORY-012 AC 1, design.md § 1.1
- [ ] **A2.4** — Unit-test `auditTrainerAction`. Cover: writes row in same tx; rollback on outer-tx rollback; rejects unknown action_type via enum constraint. → CLAUDE.md testing rules
- [ ] **A2.5** — Create `requireRole(['personal_trainer', 'physiotherapist'])` middleware (if not already present from M0..M3). Place at `microservices/core/src/application/middleware/requireRole.ts`. → design.md § 11

---

### Phase A3: Backend — on-behalf write endpoints (M8 Tier A)

**Spec:** design.md § 1.2 + § 12 endpoints 1-4.

- [ ] **A3.1** — `POST /trainers/me/clients/:clientId/sessions` handler at `microservices/core/src/application/sessions/handlers/createSessionOnBehalf.ts`. Reuses `sessionCreateSchema` from self-write. Single tx: insert `workout_sessions` with `user_id=clientId, logged_by_user_id=trainerId` → `auditTrainerAction(tx, action_type='workout_logged_on_behalf')` → emit notification. → STORY-010 AC 1, 3, 4
- [ ] **A3.2** — `POST /trainers/me/clients/:clientId/measurements` handler. Same shape as A3.1. → STORY-011 AC 1, 3, 4
- [ ] **A3.3** — `POST /trainers/me/clients/:clientId/goals` handler. Insert `user_goals` with `assigned_by_user_id=trainerId` → audit + notification. → STORY-007 AC 3, 4
- [ ] **A3.4** — `PUT /trainers/me/clients/:clientId/nutrition/target` handler at `microservices/core/src/application/nutrition/handlers/setTargetOnBehalf.ts`. Feature-flag with `NUTRITION_M9_LIVE` env: if unset, returns 503 with `{ code: 'NUTRITION_NOT_AVAILABLE' }`. → STORY-009 AC 1, 4, sequencing note
- [ ] **A3.5** — Service-level tests for A3.1..A3.4 — verify row written + audit written + notification emitted in same tx; rollback on audit fail. → STORY-010 AC 4 (audit-write atomicity)
- [ ] **A3.6** — Handler-level integration tests (Vitest with mocked DB) covering: trainer JWT + relationship → 201; regular user JWT → 403; trainer JWT + no relationship → 403; malformed body → 400.

---

### Phase A4: Backend — read endpoints (M8 Tier A)

**Spec:** design.md § 12 endpoints 5-8.

- [ ] **A4.1** — `GET /trainers/me/clients/:clientId/sessions` — wraps existing `SessionRepository.listByUser` with relationship check. → STORY-004 (existing) extension to on-behalf
- [ ] **A4.2** — `GET /trainers/me/clients/:clientId/measurements` — same shape.
- [ ] **A4.3** — `GET /trainers/me/clients/:clientId/goals` — same shape; response includes `assignedByUserId` so frontend can render attribution.
- [ ] **A4.4** — `GET /trainers/me/clients/:clientId/notes` — see Phase A6.

---

### Phase A5: Backend — audit endpoints (M8 Tier A)

**Spec:** design.md § 4, § 12 endpoints 12-13.

- [ ] **A5.1** — `GET /trainers/me/audit` handler. Filters: `clientId`, `from`, `to`, `actionType` (CSV), `limit`, `offset`. Returns `{ entries: AuditEntry[], totalCount }` scoped to `trainer_id = self.id`. → STORY-012 AC 1, 3
- [ ] **A5.2** — `GET /users/me/audit/trainer-actions` handler. Same filter shape minus `clientId`. Scoped to `client_id = self.id`. → STORY-012 AC 2
- [ ] **A5.3** — Repository: `TrainerAuditRepository.list({ trainerId, clientId?, from?, to?, actionType?, limit, offset })` and `.listForClient({ clientId, from?, to?, limit, offset })`. → design.md § 4.4
- [ ] **A5.4** — Unit-test the repository: pagination, filter combinations, ordering by created_at desc, no cross-user leakage.

---

### Phase A6: Backend — trainer notes (M8 Tier A)

**Spec:** design.md § 5 + § 12 endpoints 8-11.

- [ ] **A6.1** — `TrainerNotesRepository` at `microservices/core/src/application/trainerNotes/repositories/TrainerNotesRepository.ts`. Methods: `list({ trainerId, clientId, noteType? })`, `create({ trainerId, clientId, ...note })`, `update(noteId, trainerId, ...)`, `delete(noteId, trainerId)`. All write methods scoped to `trainerId = self.id`.
- [ ] **A6.2** — Handlers: GET/POST/PATCH/DELETE per § 12 endpoints 8-11. Each write calls `auditTrainerAction` per § 5.2. → STORY-013 AC 6
- [ ] **A6.3** — Verify PATCH/DELETE reject when note's `trainerId != self.id` → 403. Test. → STORY-013 AC 6
- [ ] **A6.4** — Verify `GET /users/me/notes` (or equivalent client endpoint) does NOT return trainer notes. Add a regression test. → STORY-013 AC 7
- [ ] **A6.5** — Service + repository tests at 90% coverage.

---

### Phase A7: Backend — bulk assign (M8 Tier A)

**Spec:** design.md § 6 + § 12 endpoint 14.

- [ ] **A7.1** — `POST /workout-assignments/bulk` handler. Body validation: `clientIds.length` between 1 and 50. → STORY-016 AC 1, 7
- [ ] **A7.2** — Single transaction: sequential `assertTrainerCanActForClient` per `clientId`. On any failure, throw → tx rolls back. → STORY-016 AC 2
- [ ] **A7.3** — Insert N `workout_assignments` rows + N `trainer_actions_audit` rows (action_type='workout_assigned'). → STORY-016 AC 3-4
- [ ] **A7.4** — Emit N `workout_assigned` notifications (existing enum value). → STORY-016 AC 5
- [ ] **A7.5** — Tests: happy path (all clients valid); one client without relationship → entire batch 403, no rows written; exactly-50 boundary; 51 → 400; empty array → 400.

---

### Phase A8: Backend — workout programmes (M8 Tier A)

**Spec:** design.md § 7 + § 12 endpoints 15-26.

- [ ] **A8.1** — `WorkoutProgramRepository` + service + handlers for: `POST /workout-programs`, `GET /workout-programs` (filter by `createdBy=me|public`), `GET /workout-programs/:id`, `PATCH /workout-programs/:id`, `DELETE /workout-programs/:id`. Scope writes to `createdBy = self.id`. → STORY-017 AC 1, 4
- [ ] **A8.2** — `ProgramWeek` CRUD endpoints. Verify week_number uniqueness per programme (DB constraint already exists). → STORY-017 AC 2
- [ ] **A8.3** — `ProgramWorkout` CRUD endpoints. Validate `workoutId` exists + is visible to the programme creator. → STORY-017 AC 3
- [ ] **A8.4** — `POST /workout-programs/:id/assign` handler. Materialise into N×M `workout_assignments` rows per design.md § 7.3. Same transaction semantics as bulk-assign. → STORY-017 AC 5
- [ ] **A8.5** — Tests: programme builder happy path; week-number duplicate → 409; workout-not-found in week → 400; assignment materialisation produces correct dates from `startDate + (W-1)*7 + (dayOfWeek-1) days`.

---

### Phase A9: Backend — notifications (M8 Tier A)

**Spec:** design.md § 13 + cross-cuts.md § 5.

- [ ] **A9.1** — Add notification emit calls in handlers A3.1 (`workout_logged_on_behalf`), A3.2 (`measurement_logged_on_behalf`), A3.3 (`goal_assigned_by_trainer`), A3.4 (`nutrition_target_set_by_trainer`). → STORY-015 ALL
- [ ] **A9.2** — Each notification includes the recipient's deep link per design.md § 13 table.
- [ ] **A9.3** — Tests: notification row inserted on each on-behalf write; opt-out blocks the row (consumes existing `notification_preferences` infra from M7).

---

### Phase A10: Mobile — ports + adapters (M8 Tier A)

**Spec:** design.md § 10.

- [ ] **A10.1** — Extend `TrainerPort` interface at `packages/mobile/src/domain/ports/trainer.port.ts` per design.md § 10.1.
- [ ] **A10.2** — Create `ProgrammePort` interface at `packages/mobile/src/domain/ports/programme.port.ts`.
- [ ] **A10.3** — Implement `SSTTrainerAdapter` covering all `TrainerPort` methods. POST/PUT bodies match backend endpoint contracts in design.md § 12.
- [ ] **A10.4** — Implement `SSTProgrammeAdapter`.
- [ ] **A10.5** — Implement in-memory adapters for tests.
- [ ] **A10.6** — Adapter unit tests at 90% coverage.

---

### Phase A11: Mobile — application layer (M8 Tier A)

**Spec:** design.md § 10.2.

- [ ] **A11.1** — Queries: `listMyClients`, `getClientDetail`, `getTrainerActionAudit`, `listProgrammes`, `getProgramme`.
- [ ] **A11.2** — Commands: `inviteClient`, `setGoalForClient`, `setNutritionTargetForClient`, `logSessionForClient`, `logMeasurementForClient`, `assignWorkout`, `bulkAssignWorkout`, `addNote` / `updateNote` / `deleteNote`, `createProgramme` + week + workout adders, `assignProgramme`.
- [ ] **A11.3** — Each command/query has unit tests covering happy path + error mapping (401 / 403 / 503 surfaces as specific typed errors).

---

### Phase A12: Mobile — Trainer Dashboard (M8 Tier A)

**Spec:** design.md § 9.1.

- [ ] **A12.1** — `TrainerDashboardPresenter` — pure presenter taking `{ activeClientsCount, workoutsLoggedThisWeek, pendingInvitationsCount, programmesCount, recentActivity, onInviteClient, onCreateProgramme, onAssignWorkout }` props. → design.md § 9.1
- [ ] **A12.2** — `TrainerDashboardContainer` — fetches via queries; passes to presenter.
- [ ] **A12.3** — Screen wrapper at `packages/mobile/app/(app)/(trainer)/dashboard.tsx`.
- [ ] **A12.4** — Empty state: "Welcome to your coach console. Start by inviting a client or creating a programme." → design.md § 9.1
- [ ] **A12.5** — Presenter tests: renders all tiles, fires CTA callbacks, renders empty state when activeClientsCount === 0.
- [ ] **A12.6** — Accessibility: every tile has `accessibilityLabel` with count + delta; header announces "Trainer console".

---

### Phase A13: Mobile — Client List (M8 Tier A)

**Spec:** design.md § 9.2.

- [ ] **A13.1** — `ClientListPresenter` extends existing presenter from Phase 4 with: search bar, filter chips (All/Active/Pending/Inactive), sort dropdown, multi-select trigger (long-press enters mode).
- [ ] **A13.2** — Multi-select header: "Selected (N)" + "Cancel" + "Assign to selected (N)".
- [ ] **A13.3** — FAB "+ Invite client" reuses Phase 5 invite modal.
- [ ] **A13.4** — Empty state: friendly illustration + "No clients yet — invite your first one" + CTA. → STORY-016 + memory feedback
- [ ] **A13.5** — Presenter + container tests, including multi-select state transitions.

---

### Phase A14: Mobile — Client Detail (M8 Tier A)

**Spec:** design.md § 9.3.

- [ ] **A14.1** — `ClientDetailPresenter` with tab bar (Overview / Activity / Goals / Programmes / Notes / Settings).
- [ ] **A14.2** — Overview tab: recent sessions + current goals (with "Set by me" indicator) + latest measurement + current nutrition target. → STORY-014 AC 1
- [ ] **A14.3** — Activity tab: chronological audit list with filter chips (This week / This month / All time). → design.md § 4.1
- [ ] **A14.4** — Goals tab: grouped lists per design.md § 2.2 (Set by me / Set by client / Set by another trainer) + "Add goal" CTA.
- [ ] **A14.5** — Notes tab: per design.md § 5.4. Type-grouped collapsible list + add-note FAB.
- [ ] **A14.6** — Settings tab: terminate relationship, edit invitation reason.
- [ ] **A14.7** — Header 3-dot menu: "Log workout on behalf", "Log measurement on behalf", "Set nutrition target", "Set goal", "Add note", "Remove client".
- [ ] **A14.8** — `ClientDetailContainer` fetches via `getClientDetail` query.
- [ ] **A14.9** — Screen wrapper at `packages/mobile/app/(app)/(trainer)/clients/[id].tsx`.
- [ ] **A14.10** — Comprehensive tests across all tabs + container integration.

---

### Phase A15: Mobile — Programme Builder (M8 Tier A)

**Spec:** design.md § 9.4, § 7.4.

- [ ] **A15.1** — `ProgrammeBuilderPresenter` — tree structure per § 7.4 sketch. Drag-and-drop powered by `react-native-reanimated`.
- [ ] **A15.2** — Week-level affordances: rename, duplicate week, delete week.
- [ ] **A15.3** — Workout-level affordances: drag-reorder within week, drag between weeks, delete.
- [ ] **A15.4** — Sticky "Assign to clients" CTA at bottom.
- [ ] **A15.5** — `ProgrammeListPresenter` — own programmes + public templates, search.
- [ ] **A15.6** — Screen wrappers: `packages/mobile/app/(app)/(trainer)/programmes/index.tsx` + `[id]/edit.tsx`.
- [ ] **A15.7** — Drag-and-drop accessibility fallback: long-press → "Move to..." picker (per design.md § 9.9).
- [ ] **A15.8** — Tests including drag-reorder state.

---

### Phase A16: Mobile — Log on behalf modals (M8 Tier A)

**Spec:** design.md § 9.5, § 9.6.

- [ ] **A16.1** — Adapt `ActiveSessionContainer` (from `05-active-session`) to accept optional `onBehalfOfClientId` prop. When set, POSTs to trainer-scoped endpoint and shows persistent trainer-mode banner. → STORY-010 AC 1, design.md § 9.5
- [ ] **A16.2** — Confirm-gate sheet: "Confirm — this will be logged as a workout for {client}". Cancel / Confirm and save. → design.md § 9.5 confirm gate
- [ ] **A16.3** — `LogMeasurementOnBehalfContainer` + presenter. Simpler form: date, weight, body fat %, optional notes. Same confirm-gate pattern. → STORY-011, design.md § 9.6
- [ ] **A16.4** — `SetNutritionTargetForClientContainer` + presenter. Macro slider + calorie input per design.md § 3.2. → STORY-009
- [ ] **A16.5** — `SetGoalForClientContainer` + presenter. Goal type picker (incl. frequency preset) per design.md § 2.1, § 2.3. → STORY-007, STORY-008
- [ ] **A16.6** — Tests: each modal renders, confirm-gate fires correct API call, error states surface correctly (403 if relationship lost mid-flow → toast + back to client detail).

---

### Phase A17: Mobile — Bulk assign modal (M8 Tier A)

**Spec:** design.md § 9.7.

- [ ] **A17.1** — `BulkAssignWorkoutPresenter` per § 9.7 structure.
- [ ] **A17.2** — `BulkAssignWorkoutContainer` consumes selected clients from client-list multi-select state.
- [ ] **A17.3** — Error handling: 403 (one client lost relationship) → toast per design.md § 9.7.
- [ ] **A17.4** — Tests.

---

### Phase A18: Mobile — Audit log view (M8 Tier A)

**Spec:** design.md § 9.8, § 4.

- [ ] **A18.1** — `TrainerAuditPresenter` — filter chips + section grouping toggle (by client / by action-type).
- [ ] **A18.2** — `TrainerAuditContainer` consumes `getTrainerActionAudit` query.
- [ ] **A18.3** — Screen wrapper `packages/mobile/app/(app)/(trainer)/audit/index.tsx`.
- [ ] **A18.4** — Client-side audit view: section in Profile/Settings titled "Actions my trainer took for me". Reuses entry-row component with trainer attribution. → STORY-012 AC 5
- [ ] **A18.5** — Tests.

---

### Phase A19: Mobile — Trainer-mode nav + visual identity (M8 Tier A)

**Spec:** design.md § 9 (preamble), § 10.3.

- [ ] **A19.1** — Add `$accentTrainer` token to Tamagui theme. Propose desaturated indigo `#6366f1`-derived; await Brad sign-off before locking exact shade. → design.md § 9 preamble
- [ ] **A19.2** — Trainer-mode tab navigator: Dashboard / Clients / Programmes / Audit / Profile.
- [ ] **A19.3** — Role-driven nav swap: read `session.role`, render trainer nav OR client nav at app root.
- [ ] **A19.4** — Trainer-mode chrome uses `$accentTrainer` for header active state + bottom-tab active state.
- [ ] **A19.5** — "Switch to my own view" affordance on Profile screen for dual-role users (UI toggle only, no JWT change). → design.md § 10.3
- [ ] **A19.6** — Tests: role-driven render; regular user does not see trainer nav.

---

### Phase A20: Mobile — Client-side attribution (M8 Tier A)

**Spec:** design.md § 2, § 9; STORY-014.

- [ ] **A20.1** — Goal card on client's Progress dashboard shows "Set by Coach {name}" when `assignedByUserId IS NOT NULL`. Trainer name resolved from `profiles.displayName`. → STORY-014 AC 1-2
- [ ] **A20.2** — On-behalf rows (sessions, measurements) on client's history list show "Logged by Coach {name} on {date}" badge per cross-cuts § 1.5.
- [ ] **A20.3** — Client cannot delete / edit trainer-assigned goal — UI hides edit/delete affordances when `assignedByUserId IS NOT NULL`. → STORY-014 AC 4
- [ ] **A20.4** — Client cannot delete on-behalf session/measurement — edit/delete affordances hidden when `loggedByUserId IS NOT NULL`. → cross-cuts § 1.5
- [ ] **A20.5** — Tests: attribution renders correctly, edit/delete affordances correctly hidden, attribution survives terminated relationship per cross-cuts § 1.5.

---

### Phase A21: Quality gates (M8 Tier A)

**Spec:** CLAUDE.md.

- [ ] **A21.1** — `bun run prettier:check` passes
- [ ] **A21.2** — `bun run typecheck` passes
- [ ] **A21.3** — `bun run lint` passes
- [ ] **A21.4** — `bun run build` passes
- [ ] **A21.5** — `bun run test:unit` passes with ≥ 90% coverage on changed files
- [ ] **A21.6** — Smoke test per `specs/milestones/M8-trainer-features/SMOKE_TEST.md`: trainer logs in, sees dashboard, invites client, client accepts, trainer assigns workout, trainer logs workout on behalf, client sees audit entry, trainer sets goal, client sees goal with attribution.

---

## Tier B — Phase B (post-M8 follow-up)

Tasks below are deferred to a post-M8 milestone. They are spec-covered here so M8 implementation does not stub them.

### Phase B1: Check-in form schema + endpoints

**Spec:** design.md § 8.

- [ ] **B1.1** — Migration: `check_in_field_type` + `check_in_cadence` enums; `check_in_form_templates` + `check_in_assignments` + `check_in_submissions` tables per § 8.1.
- [ ] **B1.2** — `notification_type` enum gains `check_in_due` (coordinate with M7).
- [ ] **B1.3** — Backend endpoints per § 8.2 + § 12 endpoints 27-33.
- [ ] **B1.4** — Repository + service + handler tests at 90% coverage.
- [ ] **B1.5** — Scheduled Lambda: nightly job sweeps active `check_in_assignments` and emits `check_in_due` for the current period if no submission exists.

### Phase B2: Check-in form UI (trainer)

- [ ] **B2.1** — `CheckInFormBuilderPresenter` — drag-and-drop field designer (label, type picker, required toggle).
- [ ] **B2.2** — `AssignCheckInPresenter` — template picker + cadence + start/end dates.
- [ ] **B2.3** — `CheckInSubmissionListPresenter` — per-client submission history with side-by-side trend view.
- [ ] **B2.4** — Tests.

### Phase B3: Check-in form UI (client)

- [ ] **B3.1** — Client-side check-in submission form. Renders fields from template `fields` jsonb.
- [ ] **B3.2** — Photo upload via existing storage adapter.
- [ ] **B3.3** — Notification deep-link: `/check-ins/:id` opens the form.
- [ ] **B3.4** — Tests.

### Phase B4: Trainer-side "client missed workout" + "client logged session" notifications

**Spec:** design.md § 13.1.

- [ ] **B4.1** — Nightly cron Lambda for missed assignments: for each `workout_assignment` where `due_date < today AND status='assigned' AND completed_session_id IS NULL`, emit `client_missed_assigned_workout` to the assigning trainer.
- [ ] **B4.2** — On client session-complete: opt-in check for the relationship's trainer → emit `client_logged_session` notification.
- [ ] **B4.3** — `notification_type` enum gains both values (coordinate with M7).
- [ ] **B4.4** — Trainer preferences UI exposes these two as opt-in toggles.

### Phase B5: Habit dashboard for client

**Spec:** future Tier B work; cross-cuts § 3 habit_completions table is the data substrate.

- [ ] **B5.1** — Client-side habit grid presenter (TrueCoach-style completion calendar) per research-pass notes.
- [ ] **B5.2** — Trainer-side view of client's habit completion grid on Client Detail Overview.
- [ ] **B5.3** — Tests.

### Phase B6: Quality gates (Tier B)

- [ ] **B6.1** — All Tier B test suites pass at 90% coverage.
- [ ] **B6.2** — Tier B smoke test (separate from M8 SMOKE_TEST.md).
