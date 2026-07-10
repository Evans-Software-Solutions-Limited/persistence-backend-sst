import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import type { RecordSessionInput } from "../../repositories/sessionRepository";
import { recordClientSessionOnBehalf } from "./recordClientSession";

/**
 * POST /trainers/me/clients/:clientId/sessions/record — a coach BULK-RECORDS a
 * full session (root + exercises + sets, with PR detection + adherence linking)
 * ON BEHALF OF a client they actively train. The M18 Start-live path: the coach
 * runs an in-person session on their own device reusing the athlete
 * active-session UI, and Finish records it as the CLIENT's session with
 * `logged_by_user_id = trainerId`.
 *
 * The on-behalf sibling of the self `POST /sessions/record` — same
 * `RecordSessionInput` body validator (reused verbatim, min 1 exercise) — but
 * without the self route's entitlement gate (the trainer↔client relationship IS
 * the authorization; see `recordClientSessionOnBehalf`). Auth + write + audit +
 * post-commit side effects all live in that shared core.
 *
 * Static `sessions/record` segment, so it never collides with either the bare
 * `:clientId` detail GET or the `POST .../sessions` header-log route.
 */
export const trainersMeRecordClientSessionHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .post(
    "/trainers/me/clients/:clientId/sessions/record",
    async (ctx) => {
      const { sub: trainerId } = getUser(ctx);
      const { clientId } = ctx.params as { clientId: string };
      const payload = ctx.body as RecordSessionInput;

      const result = await recordClientSessionOnBehalf({
        trainerId,
        clientId,
        payload,
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
      // Reuses the self POST /sessions/record validator verbatim (cross-cuts
      // § 1.2 — same body shape as the self route).
      body: t.Object({
        // M13 sync-hardening: retry-dedup id, scoped to the client's id (the
        // on-behalf path passes clientId as user_id into recordSession).
        clientSessionId: t.Optional(t.Union([t.String(), t.Null()])),
        workoutId: t.Optional(t.Union([t.String(), t.Null()])),
        name: t.Optional(t.Union([t.String(), t.Null()])),
        startedAt: t.String(),
        completedAt: t.Optional(t.Union([t.String(), t.Null()])),
        status: t.Union([t.Literal("completed"), t.Literal("cancelled")]),
        totalDurationSeconds: t.Optional(t.Union([t.Number(), t.Null()])),
        userNotes: t.Optional(t.Union([t.String(), t.Null()])),
        sessionRating: t.Optional(t.Union([t.Number(), t.Null()])),
        overallRpe: t.Optional(t.Union([t.Number(), t.Null()])),
        difficultyRanking: t.Optional(t.Union([t.Number(), t.Null()])),
        exercises: t.Array(
          t.Object({
            exerciseId: t.String(),
            sortOrder: t.Number(),
            supersetGroup: t.Optional(t.Union([t.Number(), t.Null()])),
            isSubstituted: t.Optional(t.Boolean()),
            originalExerciseId: t.Optional(t.Union([t.String(), t.Null()])),
            notes: t.Optional(t.Union([t.String(), t.Null()])),
            sets: t.Array(
              t.Object({
                setNumber: t.Number(),
                reps: t.Optional(t.Union([t.Number(), t.Null()])),
                weightKg: t.Optional(
                  t.Union([t.String(), t.Number(), t.Null()]),
                ),
                durationSeconds: t.Optional(t.Union([t.Number(), t.Null()])),
                distanceMeters: t.Optional(
                  t.Union([t.String(), t.Number(), t.Null()]),
                ),
                rpe: t.Optional(t.Union([t.Number(), t.Null()])),
                restAfterSeconds: t.Optional(t.Union([t.Number(), t.Null()])),
                isCompleted: t.Optional(t.Boolean()),
                completedAt: t.Optional(t.Union([t.String(), t.Null()])),
              }),
            ),
          }),
          { minItems: 1 },
        ),
      }),
    },
  );
