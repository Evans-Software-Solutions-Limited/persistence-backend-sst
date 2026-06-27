# 10 — Trainer Features: Tasks

> **Spec rewritten from scratch on 2026-05-27.** Prior tasks preserved in git history.

---

## Status & reconciliation — 2026-06-26 (post-PR #136)

The phase checkboxes below predate several shipped PRs and were never ticked; **this block is the
source of truth** for what's actually merged on `main`.

### Shipped
- **Coach mode branching** — `(tabs)/index.tsx` + `(tabs)/you.tsx` branch on `useUserMode().mode` (T-10.9.4). NB `CoachHomeContainer` is still a **`ComingSoon` stub** → T-10.9.1 NOT done.
- **Coach You** — `CoachYouPresenter`/`Container` + `GET /trainers/me/overview` (business stats, client-health donut, own-training peek, programme-stats peek, recent-activity feed) → T-10.13.1/.2. `AISummaryCardPresenter` stub NOT built → T-10.13.3 open.
- **Clients list** (#125) — `ClientsListPresenter` → T-10.9.2.
- **Invite flows** — email invitations (`/trainers/me/invitations` CRUD) + invite codes (`/trainers/me/invite-codes`, `/trainers/accept-invite-code`) + AddClient sheet → T-10.11.1.
- `trainer_client_notes` **table** exists (migration 2026-01-17); notes **endpoints** (Phase 10.5) NOT built.
- **PR #136 — new surface, NOT in the original brief:** client-side accept/decline handshake (`GET /clients/me/relationships`, `POST /clients/me/relationships/:id/respond`), You-page "Your trainer" section, invite-code → trainer notification, coach log-weight, and coach→client→HealthKit weight writeback sync.

### ⚠ Reconciliation debt from #136 — do BEFORE more on-behalf work
#136 shipped a coach weight-log endpoint that **diverges from this brief + cross-cuts**:
- Path is `POST /clients/:clientId/measurements`; brief mandates `POST /trainers/me/clients/:clientId/measurements` (cross-cuts § 1.2).
- Authorization is an **inline** active-relationship check, not the shared `assertTrainerCanActForClient` helper (cross-cuts § 1.3) — which still does not exist in code.
- It writes **no `trainer_actions_audit` row** (cross-cuts § 1.4) — the audit table + `auditTrainerAction` helper don't exist yet, so this on-behalf write has no audit trail, violating the "no `logged_by_user_id` without a matching audit row" invariant.

> **R-1** Build the audit foundation (T-10.1.1 + Phase 10.2) FIRST, then re-home the #136 weight-log onto `POST /trainers/me/clients/:clientId/measurements` via the shared helpers + transactional audit write, and repoint the mobile `logClientWeight` adapter (keep the old route as a temporary alias or migrate its single caller). Add the audit-rollback test.

### Not built yet
Audit infra (10.1 table/enum, 10.2 helpers), on-behalf endpoints (10.3 sessions/goals/nutrition-target/workout-assignments), programs (10.4/10.12), notes endpoints (10.5), dedicated recent-activity endpoint (10.6 — currently folded into the overview aggregate), **Client Detail screen (10.9.3 — still the `ComingSoon` stub)**, on-behalf sheets (10.11), athlete-side attribution badges (10.14), AI-summary stub (10.13.3).

### Recommended order for the next sessions
1. **Audit foundation (10.1 + 10.2)** — `trainer_actions_audit` + `action_type_enum`, `assertTrainerCanActForClient` + `auditTrainerAction` helpers + tests. Everything on-behalf depends on it.
2. **Reconcile #136 (R-1 above).**
3. **Client Detail read-only v1** — per `specs/milestones/M8-coach/CLIENT_DETAIL_BRIEF.md`: `GET /trainers/me/clients/:clientId` + replace the `clients/[id]` stub. Formally introduces `assertTrainerCanActForClient`. (Spec/design call this a "5-tab strip"; the prototype + brief are a single-scroll screen — fix that wording when 10.9.3 lands.)

---

## Phase 10.1 — Database migrations (1 PR)

- [ ] **T-10.1.1** Migration: `action_type_enum` + `trainer_actions_audit` table per cross-cuts § 1.4.
- [ ] **T-10.1.2** Migration: `programs`, `program_weeks`, `program_days`, `program_assignments` tables per `design.md § Backend programs`.
- [ ] **T-10.1.3** Migration: `trainer_client_notes` table per `design.md § Backend notes`.
- [ ] **T-10.1.4** Verify `workout_sessions.logged_by_user_id` + `body_measurements.logged_by_user_id` already exist (added by `06-progress-goals` T-06.1.5).
- [ ] **T-10.1.5** All migrations idempotent + forward/back safe.

## Phase 10.2 — Backend helpers (1 PR)

- [ ] **T-10.2.1** Author `assertTrainerCanActForClient` helper in `application/relationships/` per cross-cuts § 1.3. Implements STORY-004 + 007 + 008 + 009 AC re: 403 on missing relationship.
- [ ] **T-10.2.2** Author `auditTrainerAction` helper per cross-cuts § 1.4.2. Inside-transaction enforcement.
- [ ] **T-10.2.3** Unit tests for both helpers.

## Phase 10.3 — On-behalf endpoints (1 PR)

- [ ] **T-10.3.1** `POST /trainers/me/clients/:clientId/sessions` per cross-cuts § 1.2 + STORY-004 ACs.
- [ ] **T-10.3.2** `GET /trainers/me/clients/:clientId/sessions` (parity GET per cross-cuts § 1.2 locked decision).
- [ ] **T-10.3.3** `POST /trainers/me/clients/:clientId/measurements` per STORY-009.
- [ ] **T-10.3.4** `GET /trainers/me/clients/:clientId/measurements`.
- [ ] **T-10.3.5** `POST /trainers/me/clients/:clientId/goals` per STORY-007 + cross-cuts § 2.
- [ ] **T-10.3.6** `GET /trainers/me/clients/:clientId/goals`.
- [ ] **T-10.3.7** `PUT /trainers/me/clients/:clientId/goals/:id` (edit own assignment per cross-cuts § 2.2).
- [ ] **T-10.3.8** `PUT /trainers/me/clients/:clientId/nutrition/target` per STORY-008.
- [ ] **T-10.3.9** `POST /trainers/me/clients/:clientId/workout-assignments` per STORY-006.
- [ ] **T-10.3.10** Every handler writes audit row inside the same transaction per cross-cuts § 1.4.2.
- [ ] **T-10.3.11** Unit + integration tests for every endpoint — happy path, 403 missing relationship, 403 wrong role, audit row written, audit roll-back on row failure.

## Phase 10.4 — Programs endpoints (1 PR)

- [ ] **T-10.4.1** `GET /trainers/me/programs`. Implements STORY-010 AC 10.6.
- [ ] **T-10.4.2** `POST /trainers/me/programs` (create).
- [ ] **T-10.4.3** `GET /trainers/me/programs/:id`, `PUT /trainers/me/programs/:id`, `DELETE /trainers/me/programs/:id`.
- [ ] **T-10.4.4** `POST /trainers/me/programs/:id/days` (bulk-upsert week/day structure).
- [ ] **T-10.4.5** `POST /trainers/me/programs/:id/assign` (assign program to client).
- [ ] **T-10.4.6** Ownership checks on every read + write (trainer can only access programs they authored).
- [ ] **T-10.4.7** Unit + integration tests.

## Phase 10.5 — Notes endpoints (1 PR)

- [ ] **T-10.5.1** `GET /trainers/me/clients/:clientId/notes`. Implements STORY-011 ACs.
- [ ] **T-10.5.2** `POST /trainers/me/clients/:clientId/notes` — writes audit `client_note_added`.
- [ ] **T-10.5.3** `PUT /trainers/me/clients/:clientId/notes/:noteId` — writes audit `client_note_updated`.
- [ ] **T-10.5.4** `DELETE /trainers/me/clients/:clientId/notes/:noteId` — writes audit `client_note_deleted`.
- [ ] **T-10.5.5** Visibility: every read filters by `trainer_id = self.id`. Integration test covers the leak path.

## Phase 10.6 — Recent activity feed (1 PR)

- [ ] **T-10.6.1** `GET /trainers/me/recent-activity` aggregates last 20 events across the trainer's clients per `design.md § Backend recent activity feed`.
- [ ] **T-10.6.2** Unit tests cover the aggregation logic.

## Phase 10.7 — Frontend domain + adapters (1 PR)

- [ ] **T-10.7.1** Domain models: `Program`, `ProgramAssignment`, `TrainerNote`, `TrainerActionAudit`, `Client`, `ClientHealthBreakdown`, `BusinessStats`, `RecentActivityEvent`.
- [ ] **T-10.7.2** Port extensions for all new endpoints.
- [ ] **T-10.7.3** API adapter implementations.
- [ ] **T-10.7.4** SQLite cache repositories for offline reads.

## Phase 10.8 — Frontend hooks (1 PR)

- [ ] **T-10.8.1** `useTrainerClients`, `useTrainerClient(id)`, `useTrainerPrograms`, `useTrainerProgram(id)`, `useTrainerNotes(clientId)`, `useTrainerRecentActivity`, `useTrainerBusinessStats`.
- [ ] **T-10.8.2** Mutations: `useStartClientSession`, `useLogClientMeasurement`, `useAssignClientGoal`, `useSetClientNutritionTarget`, `useAssignClientWorkout`, `useCreateProgram`, `useUpdateProgram`, `useAddTrainerNote`, `useAddClient` (invite).
- [ ] **T-10.8.3** Tests.

## Phase 10.9 — Coach Home + Clients list + Client detail (1 PR — large)

- [ ] **T-10.9.1** `<CoachHomePresenter>` + sub-presenters per `coach.jsx:12–48` + `design.md`. Implements STORY-001.
- [ ] **T-10.9.2** `<ClientsListPresenter>` per `extra.jsx:190–241`. Implements STORY-002.
- [ ] **T-10.9.3** `<ClientDetailPresenter>` per `client-detail.jsx`. 5-tab strip. Implements STORY-003.
- [ ] **T-10.9.4** Mode-branching at `(app)/(tabs)/index.tsx` — `<HomeContainer>` (athlete) | `<CoachHomeContainer>` (coach). Implements `design.md § Mode-aware screen branching`.

## Phase 10.10 — On-behalf flow integration with active session (1 PR)

- [ ] **T-10.10.1** Trainer "Log session for client" CTA in Client Detail → Workouts tab. Implements STORY-004 ACs.
- [ ] **T-10.10.2** `useStartClientSession({ workoutId, clientId, retroactive })` resolves to `POST /trainers/me/clients/:clientId/sessions`.
- [ ] **T-10.10.3** Updates `useActiveWorkout` Zustand slice with `withClient` + `retroactive`. Trainer banner renders per `05-active-session` STORY-004.

## Phase 10.11 — On-behalf sheets (1 PR each: AddClient / AssignWorkout / AssignGoal / EditTargets / AddNote)

- [ ] **T-10.11.1** `<AddClientSheetPresenter>` + container. Implements STORY-005.
- [ ] **T-10.11.2** `<AssignWorkoutSheetPresenter>` + container. Implements STORY-006.
- [ ] **T-10.11.3** `<AssignGoalSheetPresenter>` + container. Implements STORY-007.
- [ ] **T-10.11.4** `<EditNutritionTargetsSheetPresenter>` + container — composes the form from `13-nutrition-tracking` Fuel Targets. Implements STORY-008.
- [ ] **T-10.11.5** `<AddNoteSheetPresenter>` + container. Implements STORY-011.

## Phase 10.12 — Programs list + editor (1 PR)

- [ ] **T-10.12.1** `<ProgramsListPresenter>` per `coach.jsx ProgramsScreen` + `extra.jsx:290–328`. Implements STORY-010 AC 10.1–10.4.
- [ ] **T-10.12.2** `<ProgramEditorPresenter>` per design.md. Week-by-week list editing v1.
- [ ] **T-10.12.3** Routes `(app)/programs/create.tsx` + `(app)/programs/[id].tsx`.
- [ ] **T-10.12.4** Drag-drop reorder deferred to follow-up.

## Phase 10.13 — Coach You + AI summary stub (1 PR)

- [ ] **T-10.13.1** `<CoachYouPresenter>` per `coach.jsx:12–48` (Coach You uses similar layout to Coach Home but emphasises own training). Implements STORY-012.
- [ ] **T-10.13.2** Mode-branching at `(app)/(tabs)/you.tsx`.
- [ ] **T-10.13.3** `<AISummaryCardPresenter>` stub — shows "AI summary coming soon" placeholder. Implements STORY-014 AC 14.1 + 14.2.

## Phase 10.14 — Athlete-side attribution badges (1 PR)

- [ ] **T-10.14.1** Session detail badge "Logged by Coach {name} on {date}" when `logged_by_user_id IS NOT NULL`. Implements STORY-013 AC 13.1.
- [ ] **T-10.14.2** Goal card badge "Goal set by Coach {name}" per AC 13.2.
- [ ] **T-10.14.3** Nutrition target card badge per AC 13.3 (lands when M9 ships).
- [ ] **T-10.14.4** Measurement row badge in body-trend per AC 13.4.

## Phase 10.15 — Cleanup + verification

- [ ] **T-10.15.1** Run `01-design-system § Codemod` against new files.
- [ ] **T-10.15.2** `bun run typecheck`, `bun run lint`, `bun run build`, `bun run test:unit` — all green.
- [ ] **T-10.15.3** 90% coverage on new application + handler code. Audit log code at 95%+ (high-stakes).
- [ ] **T-10.15.4** Manual e2e:
  - Trainer flow: switch mode → Coach Home → Clients → pick client → log session on behalf → assert audit row in DB → switch back to athlete.
  - Athlete flow: log in as that client → see session in history with "Logged by Coach Bradley" attribution.
  - Trainer notes: add → edit → delete → assert client cannot see notes via any read endpoint.
  - Programs: create → assign to client → assert client sees program in Assigned section.

---

## Acceptance gate (trainer features phase complete)

- [ ] All 15 phases shipped as PRs in dependency order (migrations → helpers → endpoints → frontend hooks → screens).
- [ ] Cross-cuts § 1, 2, 4, 5 fully implemented.
- [ ] Audit log writes are transactional + tested for roll-back.
- [ ] Client never sees trainer notes.
- [ ] Attribution badges visible on athlete side for all on-behalf actions.
- [ ] Coach mode end-to-end works.

---

_End of `10-trainer-features/tasks.md` · 2026-05-27 (rewritten from scratch)_
