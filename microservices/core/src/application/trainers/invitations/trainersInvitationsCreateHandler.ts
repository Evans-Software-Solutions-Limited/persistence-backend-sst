import Elysia, { t } from "elysia";
import { TrainerService } from "../../repositories/trainerService";
import { InviteError } from "../../repositories/trainerRepository";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * POST /trainers/me/invitations — invite a client by email. Trainer-role-gated.
 *
 * Body: { clientEmail: string, relationshipReason?: string }
 *
 * Maps the repository's `InviteError` to a JSON error body carrying a stable
 * `code` (self_invite → 400, no_slots → 403, exists → 409). Success returns
 * the `InviteClientResult` shape with `action: relationship_created |
 * invitation_created`.
 */
export const trainersInvitationsCreateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(TrainerService)
  .post(
    "/trainers/me/invitations",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);

      if (!(await ctx.TrainerRepository.isTrainer(userId))) {
        ctx.set.status = 403;
        return { message: "Forbidden" };
      }

      const body = ctx.body as {
        clientEmail: string;
        relationshipReason?: string;
      };

      try {
        const result = await ctx.TrainerRepository.inviteClientByEmail(
          userId,
          body.clientEmail,
          body.relationshipReason ?? null,
        );
        ctx.set.status = 201;
        return { data: result };
      } catch (err) {
        if (err instanceof InviteError) {
          ctx.set.status = err.status;
          return { code: err.code, message: err.message };
        }
        // Surface the real error so it's visible in logs/response.
        // Do NOT log the client email (PII → CloudWatch); userId + message
        // is enough to triage, and the email adds no diagnostic value.
        console.error(
          `[trainers:invite] unhandled error for trainer=${userId}:`,
          err instanceof Error ? err.message : err,
          err instanceof Error ? err.stack : "",
        );
        throw err;
      }
    },
    {
      body: t.Object({
        clientEmail: t.String(),
        relationshipReason: t.Optional(t.String()),
      }),
    },
  );
