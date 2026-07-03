# M13 — Programs (unified model)

> Milestone brief for `specs/19-programs/` (merged PR #148). Spec is
> authoritative; this brief scopes execution. Decisions D1–D6 are locked
> (Brad, 2026-07-03) — do not re-litigate (see spec design.md § Decision
> record).

## Shippable slice

A coach authors a programme (flat ordered cycle of workouts; fixed-weeks or
**indefinite**), assigns it to a client, and the client's schedule
materialises as `workout_assignments` rows — lighting up the already-shipped
adherence %, MISSED flags, ClientsList `programLabel` / "Programme ends",
Coach You programme stats, Home dashboard, and `type=assigned` library with
zero new read paths. Client sees a "Your programme" card + "Today's training"
on Home. Ad-hoc single-workout assignment ships alongside.

## PR plan (in order, each off fresh main)

| PR  | Scope                                                                                                                                                                                                                                     | Brief               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| B1  | Phase 19.1 — migration + schema.ts + `scheduling.ts` + `programRepository` + `programAssignmentRepository` + `getProgramStats` rewrite (compilation-coupled to the schema change) + tests                                                 | `BACKEND_BRIEF.md`  |
| B2  | Phase 19.2 — endpoints (programme CRUD, assign/unassign, ad-hoc), completion linking in `/sessions/record`, ClientsList `programLabel`/programme-ends, dashboard `activeProgramme` + due-ordering, `type=assigned` filter + `canRead` fix | `BACKEND_BRIEF.md`  |
| F1  | Phase 19.3 — coach surfaces: Programs tab (ProgramsScreenV2), editor routes, AssignProgramSheet, Client Detail ProgrammeCard + ad-hoc assign sheet                                                                                        | `FRONTEND_BRIEF.md` |
| F2  | Phase 19.4 — athlete surfaces: Home "Your programme" card + "Today's training" section                                                                                                                                                    | `FRONTEND_BRIEF.md` |

Milestone exit gate: `SMOKE_TEST.md` passes end-to-end on device.

## Cross-agent constraints

- Fuel AI-Snap agent runs in parallel and owns everything nutrition
  (`nutrition_*`, foods, recipes, meals, water, Fuel tab, `/nutrition/*`) —
  OFF LIMITS here. It also lands migrations: re-check `supabase/migrations/`
  newest file immediately before authoring; timestamp strictly after.
- Spec-10 audit foundation (`trainer_actions_audit`,
  `assertTrainerCanActForClient`) is NOT built — use the inline
  `pt_client_relationships` guard (status `active`, `is_ai_trainer = false`);
  audit rows are a conditional task (T-19.2.9).
