# M9 — Nutrition tracking (NEW feature) — BRIEF (stub)

Briefs to be authored before milestone starts. **Blocker:** parent spec is a stub; requirements + design pass is the first item of work, pre-M9.

**Parent spec:** [`../../13-nutrition-tracking/`](../../13-nutrition-tracking/).

**Scope sketch (indicative, subject to the requirements pass):**

Not a port. Net-new full-stack build — needs its own domain model (Meal, FoodItem, NutritionEntry, DailyNutrition, NutritionGoal), ports (`NutritionPort`, possibly `FoodDatabasePort`), backend endpoints, offline strategy, and UI screens.

Indicative review gate: add a meal manually, see today's macros roll up, set a daily calorie target, see progress against it.

**Pre-requisite work:** before the backend/frontend agents kick off, a discovery agent pair (requirements + design) must populate [`../../13-nutrition-tracking/requirements.md`](../../13-nutrition-tracking/requirements.md) and [`../../13-nutrition-tracking/design.md`](../../13-nutrition-tracking/design.md).
