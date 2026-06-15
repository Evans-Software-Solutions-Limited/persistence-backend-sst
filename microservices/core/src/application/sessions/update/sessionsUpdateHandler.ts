import Elysia, { t } from "elysia";
import { SessionService } from "../../repositories/sessionService";
import { PersonalRecordsService } from "../../repositories/personalRecordsService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { safeEvaluateStreaks, resolveEventTs } from "../../streaks/evaluate";
import { safeRecomputeVolume } from "../../progress/recompute";

export const sessionsUpdateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(SessionService)
  .use(PersonalRecordsService)
  .patch(
    "/sessions/:sessionId",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { sessionId } = ctx.params;
      const body = ctx.body as Record<string, unknown>;

      // Allow updating specific fields
      const allowedFields = [
        "name",
        "status",
        "completedAt",
        "totalDurationSeconds",
        "userNotes",
        "trainerFeedback",
        "sessionRating",
        "overallRpe",
        "difficultyRanking",
      ];

      const updateData: Record<string, unknown> = {};
      for (const field of allowedFields) {
        if (field in body) {
          updateData[field] = body[field];
        }
      }

      if (Object.keys(updateData).length === 0) {
        ctx.set.status = 400;
        return { error: "No valid fields to update" };
      }

      // Only snapshot the pre-update state when the PATCH could
      // transition the session to `completed` — i.e. when the body
      // explicitly sets `status: "completed"`. Otherwise we'd burn
      // 2 extra DB queries (getById = session SELECT + exercises
      // JOIN) on every PATCH that touches notes / rating / RPE /
      // any other non-status field. That's a 4× round-trip
      // amplification on the hot path the mobile client uses for
      // mid-session metadata updates (bugbot finding, PR #48).
      const couldTransitionToCompleted = body.status === "completed";
      const previous = couldTransitionToCompleted
        ? await ctx.SessionRepository.getById(sessionId, userId)
        : null;

      const session = await ctx.SessionRepository.update(
        sessionId,
        userId,
        updateData,
      );

      if (!session) {
        ctx.set.status = 404;
        return { error: "Session not found" };
      }

      // Detect the in_progress → completed transition. Run AFTER the
      // session update commits so a PR-detection failure doesn't roll
      // back the session-complete state — the user always sees their
      // session marked done. PR detection is idempotent (unique index
      // + value comparison in personalRecordsRepository), so a missed
      // run can be re-attempted safely on a follow-up PATCH.
      //
      // Gated on couldTransitionToCompleted so we never reach this
      // path without `previous` being snapshotted above.
      const wasCompletedBefore = previous?.status === "completed";
      const isCompletedNow = session.status === "completed";
      if (couldTransitionToCompleted && !wasCompletedBefore && isCompletedNow) {
        try {
          await ctx.PersonalRecordsRepository.recordPRsForSession(
            userId,
            sessionId,
          );
        } catch (err) {
          // Don't fail the request — session is already in completed
          // state. Log so we can investigate; client-side predictive
          // PR detection still surfaces the values on the Summary
          // screen even if the server-side write didn't happen yet.
          console.error("[sessionsUpdateHandler] PR detection failed", {
            userId,
            sessionId,
            error: err,
          });
        }

        // Advance the workout streak (STORY-006). Fire-and-forget +
        // error-tolerant — same posture as PR detection above. completedAt is
        // clamped to now (never future) so it can't push the streak past
        // genuinely-missed periods.
        await safeEvaluateStreaks(
          userId,
          "workout_logged",
          resolveEventTs(body.completedAt),
        );
        await safeRecomputeVolume(userId);
      }

      return { data: session };
    },
    {
      params: t.Object({
        sessionId: t.String(),
      }),
      body: t.Object({
        name: t.Optional(t.String()),
        status: t.Optional(t.String()),
        completedAt: t.Optional(t.Union([t.String(), t.Null()])),
        totalDurationSeconds: t.Optional(t.Number()),
        userNotes: t.Optional(t.String()),
        trainerFeedback: t.Optional(t.String()),
        sessionRating: t.Optional(t.Number()),
        overallRpe: t.Optional(t.Number()),
        difficultyRanking: t.Optional(t.Number()),
      }),
    },
  );
