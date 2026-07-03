# 19 — Programs: Tasks

> **Authored 2026-07-03.** Pairs with `requirements.md` + `design.md`.
> Supersedes spec-10 Phases 10.4/10.12. Execution follows the milestone-brief
> pattern: a `specs/milestones/` brief scopes each PR; backend lands before
> mobile. Every backend PR runs the full gate (`prettier:check`, `typecheck`,
> `lint`, `build`, `test:unit` ≥ 90% on changed files); mobile PRs run the
> mobile gate from repo root.

---

## Phase 19.1 — Schema + repositories (backend PR 1)

- [ ] **T-19.1.1** Migration per `design.md § Schema`: reshape
      `workout_programs` (rename `total_weeks`→`duration_weeks` nullable, add
      `days_per_week`), drop + recreate `program_workouts` flat, drop
      `program_weeks`, create `program_assignments`, extend `workout_assignments`
      (`program_assignment_id`, `occurrence_index`, `show_in_plan`,
      `show_in_library`, partial unique + indexes). Idempotent; timestamped after
      the newest applied migration **at authoring time** (parallel Fuel agent also
      lands migrations).
- [ ] **T-19.1.2** `schema.ts` mirror + derived types; remove `programWeeks`
      exports; fix type exports (`ProgramAssignment`, etc.).
- [ ] **T-19.1.3** `scheduling.ts` pure functions (dayOffset spread, cycle
      mapping, finite occurrence expansion, horizon top-up window) + exhaustive
      unit tests (d = 1..7, cycle shorter/longer than a week, indefinite horizon
      boundaries).
- [ ] **T-19.1.4** `programRepository` — CRUD + atomic structure replace,
      `trainerId` first param, ownership folded into WHERE (404 semantics),
      workout-readability validation (422).
- [ ] **T-19.1.5** `programAssignmentRepository` — assign (tx: insert +
      materialise), `ensureMaterialized` (idempotent, ON CONFLICT DO NOTHING),
      unassign (skip + prune future), `getActiveProgrammeForClient`,
      live-uniqueness (409 mapping).
- [ ] **T-19.1.6** Two-user isolation tests: trainer A cannot read/write
      trainer B's programmes; client A never sees client B's assignments; jointly
      coached client scoping (trainer filter) on all new aggregates.

## Phase 19.2 — Endpoints + integration (backend PR 2)

- [ ] **T-19.2.1** Programme CRUD handlers (`GET/POST /trainers/me/programs`,
      `GET/PUT/DELETE …/:id`) — thin, `t.Object` validation, trainer role guard.
- [ ] **T-19.2.2** Assign/unassign handlers + relationship guard (copy
      `trainersLogClientMeasurementHandler` inline guard; swap to
      `assertTrainerCanActForClient` if spec-10 Phase 10.2 has landed — check at
      build time). 403 wrong-role tests, 409 double-assign test, 422 empty
      programme test.
- [ ] **T-19.2.3** Ad-hoc workout-assignment endpoints (STORY-006) — same
      guards.
- [ ] **T-19.2.4** Completion linking in `POST /sessions/record` (same tx;
      retry-idempotent no-op guard; parent assignment `assigned→started→completed`
      transitions; finite-programme final-occurrence test).
- [ ] **T-19.2.5** Rewrite `trainerRepository.getProgramStats` onto
      `program_assignments` (payload shape unchanged — snapshot test against the
      existing `CoachOverview` contract).
- [ ] **T-19.2.6** `trainersClientsListHandler`: populate `programLabel`
      (`Wk N / M` finite, `Wk N` indefinite) + "Programme ends ≤ 14d" count.
- [ ] **T-19.2.7** `dashboardRepository`: `activeProgramme` summary +
      due-date-ordered, `show_in_plan`-filtered assigned section + indefinite
      top-up call.
- [ ] **T-19.2.8** `workoutRepository`: `type=assigned` → `show_in_library`
      filter + dedupe; `canRead` assignment-existence check (private assigned
      workout readable by its client — regression test both directions).
- [ ] **T-19.2.9** Audit rows for assign/unassign/ad-hoc **iff**
      `trainer_actions_audit` exists by build time; else file the follow-up task
      in spec-10 tasks and note in PR description.

## Phase 19.3 — Mobile coach surfaces (mobile PR 1)

- [ ] **T-19.3.1** API port methods + zod-validated adapters + commands
      (`create-program`, `update-program`, `delete-program`, `assign-program`,
      `unassign-program`, `assign-workout` per `create-workout.command.ts` shape,
      local-id reconciliation on programme create).
- [ ] **T-19.3.2** `ProgramsListContainer`/`Presenter` — ProgramsScreenV2 port
      (search, chips, derived ACTIVE/DRAFT, accent cycling, ONGOING pill, dashed
      CTA). Replaces the `(tabs)/programs.tsx` ComingSoon stub.
- [ ] **T-19.3.3** `ProgramEditorContainer`/`Presenter` + `create.tsx`/`[id].tsx`
      routes — metadata (Fixed weeks | Ongoing segment, days/wk stepper), ordered
      list add/remove/up-down, "changes apply to future weeks" copy, ref-guarded
      one-shot seeding effect, mode gate (non-coach → redirect).
- [ ] **T-19.3.4** `AssignProgramSheet` — root-mounted, zustand store, client
      picker + start date + the two visibility toggles.
- [ ] **T-19.3.5** Client Detail: `ProgrammeCard` (Week N / M bar; indefinite
      variant) + assign CTA + ad-hoc "Assign workout" sheet (minimal v1).
- [ ] **T-19.3.6** Presenter/container tests: rendering, interactions,
      API mocking, empty/indefinite/draft states.

## Phase 19.4 — Mobile athlete surfaces (mobile PR 2)

- [ ] **T-19.4.1** Dashboard model + adapter: `activeProgramme`; Home "Your
      programme" card (athlete-accent ProgrammeCard; hidden when null).
- [ ] **T-19.4.2** Home assigned section → "Today's training" (due-ordered;
      attribution badge preserved; presenter structure otherwise unchanged).
- [ ] **T-19.4.3** Verify Train tab MY WORKOUTS dedupe/filter end-to-end
      against the new server behaviour (no mobile code change expected — test
      only).
- [ ] **T-19.4.4** Tests incl. offline: cached plan renders, queued assign
      flush reconciliation.

## Phase 19.5 — Milestone wrap

- [ ] **T-19.5.1** `specs/milestones/M13-programs/` brief set (BRIEF /
      BACKEND_BRIEF / FRONTEND_BRIEF / SMOKE_TEST) authored from this spec before
      build starts.
- [ ] **T-19.5.2** E2E smoke: coach creates programme (finite + indefinite) →
      assigns → client sees plan card + today's workout → completes session →
      adherence % + programLabel + programme-ends + programStats all populate →
      unassign prunes future only.
- [ ] **T-19.5.3** Spec-10 back-pointers (STORY-010 / design § programs /
      tasks 10.4/10.12 marked superseded by this spec) — done in the spec PR.
