import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  foods,
  meals,
  mealItems,
  mealPlanMeals,
  mealPlans,
  recipeIngredients,
  recipes,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { type EffortLevel } from "../nutrition/mealprint/preferences/vocabulary";
import type {
  ShoppingFoodRow,
  ShoppingListSource,
  ShoppingMealItemRow,
  ShoppingMealTotal,
  ShoppingRecipeIngredientRow,
  ShoppingRecipeTotal,
} from "../nutrition/mealprint/plans/shopping/deriveShoppingList";
import {
  mealNutritionDataIsUsable,
  PlanNutritionUnavailableError,
  recipeNutritionDataIsUsable,
} from "./nutritionDataValidity";
import { usableFoodForUserCondition } from "./foodRepository";

/**
 * Mealprint (spec-26 § 2.3, Phase 2) — accepted meal plans and their meals.
 *
 * `userId` is first on every method and every query filters by it. There is no
 * cross-user read: a coach-authored plan is a future surface
 * (`meal_plans.created_by_user_id` exists for it) but v1 has no path that reads
 * another user's plan, so the narrow interface is the authorization design, not
 * an omission.
 *
 * ⚠ **The client never supplies macros.** `create` takes item references and the
 * caller (the accept handler) recomputes every macro from DB rows before calling
 * in. That is why {@link CreatePlanMealInput} carries numbers but the ROUTE
 * schema does not accept them — see `nutritionPlansCreateHandler`. A repository
 * that trusted client macros would let a user log 3000 kcal as 300.
 */

export const PLAN_STATUSES = ["draft", "active", "archived"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const PLAN_MEAL_STATES = ["planned", "logged", "skipped"] as const;
export type PlanMealState = (typeof PLAN_MEAL_STATES)[number];

export const LOG_SLOTS = ["breakfast", "lunch", "snack", "dinner"] as const;
export type LogSlot = (typeof LOG_SLOTS)[number];

export type PlanMealItem = { foodId: string; servings: number };

export type MealPlanMealDTO = {
  id: string;
  sortOrder: number;
  label: string;
  logSlot: LogSlot;
  recipeId: string | null;
  mealId: string | null;
  items: PlanMealItem[] | null;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  aiReason: string | null;
  state: PlanMealState;
  loggedEntryId: string | null;
};

export type MealPlanDTO = {
  id: string;
  userId: string;
  status: PlanStatus;
  planDate: string;
  groupId: string | null;
  mealsPerDay: number;
  effortLevel: EffortLevel;
  targetKcal: number;
  targetProteinG: number;
  targetCarbsG: number;
  targetFatG: number;
  source: string;
  createdByUserId: string | null;
  createdAt: string | null;
  acceptedAt: string | null;
  meals: MealPlanMealDTO[];
};

export type CreatePlanMealInput = {
  sortOrder: number;
  label: string;
  logSlot: LogSlot;
  recipeId?: string | null;
  mealId?: string | null;
  items?: PlanMealItem[] | null;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  aiReason?: string | null;
};

export type CreatePlanInput = {
  planDate: string;
  groupId?: string | null;
  mealsPerDay: number;
  effortLevel: EffortLevel;
  targetKcal: number;
  targetProteinG: number;
  targetCarbsG: number;
  targetFatG: number;
  source?: string;
  createdByUserId?: string | null;
  meals: CreatePlanMealInput[];
};

/**
 * Thrown when `create` would breach `meal_plans_one_active_per_date`. The
 * handler turns this into a 409 so the client can offer "replace today's plan"
 * rather than rendering a generic failure.
 *
 * ⚠ This exists because the guard is a DB constraint, not an application check.
 * A read-then-insert would race under a double tap — two requests both see no
 * active plan, both insert, and the user ends up with two plans for one day.
 * Letting Postgres arbitrate and translating the error is the only version that
 * holds under concurrency.
 */
export class ActivePlanExistsError extends Error {
  /**
   * ⚠ Declared-then-assigned rather than a `public readonly` constructor
   * parameter property. `packages/web` compiles with `erasableSyntaxOnly`, and
   * its Eden client pulls this file in through the `CoreApi` type — so a
   * parameter property here fails the WEB typecheck (TS1294) with no web file
   * touched. Same class of coupling as `reference_web_eden_couples_to_core_type`.
   */
  readonly planDate: string;

  constructor(planDate: string) {
    super(`an active plan already exists for ${planDate}`);
    this.name = "ActivePlanExistsError";
    this.planDate = planDate;
  }
}

/** Postgres unique-violation SQLSTATE. */
const PG_UNIQUE_VIOLATION = "23505";

function isActivePlanConflict(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const constraint = (error as { constraint_name?: unknown } | null)
    ?.constraint_name;
  return (
    code === PG_UNIQUE_VIOLATION &&
    // Guard on the constraint NAME as well as the code: this insert also has a
    // primary key, and treating any unique violation as "you already have a
    // plan today" would mislabel an id collision.
    (constraint === undefined ||
      constraint === "meal_plans_one_active_per_date")
  );
}

type PlanRow = typeof mealPlans.$inferSelect;
type MealRow = typeof mealPlanMeals.$inferSelect;

function toMealDTO(row: MealRow): MealPlanMealDTO {
  return {
    id: row.id,
    sortOrder: row.sortOrder,
    label: row.label,
    logSlot: row.logSlot as LogSlot,
    recipeId: row.recipeId,
    mealId: row.mealId,
    // `items` is unvalidated jsonb at the DB boundary. The repository is the
    // only writer and it writes the shape below, so a cast is honest here —
    // but it stays a cast rather than a claim, hence the null-coalesce.
    items: (row.items as PlanMealItem[] | null) ?? null,
    kcal: Number(row.kcal),
    proteinG: Number(row.proteinG),
    carbsG: Number(row.carbsG),
    fatG: Number(row.fatG),
    aiReason: row.aiReason,
    state: row.state as PlanMealState,
    loggedEntryId: row.loggedEntryId,
  };
}

function toPlanDTO(row: PlanRow, meals: MealRow[]): MealPlanDTO {
  return {
    id: row.id,
    userId: row.userId,
    status: row.status as PlanStatus,
    planDate: row.planDate,
    groupId: row.groupId,
    mealsPerDay: row.mealsPerDay,
    effortLevel: row.effortLevel as EffortLevel,
    targetKcal: Number(row.targetKcal),
    targetProteinG: Number(row.targetProteinG),
    targetCarbsG: Number(row.targetCarbsG),
    targetFatG: Number(row.targetFatG),
    source: row.source,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt?.toISOString() ?? null,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    meals: meals
      // Order in JS rather than relying on the query: `hydrate` fetches meals
      // for several plans in ONE query (see the N+1 note there), so a single
      // ORDER BY cannot express per-plan ordering.
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(toMealDTO),
  };
}

export class MealPlanRepository {
  /**
   * Persist a reviewed draft as the ACTIVE plan for its date (AC 4.5).
   *
   * ⚠ Not a transaction, and that is a deliberate, bounded compromise. This
   * repo reaches Supabase through the Transaction-mode pooler (:6543) with
   * `prepare: false`; `db.transaction()` over pgbouncer in transaction mode
   * pins a server connection for the whole block, and under Lambda scale-out
   * that is the exact pattern that exhausted the pool before. The failure mode
   * here is a plan row with no meals, which `hydrate` renders as an empty plan
   * rather than corrupting anything — so the insert order is plan-then-meals
   * and a partial write is recoverable by deleting the plan. If this ever needs
   * atomicity, the fix is a single INSERT ... SELECT with a CTE, not a
   * transaction.
   */
  async create(userId: string, input: CreatePlanInput): Promise<MealPlanDTO> {
    const db = getDb();

    let planRow: PlanRow;
    try {
      const inserted = await db
        .insert(mealPlans)
        .values({
          userId,
          // Accepting a plan is what makes it active — 'draft' is never written
          // by this path (see the schema note on why the state exists).
          status: "active",
          planDate: input.planDate,
          groupId: input.groupId ?? null,
          mealsPerDay: input.mealsPerDay,
          effortLevel: input.effortLevel,
          targetKcal: String(input.targetKcal),
          targetProteinG: String(input.targetProteinG),
          targetCarbsG: String(input.targetCarbsG),
          targetFatG: String(input.targetFatG),
          source: input.source ?? "ai",
          createdByUserId: input.createdByUserId ?? null,
          acceptedAt: new Date(),
        })
        .returning();
      planRow = inserted[0]!;
    } catch (error) {
      if (isActivePlanConflict(error)) {
        throw new ActivePlanExistsError(input.planDate);
      }
      throw error;
    }

    if (input.meals.length === 0) {
      return toPlanDTO(planRow, []);
    }

    const mealRows = await db
      .insert(mealPlanMeals)
      .values(
        input.meals.map((meal) => ({
          planId: planRow.id,
          sortOrder: meal.sortOrder,
          label: meal.label,
          logSlot: meal.logSlot,
          recipeId: meal.recipeId ?? null,
          mealId: meal.mealId ?? null,
          items: meal.items ?? null,
          kcal: String(meal.kcal),
          proteinG: String(meal.proteinG),
          carbsG: String(meal.carbsG),
          fatG: String(meal.fatG),
          aiReason: meal.aiReason ?? null,
        })),
      )
      .returning();

    return toPlanDTO(planRow, mealRows);
  }

  /**
   * Attach meals to plan rows in ONE extra query rather than one per plan.
   *
   * ⚠ `inArray` with an empty list renders `IN ()`, which is a syntax error in
   * Postgres — hence the early return. Drizzle does not guard this for us and
   * it is the standard way this helper breaks.
   */
  private async hydrate(rows: PlanRow[]): Promise<MealPlanDTO[]> {
    if (rows.length === 0) return [];
    const db = getDb();

    const meals = await db
      .select()
      .from(mealPlanMeals)
      .where(
        inArray(
          mealPlanMeals.planId,
          rows.map((row) => row.id),
        ),
      );

    const byPlan = new Map<string, MealRow[]>();
    for (const meal of meals) {
      const bucket = byPlan.get(meal.planId);
      if (bucket) bucket.push(meal);
      else byPlan.set(meal.planId, [meal]);
    }

    return rows.map((row) => toPlanDTO(row, byPlan.get(row.id) ?? []));
  }

  /** Ownership-checked read. Returns null for another user's plan id. */
  async get(userId: string, planId: string): Promise<MealPlanDTO | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(mealPlans)
      .where(and(eq(mealPlans.userId, userId), eq(mealPlans.id, planId)))
      .limit(1);

    const hydrated = await this.hydrate(rows);
    return hydrated[0] ?? null;
  }

  /**
   * Ownership-checked read of everything `deriveShoppingList` needs to
   * explode ONE plan's meals into a shopping list (spec-26 amendment §B.3).
   * Returns null for a foreign/nonexistent plan id, same as {@link get}.
   *
   * ⚠ Sequential awaits, not `Promise.all` — deliberately. This method has no
   * hot-path latency requirement (a shopping-list read, not plan generation),
   * and sequential queries keep the call order — and therefore the mocked-DB
   * test queue order — trivially readable. See the repo's own note on why
   * `create()` is not a transaction for the general reasoning on trading a
   * little latency for a simpler, more provably-correct implementation here.
   */
  async getShoppingSource(
    userId: string,
    planId: string,
  ): Promise<ShoppingListSource | null> {
    const plan = await this.get(userId, planId);
    if (!plan) return null;

    const db = getDb();

    const recipeIds = [
      ...new Set(
        plan.meals
          .map((m) => m.recipeId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const mealIds = [
      ...new Set(
        plan.meals
          .map((m) => m.mealId)
          .filter((id): id is string => id !== null),
      ),
    ];

    const recipeIngredientRows =
      recipeIds.length > 0
        ? await db
            .select({
              recipeId: recipeIngredients.recipeId,
              foodId: recipeIngredients.foodId,
              customName: recipeIngredients.customName,
              quantity: recipeIngredients.quantity,
              unit: recipeIngredients.unit,
            })
            .from(recipeIngredients)
            .where(inArray(recipeIngredients.recipeId, recipeIds))
        : [];

    const mealItemRows =
      mealIds.length > 0
        ? await db
            .select({
              mealId: mealItems.mealId,
              foodId: mealItems.foodId,
              recipeId: mealItems.recipeId,
              servings: mealItems.servings,
            })
            .from(mealItems)
            .where(inArray(mealItems.mealId, mealIds))
        : [];

    const recipeTotalRows =
      recipeIds.length > 0
        ? await db
            .select({ id: recipes.id, totalKcal: recipes.totalKcal })
            .from(recipes)
            .where(
              and(
                inArray(recipes.id, recipeIds),
                eq(recipes.userId, userId),
                recipeNutritionDataIsUsable(recipes.id),
              ),
            )
        : [];

    const mealTotalRows =
      mealIds.length > 0
        ? await db
            .select({ id: meals.id, totalKcal: meals.totalKcal })
            .from(meals)
            .where(
              and(
                inArray(meals.id, mealIds),
                eq(meals.userId, userId),
                mealNutritionDataIsUsable(meals.id),
              ),
            )
        : [];

    const foodIds = new Set<string>();
    for (const meal of plan.meals) {
      for (const item of meal.items ?? []) foodIds.add(item.foodId);
    }
    for (const row of recipeIngredientRows) {
      if (row.foodId) foodIds.add(row.foodId);
    }
    for (const row of mealItemRows) {
      if (row.foodId) foodIds.add(row.foodId);
    }

    const foodRows =
      foodIds.size > 0
        ? await db
            .select({
              id: foods.id,
              name: foods.name,
              servingSize: foods.servingSize,
              servingUnit: foods.servingUnit,
              servingQuantity: foods.servingQuantity,
              categoryTags: foods.categoryTags,
            })
            .from(foods)
            .where(
              and(
                inArray(foods.id, [...foodIds]),
                usableFoodForUserCondition(userId),
              ),
            )
        : [];

    // Missing rows mean a source was deleted, moved out of the caller's scope,
    // or quarantined after this plan was accepted. Do not derive a partial
    // shopping list that still recommends an unusable meal.
    if (
      recipeTotalRows.length !== recipeIds.length ||
      mealTotalRows.length !== mealIds.length ||
      foodRows.length !== foodIds.size
    ) {
      throw new PlanNutritionUnavailableError();
    }

    const recipeIngredientsOut: ShoppingRecipeIngredientRow[] =
      recipeIngredientRows.map((row) => ({
        recipeId: row.recipeId,
        foodId: row.foodId,
        customName: row.customName,
        quantity: Number(row.quantity),
        unit: row.unit,
      }));

    const mealItemsOut: ShoppingMealItemRow[] = mealItemRows.map((row) => ({
      mealId: row.mealId,
      foodId: row.foodId,
      recipeId: row.recipeId,
      servings: Number(row.servings),
    }));

    const foodsOut: ShoppingFoodRow[] = foodRows.map((row) => ({
      id: row.id,
      name: row.name,
      servingSize: Number(row.servingSize),
      servingUnit: row.servingUnit,
      servingQuantity:
        row.servingQuantity == null ? null : Number(row.servingQuantity),
      categoryTags: (row.categoryTags as string[] | null) ?? null,
    }));

    const recipeTotalsOut: ShoppingRecipeTotal[] = recipeTotalRows.map(
      (row) => ({
        id: row.id,
        totalKcal: row.totalKcal == null ? null : Number(row.totalKcal),
      }),
    );

    const mealTotalsOut: ShoppingMealTotal[] = mealTotalRows.map((row) => ({
      id: row.id,
      // `meals.totalKcal` is `NOT NULL` — unlike a recipe's, which may be
      // un-materialised — so no null-guard is needed here.
      totalKcal: Number(row.totalKcal),
    }));

    return {
      planId: plan.id,
      meals: plan.meals.map((m) => ({
        kcal: m.kcal,
        recipeId: m.recipeId,
        mealId: m.mealId,
        items: m.items,
      })),
      recipeIngredients: recipeIngredientsOut,
      mealItems: mealItemsOut,
      foods: foodsOut,
      recipeTotals: recipeTotalsOut,
      mealTotals: mealTotalsOut,
    };
  }

  /**
   * The ACTIVE plan for a date, if any — the Fuel "Today" read.
   *
   * Scoped to `status = 'active'` so an archived plan for the same date never
   * shadows the current one. `plan_date` is a `date` column, so no timezone
   * conversion is needed here — unlike `nutrition_entries.logged_at`, which is
   * timestamptz and must be bucketed into the user's local day.
   */
  async getActiveForDate(
    userId: string,
    planDate: string,
  ): Promise<MealPlanDTO | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(mealPlans)
      .where(
        and(
          eq(mealPlans.userId, userId),
          eq(mealPlans.planDate, planDate),
          eq(mealPlans.status, "active"),
        ),
      )
      .limit(1);

    const hydrated = await this.hydrate(rows);
    return hydrated[0] ?? null;
  }

  /** Recent plans, newest planned-date first. History surface. */
  async listRecent(userId: string, limit = 30): Promise<MealPlanDTO[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(mealPlans)
      .where(eq(mealPlans.userId, userId))
      .orderBy(desc(mealPlans.planDate))
      .limit(limit);

    return this.hydrate(rows);
  }

  /** Every plan in a Phase 3 week group, ascending by date. */
  async listByGroup(userId: string, groupId: string): Promise<MealPlanDTO[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(mealPlans)
      .where(and(eq(mealPlans.userId, userId), eq(mealPlans.groupId, groupId)))
      .orderBy(mealPlans.planDate);

    return this.hydrate(rows);
  }

  /** Archive a plan — frees the active slot for its date. */
  async archive(userId: string, planId: string): Promise<MealPlanDTO | null> {
    const db = getDb();
    const updated = await db
      .update(mealPlans)
      .set({ status: "archived" })
      .where(and(eq(mealPlans.userId, userId), eq(mealPlans.id, planId)))
      .returning();

    if (updated.length === 0) return null;
    return this.get(userId, planId);
  }

  /**
   * Re-date a plan ("use again"), keeping it active.
   *
   * ⚠ Surfaces {@link ActivePlanExistsError} rather than silently archiving
   * whatever already occupies the target date. Overwriting a day the user has
   * possibly already logged against is not a decision a repository should make
   * on its own.
   */
  async redate(
    userId: string,
    planId: string,
    planDate: string,
  ): Promise<MealPlanDTO | null> {
    const db = getDb();
    try {
      const updated = await db
        .update(mealPlans)
        .set({ planDate, status: "active" })
        .where(and(eq(mealPlans.userId, userId), eq(mealPlans.id, planId)))
        .returning();

      if (updated.length === 0) return null;
    } catch (error) {
      if (isActivePlanConflict(error)) {
        throw new ActivePlanExistsError(planDate);
      }
      throw error;
    }
    return this.get(userId, planId);
  }

  /**
   * Delete a plan. Its meals cascade; **logged nutrition entries survive**
   * (AC 5.4) because `meal_plan_meals.logged_entry_id` is ON DELETE SET NULL in
   * the entry direction and the cascade only runs plan → meals. Verified by
   * `mealPlanRepository.test.ts`.
   *
   * Returns false when the id is not the caller's, so the handler answers 404
   * rather than a misleading 204.
   */
  async remove(userId: string, planId: string): Promise<boolean> {
    const db = getDb();
    const deleted = await db
      .delete(mealPlans)
      .where(and(eq(mealPlans.userId, userId), eq(mealPlans.id, planId)))
      .returning({ id: mealPlans.id });

    return deleted.length > 0;
  }

  /**
   * Link a planned meal to the entry it was logged as, and flip its state.
   *
   * ⚠ The ownership check is a correlated subquery on the PARENT plan, not a
   * filter on the meal id. `meal_plan_meals` carries no `user_id` — so without
   * the join to `meal_plans` this method would happily mutate another user's
   * planned meal given its id. That is the single most important line in this
   * file.
   *
   * ⚠ Also guarded on `state <> 'logged'`, which makes a double tap idempotent
   * in effect: the second call updates zero rows and returns false, so the
   * handler will not create a second nutrition entry for the same meal.
   */
  async markMealLogged(
    userId: string,
    planId: string,
    mealId: string,
    entryId: string,
  ): Promise<boolean> {
    const db = getDb();
    const updated = await db
      .update(mealPlanMeals)
      .set({ state: "logged", loggedEntryId: entryId })
      .where(
        and(
          eq(mealPlanMeals.id, mealId),
          eq(mealPlanMeals.planId, planId),
          sql`${mealPlanMeals.state} <> 'logged'`,
          sql`EXISTS (SELECT 1 FROM ${mealPlans} WHERE ${mealPlans.id} = ${planId} AND ${mealPlans.userId} = ${userId})`,
        ),
      )
      .returning({ id: mealPlanMeals.id });

    return updated.length > 0;
  }

  /** Mark a planned meal skipped. Same ownership reasoning as above. */
  async markMealSkipped(
    userId: string,
    planId: string,
    mealId: string,
  ): Promise<boolean> {
    const db = getDb();
    const updated = await db
      .update(mealPlanMeals)
      .set({ state: "skipped" })
      .where(
        and(
          eq(mealPlanMeals.id, mealId),
          eq(mealPlanMeals.planId, planId),
          sql`EXISTS (SELECT 1 FROM ${mealPlans} WHERE ${mealPlans.id} = ${planId} AND ${mealPlans.userId} = ${userId})`,
        ),
      )
      .returning({ id: mealPlanMeals.id });

    return updated.length > 0;
  }

  /**
   * Replace ONE meal in an accepted plan (the post-accept swap path, AC 4.4).
   *
   * Resets `state` to 'planned' and clears `loggedEntryId`: the row now
   * describes different food, so a stale 'logged' link would attribute an
   * existing entry to a meal the user never ate. ⚠ Clearing the link does NOT
   * delete the entry — un-logging is a separate, explicit action.
   */
  async replaceMeal(
    userId: string,
    planId: string,
    mealId: string,
    meal: Omit<CreatePlanMealInput, "sortOrder">,
  ): Promise<MealPlanDTO | null> {
    const db = getDb();
    const updated = await db
      .update(mealPlanMeals)
      .set({
        label: meal.label,
        logSlot: meal.logSlot,
        recipeId: meal.recipeId ?? null,
        mealId: meal.mealId ?? null,
        items: meal.items ?? null,
        kcal: String(meal.kcal),
        proteinG: String(meal.proteinG),
        carbsG: String(meal.carbsG),
        fatG: String(meal.fatG),
        aiReason: meal.aiReason ?? null,
        state: "planned",
        loggedEntryId: null,
      })
      .where(
        and(
          eq(mealPlanMeals.id, mealId),
          eq(mealPlanMeals.planId, planId),
          sql`EXISTS (SELECT 1 FROM ${mealPlans} WHERE ${mealPlans.id} = ${planId} AND ${mealPlans.userId} = ${userId})`,
        ),
      )
      .returning({ id: mealPlanMeals.id });

    if (updated.length === 0) return null;
    return this.get(userId, planId);
  }
}
