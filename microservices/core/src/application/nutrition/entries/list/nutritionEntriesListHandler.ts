import Elysia, { t } from "elysia";
import { NutritionEntryService } from "../../../repositories/nutritionEntryService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/** GET /nutrition/entries?date=YYYY-MM-DD — a day's entries, newest first. */
export const nutritionEntriesListHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(NutritionEntryService)
  .get(
    "/nutrition/entries",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const entries = await ctx.NutritionEntryRepository.listByDate(
        userId,
        ctx.query.date,
      );
      return { data: entries };
    },
    {
      query: t.Object({
        date: t.String(),
      }),
    },
  );
