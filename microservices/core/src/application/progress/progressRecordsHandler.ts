import Elysia from "elysia";
import { ProgressService } from "../repositories/progressService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const progressRecordsHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(ProgressService)
  .get("/progress/records", async (ctx) => {
    const { sub: userId } = getUser(ctx);
    const records = await ctx.ProgressRepository.getRecords(userId);
    return { data: records };
  });
