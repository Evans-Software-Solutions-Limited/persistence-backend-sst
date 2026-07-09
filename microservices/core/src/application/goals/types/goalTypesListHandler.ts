import Elysia from "elysia";
import { GoalService } from "../../repositories/goalService";
import {
  getAuthUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";

export const goalTypesListHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(GoalService)
  .get("/goal-types", async (ctx) => {
    const goalTypes = await ctx.GoalRepository.listTypes();

    return { data: goalTypes };
  });
