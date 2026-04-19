# M9 — Nutrition tracking (NEW feature) — BRIEF (stub)

Briefs to be authored before milestone starts. **Blocker:** parent spec is a stub; requirements + design pass is the first item of work, pre-M9.

**Parent spec:** [`../../13-nutrition-tracking/`](../../13-nutrition-tracking/).

**Scope sketch (indicative, subject to the requirements pass):**

Not a port. Net-new full-stack build — needs its own domain model (Meal, FoodItem, NutritionEntry, DailyNutrition, NutritionGoal), ports (`NutritionPort`, possibly `FoodDatabasePort`), backend endpoints, offline strategy, and UI screens.

Indicative review gate: add a meal manually, see today's macros roll up, set a daily calorie target, see progress against it.

**Pre-requisite work:** before the backend/frontend agents kick off, a discovery agent pair (requirements + design) must populate [`../../13-nutrition-tracking/requirements.md`](../../13-nutrition-tracking/requirements.md) and [`../../13-nutrition-tracking/design.md`](../../13-nutrition-tracking/design.md).

## When this milestone kicks off

Follow the same workflow M0 established ([`../M0-integration-baseline/HANDOVER.md`](../M0-integration-baseline/HANDOVER.md) is the template). In summary:

1. **Write the four brief files first** (`BRIEF.md`, `BACKEND_BRIEF.md`, `FRONTEND_BRIEF.md`, `SMOKE_TEST.md`) — replacing this stub. Each brief cites the parent spec(s) as authority.
2. **Audit the parent spec(s) for gaps.** If this milestone's scope adds architecture not yet in `design.md`, or behaviours not yet in `requirements.md`, the first commits on each branch are spec updates — not implementation. See [`../../_agent.md`](../../_agent.md) § Spec-first discipline.
3. **Two branches, two PRs, parallel execution.** One backend branch, one frontend branch, both off fresh `main`. Each PR's commit history starts with spec-update commits, then implementation commits that cite the spec sections they implement.
4. **E2E smoke test against `bun run dev`** before merge. `SMOKE_TEST.md` steps map 1:1 to acceptance criteria in `requirements.md`.

Do not start code on this milestone without briefs authored.
