import Elysia, { t } from "elysia";
import { SessionService } from "../../repositories/sessionService";
import { PersonalRecordsService } from "../../repositories/personalRecordsService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import type { RecordSessionInput } from "../../repositories/sessionRepository";

/**
 * POST /sessions/record
 *
 * Bulk-record a completed (or cancelled) session in one atomic
 * transaction. Mobile keeps the active session in local state; on
 * Finish (or Discard) it builds the full payload — root row +
 * nested exercises + nested sets — and POSTs once.
 *
 * Why this rather than the piecemeal POST chain:
 *
 *   - Atomic: session row + every exercise + every set + PR detection
 *     all in one Postgres transaction. No partial-flush states.
 *   - Mid-session reordering / supersetting / substitution are pure
 *     mobile-local-state concerns. Final shape lands in this POST.
 *   - One round-trip per session vs N+M+2 for the piecemeal chain.
 *
 * The piecemeal endpoints (POST /sessions, POST /sessions/:id/
 * exercises, POST .../sets, PATCH /sessions/:id) remain available
 * for editing already-completed sessions — M4 progress edits, trainer
 * review notes in M8 — but the active-session flush path is bulk-only.
 *
 * Spec: specs/milestones/M3-active-session/BACKEND_BRIEF.md § 7.
 */
export const sessionsRecordHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(SessionService)
  .use(PersonalRecordsService)
  .post(
    "/sessions/record",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const payload = ctx.body as RecordSessionInput;

      // Hand off the PR-detection function to the repo so it can run
      // inside the same transaction. Keeps SessionRepository free of
      // a direct PersonalRecordsRepository import — DI via the handler.
      const recorded = await ctx.SessionRepository.recordSession(
        userId,
        payload,
        (uid, sessionId, tx) =>
          ctx.PersonalRecordsRepository.recordPRsForSession(uid, sessionId, tx),
      );

      ctx.set.status = 201;
      return { data: recorded };
    },
    {
      body: t.Object({
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
        // At least one exercise is required — mirrors legacy
        // recordWorkout's validation. Empty sessions (user opens
        // workout, taps Cancel without logging) take the discard
        // path through CancelSessionCommand instead.
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
