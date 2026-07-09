import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import {
  sendClientBriefOnBehalf,
  CLIENT_BRIEF_MAX_LENGTH,
} from "./sendClientBrief";

/**
 * POST /trainers/me/clients/:clientId/brief — a coach sends a client a
 * free-text brief (M17 "Send brief"). Authorization + notification-row +
 * audit + push live in the shared `sendClientBriefOnBehalf` core.
 */
export const trainersMeSendClientBriefHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .post(
    "/trainers/me/clients/:clientId/brief",
    async (ctx) => {
      const { sub: trainerId } = getUser(ctx);
      const { clientId } = ctx.params as { clientId: string };
      const body = ctx.body as { message: string };

      // The schema's minLength admits whitespace-only strings; a brief must
      // carry actual content, so trim first and reject an empty result.
      const message = body.message.trim();
      if (message.length === 0) {
        ctx.set.status = 422;
        return {
          code: "invalid_message",
          message: "Brief message cannot be empty",
        };
      }

      const result = await sendClientBriefOnBehalf({
        trainerId,
        clientId,
        message,
      });

      if (!result.ok) {
        ctx.set.status = result.status;
        return result.body;
      }

      ctx.set.status = 201;
      return { data: result.notification };
    },
    {
      params: t.Object({ clientId: t.String({ minLength: 1 }) }),
      body: t.Object({
        message: t.String({ minLength: 1, maxLength: CLIENT_BRIEF_MAX_LENGTH }),
      }),
    },
  );
