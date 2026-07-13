# Workout Authoring v2 — Requirements

> **Authored 2026-07-12** from Brad's kickoff + a 2-agent backend/mobile recon +
> Brad's decision sign-off (AskUserQuestion, see `§ Locked decisions`). This is a
> **port + feature** ticket: the v3 prototypes are the source of truth and the
> mobile UI must match them 1:1 (migration discipline — see repo `CLAUDE.md
§ Migration intent`). Pairs with `design.md` + `tasks.md`.
>
> **Relationship to spec-19 (Programs):** Programmes remain the primary
> _scheduled multi-workout_ assignment model and are unchanged here. This ticket
> is about **authoring** workouts (create/edit/detail) and about **owner
> visibility** of authored workouts in the author's own library. The one-tap
> create+assign shortcut (STORY-007) rides the **existing ad-hoc single-workout
> assignment** path (`workout_assignments.program_assignment_id IS NULL`), which
> has always coexisted with programmes (spec-19 D2).

---

## Overview

Five outcomes:

1. **Everyone can create workouts; coaches/trainers get UNLIMITED** (other tiers
   stay capped). Already true in code — the create gate reads
   `subscription_tiers.workout_limit` and all trainer tiers are `NULL`
   (unlimited). This ticket **verifies and locks that with a guard test**; no
   behaviour change.
2. **Coaches get the same create-workout ability as athlete mode**, plus a
   coach-mode **Workouts library** screen to browse/edit what they've authored.
   Authored workouts remain assignable to clients (programmes + ad-hoc, both
   already work).
3. A **per-workout owner-visibility toggle** — whether a workout appears in the
   author's own personal "My Workouts" page.
4. A **trainer's personal "My Workouts"** shows only workouts that are
   owner-visible **or** assigned to them (as an athlete), so authoring for
   clients doesn't crowd their personal view. **Regular athletes are unchanged.**
5. Ship the **up-to-date workout-detail + workout-creator v3 designs** from the
   prototype (the detail hero + market-standard history block are the main
   additions; superset styling matched between editor and detail).

### Authoritative visual references (prototype wins on visuals)

1. `~/Downloads/Persistence Gym Application with You Coach/Workout & Weigh-In
Screens/src/screens/workout-creator.jsx` (v3) — Name\* · Description ·
   Visibility tri-state · exercises with the centred **SUPERSET A** pill on a
   connector line, 3px left primary accent on member cards, shared sets/rest from
   the superset lead, ± steppers, min–max rep range, drag-to-reorder,
   delete-confirm.
2. `~/Downloads/Persistence Gym Application with You Coach/Workout & Weigh-In
Screens/src/screens/workout-detail.jsx` (v3) — primary-gradient **hero**
   (equipment · name · duration/exercises/total-sets stats + muscle pills), a
   **history stats block** (LAST DONE relative · COMPLETED count · AVG TIME +
   "Last session · date · volume · minutes" footer), matched superset styling,
   Start CTA.

Both v3 prototypes are "largely parity with the shipped presenters" — the
**deltas** are the deliverable. The `show_in_owner_library` toggle is **not** in
the shared prototype (it is coach-only, additive, shown only in coach authoring
context); everything else in the creator/detail must match the prototype exactly.

---

## Locked decisions (Brad, 2026-07-11 kickoff + 2026-07-12 AskUserQuestion)

| #   | Decision                              | Locked value                                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Owner-visibility mechanism            | New column `workouts.show_in_owner_library boolean NOT NULL DEFAULT true`. `true` = the workout appears in its author's personal "My Workouts". Distinct from `workout_assignments.show_in_library` (which governs an **assigned** occurrence in the **client's** library) and from the `visibility` enum (owner-side social sharing).                          |
| D2  | Who gets the de-crowded personal view | **Any trainer, both modes** (`isTrainerEligible === true`). A trainer's personal "My Workouts" = `(created-by-me AND show_in_owner_library) ∪ assigned-to-me`. **Regular athletes are unchanged** — `mine` stays "everything I created" ∪ assigned.                                                                                                             |
| D3  | Toggle default                        | Created in a **coach** context (coach library / Client-Detail create+assign) → `show_in_owner_library = false`. Created in an **athlete** context (Train → Workouts) → `true`. DB column default `true` (so all pre-existing + all athlete-path workouts are personal, correct). A coach-only toggle in the creator/editor overrides.                           |
| D4  | Detail history block                  | **In scope.** New read `GET /workouts/:id/history` — for the **calling user**, aggregated from their own `workout_sessions` (status = `completed`) of this workout: last-completed date, completed count, avg session minutes, and the last session's total volume + minutes. Empty / never-done state renders cleanly (no block, or a neutral "Not done yet"). |
| D5  | One-tap create + assign               | **Yes, in v1**, from Client Detail — creates a workout then **ad-hoc-assigns** it to that client via the existing `POST /trainers/me/clients/:id/workout-assignments` path (`program_assignment_id = null`). Programmes stay the primary scheduled-plan model; this is the single-workout ad-hoc complement that already exists.                                |
| D6  | Ticket placement                      | `specs/milestones/WORKOUT-AUTHORING-V2/` (this triplet). Touches spec-04 (workout-management) + spec-10/19 (coach). Spec-04/10/19 stay authoritative for everything not restated here.                                                                                                                                                                          |
| D7  | Coach authoring surface               | **Full coach-mode "Workouts library" screen** (list of all workouts the coach authored, `type=mine` unfiltered) with Create + tap-to-edit, reachable from the coach section. Plus the Client-Detail create+assign entry (D5).                                                                                                                                   |
| D8  | Caps                                  | Trainer tiers already `workout_limit = NULL`. **No migration.** Lock with a guard test asserting the seeded trainer tiers are unlimited.                                                                                                                                                                                                                        |

---

## User stories

### STORY-001 — Everyone can create; coaches unlimited (verify only)

**As** any signed-in user **I can** create a workout, subject to my tier's
`workout_limit`; **as** a trainer **I have** no workout cap.

- **1.1** WHEN a user with a finite `workout_limit` who is at their cap calls
  `POST /workouts`, THE system SHALL reject with **402** (`create_workout`
  entitlement) — unchanged.
- **1.2** WHEN a user on any trainer tier (`individual_trainer`,
  `small_business`, `medium_enterprise`) calls `POST /workouts`, THE system SHALL
  allow it regardless of count (tier `workout_limit IS NULL`).
- **1.3** THE seed for every trainer tier SHALL keep `workout_limit = NULL`,
  asserted by an automated test (no runtime change).

### STORY-002 — Coach create entry + Workouts library

**As** a coach **I can** create workouts from coach mode and browse/edit the
workouts I've authored, without switching to athlete mode.

- **2.1** WHEN in coach mode, THE app SHALL expose a "Workouts" library entry
  that opens a screen listing every workout I authored (`type=mine`, unfiltered
  by `show_in_owner_library`), newest first.
- **2.2** THE library screen SHALL provide a "Create workout" action that opens
  the shared creator, and tapping a listed workout SHALL open it for edit.
- **2.3** A workout created from a coach context SHALL default
  `show_in_owner_library = false` (D3).
- **2.4** THE library screen SHALL be coach-gated (a non-coach reaching the route
  is redirected, mirroring the Program editor gate).

### STORY-003 — Per-workout owner-visibility toggle

**As** an author **I can** control whether a workout shows in my personal "My
Workouts".

- **3.1** THE creator/editor SHALL render a "Show in my workouts" toggle **only
  in a coach authoring context**; athlete-context creation SHALL NOT render it
  and SHALL send `show_in_owner_library = true`.
- **3.2** WHEN the toggle is changed and the workout saved, THE `POST`/`PATCH
/workouts[/:id]` request SHALL carry `show_in_owner_library` and THE column
  SHALL persist it.
- **3.3** WHEN `show_in_owner_library` is omitted from a create/update request,
  THE backend SHALL default it to `true` (legacy-safe; existing clients keep
  working).

### STORY-004 — Trainer personal "My Workouts" is de-crowded

**As** a trainer viewing my own workouts **I see** only my personal ones plus
what's assigned to me — not the dozens I authored for clients.

- **4.1** WHEN a trainer (`isTrainerEligible`) opens their personal My Workouts,
  THE saved list SHALL equal `(created-by-me WHERE show_in_owner_library = true)
∪ (assigned-to-me)`.
- **4.2** WHEN a **non-trainer** athlete opens My Workouts, THE list SHALL equal
  `(all created-by-me) ∪ (assigned-to-me)` — **unchanged from today**.
- **4.3** THE owner-visibility filter SHALL be an **opt-in query param**
  (`ownerLibraryOnly=true`) on `GET /workouts?type=mine`, sent by the client only
  for trainers; the backend default (param absent) SHALL be unchanged behaviour.
- **4.4** Quota (`used`/`limit`) SHALL keep counting **all** created workouts
  (`created_by = me`) regardless of `show_in_owner_library`; trainers see no cap
  (limit `NULL`).

### STORY-005 — Workout detail v3 (hero + history + matched superset)

**As** a user opening a workout **I see** the v3 detail: a primary-gradient hero,
a market-standard history block, matched superset styling, and Start.

- **5.1** THE detail SHALL render a hero card: equipment eyebrow, name,
  duration / exercises / **total-sets** stats, and muscle pills (muscles derived
  from the cached exercise library; equipment token derived similarly, omitted if
  unavailable). Matches `workout-detail.jsx` hero 1:1.
- **5.2** THE detail SHALL render a history block (LAST DONE · COMPLETED × · AVG
  TIME + "Last session · {date} · {volume} · {minutes} min"), fed by
  `GET /workouts/:id/history`. WHEN there is no completed history, THE block
  SHALL render the empty state cleanly (no crash, no zeros-as-data).
- **5.3** Superset groups in the detail SHALL use the matched styling (centred
  SUPERSET-letter pill on a connector line + 3px left primary accent + closing
  connector), consistent with the creator.
- **5.4** THE Start CTA and per-exercise navigation SHALL be unchanged from
  legacy behaviour.

### STORY-006 — Workout creator v3

**As** an author **I build** a workout with the v3 creator: name, description,
visibility, exercises with the matched superset treatment and shared sets/rest.

- **6.1** THE creator SHALL render the **Visibility** tri-state
  (private/friends/public) that today only the editor renders — matching
  `workout-creator.jsx`. (Bug parity: creation is currently always private.)
- **6.2** Superset groups SHALL render the centred **SUPERSET {letter}** pill on
  a connector line, 3px left primary accent on members, closing connector below —
  matching the prototype (today's badge is a left-anchored "Superset N" square).
- **6.3** Existing legacy behaviours SHALL be preserved: ± steppers + typeable
  sets/rest, min–max rep range, non-lead members inherit sets+rest from the lead
  (disabled + hint), add/remove, drag-to-reorder with auto-ungroup, delete
  confirm (edit only), validation (name required, `repsMin ≤ repsMax`).

### STORY-007 — One-tap create + assign from Client Detail (REMOVED)

**Revision (Cluster 6, workout creator/editor restyle):** the one-tap
"Create & assign workout" quick action on Client Detail has been **removed**.
Coaches create a workout via the coach Workout Library and assign it to a
client via the existing AssignWorkoutSheet (`quick-action-assign` /
`onAssignWorkout`) — two steps instead of one, no dedicated entry point.

- QuickActionsRow no longer offers a "Create" action (`onCreateAssignWorkout`,
  `quick-action-create-assign` removed from `ClientDetailPresenter` /
  `ClientDetailContainer`).
- `WorkoutCreatorContainer` still supports its `assignClientId` create-and-assign
  submit path (direct online create → ad-hoc assign) — it's just unreached
  from Client Detail now. Left in place for a future coach-library entry point
  to reuse rather than deleted.

### STORY-008 — Workout history aggregation (backend)

**As** the detail screen **I fetch** per-workout history for the calling user.

- **8.1** `GET /workouts/:id/history` SHALL be gated by the existing `canRead`
  check (same access as the detail GET) and SHALL 404/403 consistently with it.
- **8.2** THE response SHALL be scoped to the **calling user's** completed
  sessions of this workout only (`workout_sessions.user_id = me AND workout_id =
:id AND status = 'completed'`) — never another user's history.
- **8.3** THE response SHALL provide: `completedCount`, `lastCompletedAt`
  (nullable), `avgDurationSeconds` (nullable), and `lastSession` (nullable):
  `{ completedAt, totalVolumeKg, durationSeconds }`. Volume = `SUM(weight_kg ×
reps)` over the last completed session's sets (the canonical `volumeRepository`
  formula).
- **8.4** WHEN the user has never completed this workout, THE response SHALL
  return `completedCount = 0` and null aggregates (empty state), HTTP 200.

---

## Non-goals

- No change to the programme (spec-19) model, scheduling, or adherence.
- No change to the `visibility` enum semantics or friends/public sharing.
- No drag-and-drop beyond the legacy reorder already present.
- No coach realtime / live-session work (separate milestone, shipped).
- No new tier or pricing change (caps are verify-only).

---

## Cross-cutting constraints

- **Migration discipline:** mobile presenters match the v3 prototype 1:1; the
  only additive coach-only UI is the owner-visibility toggle + coach library +
  create&assign entry. No UX "improvements".
- **Data isolation:** history and all list queries stay scoped to the caller's
  `user_id`; the ad-hoc assign path keeps the `assertTrainerCanActForClient`
  gate. Two-user isolation tests required.
- **Gates:** backend PRs run `prettier:check`, `typecheck`, `lint`, `build`,
  `test:unit` (≥ 90% on changed repos/services). Mobile PRs run the mobile gate.
- **Idempotent migration** timestamped after the newest applied migration at
  authoring time; `ADD COLUMN IF NOT EXISTS … NOT NULL DEFAULT true`.
