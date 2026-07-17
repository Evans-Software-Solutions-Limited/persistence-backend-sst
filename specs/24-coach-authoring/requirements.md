# 24 — Coach Authoring & Library IA: Requirements

> **Authored 2026-07-17** from Brad's coach-tooling-IA-slice brief + three
> sign-off decisions (see `design.md § Decision record`). This spec covers the
> **coach authoring surfaces + information architecture** and the **exercise
> read-visibility narrowing** that pairs with them. It does **not** redefine the
> programme model (`specs/19-programs` is authoritative) or coach-mode routing
> (`specs/14-navigation` is authoritative) — it composes them.
>
> Note: `specs/20-*` is `20-sleep-quicklog`; this feature takes the next free
> slot, `24` (21/22/23 reserved for the GTM-EXPANSION milestones — see
> `specs/milestones/GTM-EXPANSION/`).

---

## Overview

Coach mode already ships the pieces, but they are **not reachable from one
place** and the athlete exercise library **leaks** coach-authored exercises:

- The coach tab bar is `Home · Clients · Programs · You`. The **Programs tab
  shows programmes only** (`ProgramsListContainer`, Active/Drafts). There is no
  in-tab path to the coach's **workout library** or to the **exercise library /
  exercise creation** while in coach mode.
- The coach **workout library already exists** (`CoachWorkoutLibraryContainer`)
  but is reachable only via a single card on the **You** tab.
- The **exercise create flow** (`/exercises/create`) is ownership-generic and
  works for coaches, but **every entry point lives in the athlete Train hub**,
  which is `href: null` in coach mode — so a coach cannot create an exercise.
- **Exercise visibility leaks:** the backend grants an athlete read access to
  **every** exercise authored by **any** linked active coach
  (`exerciseRepository.buildVisibilityCondition` → blanket
  `created_by IN (activeTrainerIds)`), so a coach's private custom exercises
  appear in the athlete's library **search/browse** even when nothing has been
  assigned. Brad's requirement: an athlete should see a coach's custom exercise
  **only** when it has been assigned to them (in a programme or an assigned
  workout) — not by searching the exercise DB.

This slice makes the coach Programs tab a **unified library hub**
(Programmes | Workouts | Exercises), gives coaches an exercise-create entry, and
**narrows** exercise visibility to be assignment-scoped.

Authoritative references:

- **IA analog:** the athlete `TrainHubContainer`
  (`packages/mobile/src/ui/containers/TrainHubContainer.tsx`) — the segment-hub
  chrome pattern (eyebrow + segment-driven title + contextual action +
  `<Segmented>`), backed by a Zustand segment store (`useTrainSegment`).
- **Coach visual language:** the prototype
  `~/Downloads/handoff/design-source/screens/coach.jsx` (`ProgramsScreenV2`) and
  `specs/19-programs`. The unified hub itself is **net-new IA** (the prototype
  has a standalone Programmes screen only) — it is modelled on `TrainHub`, not
  ported from a prototype screen.
- **Programme/assignment model:** `specs/19-programs`
  (`program_assignments` → `program_workouts`; `workout_assignments` as the
  single per-occurrence table).

---

## Out of scope (explicit)

- **Selective per-client exercise sharing** (a share table + visibility enum) —
  deferred. Visibility stays relationship/assignment-derived, all-or-nothing per
  assignment.
- **Client-facing "From my coach" discoverability filter** — deferred (Brad,
  2026-07-17): "these exercises will technically be visible in the assigned
  programmes and workouts." No `created_by=<ptId>` / `source=coach` UI.
- **Programme model, assign flows, workout creator/editor** — unchanged; owned
  by `specs/19-programs` + `WORKOUT-AUTHORING-V2`.

---

## Stories

### STORY-001 — Unified coach library hub (Programs tab)

**As a** coach, **I want** the Programs tab to switch between my Programmes, my
Workouts, and my Exercises, **so that** all my authoring surfaces live behind
one tab instead of being scattered across tabs and cards.

- **AC 1.1** In coach mode, the Programs tab renders a hub with a top-level
  `<Segmented>` switcher: **Programmes | Workouts | Exercises**, modelled on
  `TrainHubContainer` (eyebrow + segment-driven title + contextual top-right
  action + segmented control).
- **AC 1.2** Selecting **Programmes** renders the existing programmes library
  (Active/Drafts search + list + create), i.e. today's `ProgramsListContainer`
  behaviour, minus its own screen chrome (the hub owns the eyebrow/title).
- **AC 1.3** Selecting **Workouts** renders the existing
  `CoachWorkoutLibraryContainer` behaviour (unfiltered coach workout list +
  create + open-to-edit), minus its own back-button header (the hub owns
  chrome; there is no "back" — it's a tab).
- **AC 1.4** Selecting **Exercises** renders a coach exercise library (browse +
  search) scoped to the coach, with a **Create** action.
- **AC 1.5** The selected segment persists across app launches and is restored
  on return (mirrors `useTrainSegment` persistence). Default segment on a fresh
  install is **Programmes** (the tab's historical purpose).
- **AC 1.6** The contextual top-right action is segment-aware: Programmes →
  "New programme" (+), Workouts → "Create workout" (+), Exercises → "Create"
  exercise (+). (A per-segment inline CTA may also remain where the existing
  bodies already have one; no regression to those.)
- **AC 1.7** The hub is coach-only. A non-coach who reaches the route (mode
  flip / deep link) is handled exactly as today (tab is `href: null` in athlete
  mode; the sub-containers already self-bounce). No athlete-visible change.

### STORY-002 — Coach exercise creation

**As a** coach, **I want** to create a custom exercise from the Programs →
Exercises segment, **so that** I can author exercises to use in my workouts and
programmes without leaving coach mode.

- **AC 2.1** The Exercises segment exposes a **Create** entry that pushes the
  existing full-screen `/exercises/create` route (no new create flow).
- **AC 2.2** Creating an exercise in coach mode persists it with
  `created_by = <coach userId>` (already the backend behaviour — no backend
  change to the create path).
- **AC 2.3** After a successful create, the coach's Exercises segment reflects
  the new exercise without an app reload (reuses the existing
  `useExerciseLibrary` revision-bump refresh).
- **AC 2.4** The empty state of the coach Exercises segment offers the same
  Create affordance.

### STORY-003 — Assignment-scoped exercise visibility (athlete)

**As an** athlete, **I want** my exercise library to show only stock exercises,
my own exercises, and exercises my coach has actually assigned to me, **so that**
I don't see my coach's entire private exercise catalogue when I search.

- **AC 3.1** An athlete's exercise **list / search / count** (`GET /exercises`,
  `GET /exercises/search`) returns: system/public exercises, the athlete's own
  (`created_by = self`), and exercises that appear in a workout assigned to the
  athlete — and **excludes** coach-authored exercises that have **not** been
  assigned.
- **AC 3.2** "Assigned to the athlete" means the exercise is referenced by a
  `workout_exercises` row for a workout that is EITHER (a) in a programme with a
  **live** (`assigned`/`started`) `program_assignments` row for the athlete, OR
  (b) referenced by any `workout_assignments` row for the athlete (ad-hoc
  assignment, or a materialised/completed programme occurrence). See
  `design.md § Visibility predicate` for the exact predicate + rationale.
- **AC 3.3** `GET /exercises/:id` for an assigned coach exercise returns the
  exercise (**no 404 regression**); for a never-assigned coach exercise it
  returns 404 (same "not visible → 404, no existence leak" behaviour as today).
- **AC 3.4** The athlete continues to see assigned coach exercises **inside**
  the assigned workout / programme views (the workout payload embeds exercise
  fields and does not depend on this predicate — unchanged).
- **AC 3.5** A coach's own access to their own exercises is unchanged
  (`created_by = self`). System-exercise and unauthenticated behaviour are
  unchanged.
- **AC 3.6** Full future-programme coverage: an athlete assigned a finite or
  **indefinite** programme can read the full detail of exercises in **any** week
  of the programme, including weeks whose `workout_assignments` occurrences have
  **not yet been materialised** (the predicate keys off the programme definition
  via `program_assignments`, not only materialised occurrences).
- **AC 3.7** Two-user isolation: athlete B (not linked / not assigned) cannot
  read athlete A's or coach C's unassigned custom exercises via list, search, or
  getById.

### STORY-004 — Retire the You-tab Workout library card

**As a** coach, **I want** a single canonical path to my workout library,
**so that** the IA isn't ambiguous once Programs → Workouts exists.

- **AC 4.1** The You-tab "Workout library" card is **removed**
  (`CoachYouPresenter` card + `CoachYouContainer.onOpenWorkoutLibrary` wiring),
  now that Programs → Workouts is the canonical entry.
- **AC 4.2** The coach workout library remains reachable (Programs → Workouts).
  The standalone route may remain registered for deep links, but no in-app
  surface other than the hub links to it.
- **AC 4.3** No dead code: the removed card's props/handlers are cleaned up, not
  left orphaned.

---

## Non-functional requirements

- **NFR-1 (data isolation):** STORY-003 is a data-isolation change. It MUST be
  covered by tests that prove an unassigned coach exercise is invisible and an
  assigned one is visible, including two-user isolation (see CLAUDE.md §
  Dangerous Areas · User Data Isolation).
- **NFR-2 (coverage):** ≥90% lines/functions/branches/statements on changed
  files (backend + mobile), per repo standard. No fake tests; the visibility SQL
  must be guarded against the mocked-`getDb` blind spot (render via `PgDialect`,
  per `reference_drizzle_groupby_param_bug`).
- **NFR-3 (port fidelity):** coach mode is prototype/V2-designed, not
  legacy-ported; the hub is net-new IA modelled on `TrainHub`. The existing
  ported programme/workout bodies keep their visual output — only their outer
  chrome moves to the hub. No athlete UI changes beyond STORY-003's list
  contents.
- **NFR-4 (performance):** the visibility predicate runs on every exercise
  list/search/count/getById. The added subqueries are client-scoped and use
  existing indexes (`program_assignments (client_id,status)`, `workout_assignments
(client_id,due_date)`); confirm `workout_exercises(workout_id)` is indexed or
  note it (see `design.md § Performance`).
- **NFR-5 (device verification):** gorhom bottom-sheets are mocked in CI. The
  new Programs segments, coach exercise creation end-to-end, and a client seeing
  an assigned coach exercise MUST be device-verified before any staging/prod EAS
  build (this slice is a launch blocker).
