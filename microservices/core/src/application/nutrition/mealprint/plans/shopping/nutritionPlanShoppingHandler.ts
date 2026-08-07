import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { MealPlanService } from "../../../../repositories/mealPlanService";
import { deriveShoppingList } from "./deriveShoppingList";

/**
 * `GET /nutrition/plans/:id/shopping` — spec-26 amendment §B. A day-scoped
 * shopping list, computed on read from ONE accepted plan's exploded meals.
 * Nothing is stored (§B.1 DECISION: week-scoping + persisted checklist state
 * are later slices; check-off state lives client-side in SQLite per §B.2).
 *
 * Ownership-checked and ungated exactly like `nutritionPlansReadHandlers`:
 * same "reading a plan you already generated must survive a lapsed
 * subscription" reasoning (see that file's docstring), and the same
 * 404-for-another-user's-id posture — a 403 would confirm the plan exists.
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
      const source = await ctx.MealPlanRepository.getShoppingSource(
        userId,
        ctx.params.id,
      );
      if (!source) {
        ctx.set.status = 404;
        return { error: "not_found" };
      }
      return { data: deriveShoppingList(source) };
    },
    { params: t.Object({ id: t.String({ format: "uuid" }) }) },
  );
