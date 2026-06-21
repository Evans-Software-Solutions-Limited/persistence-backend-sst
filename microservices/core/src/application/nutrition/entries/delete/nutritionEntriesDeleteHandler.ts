import Elysia, { t } from "elysia";
import { NutritionEntryService } from "../../../repositories/nutritionEntryService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * DELETE /nutrition/entries/:id — remove an owned entry. Ownership folded into
 * the mutation WHERE; a non-match returns 404 (don't leak existence).
 */
export const nutritionEntriesDeleteHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(NutritionEntryService)
  .delete(
    "/nutrition/entries/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const deleted = await ctx.NutritionEntryRepository.delete(
        ctx.params.id,
        userId,
      );

      if (!deleted) {
        ctx.set.status = 404;
        return { error: "entry_not_found" };
      }

      return { data: { id: ctx.params.id, deleted: true } };
    },
    {
      params: t.Object({ id: t.String() }),
    },
  );
