import Elysia, { t } from "elysia";
import { ProgramService } from "../../repositories/programService";
import { TrainerService } from "../../repositories/trainerService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { hasActiveRelationship } from "../relationships/activeRelationshipGuard";
import { ISO_DATE_PATTERN, todayIso } from "./shared";
import { emitTrainerOnBehalfNotification } from "../onBehalfNotifications";

/**
 * POST /trainers/me/programs/:id/assign — assign a programme to an active
 * client (specs/19-programs STORY-003). Creates the `program_assignments`
 * row and MATERIALISES `workout_assignments` occurrences in one
 * transaction. 403 without an active non-AI relationship; 404 un-owned
 * programme; 409 already live for this client; 422 empty cycle.
 *
 * Audit note (T-19.2.9): `trainer_actions_audit` (spec-10 Phase 10.1/10.2)
 * doesn't exist yet — when it lands, this write gains a transactional
 * audit row per cross-cuts § 1.4.
 *
 * Notification (QA-10, device-QA sweep BRIEF-7): the occurrence
 * materialisation used to fire a legacy per-row DB trigger
 * (`assignment_notifications`), so assigning ONE programme flooded the
 * client with N pushes (one per occurrence). That trigger is dropped
 * (migration 20260722120000) — this handler now emits exactly ONE
 * `workout_assigned` notification per programme assignment, post-commit,
 * best-effort, mirroring `assignClientWorkoutOnBehalf`.
 */
export const trainersProgramsAssignHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(TrainerService)
  .use(ProgramService)
  .post(
    "/trainers/me/programs/:id/assign",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);

      if (!(await ctx.TrainerRepository.isTrainer(userId))) {
        ctx.set.status = 403;
        return { message: "Forbidden" };
      }
      if (!(await hasActiveRelationship(userId, ctx.body.clientId))) {
        ctx.set.status = 403;
        return {
          code: "not_your_client",
          message: "You can only assign programmes to your active clients",
        };
      }

      const result = await ctx.ProgramAssignmentRepository.assign(
        userId,
        ctx.params.id,
        {
          clientId: ctx.body.clientId,
          startDate: ctx.body.startDate,
          showInPlan: ctx.body.showInPlan,
          showInLibrary: ctx.body.showInLibrary,
        },
        todayIso(),
      );

      if ("error" in result) {
        if (result.error === "not_found") {
          ctx.set.status = 404;
          return { code: "not_found", message: "Programme not found" };
        }
        if (result.error === "already_assigned") {
          ctx.set.status = 409;
          return {
            code: "already_assigned",
            message: "This client already has this programme live",
          };
        }
        ctx.set.status = 422;
        return {
          code: "PROGRAM_EMPTY",
          message: "Add workouts to the programme before assigning it",
        };
      }

      await emitTrainerOnBehalfNotification({
        clientId: ctx.body.clientId,
        trainerId: userId,
        // Reuses the existing `workout_assigned` enum value — a distinct
        // "programme_assigned" type would need its own enum migration for
        // no behavioural gain (this IS a workout-assignment notification).
        type: "workout_assigned",
        title: "New programme from your coach",
        buildMessage: (coachName) => `${coachName} assigned you a programme`,
        // No athlete-facing programme detail route exists yet (`/programs`
        // and `/programs/:id` are coach-only, per app/(app)/programs/*) — the
        // programme + its "Today's training" occurrences surface on Home, so
        // the deep link lands there. Flagging as a judgment call.
        deepLink: "/(app)/(tabs)",
        relatedEntityType: "program_assignment",
        relatedEntityId: result.assignment.id,
      });

      ctx.set.status = 201;
      return { data: result.assignment };
    },
    {
      params: t.Object({ id: t.String({ minLength: 1 }) }),
      body: t.Object({
        clientId: t.String({ minLength: 1 }),
        startDate: t.String({ pattern: ISO_DATE_PATTERN }),
        showInPlan: t.Optional(t.Boolean()),
        showInLibrary: t.Optional(t.Boolean()),
      }),
    },
  );
