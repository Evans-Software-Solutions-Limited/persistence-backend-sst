import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { logClientSessionOnBehalf } from "./logClientSession";

/**
 * POST /trainers/me/clients/:clientId/sessions — canonical route (cross-cuts
 * § 1.2) for a coach logging a workout session ON BEHALF OF a client they
 * actively train (10-trainer-features STORY-010).
 *
 * Authorization + write + audit + notification live in the shared
 * `logClientSessionOnBehalf` core (role-first-then-active-relationship gate,
 * session + audit row in one transaction, `workout_logged_on_behalf`
 * notification post-commit). The session is written for the CLIENT
 * (`user_id = clientId`) with `logged_by_user_id = trainerId`. The body
 * mirrors the self `POST /sessions` validator exactly.
 */
export const trainersMeLogClientSessionHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .post(
    "/trainers/me/clients/:clientId/sessions",
    async (ctx) => {
      const { sub: trainerId } = getUser(ctx);
      const { clientId } = ctx.params as { clientId: string };
      const body = ctx.body as Record<string, unknown>;

      const result = await logClientSessionOnBehalf({
        trainerId,
        clientId,
        body,
      });

      if (!result.ok) {
        ctx.set.status = result.status;
        return result.body;
      }

      ctx.set.status = 201;
      return { data: result.session };
    },
    {
      params: t.Object({ clientId: t.String({ minLength: 1 }) }),
      body: t.Object({
        workoutId: t.Optional(t.String()),
        name: t.Optional(t.String()),
        status: t.Optional(
          t.Union([
            t.Literal("in_progress"),
            t.Literal("completed"),
            t.Literal("cancelled"),
          ]),
        ),
        userNotes: t.Optional(t.String()),
      }),
    },
  );
