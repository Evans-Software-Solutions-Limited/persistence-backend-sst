import { and, eq, inArray } from "drizzle-orm";
import {
  foods,
  nutritionPlanItems,
  nutritionPlanMeals,
  nutritionPlans,
  recipeIngredients,
  recipes,
  type Food,
  type NutritionPlan,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { DbOrTx } from "../../repositories/personalRecordsRepository";
import {
  NutritionPlanRepository,
  type PlanDTO,
} from "../../repositories/nutritionPlanRepository";

/**
 * Design D (PER-118): copies that the recipient owns — Duplicate, and the coach
 * → client recipe share. Spec 38's copy rules: the copy carries attribution
 * (`recipes.source_recipe_id`, `shared_by_user_id`), a recipe is copied into an
 * account at most once per source, and private foods are copied, never
 * dropped. Everything runs in one transaction, so a retry after a lost
 * response finds either nothing or the whole copy.
 */

/** The shared catalogue is readable by everyone; anything else is private to its creator. */
function usableBy(food: Food, userId: string): boolean {
  return food.source === "openfoodfacts" || food.createdBy === userId;
}

/** Per-transaction memo so one food is copied once per copy operation. */
export type FoodCopies = Map<string, string>;

/**
 * The id `toUserId` should use for `foodId`: the same food when they can use
 * it, otherwise a private copy they own (macros, serving and tags carried
 * over). Null when the food no longer exists.
 */
export async function foodForRecipient(
  tx: DbOrTx,
  foodId: string,
  toUserId: string,
  memo: FoodCopies,
): Promise<string | null> {
  const memoised = memo.get(foodId);
  if (memoised) return memoised;
  const rows = await tx
    .select()
    .from(foods)
    .where(eq(foods.id, foodId))
    .limit(1);
  const food = rows[0];
  if (!food) return null;
  if (usableBy(food, toUserId)) {
    memo.set(foodId, food.id);
    return food.id;
  }
  const [copy] = await tx
    .insert(foods)
    .values({
      name: food.name,
      brand: food.brand,
      barcode: food.barcode,
      kcal: food.kcal,
      proteinG: food.proteinG,
      carbsG: food.carbsG,
      fatG: food.fatG,
      servingSize: food.servingSize,
      servingUnit: food.servingUnit,
      servingQuantity: food.servingQuantity,
      allergenTags: food.allergenTags,
      categoryTags: food.categoryTags,
      localeTags: food.localeTags,
      nutritionDataValid: food.nutritionDataValid,
      nutritionDataIssue: food.nutritionDataIssue,
      source: "user",
      createdBy: toUserId,
    })
    .returning({ id: foods.id });
  memo.set(foodId, copy.id);
  return copy.id;
}

export type RecipeCopyResult =
  | { ok: true; recipeId: string; created: boolean }
  | { ok: false; error: "recipe_not_found" };

/**
 * Copy `sourceRecipeId` (owned by `fromUserId`) into `toUserId`'s recipes with
 * attribution. Idempotent on `(source_recipe_id, recipient)`: an existing copy
 * is returned as is.
 */
export async function copyRecipeToUser(
  tx: DbOrTx,
  sourceRecipeId: string,
  fromUserId: string,
  toUserId: string,
  memo: FoodCopies = new Map(),
): Promise<RecipeCopyResult> {
  // Ownership first: only the owner's recipe can be shared or copied, even
  // when the recipient already holds a copy (another coach must not be able
  // to "share" it and learn the copy's id).
  const sourceRows = await tx
    .select()
    .from(recipes)
    .where(and(eq(recipes.id, sourceRecipeId), eq(recipes.userId, fromUserId)))
    .limit(1);
  const source = sourceRows[0];
  if (!source) return { ok: false, error: "recipe_not_found" };
  const existing = await tx
    .select({ id: recipes.id })
    .from(recipes)
    .where(
      and(
        eq(recipes.userId, toUserId),
        eq(recipes.sourceRecipeId, sourceRecipeId),
      ),
    )
    .limit(1);
  if (existing[0])
    return { ok: true, recipeId: existing[0].id, created: false };
  const ingredients = await tx
    .select()
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, source.id));

  const inserted = await tx
    .insert(recipes)
    .values({
      userId: toUserId,
      name: source.name,
      photoUrl: source.photoUrl,
      servings: source.servings,
      instructions: source.instructions,
      source: source.source,
      sourceUrl: source.sourceUrl,
      totalKcal: source.totalKcal,
      totalProteinG: source.totalProteinG,
      totalCarbsG: source.totalCarbsG,
      totalFatG: source.totalFatG,
      sourceRecipeId: source.id,
      sharedByUserId: fromUserId,
    })
    .onConflictDoNothing({ target: [recipes.userId, recipes.sourceRecipeId] })
    .returning({ id: recipes.id });
  if (!inserted[0]) {
    // A concurrent copy won; it is the answer.
    const winner = await tx
      .select({ id: recipes.id })
      .from(recipes)
      .where(
        and(
          eq(recipes.userId, toUserId),
          eq(recipes.sourceRecipeId, sourceRecipeId),
        ),
      )
      .limit(1);
    return { ok: true, recipeId: winner[0]!.id, created: false };
  }
  const recipeId = inserted[0].id;
  if (ingredients.length > 0) {
    const rows = [];
    for (const ing of ingredients) {
      const foodId = ing.foodId
        ? await foodForRecipient(tx, ing.foodId, toUserId, memo)
        : null;
      rows.push({
        recipeId,
        foodId,
        customName: ing.customName,
        quantity: ing.quantity,
        unit: ing.unit,
        sortOrder: ing.sortOrder,
      });
    }
    await tx.insert(recipeIngredients).values(rows);
  }
  return { ok: true, recipeId, created: true };
}

/**
 * `POST /nutrition/meal-plans/:id/duplicate`: copy a plan the caller can read
 * into their own plans. Their own plan is copied by reference. A coach plan is
 * made self-contained for the client: coach recipes are copied with
 * attribution, the coach's private foods are copied, and saved meals (which
 * can't be shared) become one-off items with the same name and macros. Item
 * macros are kept exactly as the plan showed them.
 *
 * Replay-safe: the `Idempotency-Key` is the new plan's `client_request_id`,
 * and the whole copy is one transaction.
 */
export async function duplicatePlan(
  source: NutritionPlan,
  toUserId: string,
  clientRequestId: string | null,
): Promise<{ plan: PlanDTO; replayed: boolean }> {
  const repo = new NutritionPlanRepository();
  const db = getDb();
  if (clientRequestId) {
    const existing = await repo.findByKey(toUserId, clientRequestId, db);
    if (existing)
      return {
        plan: await repo.getDto(toUserId, existing, db),
        replayed: true,
      };
  }
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(nutritionPlans)
      .values({
        ownerId: toUserId,
        name: source.name,
        notes: source.notes,
        source: "duplicate",
        sourcePlanId: source.id,
        clientRequestId,
      })
      .onConflictDoNothing({
        target: [nutritionPlans.ownerId, nutritionPlans.clientRequestId],
      })
      .returning();
    if (!inserted[0]) {
      const winner = (await repo.findByKey(toUserId, clientRequestId!, tx))!;
      return { plan: await repo.getDto(toUserId, winner, tx), replayed: true };
    }
    const plan = inserted[0];
    const crossUser = source.ownerId !== toUserId;
    const memo: FoodCopies = new Map();

    const sourceMeals = await tx
      .select()
      .from(nutritionPlanMeals)
      .where(eq(nutritionPlanMeals.planId, source.id));
    const sourceItems =
      sourceMeals.length > 0
        ? await tx
            .select()
            .from(nutritionPlanItems)
            .where(
              inArray(
                nutritionPlanItems.planMealId,
                sourceMeals.map((m) => m.id),
              ),
            )
        : [];

    for (const meal of sourceMeals) {
      const [newMeal] = await tx
        .insert(nutritionPlanMeals)
        .values({
          planId: plan.id,
          name: meal.name,
          logSlot: meal.logSlot,
          sortOrder: meal.sortOrder,
        })
        .returning({ id: nutritionPlanMeals.id });
      for (const item of sourceItems.filter((i) => i.planMealId === meal.id)) {
        let { foodId, recipeId, mealId, custom } = item;
        if (crossUser) {
          // A one-off with the item's own name and macros, per serving.
          const servings = Number(item.servings) || 1;
          const flatten = () => ({
            name: item.displayName || "Item",
            kcal: Number(item.kcal) / servings,
            proteinG: Number(item.proteinG) / servings,
            carbsG: Number(item.carbsG) / servings,
            fatG: Number(item.fatG) / servings,
          });
          if (foodId) {
            const mapped = await foodForRecipient(tx, foodId, toUserId, memo);
            if (!mapped) {
              foodId = null;
              custom = flatten();
            } else foodId = mapped;
          } else if (recipeId) {
            const copied = await copyRecipeToUser(
              tx,
              recipeId,
              source.ownerId,
              toUserId,
              memo,
            );
            if (copied.ok) recipeId = copied.recipeId;
            else {
              recipeId = null;
              custom = flatten();
            }
          } else if (mealId) {
            mealId = null;
            custom = flatten();
          }
        }
        await tx.insert(nutritionPlanItems).values({
          planMealId: newMeal.id,
          foodId,
          recipeId,
          mealId,
          custom,
          displayName: item.displayName,
          servings: item.servings,
          kcal: item.kcal,
          proteinG: item.proteinG,
          carbsG: item.carbsG,
          fatG: item.fatG,
          sortOrder: item.sortOrder,
        });
      }
    }
    return { plan: await repo.getDto(toUserId, plan, tx), replayed: false };
  });
}
