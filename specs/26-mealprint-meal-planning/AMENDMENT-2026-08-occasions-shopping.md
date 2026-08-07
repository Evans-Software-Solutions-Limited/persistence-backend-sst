# Spec-26 Amendment — Suggest Occasions + Shopping List (2026-08)

**Status:** authoritative for this slice. Amends `requirements.md` (STORY-003 suggest,
STORY-006 shopping) and `design.md`. Restores scope that was in the AnyMeal visual
prototype (`~/Downloads/Meal Designs/project/src/screens/gtm-d8-anymeal*.jsx`) but was
dropped when spec-26 was first written. Prototype-first fidelity applies.

## Why this exists

The shipped suggest flow is shape + steer only; the prototype's **occasion** layer
(On plan / Cheat meal / Eating out) and the **shopping list** never made it into the
written spec. This amendment brings them in. Build to the prototype 1:1 except where a
deliberate decision below says otherwise.

---

## A. Suggest-a-meal occasions

### A.1 Occasion selector (STORY-003 extension)

- Full-width 3-up segmented control labelled `OCCASION`, **above** the shape control,
  under the "left today" macro card. Options, in order: `On plan` · `Cheat meal` ·
  `Eating out`. Default `On plan`.
- Accent follows occasion: `cheat_meal` → **ember** (`#FB923C`, the existing `ember`
  tone); `on_plan` / `eating_out` → **gold**. The selector, generate button, generating
  state, and card accents all take the occasion accent.
- Per-occasion copy (verbatim):

  | occasion   | subtitle                                                                      | shape shown | steer placeholder               | generate label      | #cards | accent |
  | ---------- | ----------------------------------------------------------------------------- | ----------- | ------------------------------- | ------------------- | ------ | ------ |
  | on_plan    | Meals that keep you on target.                                                | yes         | Add a steer — "something sweet" | Suggest a meal      | 3      | gold   |
  | cheat_meal | Fancy a treat? See how it fits — or the lighter swap that scratches the itch. | no          | Add a steer — "something sweet" | Show me the options | 2      | ember  |
  | eating_out | Heading out? Get the best order for your remaining macros before you go.      | no          | Which restaurant? (optional)    | Find my best order  | 3      | gold   |

- Shape (`snack/meal/either`) only renders for `on_plan`; ignored otherwise.

### A.2 Backend contract

- `POST /nutrition/ai/meal-suggest` gains `occasion: "on_plan" | "cheat_meal" |
"eating_out"` (default `on_plan`). `shape` stays optional (meaningful only for
  `on_plan`).
- `MealSuggestion` gains: `cheat: boolean`, `isOrder: boolean`, `tag: string | null`
  (`Have it` / `Smart swap` / `Snack` / `Meal`).
- Prompt branches per occasion (`suggestModel.ts` `OCCASION_INSTRUCTION`):
  - **on_plan** — unchanged behaviour.
  - **cheat_meal** — exactly 2 cards: (1) the indulgent "have it" card (`tag: "Have it"`,
    `cheat: true`) and (2) the lighter swap (`tag: "Smart swap"`, `cheat: true`, same
    craving, fewer kcal).
  - **eating_out** — restaurant-oriented "best order" cards.

### A.3 DECISIONS (deviations from a naive prototype port)

1. **Cheat "have it" may exceed remaining kcal.** The indulgent card is intentionally
   over-budget. Relax, for `cheat_meal` only: the handler `budget_exhausted` pre-check
   and `verifyComposition` `kcal_overshoot` rejection. The "lighter swap" card still
   respects a sensible ceiling. Every other occasion keeps the existing budget rules.
2. **Eating-out is DEFERRED this release (Brad, 2026-08-07) — not surfaced.** A faithful
   "best order" needs a restaurant-menu data source; without one it would mean the AI
   inventing restaurant macros, which crosses the one line the Mealprint safety design
   holds. So the selector ships **`on_plan` + `cheat_meal` only** (`OFFERED_OCCASIONS` in
   `MealprintSuggestSheetPresenter`). Retained DORMANT so re-enabling is a one-line change
   once a menu source exists: the `eating_out` value + copy, the card `isOrder`/"Save
   order" handling, and a SAFE backend path (still candidate-constrained + forced
   `containsUnverified` + label-check — the model does NOT invent macros). The
   off-catalogue AI-estimated variant is a separate future decision, not shipped.
3. **"Save order" = log via the existing draft/confirm flow.** No separate saved-orders
   store this slice; the primary action on an `isOrder` card is labelled `Save order`
   but routes through the same draft-confirm → log path as `Log it`. A real
   save-for-later store is deferred.
4. **Preserve the existing draft-confirm / keep-drop / unconditional label-check safety
   flow.** Occasions layer on top of it; they do not replace it with the prototype's
   lighter one-tap `Log it`.

---

## B. Shopping list (STORY-006)

### B.1 DECISION — day-scoped now

The prototype's list is per-week; week generation (7 `meal_plans` sharing `groupId`,
async job infra) is unbuilt Phase 3. This slice ships a **day-scoped** shopping list
derived from a single accepted day plan. Week-scoping is a later flip once week
generation exists.

### B.2 Behaviour

- Entry: a basket icon in the `PlanToday` header (beside the existing delete icon) →
  navigates to the shopping list for that day's accepted plan.
- Screen `Shopping list`: `OFFLINE ✓` pill; a progress card (`{done}/{total}`, gold bar);
  aisle groups each a `Card` of rows; row = checkbox + item name (checked → strikethrough)
  - right-aligned quantity. Check-off is local optimistic state (client-side; persisted
    in SQLite so it survives offline).
- Aisle order + vocabulary: `Meat & fish` · `Dairy & eggs` · `Fruit & veg` · `Bakery` ·
  `Cupboard` · `Other` (unmapped/NULL tags).

### B.3 Backend derivation (nothing stored)

- `GET /nutrition/plans/:id/shopping` (reads, ungated like other plan reads).
- Explode `meal_plan_meals` → foods: `recipeId` → `recipe_ingredients`; `mealId` →
  `meal_items`; `items` jsonb → foods directly. Scale by serving multiplier.
- Group by `foods.categoryTags` → aisle via a NEW OFF-category-tag → aisle mapping module
  (authored from scratch; `Other` for unmapped/NULL/custom-name items).
- Aggregate servings per distinct `foodId`, formatted from `servingSize`/`servingUnit`/
  `servingQuantity`.

### B.4 Deferred (documented, not dropped)

Week plans + async generation; real restaurant menu data source; saved-orders store;
`HARD TO FIND` / rare-ingredient flag (no data source). These are follow-on slices.

---

## C. Also in this branch (not occasion/shopping)

- Subscription back-nav fix (plans → Manage for subscribers).
- Gold accent + full-width on the Mealprint segmented controls.
- "Edit preferences" (allergens/likes/dislikes) link on the suggest sheet — the editor
  already exists; only the plan sheet linked to it.
