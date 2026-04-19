# Persistence Mobile — Feature Specs

Structured feature specifications for the Persistence V2 build (mobile + backend). Each feature-level spec has `requirements.md`, `design.md`, and `tasks.md`. Specs are the source of truth; per-milestone briefs at `specs/milestones/M<N>-<name>/` cut scoped cross-feature work items for agents to consume.

**Current milestone: M0 — Integration baseline** (briefs pending). M0 closes the Exercise Library wire-format drift, adds backend `POST/PATCH/DELETE /exercises`, and shifts the mobile filter UI onto API-sourced reference lists. See [`milestones/ROADMAP.md`](./milestones/ROADMAP.md).

## Spec index

| Spec | Feature                                                  | Current state                          | Parent milestone(s) |
| ---- | -------------------------------------------------------- | -------------------------------------- | ------------------- |
| 00   | [Guardrails](./00-guardrails/)                           | Complete (39/40)                       | —                   |
| 01   | [Design system](./01-design-system/)                     | Complete (32/35)                       | M1 polish as needed |
| 02   | [Auth flow](./02-auth-flow/)                             | Complete (~44/46)                      | —                   |
| 03   | [Exercise library](./03-exercise-library/)               | Phases 1–4 shipped; 5–8 deferred       | M0, M5              |
| 04   | [Workout management](./04-workout-management/)           | Not started on mobile; backend present | M2                  |
| 05   | [Active session](./05-active-session/)                   | Not started on mobile; backend present | M3                  |
| 06   | [Progress & goals](./06-progress-goals/)                 | Not started on mobile; backend present | M1 (dashboard), M4  |
| 07   | [Health integration](./07-health-integration/)           | Stub adapter only                      | M1                  |
| 08   | [Profile & settings](./08-profile-settings/)             | Minimal Profile shell only             | M6                  |
| 09   | [Notifications & social](./09-notifications-social/)     | Stub adapter; no backend               | M7                  |
| 10   | [Trainer features](./10-trainer-features/)               | Not started                            | M8                  |
| 11   | [Payments & subscriptions](./11-payments-subscriptions/) | Stub adapter; no backend               | M10                 |
| 12   | [Production readiness](./12-production-readiness/)       | Icons/splash only                      | M11                 |
| 13   | [Nutrition tracking](./13-nutrition-tracking/)           | Stub — requirements pass pending       | M9                  |

## How to use these specs

- **Feature specs (`specs/NN-<feature>/`)** are the authoritative description of what a feature must do, how it's architected, and what tasks it breaks into. Don't rewrite them — append current-state notes and mark checkboxes as work lands.
- **Milestone briefs (`specs/milestones/M<N>-<name>/`)** scope a shippable cross-feature slice, pointing at the relevant specs as authority. Each milestone produces `BRIEF.md` (overview), `BACKEND_BRIEF.md`, `FRONTEND_BRIEF.md`, and `SMOKE_TEST.md`.
- **Agents always work from a brief**, never from a raw `tasks.md`. A brief is the contract between humans and agents about what's in scope.
- See [`_agent.md`](./_agent.md) for architectural constraints and the "always work from a brief" execution model.

## Roadmap

See [`milestones/ROADMAP.md`](./milestones/ROADMAP.md) for the M0 → M11 execution order and per-milestone status.

## Explicit non-goals

Copied from the approved V2 migration plan:

- No per-screen `/frontend-design` passes during milestones (polish is M11)
- No backend rewrites — extend existing Elysia handlers
- No migration of the legacy mobile app's data-layer hooks
- No skipping e2e smoke tests
- No milestone begins without its parent spec being marked-up / created
- No nav redesign until M11 (trainer/nutrition both need to land to see the real pressure)
