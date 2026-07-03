# 19 — Programs: Requirements

> **Authored 2026-07-03** from the Phase-0 audit + Brad's decision sign-off (see
> `design.md § Decision record`). **Supersedes** `specs/10-trainer-features`
> STORY-010, AC 10.7, and tasks Phases 10.4/10.12 — the table shapes and endpoint
> details there are replaced by this spec. Spec 10 remains authoritative for
> everything else coach-mode (IA, on-behalf, audit, notes).

---

## Overview

A **Program is an ordered collection of workouts** that a coach authors once and
assigns to clients. Assigning a program materialises the client's training
schedule as `workout_assignments` rows, which means every already-shipped
consumer — 28-day adherence %, MISSED flags, Home-dashboard assigned workouts,
`GET /workouts?type=assigned`, Coach You programme stats, ClientsList
`programLabel` / "Programme ends" — lights up without new read paths.

**Unification mandate (Brad, standing):** do NOT build a parallel model. The two
pre-existing half-models are reconciled as follows:

- `workout_programs` / `program_workouts` are **reshaped in place** (flat
  ordered list; `program_weeks` dropped). Safe: all four tables are empty in
  prod (verified 2026-07-03, project `dfeyebgdktfteqlacmru`).
- `workout_assignments` is **kept** as the single per-occurrence assignment
  table. Program assignment writes into it; ad-hoc single-workout assignment
  stays possible alongside (nullable `program_assignment_id` discriminates).

Authoritative visual references (prototype wins on visuals):

1. `~/Downloads/handoff/design-source/screens/coach.jsx` — `ProgramsScreenV2`
   (list: search + ACTIVE/DRAFTS filter + cards), `ProgramStats` (Coach You),
   `ClientsScreenV2` (row subtitle `Strength · Wk 4 / 12`, "Programme ends" chip).
2. `~/Downloads/handoff/design-source/screens/extra.jsx:290–328` —
   `ProgramsScreen` (card anatomy: accent left border, `N WKS` / `N CLIENTS`
   pills, dashed "+ New programme" CTA).
3. `~/Downloads/handoff/design-source/screens/client-detail.jsx:564` —
   `ProgrammeCard` ("ACTIVE PROGRAMME", Week N / M, per-week progress bar).

There is **no athlete plan screen in the prototype** and **no legacy programs
UI** (audit-confirmed) — the athlete surface (STORY-005) is a new design,
approved by Brad as a minimal card reusing the `ProgrammeCard` pattern.

---

## Locked decisions (Brad, 2026-07-03)

| #   | Decision                      | Locked value                                                                                                                                                                                                                                                                  |
| --- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Program shape                 | Flat ordered list (the _cycle_). `program_weeks` dropped. `duration_weeks` **nullable — NULL = indefinite** (e.g. ongoing weight-loss programme). `days_per_week` metadata drives scheduling + "4 days/wk" chrome.                                                            |
| D2  | Fate of `workout_assignments` | Kept as the unified per-occurrence table. Program assignment **materialises** rows into it; ad-hoc single-workout assignment coexists (`program_assignment_id IS NULL`). Home "Your workouts" evolves into schedule-driven "Today's training".                                |
| D3  | Dual visibility flags         | `show_in_plan` + `show_in_library` booleans on **assignment rows** (`workout_assignments` + defaults on `program_assignments`). Existing `workout_visibility` enum untouched — it keeps governing owner-side sharing.                                                         |
| D4  | Assignment lifecycle          | `program_assignments (start_date, end_date, status)`; `end_date = start + duration_weeks` stored at assign time (NULL when indefinite); reuses `assignment_status` enum; completion flows through `workout_assignments.completed_session_id` → existing adherence calc.       |
| D5  | Athlete surface               | No new tab. Assigned occurrences surface via existing Train/Home readers + one new "Your programme" card (ProgrammeCard reuse) on Home. Recommendation engine = non-goal.                                                                                                     |
| D6  | Coach surface                 | Programs tab per `ProgramsScreenV2`; editor at `(app)/programs/create` + `[id]` (up/down reorder v1, drag-drop deferred); assign/unassign from program detail + client detail. ACTIVE/DRAFT derived (active = ≥1 live assignment), no stored status. Coach Home out of scope. |

---

## User stories

### STORY-001: As a coach, I can create and edit a programme

**Acceptance Criteria:**

- 1.1 [ ] `POST /trainers/me/programs` creates a programme with `name`
  (required), `description`, `durationWeeks` (integer ≥ 1 or **null =
  indefinite**), `daysPerWeek` (integer 1–7, required), and an ordered
  `workoutIds[]` (0..n — an empty programme is a valid draft).
- 1.2 [ ] Each `workoutId` must be readable by the coach (authored by them or
  `visibility = 'public'`); otherwise 422. The same workout MAY appear more
  than once in the list (e.g. Push/Pull/Legs/Push).
- 1.3 [ ] `PUT /trainers/me/programs/:id` updates metadata and/or replaces the
  ordered list atomically (delete + insert in one transaction).
- 1.4 [ ] Structure edits affect **future materialisation only** (indefinite
  top-ups + new assignments). Already-materialised occurrences are not
  retro-edited (v1 policy, documented to the coach in the editor).
- 1.5 [ ] `DELETE /trainers/me/programs/:id` returns 409 while ≥1 live
  (`assigned`/`started`) assignment exists; deletable once all assignments are
  terminal.
- 1.6 [ ] Ownership: every read/write checks `created_by = trainerId`. Wrong
  owner → 404 (not 403, no existence leak). Non-trainer role → 403.

### STORY-002: As a coach, I can see my programmes library

**Acceptance Criteria:**

- 2.1 [ ] Coach-mode Programs tab (`(app)/(tabs)/programs.tsx`) replaces the
  ComingSoon stub with `ProgramsScreenV2`: large header ("Programmes", eyebrow
  `N ACTIVE · N DRAFTS`), search, ACTIVE/DRAFTS filter chips, card list,
  dashed "+ New programme" CTA.
- 2.2 [ ] Card anatomy per prototype: accent left border, name, subtle line
  (description), `N WKS` pill (or `ONGOING` when indefinite), `N CLIENT(S)`
  pill when > 0, ACTIVE/DRAFT status pill.
- 2.3 [ ] ACTIVE = ≥1 live assignment; DRAFT otherwise (derived, not stored).
- 2.4 [ ] `GET /trainers/me/programs` returns each programme with
  `activeClientCount` + workout count; list is trainer-scoped.

### STORY-003: As a coach, I can assign / unassign a programme to a client

**Acceptance Criteria:**

- 3.1 [ ] `POST /trainers/me/programs/:id/assign` body
  `{ clientId, startDate, showInPlan?, showInLibrary? }` creates a
  `program_assignments` row and materialises `workout_assignments` occurrences
  (see design § Materialisation).
- 3.2 [ ] Relationship guard: active `pt_client_relationships` row
  (`status = 'active' AND is_ai_trainer = false`) between coach and client,
  else 403 — same guard as `trainersLogClientMeasurementHandler` (or the
  shared `assertTrainerCanActForClient` helper once spec-10 Phase 10.2 lands).
- 3.3 [ ] One live assignment per (programme, client): re-assign while a live
  one exists → 409. Re-assign after a terminal one → allowed (new row).
- 3.4 [ ] Unassign (`DELETE /trainers/me/programs/:id/assignments/:assignmentId`)
  sets the assignment `status = 'skipped'` and deletes future not-started
  occurrences (`due_date > today AND status = 'assigned'`). Completed history
  is preserved.
- 3.5 [ ] Assign/unassign UI: assign-clients section on programme detail +
  assign action from Client Detail. Client rows show start date and Week N
  (of M when finite).
- 3.6 [ ] Audit: once spec-10's `trainer_actions_audit` foundation exists,
  assign/unassign write audit rows per `_shared/cross-cuts.md § 1.4`. If this
  spec builds first, the audit write is a tracked follow-up — do not block.

### STORY-004: As a coach, my existing dashboards light up from assignments

**Acceptance Criteria:**

- 4.1 [ ] `getProgramStats` (Coach You "Programmes in use") is rewritten to
  count distinct live `program_assignments` clients per programme — no more
  3-table week join. Payload shape (`CoachProgramStats`) unchanged.
- 4.2 [ ] ClientsList `programLabel` populates: `"{programme name} · Wk N / M"`
  (finite) / `"{programme name} · Wk N"` (indefinite) from the client's live
  assignment. Null when none (existing rendering already handles null).
- 4.3 [ ] "Programme ends" summary chip counts clients whose live assignment
  has `end_date` within the next 14 days.
- 4.4 [ ] 28d adherence % and MISSED flags work unchanged — they already read
  `workout_assignments` by `due_date`/`status`; materialised occurrences feed
  them with no query changes.
- 4.5 [ ] Client Detail shows `ProgrammeCard` (ACTIVE PROGRAMME, Week N / M +
  progress bar; indefinite → "Week N · Ongoing", no bar denominator).

### STORY-005: As a client, I can see my plan and today's training

**Acceptance Criteria:**

- 5.1 [ ] Home shows a "Your programme" card when a live assignment with
  `show_in_plan = true` exists: programme name, Week N / M (or "Ongoing"),
  progress bar (finite only) — `ProgrammeCard` visual reuse, athlete accent.
- 5.2 [ ] Home's assigned-workouts section becomes schedule-aware: occurrences
  due today (then soonest-upcoming) with `show_in_plan = true`, ordered by
  `due_date`. Trainer attribution badge preserved.
- 5.3 [ ] `GET /workouts?type=assigned` (Train tab "MY WORKOUTS" merge) filters
  to `show_in_library = true` and dedupes repeated workouts.
- 5.4 [ ] Starting an assigned workout and completing the session marks the
  matching open occurrence `completed` + links `completed_session_id`
  (server-side on `POST /sessions/record`; see design § Completion linking).
- 5.5 [ ] A client can read an assigned workout's detail even when it is
  `private` and authored by the coach — `canRead` gains an
  assignment-existence check (closes an audit-found gap: the list grants
  access but the detail read would 404).
- 5.6 [ ] All client reads are scoped `client_id = userId` from JWT; no client
  can read another client's assignments.

### STORY-006: As a coach, I can assign a single ad-hoc workout

**Acceptance Criteria:**

- 6.1 [ ] `POST /trainers/me/clients/:clientId/workout-assignments` body
  `{ workoutId, dueDate?, showInPlan?, showInLibrary?, trainerNotes? }` creates
  one `workout_assignments` row with `program_assignment_id = NULL`.
- 6.2 [ ] Same relationship guard as 3.2; same workout-readability rule as 1.2.
- 6.3 [ ] Ad-hoc occurrences feed adherence/dashboard/library identically to
  programme occurrences.
- 6.4 [ ] Unassign: `DELETE /trainers/me/clients/:clientId/workout-assignments/:id`
  (only while status is `assigned`; 409 otherwise).
- 6.5 [ ] v1 UI: "Assign workout" action on Client Detail (sheet: workout
  picker + optional due date). Kept deliberately minimal.

---

## Non-goals (v1)

- **Photo/PDF programme import** (physio hand-off) — parked by Brad; do not scope.
- Drag-drop reorder in the editor (up/down buttons v1; drag-drop follow-up).
- Recommended-workouts engine (Home shows _scheduled_, not _recommended_).
- Athlete-visible programme _library_ / programme sharing between coaches
  (`workout_programs.is_public` stays dormant).
- Bulk-assign to multiple clients in one action (spec-10 Tier B / M8.5).
- Coach Home (10.9.1) — separate design decision, unchanged.
- Retro-regeneration of materialised occurrences after programme edits.
- Per-day-of-week scheduling UI (occurrences are spread algorithmically;
  a "train on Mon/Wed/Fri" picker is a follow-up).
