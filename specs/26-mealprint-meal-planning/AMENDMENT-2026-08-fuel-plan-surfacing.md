# Spec-26 Amendment — Edit / Clear plan from the Fuel page (2026-08-07)

**Status:** authoritative for this slice. Decision by Brad, 2026-08-07: an accepted
Mealprint plan must be **manageable from the Fuel page** — the user needs to adjust or
remove the plan, not just view it.

## What already exists (do NOT rebuild)

The Fuel diary **already** surfaces an accepted day plan's `state='planned'` meals as
**unchecked "ghost rows"** (dashed, gold-tinted, per-slot), with a **"Log it"** action that
writes the meal through `useLogPlanMeal` and flips it `planned → logged` — shipped in
spec-26 Phase 2 (AC 5.1 / 5.2). Those ghost rows are excluded from the ring until logged.
Mechanism: `useGetActiveMealPlan` + `plannedMealsForSlot` → `MealLogPresenter` ghost rows.
So "show the plan as unchecked in the diary" is DONE — this slice does not touch it.

(A read-side `plannedMeals` field on `GET /nutrition/today` was prototyped and then
**dropped**: it duplicated the working `useGetActiveMealPlan` path and was consumed by no
render surface. If the two fetches are ever consolidated onto one `/nutrition/today` call
for fewer requests, that is a separate, self-contained follow-up.)

## The gap this slice fills — manage the plan from Fuel

The ghost rows let you _log_ the plan, but there was no way to **edit** or **clear** it from
the Fuel page. Add both:

- **Edit plan** — an "Edit" action in a plan header/actions row on the Fuel page, routing to
  the existing plan flow (`/(app)/fuel/plan-today`, where replace-meal / swap already live).
  No new editor.
- **Clear plan** — a "Clear" action → confirm-before-clear dialog → the **existing**
  `DELETE /nutrition/plans/:id` (shipped in #357). Because `meal_plan_meals.logged_entry_id`
  is `ON DELETE SET NULL`, already-logged `nutrition_entries` are RETAINED — clearing a plan
  never erases eaten food. The confirm copy must say so explicitly. On success, invalidate
  the active-plan + today caches so the ghost rows disappear.
- The actions row shows only when there is an active plan for the day.

No schema change, no new endpoint (delete already exists). Day-scoped; extends to a week
once Phase-3 week generation exists.
