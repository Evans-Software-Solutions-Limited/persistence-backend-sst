import { and, asc, eq, gt, inArray, isNull, ne, or } from "drizzle-orm";
import {
  foods,
  meals,
  nutritionPlanAssignments,
  nutritionPlanItems,
  nutritionPlanMeals,
  nutritionPlans,
  profiles,
  ptClientRelationships,
  recipeIngredients,
  recipes,
  type NutritionPlan,
  type NutritionPlanAssignment,
  type NutritionPlanItem,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { DbOrTx } from "./personalRecordsRepository";
import type { MealSlot } from "./nutritionEntryRepository";
import { usableFoodForUserCondition } from "./foodRepository";
import { recipeNutritionDataIsUsable } from "./nutritionDataValidity";
import { isUuid } from "./userMealRepository";
import { stripNul } from "../shared/stripNul";
import type { DbTransaction } from "../relationships/auditTrainerAction";

/**
 * Design D (PER-118) — list meal plans: a named list of meals with foods, no
 * dates, no weekdays and no target of its own (builders compare totals with
 * the person's `nutrition_targets`).
 *
 * ## Access rule (the only place it lives)
 *
 * - The OWNER reads and writes.
 * - A CLIENT reads — never writes — while an assignment of the plan to them is
 *   `sent` or `added` on a relationship that is still `active`, and the coach's
 *   account isn't deleted. That is `getReadable`. Reads embed every food,
 *   recipe and saved-meal summary the client needs, so a client never needs
 *   direct access to the coach's rows.
 * - Anyone else gets nothing (the handlers answer 404).
 *
 * Every write method takes the owner's id and filters by it.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type Macros = {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

export type CustomItem = Macros & { name: string };

export type PlanItemInput = {
  foodId?: string;
  recipeId?: string;
  mealId?: string;
  /** A one-off: name and per-serving macros. */
  custom?: CustomItem;
  servings: number;
  sortOrder?: number;
};

export type PlanMealInput = {
  name: string;
  logSlot: MealSlot;
  sortOrder?: number;
  items: PlanItemInput[];
};

export type PlanInput = {
  name: string;
  notes?: string | null;
  meals: PlanMealInput[];
};

export type PlanInputError =
  | "invalid_plan_name"
  | "invalid_meal_name"
  | "invalid_item"
  | "food_not_found"
  | "recipe_not_found"
  | "meal_not_found";

/** What a reader logs for an item: the body of one `/nutrition/entries/batch` entry, minus slot, time and key. */
export type LogEntryHint =
  | { foodId: string; servings: number }
  | { recipeId: string; servings: number }
  | { mealId: string; servings: number }
  | ({ customName: string; servings: number } & Macros);

export type PlanItemDTO = Macros & {
  id: string;
  kind: "food" | "recipe" | "meal" | "custom";
  foodId: string | null;
  recipeId: string | null;
  mealId: string | null;
  name: string;
  servings: number;
  sortOrder: number;
  food: {
    name: string;
    brand: string | null;
    servingSize: number;
    servingUnit: string;
    perServing: Macros;
  } | null;
  recipe: {
    name: string;
    photoUrl: string | null;
    servings: number;
    instructions: string | null;
    perServing: Macros;
    ingredients: { name: string; quantity: number; unit: string }[];
    sharedByUserId: string | null;
  } | null;
  meal: { name: string; photoUrl: string | null; perServing: Macros } | null;
  custom: CustomItem | null;
  logEntry: LogEntryHint;
};

export type PlanMealDTO = {
  id: string;
  name: string;
  logSlot: MealSlot;
  sortOrder: number;
  totals: Macros;
  items: PlanItemDTO[];
};

export type PlanDTO = {
  id: string;
  ownerId: string;
  name: string;
  notes: string | null;
  source: string;
  sourcePlanId: string | null;
  revision: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  totals: Macros;
  meals: PlanMealDTO[];
};

export type AssignmentStatus = "sent" | "added" | "dismissed" | "removed";

export type AssignmentDTO = {
  id: string;
  planId: string;
  trainerId: string;
  clientId: string;
  relationshipId: string;
  note: string | null;
  status: AssignmentStatus;
  seenRevision: number;
  sentAt: string;
  addedAt: string | null;
  removedAt: string | null;
  updatedAt: string;
};

export type Readable =
  | { role: "owner"; plan: NutritionPlan }
  | {
      role: "client";
      plan: NutritionPlan;
      assignment: NutritionPlanAssignment;
    };

export type CoachSummary = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

export type FromCoachDTO = {
  plan: PlanDTO;
  coach: CoachSummary;
  assignmentId: string;
  note: string | null;
  status: AssignmentStatus;
  sentAt: string;
  addedAt: string | null;
  updatedSinceSeen: boolean;
};

export const MAX_PLAN_MEALS = 20;
export const MAX_ITEMS_PER_MEAL = 50;
export const MAX_ITEM_SERVINGS = 100;
const MAX_ITEM_KCAL = 20_000;
const MAX_ITEM_MACRO_G = 2_000;

/** Readable assignment states (the access rule). */
const READABLE_STATUSES = ["sent", "added"] as const;

// ─── Small helpers ────────────────────────────────────────────────────────────

const num = (v: unknown): number =>
  v === null || v === undefined ? 0 : Number(v);
const iso = (d: Date | null | undefined): string | null =>
  d ? d.toISOString() : null;
const round2 = (n: number) => Math.round(n * 100) / 100;

const zero = (): Macros => ({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 });
function add(into: Macros, m: Macros): void {
  into.kcal += m.kcal;
  into.proteinG += m.proteinG;
  into.carbsG += m.carbsG;
  into.fatG += m.fatG;
}
function scale(m: Macros, factor: number): Macros {
  return {
    kcal: round2(m.kcal * factor),
    proteinG: round2(m.proteinG * factor),
    carbsG: round2(m.carbsG * factor),
    fatG: round2(m.fatG * factor),
  };
}
function rounded(m: Macros): Macros {
  return scale(m, 1);
}

function finiteIn(value: unknown, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= max
  );
}

function cleanName(raw: string, max: number): string | null {
  const name = stripNul(raw).trim();
  return name.length >= 1 && name.length <= max ? name : null;
}

export function assignmentDto(row: NutritionPlanAssignment): AssignmentDTO {
  return {
    id: row.id,
    planId: row.planId,
    trainerId: row.trainerId,
    clientId: row.clientId,
    relationshipId: row.relationshipId,
    note: row.note,
    status: row.status as AssignmentStatus,
    seenRevision: row.seenRevision,
    sentAt: row.sentAt.toISOString(),
    addedAt: iso(row.addedAt),
    removedAt: iso(row.removedAt),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * `asOf` for `?since=` lists: two minutes behind the server clock, so a write
 * still open while the list ran is re-read on the next sync (as PER-108's
 * profile list does). A re-read is harmless; a miss is not.
 */
export function listAsOf(now = Date.now()): string {
  return new Date(now - 2 * 60_000).toISOString();
}

type ItemRow = Omit<NutritionPlanItem, "id" | "planMealId">;

// ─── Resolving input into stored rows ────────────────────────────────────────

/**
 * Check a plan body and compute every item's macros from the OWNER's rows.
 * Server-side macro authority, as for food entries: food → per-serving ×
 * servings; recipe → per serving (`total / recipe.servings`) × servings; saved
 * meal → its total × servings; one-off → the given per-serving macros ×
 * servings. Another user's private food, recipe or meal is "not found".
 */
export async function resolvePlanInput(
  db: DbOrTx,
  ownerId: string,
  input: PlanInput,
): Promise<
  | {
      ok: true;
      name: string;
      notes: string | null;
      meals: {
        name: string;
        logSlot: MealSlot;
        sortOrder: number;
        items: ItemRow[];
      }[];
    }
  | { ok: false; error: PlanInputError }
> {
  const name = cleanName(input.name, 80);
  if (!name) return { ok: false, error: "invalid_plan_name" };
  const notes =
    input.notes === undefined || input.notes === null
      ? null
      : stripNul(input.notes).trim() || null;

  const foodIds = new Set<string>();
  const recipeIds = new Set<string>();
  const mealIds = new Set<string>();
  for (const meal of input.meals) {
    for (const item of meal.items) {
      const sources = [
        item.foodId,
        item.recipeId,
        item.mealId,
        item.custom,
      ].filter((s) => s !== undefined && s !== null && s !== "");
      if (sources.length !== 1) return { ok: false, error: "invalid_item" };
      if (!finiteIn(item.servings, MAX_ITEM_SERVINGS) || item.servings <= 0)
        return { ok: false, error: "invalid_item" };
      if (item.foodId) {
        if (!isUuid(item.foodId)) return { ok: false, error: "food_not_found" };
        foodIds.add(item.foodId);
      } else if (item.recipeId) {
        if (!isUuid(item.recipeId))
          return { ok: false, error: "recipe_not_found" };
        recipeIds.add(item.recipeId);
      } else if (item.mealId) {
        if (!isUuid(item.mealId)) return { ok: false, error: "meal_not_found" };
        mealIds.add(item.mealId);
      } else {
        const c = item.custom!;
        if (
          typeof c.name !== "string" ||
          !cleanName(c.name, 200) ||
          !finiteIn(c.kcal, MAX_ITEM_KCAL) ||
          !finiteIn(c.proteinG, MAX_ITEM_MACRO_G) ||
          !finiteIn(c.carbsG, MAX_ITEM_MACRO_G) ||
          !finiteIn(c.fatG, MAX_ITEM_MACRO_G)
        )
          return { ok: false, error: "invalid_item" };
      }
    }
  }

  const foodRows =
    foodIds.size > 0
      ? await db
          .select()
          .from(foods)
          .where(
            and(
              inArray(foods.id, [...foodIds]),
              usableFoodForUserCondition(ownerId),
            ),
          )
      : [];
  const recipeRows =
    recipeIds.size > 0
      ? await db
          .select()
          .from(recipes)
          .where(
            and(
              inArray(recipes.id, [...recipeIds]),
              eq(recipes.userId, ownerId),
              recipeNutritionDataIsUsable(recipes.id),
            ),
          )
      : [];
  const mealRows =
    mealIds.size > 0
      ? await db
          .select()
          .from(meals)
          .where(
            and(inArray(meals.id, [...mealIds]), eq(meals.userId, ownerId)),
          )
      : [];
  const foodById = new Map(foodRows.map((f) => [f.id, f]));
  const recipeById = new Map(recipeRows.map((r) => [r.id, r]));
  const mealById = new Map(mealRows.map((m) => [m.id, m]));

  const outMeals = [];
  for (const [mealIndex, meal] of input.meals.entries()) {
    const mealName = cleanName(meal.name, 40);
    if (!mealName) return { ok: false, error: "invalid_meal_name" };
    const items: ItemRow[] = [];
    for (const [itemIndex, item] of meal.items.entries()) {
      const base = {
        foodId: null as string | null,
        recipeId: null as string | null,
        mealId: null as string | null,
        custom: null as CustomItem | null,
        servings: String(item.servings),
        sortOrder: item.sortOrder ?? itemIndex,
      };
      let perServing: Macros;
      let displayName: string;
      if (item.foodId) {
        const food = foodById.get(item.foodId);
        if (!food) return { ok: false, error: "food_not_found" };
        perServing = {
          kcal: num(food.kcal),
          proteinG: num(food.proteinG),
          carbsG: num(food.carbsG),
          fatG: num(food.fatG),
        };
        displayName = food.name;
        base.foodId = food.id;
      } else if (item.recipeId) {
        const recipe = recipeById.get(item.recipeId);
        if (!recipe) return { ok: false, error: "recipe_not_found" };
        const portions = num(recipe.servings) > 0 ? num(recipe.servings) : 1;
        perServing = scale(
          {
            kcal: num(recipe.totalKcal),
            proteinG: num(recipe.totalProteinG),
            carbsG: num(recipe.totalCarbsG),
            fatG: num(recipe.totalFatG),
          },
          1 / portions,
        );
        displayName = recipe.name;
        base.recipeId = recipe.id;
      } else if (item.mealId) {
        const saved = mealById.get(item.mealId);
        if (!saved) return { ok: false, error: "meal_not_found" };
        perServing = {
          kcal: num(saved.totalKcal),
          proteinG: num(saved.totalProteinG),
          carbsG: num(saved.totalCarbsG),
          fatG: num(saved.totalFatG),
        };
        displayName = saved.name;
        base.mealId = saved.id;
      } else {
        const c = item.custom!;
        const customName = cleanName(c.name, 200)!;
        base.custom = {
          name: customName,
          kcal: c.kcal,
          proteinG: c.proteinG,
          carbsG: c.carbsG,
          fatG: c.fatG,
        };
        perServing = c;
        displayName = customName;
      }
      const total = scale(perServing, item.servings);
      items.push({
        ...base,
        displayName,
        kcal: String(total.kcal),
        proteinG: String(total.proteinG),
        carbsG: String(total.carbsG),
        fatG: String(total.fatG),
      });
    }
    outMeals.push({
      name: mealName,
      logSlot: meal.logSlot,
      sortOrder: meal.sortOrder ?? mealIndex,
      items,
    });
  }
  return { ok: true, name, notes, meals: outMeals };
}

async function insertMeals(
  tx: DbOrTx,
  planId: string,
  mealsIn: {
    name: string;
    logSlot: MealSlot;
    sortOrder: number;
    items: ItemRow[];
  }[],
): Promise<void> {
  for (const meal of mealsIn) {
    const [row] = await tx
      .insert(nutritionPlanMeals)
      .values({
        planId,
        name: meal.name,
        logSlot: meal.logSlot,
        sortOrder: meal.sortOrder,
      })
      .returning({ id: nutritionPlanMeals.id });
    if (meal.items.length > 0) {
      await tx
        .insert(nutritionPlanItems)
        .values(meal.items.map((item) => ({ ...item, planMealId: row.id })));
    }
  }
}

// ─── Reading plans with their embedded summaries ─────────────────────────────

/**
 * Build full plan DTOs for `readerId`. Referenced foods, recipes and meals are
 * read by id WITHOUT an owner filter: the caller has already passed the access
 * rule for each plan, and only rows the plan lists are read.
 *
 * `logEntry` tells the reader exactly what to send to log the item. The owner
 * logs by reference. A client can't reference the coach's private rows (the
 * entry routes are owner-scoped), so they log a one-off with the item's
 * macros, unless the food is from the shared catalogue.
 */
export async function loadPlanDtos(
  db: DbOrTx,
  plans: NutritionPlan[],
  readerId: string,
): Promise<PlanDTO[]> {
  if (plans.length === 0) return [];
  const planIds = plans.map((p) => p.id);
  const mealRows = await db
    .select()
    .from(nutritionPlanMeals)
    .where(inArray(nutritionPlanMeals.planId, planIds))
    .orderBy(asc(nutritionPlanMeals.sortOrder), asc(nutritionPlanMeals.id));
  const itemRows =
    mealRows.length > 0
      ? await db
          .select()
          .from(nutritionPlanItems)
          .where(
            inArray(
              nutritionPlanItems.planMealId,
              mealRows.map((m) => m.id),
            ),
          )
          .orderBy(
            asc(nutritionPlanItems.sortOrder),
            asc(nutritionPlanItems.id),
          )
      : [];

  const recipeIds = [
    ...new Set(itemRows.map((i) => i.recipeId).filter(Boolean)),
  ] as string[];
  const mealIds = [
    ...new Set(itemRows.map((i) => i.mealId).filter(Boolean)),
  ] as string[];
  const recipeRows =
    recipeIds.length > 0
      ? await db.select().from(recipes).where(inArray(recipes.id, recipeIds))
      : [];
  const ingredientRows =
    recipeIds.length > 0
      ? await db
          .select()
          .from(recipeIngredients)
          .where(inArray(recipeIngredients.recipeId, recipeIds))
          .orderBy(asc(recipeIngredients.sortOrder))
      : [];
  const savedMealRows =
    mealIds.length > 0
      ? await db.select().from(meals).where(inArray(meals.id, mealIds))
      : [];
  const foodIds = [
    ...new Set(
      [
        ...itemRows.map((i) => i.foodId),
        ...ingredientRows.map((i) => i.foodId),
      ].filter(Boolean),
    ),
  ] as string[];
  const foodRows =
    foodIds.length > 0
      ? await db.select().from(foods).where(inArray(foods.id, foodIds))
      : [];

  const foodById = new Map(foodRows.map((f) => [f.id, f]));
  const recipeById = new Map(recipeRows.map((r) => [r.id, r]));
  const savedMealById = new Map(savedMealRows.map((m) => [m.id, m]));
  const ingredientsByRecipe = new Map<string, typeof ingredientRows>();
  for (const ing of ingredientRows) {
    const bucket = ingredientsByRecipe.get(ing.recipeId) ?? [];
    bucket.push(ing);
    ingredientsByRecipe.set(ing.recipeId, bucket);
  }
  const itemsByMeal = new Map<string, typeof itemRows>();
  for (const item of itemRows) {
    const bucket = itemsByMeal.get(item.planMealId) ?? [];
    bucket.push(item);
    itemsByMeal.set(item.planMealId, bucket);
  }

  return plans.map((plan) => {
    const isOwner = plan.ownerId === readerId;
    const planTotals = zero();
    const planMeals: PlanMealDTO[] = mealRows
      .filter((m) => m.planId === plan.id)
      .map((meal) => {
        const totals = zero();
        const items = (itemsByMeal.get(meal.id) ?? []).map((row) => {
          const servings = num(row.servings);
          const macros: Macros = {
            kcal: num(row.kcal),
            proteinG: num(row.proteinG),
            carbsG: num(row.carbsG),
            fatG: num(row.fatG),
          };
          add(totals, macros);
          const food = row.foodId ? foodById.get(row.foodId) : undefined;
          const recipe = row.recipeId
            ? recipeById.get(row.recipeId)
            : undefined;
          const saved = row.mealId ? savedMealById.get(row.mealId) : undefined;
          const kind: PlanItemDTO["kind"] = row.foodId
            ? "food"
            : row.recipeId
              ? "recipe"
              : row.mealId
                ? "meal"
                : "custom";
          const name =
            food?.name ??
            recipe?.name ??
            saved?.name ??
            row.custom?.name ??
            row.displayName;

          const oneOff: LogEntryHint = {
            customName: name,
            servings,
            ...macros,
          };
          let logEntry: LogEntryHint = oneOff;
          if (food && (isOwner || food.source === "openfoodfacts")) {
            logEntry = { foodId: food.id, servings };
          } else if (recipe && isOwner) {
            logEntry = { recipeId: recipe.id, servings };
          } else if (saved && isOwner) {
            logEntry = { mealId: saved.id, servings };
          }

          const recipePortions =
            recipe && num(recipe.servings) > 0 ? num(recipe.servings) : 1;
          const dto: PlanItemDTO = {
            id: row.id,
            kind,
            foodId: row.foodId,
            recipeId: row.recipeId,
            mealId: row.mealId,
            name,
            servings,
            sortOrder: row.sortOrder,
            ...rounded(macros),
            food: food
              ? {
                  name: food.name,
                  brand: food.brand,
                  servingSize: num(food.servingSize),
                  servingUnit: food.servingUnit,
                  perServing: {
                    kcal: num(food.kcal),
                    proteinG: num(food.proteinG),
                    carbsG: num(food.carbsG),
                    fatG: num(food.fatG),
                  },
                }
              : null,
            recipe: recipe
              ? {
                  name: recipe.name,
                  photoUrl: recipe.photoUrl,
                  servings: recipePortions,
                  instructions: recipe.instructions,
                  perServing: scale(
                    {
                      kcal: num(recipe.totalKcal),
                      proteinG: num(recipe.totalProteinG),
                      carbsG: num(recipe.totalCarbsG),
                      fatG: num(recipe.totalFatG),
                    },
                    1 / recipePortions,
                  ),
                  ingredients: (ingredientsByRecipe.get(recipe.id) ?? []).map(
                    (ing) => ({
                      name:
                        (ing.foodId ? foodById.get(ing.foodId)?.name : null) ??
                        ing.customName ??
                        "Ingredient",
                      quantity: num(ing.quantity),
                      unit: ing.unit,
                    }),
                  ),
                  sharedByUserId: recipe.sharedByUserId,
                }
              : null,
            meal: saved
              ? {
                  name: saved.name,
                  photoUrl: saved.photoUrl,
                  perServing: {
                    kcal: num(saved.totalKcal),
                    proteinG: num(saved.totalProteinG),
                    carbsG: num(saved.totalCarbsG),
                    fatG: num(saved.totalFatG),
                  },
                }
              : null,
            custom: row.custom,
            logEntry,
          };
          return dto;
        });
        add(planTotals, totals);
        return {
          id: meal.id,
          name: meal.name,
          logSlot: meal.logSlot as MealSlot,
          sortOrder: meal.sortOrder,
          totals: rounded(totals),
          items,
        };
      });
    return {
      id: plan.id,
      ownerId: plan.ownerId,
      name: plan.name,
      notes: plan.notes,
      source: plan.source,
      sourcePlanId: plan.sourcePlanId,
      revision: plan.revision,
      archivedAt: iso(plan.archivedAt),
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
      totals: rounded(planTotals),
      meals: planMeals,
    };
  });
}

// ─── Repository ───────────────────────────────────────────────────────────────

export type CreateOptions = {
  source?: "manual" | "coach" | "duplicate" | "mealprint";
  sourcePlanId?: string | null;
  clientRequestId?: string | null;
};

export type SaveResult =
  | { ok: true; plan: PlanDTO; replayed: boolean }
  | { ok: false; error: PlanInputError };

export type ReplaceResult =
  | { ok: true; plan: PlanDTO }
  | { ok: false; error: PlanInputError | "not_found" }
  | { ok: false; error: "revision_conflict"; current: PlanDTO };

export class NutritionPlanRepository {
  /** The owner's live (not archived) plan, or null. */
  async getOwned(
    ownerId: string,
    planId: string,
    db: DbOrTx = getDb(),
  ): Promise<NutritionPlan | null> {
    if (!isUuid(planId)) return null;
    const rows = await db
      .select()
      .from(nutritionPlans)
      .where(
        and(
          eq(nutritionPlans.id, planId),
          eq(nutritionPlans.ownerId, ownerId),
          isNull(nutritionPlans.archivedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * THE access rule. The owner, or a client with a `sent`/`added` assignment
   * on an ACTIVE relationship with a coach whose account isn't deleted.
   * Archived plans are readable by nobody.
   */
  async getReadable(
    userId: string,
    planId: string,
    db: DbOrTx = getDb(),
  ): Promise<Readable | null> {
    if (!isUuid(planId)) return null;
    const rows = await db
      .select()
      .from(nutritionPlans)
      .where(
        and(eq(nutritionPlans.id, planId), isNull(nutritionPlans.archivedAt)),
      )
      .limit(1);
    const plan = rows[0];
    if (!plan) return null;
    if (plan.ownerId === userId) return { role: "owner", plan };
    const assignment = await this.findClientAssignment(
      userId,
      planId,
      READABLE_STATUSES,
      db,
    );
    return assignment ? { role: "client", plan, assignment } : null;
  }

  /**
   * The client's non-removed assignment of `planId` on an active relationship
   * with a live coach account, limited to `statuses`.
   */
  async findClientAssignment(
    clientId: string,
    planId: string,
    statuses: readonly AssignmentStatus[],
    db: DbOrTx = getDb(),
  ): Promise<NutritionPlanAssignment | null> {
    const rows = await db
      .select({ a: nutritionPlanAssignments })
      .from(nutritionPlanAssignments)
      .innerJoin(
        ptClientRelationships,
        eq(ptClientRelationships.id, nutritionPlanAssignments.relationshipId),
      )
      .innerJoin(profiles, eq(profiles.id, nutritionPlanAssignments.trainerId))
      .where(
        and(
          eq(nutritionPlanAssignments.planId, planId),
          eq(nutritionPlanAssignments.clientId, clientId),
          inArray(nutritionPlanAssignments.status, [...statuses]),
          eq(ptClientRelationships.status, "active"),
          eq(ptClientRelationships.clientId, clientId),
          eq(
            ptClientRelationships.trainerId,
            nutritionPlanAssignments.trainerId,
          ),
          isNull(profiles.deletedAt),
        ),
      )
      .limit(1);
    return rows[0]?.a ?? null;
  }

  async getDto(
    readerId: string,
    plan: NutritionPlan,
    db: DbOrTx = getDb(),
  ): Promise<PlanDTO> {
    const [dto] = await loadPlanDtos(db, [plan], readerId);
    return dto;
  }

  /**
   * The owner's plans. Without `since`: every live plan. With it: plans
   * changed after `since`, archived ones reported in `deletedIds`.
   */
  async listMine(
    ownerId: string,
    since: Date | null,
  ): Promise<{ plans: PlanDTO[]; deletedIds: string[] }> {
    const db = getDb();
    const rows = await db
      .select()
      .from(nutritionPlans)
      .where(
        since
          ? and(
              eq(nutritionPlans.ownerId, ownerId),
              gt(nutritionPlans.updatedAt, since),
            )
          : and(
              eq(nutritionPlans.ownerId, ownerId),
              isNull(nutritionPlans.archivedAt),
            ),
      )
      .orderBy(asc(nutritionPlans.createdAt), asc(nutritionPlans.id));
    const live = rows.filter((r) => r.archivedAt === null);
    return {
      plans: await loadPlanDtos(db, live, ownerId),
      deletedIds: rows.filter((r) => r.archivedAt !== null).map((r) => r.id),
    };
  }

  /**
   * Plans coaches have sent the client. A plan is listed while the access
   * rule holds; with `since`, anything touched after it that no longer
   * passes (removed, dismissed, archived, coaching ended) is in `deletedIds`.
   */
  async listFromCoaches(
    clientId: string,
    since: Date | null,
  ): Promise<{ fromCoaches: FromCoachDTO[]; deletedIds: string[] }> {
    const db = getDb();
    const rows = await db
      .select({
        a: nutritionPlanAssignments,
        plan: nutritionPlans,
        relStatus: ptClientRelationships.status,
        relTrainer: ptClientRelationships.trainerId,
        coachName: profiles.fullName,
        coachAvatar: profiles.avatarUrl,
        coachDeletedAt: profiles.deletedAt,
      })
      .from(nutritionPlanAssignments)
      .innerJoin(
        nutritionPlans,
        eq(nutritionPlans.id, nutritionPlanAssignments.planId),
      )
      .innerJoin(
        ptClientRelationships,
        eq(ptClientRelationships.id, nutritionPlanAssignments.relationshipId),
      )
      .innerJoin(profiles, eq(profiles.id, nutritionPlanAssignments.trainerId))
      .where(
        since
          ? and(
              eq(nutritionPlanAssignments.clientId, clientId),
              // The coach's profile too: soft-delete and restore only
              // touch `profiles` (deleted_at + updated_at), and either flips
              // the access rule. Any other profile edit just re-sends the
              // plan, which is harmless.
              or(
                gt(nutritionPlanAssignments.updatedAt, since),
                gt(nutritionPlans.updatedAt, since),
                gt(profiles.updatedAt, since),
              ),
            )
          : and(
              eq(nutritionPlanAssignments.clientId, clientId),
              inArray(nutritionPlanAssignments.status, [...READABLE_STATUSES]),
            ),
      )
      .orderBy(
        asc(nutritionPlanAssignments.sentAt),
        asc(nutritionPlanAssignments.id),
      );

    const visible = rows.filter(
      (r) =>
        (READABLE_STATUSES as readonly string[]).includes(r.a.status) &&
        r.relStatus === "active" &&
        r.relTrainer === r.a.trainerId &&
        r.plan.archivedAt === null &&
        r.coachDeletedAt === null,
    );
    const visiblePlanIds = new Set(visible.map((r) => r.plan.id));
    const deletedIds = [
      ...new Set(
        rows
          .filter((r) => !visiblePlanIds.has(r.plan.id))
          .map((r) => r.plan.id),
      ),
    ];
    const dtos = await loadPlanDtos(
      db,
      visible.map((r) => r.plan),
      clientId,
    );
    const dtoById = new Map(dtos.map((d) => [d.id, d]));
    return {
      fromCoaches: visible.map((r) => ({
        plan: dtoById.get(r.plan.id)!,
        coach: {
          id: r.a.trainerId,
          name: r.coachName ?? "Your coach",
          avatarUrl: r.coachAvatar,
        },
        assignmentId: r.a.id,
        note: r.a.note,
        status: r.a.status as AssignmentStatus,
        sentAt: r.a.sentAt.toISOString(),
        addedAt: iso(r.a.addedAt),
        updatedSinceSeen: r.plan.revision > r.a.seenRevision,
      })),
      deletedIds,
    };
  }

  /** Create a plan for `ownerId`; a replayed key returns the first plan. */
  async create(
    ownerId: string,
    input: PlanInput,
    opts: CreateOptions = {},
  ): Promise<SaveResult> {
    const db = getDb();
    const key = opts.clientRequestId ?? null;
    if (key) {
      const existing = await this.findByKey(ownerId, key, db);
      if (existing)
        return {
          ok: true,
          plan: await this.getDto(ownerId, existing, db),
          replayed: true,
        };
    }
    const resolved = await resolvePlanInput(db, ownerId, input);
    if (!resolved.ok) return resolved;
    return db.transaction(async (tx) => {
      const inserted = await tx
        .insert(nutritionPlans)
        .values({
          ownerId,
          name: resolved.name,
          notes: resolved.notes,
          source: opts.source ?? "manual",
          sourcePlanId: opts.sourcePlanId ?? null,
          clientRequestId: key,
        })
        .onConflictDoNothing({
          target: [nutritionPlans.ownerId, nutritionPlans.clientRequestId],
        })
        .returning();
      if (!inserted[0]) {
        // Lost a race with the same key: the winner's plan is the answer.
        const winner = (await this.findByKey(ownerId, key!, tx))!;
        return {
          ok: true as const,
          plan: await this.getDto(ownerId, winner, tx),
          replayed: true,
        };
      }
      await insertMeals(tx, inserted[0].id, resolved.meals);
      return {
        ok: true as const,
        plan: await this.getDto(ownerId, inserted[0], tx),
        replayed: false,
      };
    });
  }

  async findByKey(
    ownerId: string,
    key: string,
    db: DbOrTx = getDb(),
  ): Promise<NutritionPlan | null> {
    const rows = await db
      .select()
      .from(nutritionPlans)
      .where(
        and(
          eq(nutritionPlans.ownerId, ownerId),
          eq(nutritionPlans.clientRequestId, key),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Full replace of name, notes, meals and items; owner only. A stale
   * `expectedRevision` → `revision_conflict` with the current plan. Without
   * one (older apps), the last write wins.
   */
  async replace(
    ownerId: string,
    planId: string,
    input: PlanInput,
    expectedRevision?: number,
  ): Promise<ReplaceResult> {
    const db = getDb();
    const resolved = await resolvePlanInput(db, ownerId, input);
    return db.transaction(async (tx) => {
      const locked = await tx
        .select()
        .from(nutritionPlans)
        .where(
          and(
            eq(nutritionPlans.id, planId),
            eq(nutritionPlans.ownerId, ownerId),
            isNull(nutritionPlans.archivedAt),
          ),
        )
        .for("update");
      const plan = locked[0];
      if (!plan) return { ok: false as const, error: "not_found" as const };
      if (
        expectedRevision !== undefined &&
        expectedRevision !== plan.revision
      ) {
        return {
          ok: false as const,
          error: "revision_conflict" as const,
          current: await this.getDto(ownerId, plan, tx),
        };
      }
      if (!resolved.ok) return resolved;
      await tx
        .delete(nutritionPlanMeals)
        .where(eq(nutritionPlanMeals.planId, plan.id));
      await insertMeals(tx, plan.id, resolved.meals);
      const [updated] = await tx
        .update(nutritionPlans)
        .set({
          name: resolved.name,
          notes: resolved.notes,
          revision: plan.revision + 1,
          updatedAt: new Date(),
        })
        .where(eq(nutritionPlans.id, plan.id))
        .returning();
      return {
        ok: true as const,
        plan: await this.getDto(ownerId, updated, tx),
      };
    });
  }

  /**
   * Archive the owner's plan. Idempotent: an already-archived plan is
   * "archived" again. Its assignments become `removed`; logged food is never
   * touched. Returns false when the caller doesn't own the plan.
   */
  async archive(ownerId: string, planId: string): Promise<boolean> {
    if (!isUuid(planId)) return false;
    const db = getDb();
    return db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: nutritionPlans.id,
          archivedAt: nutritionPlans.archivedAt,
        })
        .from(nutritionPlans)
        .where(
          and(
            eq(nutritionPlans.id, planId),
            eq(nutritionPlans.ownerId, ownerId),
          ),
        )
        .for("update");
      if (!rows[0]) return false;
      const now = new Date();
      if (rows[0].archivedAt === null) {
        await tx
          .update(nutritionPlans)
          .set({ archivedAt: now, updatedAt: now })
          .where(eq(nutritionPlans.id, planId));
      }
      await tx
        .update(nutritionPlanAssignments)
        .set({ status: "removed", removedAt: now, updatedAt: now })
        .where(
          and(
            eq(nutritionPlanAssignments.planId, planId),
            ne(nutritionPlanAssignments.status, "removed"),
          ),
        );
      return true;
    });
  }

  /** Does a plan with this id exist at all (owner-agnostic)? For 403 vs 404. */
  async planOwner(planId: string): Promise<string | null> {
    if (!isUuid(planId)) return null;
    const rows = await getDb()
      .select({ ownerId: nutritionPlans.ownerId })
      .from(nutritionPlans)
      .where(eq(nutritionPlans.id, planId))
      .limit(1);
    return rows[0]?.ownerId ?? null;
  }
}

/**
 * Coaching ended (or the plan was archived): every non-removed assignment on
 * this relationship from this coach becomes `removed`, inside the caller's
 * transaction. Without this, reviving the relationship would make old
 * assignments readable again.
 */
export async function removePlanAssignmentsForRelationship(
  tx: DbTransaction | DbOrTx,
  relationshipId: string,
  trainerId: string,
): Promise<number> {
  const now = new Date();
  const rows = await tx
    .update(nutritionPlanAssignments)
    .set({ status: "removed", removedAt: now, updatedAt: now })
    .where(
      and(
        eq(nutritionPlanAssignments.relationshipId, relationshipId),
        eq(nutritionPlanAssignments.trainerId, trainerId),
        ne(nutritionPlanAssignments.status, "removed"),
      ),
    )
    .returning({ id: nutritionPlanAssignments.id });
  return rows.length;
}

/** For tests and the shopping list: plan meals + items of plans already checked. */
export async function loadPlanItems(
  db: DbOrTx,
  planIds: string[],
): Promise<NutritionPlanItem[]> {
  if (planIds.length === 0) return [];
  return db
    .select({ i: nutritionPlanItems })
    .from(nutritionPlanItems)
    .innerJoin(
      nutritionPlanMeals,
      eq(nutritionPlanMeals.id, nutritionPlanItems.planMealId),
    )
    .where(inArray(nutritionPlanMeals.planId, planIds))
    .then((rows) => rows.map((r) => r.i));
}
