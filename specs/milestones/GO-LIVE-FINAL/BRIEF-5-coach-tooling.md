# BRIEF-5 — Coach tooling & IA (+ Train-hub pre-launch tidy)

_Lane 2. Two phases: **Phase A** is a small pre-launch tidy on the athlete Train hub; **Phase B** is the coach authoring/IA slice (fast-follow, spec-first). Current-state verified 2026-07-17._

## Phase A — pre-launch tidy (small, Train hub)

Both items touch the athlete Train hub, so do them together to avoid editing the same screen twice.

### A1. Hide Goals for launch (decision **C**)

- Goals today are inert (labelled intentions, no progress/completion — see the goals investigation). Brad chose **C: hide for launch** (B = make-them-real is a future spec).
- Remove the Goals surface from `TrainOverviewContainer`/`TrainOverviewPresenter` (the `GoalCard` + create/edit entry via `GoalSheet`), and **clean the dead code**: unused `packages/mobile/src/ui/components/home/GoalsSection.tsx`, and the hardcoded-zero `activeGoals` in `dashboardRepository.getActiveGoalsWithProgress` (+ its mobile model/consumers). Keep the DB/handlers (harmless) — this is a UI hide + dead-code removal, not a backend teardown.

### A2. Gate the "Training" segment on a coach relationship

- Brad's intent: the Train hub's **Training** segment (coach-assigned work) should only show when the athlete actually has a coach; otherwise it's an empty/pointless default.
- **Net-new client signal required:** there is no `hasCoach` hook in mobile today. Add a small athlete-side "has active coach" signal — a new/extended endpoint reading `pt_client_relationships WHERE clientId = me AND status = 'active' AND isAiTrainer = false` (mirror of `activeTrainerIdsSubquery` in `exerciseRepository.ts`) + a `useCoachRelationship`/`useGetHome`-extension hook.
- Gate the Training segment (and its switcher option) in `TrainHubContainer`/`useTrainSegment` + `TrainOverviewContainer` on that signal. When no coach: default the hub to **Workouts** and hide Training. Confirm the M16 default-segment behaviour with Brad before changing it (it was a deliberate milestone default).

## Phase B — coach authoring & IA (fast-follow; spec-first)

> **STATUS (2026-07-17): SHIPPED — `specs/24-coach-authoring/`, PR #260 merged (main `6156380`).** Unified Programs hub (Programmes | Workouts | Exercises), coach exercise-creation entry, You-tab card retired, and exercise visibility narrowed to assignment-scoped (backend). Client "from my coach" filter was **deferred** (Brad — assigned exercises surface via the programme/workout views). Gates green + Inspector-Brad-local clean. ⚠ **Device-verify still pending** before the next EAS build. (Phase A below — goals-hide + Training-gate — is a SEPARATE Train-hub tidy, still open.)

Author a spec triplet (`specs/NN-coach-authoring/` — pick a free number) before code; the brief below is the input.

### B1. Programs tab = unified entry (Programmes | Workouts | Exercises)

- Today `programs.tsx` → `ProgramsListContainer` renders **programmes only** (Active/Drafts). Add a top-level `Segmented` switcher analogous to the athlete `TrainHubContainer`.
- **Reuse existing surfaces:** the coach workout library already exists as `CoachWorkoutLibraryContainer` (self-gates to coach mode; currently only reachable via the You-tab "Workout library" card in `CoachYouPresenter`). Move/surface it under the Workouts segment. Add an Exercises segment (see B2).
- Decide whether the You-tab card is removed or kept as a shortcut.

### B2. Coaches can create exercises

- The create flow (`/exercises/create` → `CreateExerciseContainer` → `create-exercise.command` → `POST /exercises`) is **already ownership-generic** (`created_by` = caller). It's just **unreachable in coach mode** (all entry points live in the athlete Train hub, hidden in coach mode).
- **Gap = a coach-mode UI entry only** (from the Programs→Exercises segment). No command/handler/ownership change needed.

### B3. Coach exercises visible to clients

- **Already implemented server-side:** `exerciseRepository.buildVisibilityCondition` grants a client read access to any exercise whose `created_by` is an active, non-AI PT they're linked to (via `pt_client_relationships`), plus a `created_by=pt` filter. No share table, no visibility enum needed.
- **Gap (optional):** wire a client-side "from my coach" filter/section through the mobile exercise-library hooks/adapters so it's discoverable. A share table / new visibility value is **only** needed if you later want _selective_ per-client sharing (coach shares X with client A but not B) — current model is all-or-nothing per relationship. Confirm which Brad wants.

## Execution notes

- Container/presenter seam per repo convention; presenters pure. Offline-first cache slots follow the `CoachWorkoutLibraryContainer` pattern.
- Phase A is device-verifiable on a staging build; Phase B needs the same. gorhom sheets are mocked in CI — device-verify any sheet/nav change.

## Gates

`bun run typecheck` · `lint` · `prettier:check` · `build` · `test:unit` (≥90% on changed files). Inspector-Brad before each PR.
