import Elysia, { t } from "elysia";
import { SessionService } from "../../repositories/sessionService";
import { PersonalRecordsService } from "../../repositories/personalRecordsService";
import { WorkoutService } from "../../repositories/workoutService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import type { RecordSessionInput } from "../../repositories/sessionRepository";
import {
  assertEntitlement,
  EntitlementError,
} from "../../entitlement/assertEntitlement";
import { safeEvaluateStreaks } from "../../streaks/evaluate";
import { safeRecomputeVolume } from "../../progress/recompute";

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
  .use(WorkoutService)
  .post(
    "/sessions/record",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const payload = ctx.body as RecordSessionInput;

      // Server-side entitlement gate (M10.5). Enforced UNLESS the
      // recorded session references a workout template the calling
      // user OWNS — i.e., the user already paid the entitlement-count
      // for that workout at template-create time via POST /workouts.
      //
      // Why workoutId alone is NOT a safe discriminator (Inspector
      // Brad PR #72 high-severity find — sweep #2):
      //   - `recordSession` inserts only into `workout_sessions` /
      //     `session_exercises` / `exercise_sets`. It does NOT insert
      //     into `workouts`, so the AFTER-INSERT trigger on `workouts`
      //     (subscription_limits 'workouts' counter, see migration
      //     004 line 450) does NOT fire from this path.
      //   - The FK on `workout_sessions.workout_id` is uncorrelated
      //     with `user_id`. A free-tier user at-cap could pass ANY
      //     valid UUID (a public/shared workout, or even someone
      //     else's private workout if they discovered the UUID) and
      //     bypass the gate. The session insert would succeed.
      //   - Therefore: only skip the gate when the workout is OWNED
      //     by the caller (`workout.createdBy === userId`). A null
      //     workoutId (ad-hoc session) or a non-owned workoutId
      //     (someone else's template, a public workout) runs the gate.
      //
      // WorkoutRepository.getById applies visibility checks (private /
      // friends / public) so a malicious user can't discover workout
      // existence through this path — `null` covers both "doesn't
      // exist" and "exists but not visible to you". We additionally
      // require `createdBy === userId` for the entitlement skip;
      // visibility-only access (e.g., a PT-shared workout) still runs
      // the gate.
      //
      // Position: BEFORE the recordSession transaction (so a denied
      // request never opens a Postgres transaction at all).
      //
      // Spec: specs/11-payments-subscriptions/requirements.md AC 9.4
      let canSkipGate = false;
      if (payload.workoutId !== undefined && payload.workoutId !== null) {
        const referencedWorkout = await ctx.WorkoutRepository.getById(
          payload.workoutId,
          userId,
        );
        if (
          referencedWorkout !== null &&
          referencedWorkout.createdBy === userId
        ) {
          canSkipGate = true;
        }
      }
      if (!canSkipGate) {
        const verdict = await assertEntitlement(userId, "create_workout");
        if (!verdict.allowed) {
          throw new EntitlementError(verdict, "create_workout");
        }
      }

      // Hand off the PR-detection function to the repo so it can run
      // inside the same transaction. Keeps SessionRepository free of
      // a direct PersonalRecordsRepository import — DI via the handler.
      const recorded = await ctx.SessionRepository.recordSession(
        userId,
        payload,
        (uid, sessionId, tx) =>
          ctx.PersonalRecordsRepository.recordPRsForSession(uid, sessionId, tx),
      );

      // Advance the workout streak for a completed session (STORY-006).
      // Cancelled sessions don't count. Fire-and-forget + error-tolerant:
      // the session + PRs already committed in the transaction above.
      if (payload.status === "completed") {
        const completedTs = payload.completedAt
          ? new Date(payload.completedAt)
          : new Date();
        await safeEvaluateStreaks(userId, "workout_logged", completedTs);
        // Backup volume recompute so Home/You weekly volume is fresh before
        // the 03:00 cron (design.md § Risks — two-write redundancy).
        await safeRecomputeVolume(userId);
      }

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
