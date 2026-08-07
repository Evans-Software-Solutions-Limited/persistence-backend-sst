import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { MealPlanService } from "../../../../repositories/mealPlanService";
import { deriveShoppingList } from "./deriveShoppingList";
import {
  assertEntitlement,
  EntitlementError,
} from "../../../../entitlement/assertEntitlement";
import { PlanNutritionUnavailableError } from "../../../../repositories/nutritionDataValidity";

/**
 * `GET /nutrition/plans/:id/shopping` — spec-26 amendment §B. A day-scoped
 * shopping list, computed on read from ONE accepted plan's exploded meals.
 * Nothing is stored (§B.1 DECISION: week-scoping + persisted checklist state
 * are later slices; check-off state lives client-side in SQLite per §B.2).
 *
 * Ownership-checked and Mealprint-gated. The source plan is retained after a
 * lapse, but its derived shopping list is unavailable until resubscription.
 */
export const nutritionPlanShoppingHandlers = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(MealPlanService)
  .get(
    "/nutrition/plans/:id/shopping",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const verdict = await assertEntitlement(userId, "meal_ai");
      if (!verdict.allowed) throw new EntitlementError(verdict, "meal_ai");
      let source;
      try {
        source = await ctx.MealPlanRepository.getShoppingSource(
          userId,
          ctx.params.id,
        );
      } catch (error) {
        if (error instanceof PlanNutritionUnavailableError) {
          ctx.set.status = 409;
          return { error: "plan_nutrition_unavailable" };
        }
        throw error;
      }
      if (!source) {
        ctx.set.status = 404;
        return { error: "not_found" };
      }
      return { data: deriveShoppingList(source) };
    },
    { params: t.Object({ id: t.String({ format: "uuid" }) }) },
  );
