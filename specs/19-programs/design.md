# 19 — Programs: Design

> **Authored 2026-07-03.** Pairs with `requirements.md`. Supersedes
> `specs/10-trainer-features/design.md § Backend — programs` (which chose to
> keep the week-structured tables — reversed here per decision D1).

---

## Decision record (Brad sign-off, 2026-07-03)

Phase-0 audit facts the design rests on:

- `workout_programs`, `program_weeks`, `program_workouts`,
  `workout_assignments` are **all empty in prod** → reshape freely, no data
  migration.
- **Nothing writes `workout_assignments`** anywhere (V2 backend, legacy mobile,
  legacy edge functions) — but three read surfaces are live: adherence/missed
  (`trainerRepository.ts:451,633`), athlete library (`workoutRepository.ts:295`
  → `GET /workouts?type=assigned`), Home dashboard (`dashboardRepository.ts:459`).
- Legacy mobile has no programs UI → no port-fidelity constraint; prototype
  wins on visuals.

| #   | Decision (approved)                                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Flatten: programme = ordered cycle of workouts; `program_weeks` dropped; `duration_weeks` **nullable (NULL = indefinite)** + `days_per_week` metadata. Week visuals derived, never structural. |
| D2  | `workout_assignments` = the one per-occurrence table. Programme assignment **materialises** into it; ad-hoc assignment coexists. All existing readers work unchanged.                          |
| D3  | `show_in_plan` + `show_in_library` booleans on assignment rows; `workout_visibility` enum untouched (owner-side sharing only).                                                                 |
| D4  | `program_assignments` carries `start_date` / `end_date` (stored at assign; NULL when indefinite) / `status` (reuses `assignment_status`). Completion flows through `completed_session_id`.     |
| D5  | Athlete: no new tab; "Your programme" card + schedule-aware Home section.                                                                                                                      |
| D6  | Coach: Programs tab list + create/`[id]` editor + assign flows; ACTIVE/DRAFT derived.                                                                                                          |

---

## Schema

One idempotent migration (`supabase/migrations/` — **timestamp strictly after
the newest applied file at PR time**; the Fuel AI-Snap agent lands migrations in
parallel, so check immediately before authoring).

### 1. Reshape `workout_programs` (empty table — in-place ALTER is safe)

```sql
ALTER TABLE workout_programs RENAME COLUMN total_weeks TO duration_weeks;
ALTER TABLE workout_programs ALTER COLUMN duration_weeks DROP NOT NULL;   -- NULL = indefinite
ALTER TABLE workout_programs ADD COLUMN IF NOT EXISTS days_per_week integer NOT NULL DEFAULT 3
  CHECK (days_per_week BETWEEN 1 AND 7);
-- created_by, is_public, description, timestamps unchanged. is_public stays dormant in v1.
```

### 2. Flatten `program_workouts`, drop `program_weeks`

```sql
DROP TABLE IF EXISTS program_workouts;   -- empty; FK'd to program_weeks so drop first
DROP TABLE IF EXISTS program_weeks;

CREATE TABLE program_workouts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id  uuid NOT NULL REFERENCES workout_programs(id) ON DELETE CASCADE,
  workout_id  uuid NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  position    integer NOT NULL,                    -- 0-based order within the cycle
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX program_workouts_program_position_uq
  ON program_workouts (program_id, position);
-- No UNIQUE (program_id, workout_id): the same workout may repeat in a cycle.
-- Structure replace = DELETE WHERE program_id + bulk INSERT in one tx, so the
-- position-unique index never fights an in-place reorder.
```

### 3. New `program_assignments`

```sql
CREATE TABLE program_assignments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id       uuid NOT NULL REFERENCES workout_programs(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assigned_by      uuid NOT NULL REFERENCES profiles(id),      -- the coach
  start_date       date NOT NULL,
  end_date         date,                                       -- start + duration_weeks*7 - 1; NULL = indefinite
  status           assignment_status NOT NULL DEFAULT 'assigned',
  show_in_plan     boolean NOT NULL DEFAULT true,              -- defaults copied onto occurrences
  show_in_library  boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- one LIVE assignment per (programme, client); terminal history rows may accumulate
CREATE UNIQUE INDEX program_assignments_live_uq
  ON program_assignments (program_id, client_id)
  WHERE status IN ('assigned', 'started');
CREATE INDEX program_assignments_client_status_idx ON program_assignments (client_id, status);
CREATE INDEX program_assignments_assigned_by_idx   ON program_assignments (assigned_by);
```

`assignment_status` (existing enum, reused — no new values): `assigned` (live,
nothing completed yet) → `started` (first occurrence completed) → `completed`
(finite: all occurrences terminal or `end_date` passed) | `skipped` (unassigned).

### 4. Extend `workout_assignments`

```sql
ALTER TABLE workout_assignments
  ADD COLUMN IF NOT EXISTS program_assignment_id uuid
    REFERENCES program_assignments(id) ON DELETE CASCADE,      -- NULL = ad-hoc
  ADD COLUMN IF NOT EXISTS occurrence_index integer,           -- 0-based; NULL for ad-hoc
  ADD COLUMN IF NOT EXISTS show_in_plan boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_in_library boolean NOT NULL DEFAULT true;

-- materialisation idempotency: an occurrence exists at most once
CREATE UNIQUE INDEX IF NOT EXISTS workout_assignments_pa_occurrence_uq
  ON workout_assignments (program_assignment_id, occurrence_index)
  WHERE program_assignment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS workout_assignments_client_due_idx
  ON workout_assignments (client_id, due_date);
```

Existing columns unchanged: `trainer_id` (= `assigned_by`), `client_id`,
`workout_id`, `assigned_date`, `due_date`, `status`, `completed_session_id`,
`trainer_notes`. Adherence/missed/dashboard queries keep working verbatim.

Drizzle `schema.ts` mirrors all of the above; enum types derived
(`(typeof assignmentStatusEnum.enumValues)[number]` — memory rule 6).

---

## Materialisation

Assigning a programme turns the ordered cycle into dated occurrences.

**Scheduling function** (pure, unit-tested in isolation):

```
occurrence k (0-based), daysPerWeek d, cycle c = programWorkouts ordered by position:
  week(k)      = floor(k / d)
  slot(k)      = k mod d
  dayOffset(k) = week(k) * 7 + round(slot(k) * 7 / d)   -- spreads d sessions across the week
  due_date(k)  = start_date + dayOffset(k)
  workout(k)   = c[k mod len(c)]                         -- cycle repeats
```

**Finite programme** (`duration_weeks` set): materialise all
`duration_weeks × days_per_week` occurrences at assign time, in the same
transaction as the `program_assignments` insert. Bounded: 52 wks × 7/d = 364
rows worst-case — fine for one Neon HTTP batch insert.

**Indefinite programme** (`duration_weeks IS NULL`): materialise a rolling
horizon of **28 days** at assign time, then top up via
`ensureMaterialized(programAssignmentId, horizon = today + 28d)`:

- computes the next `occurrence_index` from `max(occurrence_index)`, inserts
  missing occurrences with `due_date <= horizon`;
- idempotent under races via the partial unique index
  (`ON CONFLICT DO NOTHING`);
- invoked server-side from the two client read paths (Home dashboard payload,
  `GET /workouts?type=assigned`) — **no cron**; a client who never opens the
  app doesn't need future rows, and a coach viewing adherence only needs
  past-due rows, which always exist.
- Top-up reads the **current** programme structure — this is how D1's
  "edits affect future materialisation only" policy falls out for free.

**Empty-cycle guard:** a programme with 0 workouts can be assigned only as a
draft — `POST /assign` returns 422 `PROGRAM_EMPTY`.

**Unassign:** mark assignment `skipped`, delete future untouched occurrences
(`due_date > today AND status = 'assigned' AND program_assignment_id = :id`).
History (completed/skipped/past-due) is preserved so adherence stays honest.

**Completion linking** (in `POST /sessions/record`, same tx as session insert):
after recording a completed session, find the earliest open occurrence for
`(client_id = userId, workout_id = session.workoutId, status IN ('assigned','started'))`
ordered by `due_date NULLS LAST` and mark it
`status = 'completed', completed_session_id = session.id`. Zero matches = plain
unassigned session, no-op. Also promote the parent `program_assignments` row
`assigned → started` on first completion, and → `completed` when it was the
final occurrence of a finite programme. NOTE: `/sessions/record` retry
idempotency is a known P0 gap (memory: sync-architecture audit) — the linking
UPDATE must be a no-op when the occurrence is already completed, so retries
don't double-link.

---

## API

All routes: Elysia, thin handlers, `t.Object` validation, `requireAuth` →
`getUser(ctx)`. Trainer routes additionally require the trainer role guard
(same as `/trainers/me/overview`).

| Method | Path                                                     | Notes                                                                                                                       |
| ------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/trainers/me/programs`                                  | List + `activeClientCount`, `workoutCount`, derived `isActive`                                                              |
| POST   | `/trainers/me/programs`                                  | `{ name, description?, durationWeeks: number\|null, daysPerWeek, workoutIds: string[] }`                                    |
| GET    | `/trainers/me/programs/:id`                              | Detail: metadata + ordered workouts (id, name, split badge fields) + assignments (client, startDate, endDate, week, status) |
| PUT    | `/trainers/me/programs/:id`                              | Metadata + full `workoutIds` replace (one tx)                                                                               |
| DELETE | `/trainers/me/programs/:id`                              | 409 `PROGRAM_HAS_LIVE_ASSIGNMENTS` while live assignments exist                                                             |
| POST   | `/trainers/me/programs/:id/assign`                       | `{ clientId, startDate, showInPlan?, showInLibrary? }` → assignment + materialisation (one tx)                              |
| DELETE | `/trainers/me/programs/:id/assignments/:assignmentId`    | Unassign (skip + prune future)                                                                                              |
| POST   | `/trainers/me/clients/:clientId/workout-assignments`     | Ad-hoc: `{ workoutId, dueDate?, showInPlan?, showInLibrary?, trainerNotes? }`                                               |
| DELETE | `/trainers/me/clients/:clientId/workout-assignments/:id` | Ad-hoc unassign (409 unless still `assigned`)                                                                               |

Athlete-side: **no new endpoint for the plan card v1** — the Home dashboard
aggregate (`dashboardRepository`) gains `activeProgramme: { name, week,
totalWeeks: number|null, endDate: string|null } | null` and its assigned-workouts
section becomes due-date-ordered + `show_in_plan`-filtered. `GET
/workouts?type=assigned` adds the `show_in_library` filter + dedupe by
`workout_id`.

### Authorization matrix

| Action                     | Check                                                                                                                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Programme CRUD             | JWT role is trainer/physio + `workout_programs.created_by = userId` (wrong owner → 404)                                                                                                                                                  |
| Assign / unassign / ad-hoc | Above + active relationship: `pt_client_relationships.status = 'active' AND is_ai_trainer = false` — copy the guard in `trainersLogClientMeasurementHandler.ts`; migrate to `assertTrainerCanActForClient` when spec-10 Phase 10.2 lands |
| Workout referenced         | `created_by = trainerId OR visibility = 'public'` at structure-write and ad-hoc-assign time (422 otherwise)                                                                                                                              |
| Client plan reads          | `client_id = userId` from JWT on every query — no cross-client reads                                                                                                                                                                     |
| Assigned-workout detail    | `canRead` (workoutRepository) gains: `EXISTS (workout_assignments WHERE workout_id = :id AND client_id = :userId)`                                                                                                                       |
| Audit (cross-cuts § 1.4)   | Dependency: `trainer_actions_audit` doesn't exist yet (spec-10 T-10.1.1). If it exists at build time, assign/unassign/ad-hoc write audit rows transactionally; else tracked follow-up — noted in PR                                      |

### Repository layout

`microservices/core/src/application/programs/` — new module mirroring
`trainers/`:

- `repositories/programRepository.ts` — programme CRUD + structure replace
  (every method takes `trainerId` first).
- `repositories/programAssignmentRepository.ts` — assign/unassign,
  `ensureMaterialized`, occurrence pruning, plan summary
  (`getActiveProgrammeForClient(clientId)`).
- `scheduling.ts` — the pure `dueDates`/cycle functions.
- Handlers one-per-route per house pattern.

Touched existing code: `trainerRepository.getProgramStats` (rewrite to count
via `program_assignments` — payload shape unchanged),
`trainersClientsListHandler` (populate `programLabel` / programme-ends),
`dashboardRepository` (plan card + due-ordering + `show_in_plan`),
`workoutRepository` (`type=assigned` filter + dedupe; `canRead` assignment
check), `sessions/record` (completion linking).

**Testing note (memory: Drizzle GROUP BY bug):** unit suite mocks `getDb`, so
render new aggregate queries via `PgDialect` in tests to catch bind-slot bugs;
group by column refs or ordinals, never a reused parameterised `sql` expr.

---

## Mobile

Container/presenter split throughout; offline-first per house rules (reads =
`useCachedResource`, coach writes = `enqueueMutation` commands shaped like
`create-workout.command.ts`). Materialisation is server-side, so queued
assign commands are safe — occurrences appear on next fetch after flush.

### Coach mode

```
app/(app)/(tabs)/programs.tsx          ← replaces ComingSoon → ProgramsListContainer
app/(app)/programs/create.tsx          ← ProgramEditorContainer (create mode)
app/(app)/programs/[id].tsx            ← ProgramEditorContainer (edit mode)
src/ui/containers/ProgramsListContainer.tsx
src/ui/containers/ProgramEditorContainer.tsx
src/ui/presenters/coach/ProgramsListPresenter.tsx    ← ProgramsScreenV2 port
src/ui/presenters/coach/ProgramEditorPresenter.tsx
src/ui/presenters/coach/AssignProgramSheet*.tsx      ← root-mounted (memory: sheets mount at root)
```

- **ProgramsListPresenter** — `ProgramsScreenV2` 1:1: HeaderBar large
  ("Programmes", eyebrow `N ACTIVE · N DRAFTS`), search field, ACTIVE/DRAFTS
  chips, `ProgramRowV2` cards (accent left border cycles
  primary/gold/success/ember by index — client-derived, no backend column),
  dashed "+ New programme". Empty state: "No programmes match those filters".
- **ProgramEditorPresenter** — name, description, duration segment
  (`Fixed weeks` numeric | `Ongoing`), days/wk stepper, ordered workout list
  (add via existing workout-picker pattern; up/down reorder v1; remove;
  duplicates allowed), assignments section (edit mode): client rows + assign
  CTA. Editor state seeded from async container props via **ref-guarded
  one-shot `useEffect` keyed on the loading flag** — never
  `useState(initializer)` (recurring bug class).
- **AssignProgramSheet** — client picker (active clients), start date
  (default today), the two visibility toggles ("Show in training plan",
  "Show in workouts library"), assign CTA. Driven by a zustand open-state
  store, mounted at root `_layout` (sibling of Stack).
- **Client Detail** — `ProgrammeCard` port (client-detail.jsx:564): ACTIVE
  PROGRAMME eyebrow, name, `Week N / M` + segmented progress bar; indefinite →
  `Week N · Ongoing`, no bar. Tap → programme editor. No live programme →
  "Assign programme" CTA slot.
- **ClientsList / Coach You** — no presenter changes; data arrives via
  existing fields (`programLabel`, programme-ends count, programStats).

### Athlete mode

- **Home "Your programme" card** — same `ProgrammeCard` visual, athlete
  accent, fed from the dashboard aggregate; hidden when `activeProgramme`
  null. Placement: above the assigned/today section.
- **Home "Today's training"** — existing assigned-workouts section re-fed by
  due-date-ordered occurrences (label change + ordering only, presenter
  structure preserved).
- **Train tab** — no UI change; `type=assigned` server filter does the work.

### API port additions (`api.port.ts`)

`listPrograms`, `getProgram`, `createProgram`, `updateProgram`,
`deleteProgram`, `assignProgram`, `unassignProgram`, `assignWorkout`,
`unassignWorkout`; dashboard payload extended with `activeProgramme`.
Commands: `create-program.command.ts`, `update-program.command.ts`,
`assign-program.command.ts`, etc., mirroring `create-workout.command.ts`
(local-id reconciliation for programme create).

---

## Risks & mitigations

| Risk                                                                       | Mitigation                                                                                                                   |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Parallel agent lands migrations while this is in flight                    | Re-check `supabase/migrations/` newest file immediately before authoring; timestamp strictly after; rebase on main before PR |
| `/sessions/record` retries double-completing occurrences                   | Linking UPDATE guarded `status IN ('assigned','started')`; idempotent no-op on retry                                         |
| Concurrent indefinite top-ups inserting duplicate occurrences              | Partial unique index + `ON CONFLICT DO NOTHING`                                                                              |
| Coach edits programme → client's already-materialised week looks stale     | v1 policy surfaced in editor copy ("changes apply to future weeks"); retro-regeneration is a non-goal                        |
| Deleting a programme with history                                          | 409 while live assignments exist; terminal assignments cascade via FK when the coach truly deletes                           |
| Mode-switch mid-programme-editor (coach → athlete)                         | `(app)/programs/*` gated like `(app)/clients/*`: `mode !== 'coach'` → redirect to tabs index                                 |
| Offline-queued assign for a client whose relationship was since terminated | Server re-validates the relationship at flush time → 403 → sync-queue failed-mutation surfacing (existing)                   |
