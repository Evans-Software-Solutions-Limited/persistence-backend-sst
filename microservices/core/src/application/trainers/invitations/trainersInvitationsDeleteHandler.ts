import Elysia, { t } from "elysia";
import { TrainerService } from "../../repositories/trainerService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * DELETE /trainers/me/invitations/:id — cancel a pending invitation,
 * ownership-scoped. Trainer-role-gated. 404 when the invitation doesn't
 * exist, isn't pending, or belongs to another trainer (we don't distinguish,
 * to avoid leaking existence).
 */
export const trainersInvitationsDeleteHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(TrainerService)
  .delete(
    "/trainers/me/invitations/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);

      if (!(await ctx.TrainerRepository.isTrainer(userId))) {
        ctx.set.status = 403;
        return { message: "Forbidden" };
      }

      const { id } = ctx.params;
      const cancelled = await ctx.TrainerRepository.cancelInvitation(
        userId,
        id,
      );

      if (!cancelled) {
        ctx.set.status = 404;
        return { message: "Invitation not found" };
      }

      return { data: { success: true } };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  );
