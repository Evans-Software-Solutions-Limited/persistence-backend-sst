import Elysia, { t } from "elysia";
import { ProgramService } from "../repositories/programService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { todayIso } from "../trainers/programs/shared";

/**
 * GET /programs/:id — ATHLETE-facing programme detail (specs/19-programs —
 * athlete view). Returns the programme metadata + its ordered workout cycle +
 * the caller's own assignment context (status + current week), so an athlete
 * can open the plan their coach assigned and start any workout in it.
 *
 * Authorisation IS the assignment: the repository returns the programme only
 * when the caller has an assignment to it (any status). Missing OR not-mine
 * both surface as 404 (no existence leak — mirrors the coach GET). Other
 * clients' assignments are never included in the athlete payload.
 *
 * This is deliberately distinct from `GET /trainers/me/programs/:id` (the
 * coach editor read, owner-scoped): the coach path is gated on
 * `created_by`/trainer role; this one is gated on the caller being a client
 * of the programme.
 */
export const programGetHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(ProgramService)
  .get(
    "/programs/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);

      const detail = await ctx.ProgramRepository.getForAthlete(
        userId,
        ctx.params.id,
        todayIso(),
      );
      if (!detail) {
        ctx.set.status = 404;
        return { code: "not_found", message: "Programme not found" };
      }
      return { data: detail };
    },
    { params: t.Object({ id: t.String({ minLength: 1 }) }) },
  );
