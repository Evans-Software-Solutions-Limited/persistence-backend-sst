import Elysia, { t } from "elysia";
import { SessionService } from "../../repositories/sessionService";
import { PersonalRecordsService } from "../../repositories/personalRecordsService";
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

      // Server-side entitlement gate (M10.5). Only enforced when the
      // recorded session represents a FRESH workout — i.e., when the
      // payload doesn't reference an existing workout template
      // (`workoutId` is null or absent). Re-recording a session
      // against an existing template is the user logging another
      // instance of a workout they already had — no new entitlement
      // cost.
      //
      // Why workoutId is the right discriminator (TRACE):
      //   - `recordSession` inserts only into `workout_sessions` /
      //     `session_exercises` / `exercise_sets`. It does NOT insert
      //     into `workouts`, so the AFTER-INSERT trigger on `workouts`
      //     (subscription_limits 'workouts' counter, see migration
      //     004 line 450) does NOT fire from this path. The "workout
      //     count" the gate compares against is the count of `workouts`
      //     rows, which the user grew via POST /workouts.
      //   - Therefore: when `workoutId` is set, the session points at
      //     an existing template the user already paid the
      //     entitlement-count for at template-create time. Allowing
      //     the session record adds zero to the count.
      //   - When `workoutId` is null, the session is ad-hoc / freeform.
      //     The brief's policy is to count these toward the limit even
      //     though no `workouts` row gets inserted. We enforce the gate
      //     here so a user at-cap on workouts can't bypass the gate by
      //     recording ad-hoc sessions instead of creating templates.
      //
      // Position: BEFORE the recordSession transaction (so a denied
      // request never opens a Postgres transaction at all).
      //
      // Spec: specs/11-payments-subscriptions/requirements.md AC 9.4
      const isFreshWorkout =
        payload.workoutId === undefined || payload.workoutId === null;
      if (isFreshWorkout) {
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
