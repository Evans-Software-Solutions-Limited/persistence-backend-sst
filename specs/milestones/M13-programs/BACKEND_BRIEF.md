# M13 — Backend brief (PRs B1 + B2)

> Execute `specs/19-programs/tasks.md` Phases 19.1–19.2. Design DDL +
> materialisation algorithm + authz matrix live in
> `specs/19-programs/design.md` — follow them exactly.

## PR B1 — schema + repositories (Phase 19.1)

**Migration** `supabase/migrations/<ts>_programs_unified_model.sql` — truly
idempotent (re-run must not destroy data written after first run):

- Rename `workout_programs.total_weeks` → `duration_weeks` (guarded on the
  old column existing), DROP NOT NULL, add `days_per_week` (default 3,
  CHECK 1–7, guarded).
- Drop old-shape `program_workouts` **only when it still has
  `program_week_id`** (information_schema guard), drop `program_weeks`,
  create flat `program_workouts` (`program_id, workout_id, position`, unique
  `(program_id, position)`).
- Create `program_assignments` per design DDL (partial live-unique index).
- Extend `workout_assignments` (`program_assignment_id`, `occurrence_index`,
  `show_in_plan`, `show_in_library`, partial unique occurrence index,
  `(client_id, due_date)` index).
- RLS: the drops removed the old `program_weeks`/`program_workouts` policies —
  recreate on the new `program_workouts` (manage own via programme creator;
  view own-or-public) and add for `program_assignments` (client or
  assigner can SELECT; assigner manages). `workout_programs` /
  `workout_assignments` policies unchanged.

**Code**

- `schema.ts`: mirror; delete `programWeeks`; derived types
  (`ProgramAssignment`, `NewProgramAssignment`); dates as `text` columns
  (house style, cf. `workoutAssignments.assignedDate`).
- `application/programs/scheduling.ts` — pure: `dayOffset`, `addDays`,
  `endDateFor`, `currentWeek`, `buildOccurrences` (finite range + horizon
  modes, cycle repeats via `k mod len`). No `Date.now()` defaults — callers
  pass `now`.
- `repositories/programRepository.ts` — list (with counts), get, create,
  update (atomic structure replace), delete (`has_live_assignments` result),
  workout-readability validation (own-or-public). `trainerId` first param;
  ownership folded into WHERE (404 semantics at the handler).
- `repositories/programAssignmentRepository.ts` — assign (tx: pre-check live
  - insert + materialise; `empty_program` guard), unassign (skip + prune
    future `assigned` rows), `ensureMaterializedForClient` (indefinite top-up,
    `onConflictDoNothing`), `getActiveProgrammeForClient`.
- `trainerRepository.getProgramStats` rewrite onto `program_assignments`
  (same `CoachOverview["programStats"]` shape, same 2-query structure,
  clientIds-empty short-circuit preserved).

**Tests** — house mock style (`getDb` thenable-builder queue); ≥90% on
changed files; two-user isolation cases per T-19.1.6; scheduling
exhaustive (d = 1..7, cycle ≠ week length, horizon boundaries, indefinite).

## PR B2 — endpoints + integration (Phase 19.2)

- Handlers under `application/programs/` (one file per route, Elysia +
  `t.Object`, registered in `api.ts`): programme CRUD, assign, unassign,
  ad-hoc workout-assignment create/delete.
- Role gate: `TrainerRepository.isTrainer` (as overview handler);
  relationship guard: inline `pt_client_relationships` check (copy
  `trainersLogClientMeasurementHandler`).
- `ProgramService` decorating both repositories.
- Completion linking in `sessions/record` (same tx, retry-idempotent,
  parent status transitions per design § Materialisation).
- `trainersClientsListHandler`: `programLabel` + programme-ends count.
- `dashboardRepository`: `activeProgramme` + due-ordered
  `show_in_plan`-filtered assigned section + indefinite top-up call.
- `workoutRepository`: `type=assigned` → `show_in_library` + dedupe;
  `canRead` assignment-existence check.
- Error-code contract: 403 `not_your_client` / not-trainer, 404 unknown or
  un-owned programme, 409 `PROGRAM_HAS_LIVE_ASSIGNMENTS` / double-assign,
  422 `PROGRAM_EMPTY` / unreadable workouts.

Gate for both PRs: `bun run prettier:check && bun run typecheck && bun run
lint && bun run build && bun run test:unit`.
