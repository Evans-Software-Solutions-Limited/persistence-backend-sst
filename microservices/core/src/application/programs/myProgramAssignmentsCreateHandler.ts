import Elysia, { t } from "elysia";
import { ProgramService } from "../repositories/programService";
import { TrainerService } from "../repositories/trainerService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { todayIso } from "../trainers/programs/shared";
import { assignProgrammeInSequence } from "./assignProgrammeInSequence";
import {
  COACH_SUBSCRIPTION_REQUIRED,
  COACH_SUBSCRIPTION_REQUIRED_MESSAGE,
  hasActiveCoachSubscription,
} from "../entitlement/coachSubscriptionGuard";

/**
 * POST /users/me/program-assignments — "Me" (canvas C2d, design G part 2,
 * spec 36's owner route): assign a programme to yourself. Always `sequence`
 * mode (no dates, programme order with Next).
 *
 * - The programme must be the caller's OWN. Anything else, public or not, is
 *   404 `not_found`, the same as an unknown id (no leak). Design G's "or
 *   public" is deferred pending Brad: assigning another coach's public
 *   programme to yourself would list you in that coach's programme detail,
 *   block their delete, and give you read access to private workouts in it
 *   through the materialised workout assignments (Inspector Brad, #564). No V2
 *   code writes `is_public` on programmes yet.
 * - The caller needs the trainer role AND an active coach subscription:
 *   "coaches' own training is free with every trainer subscription" (Brad
 *   28 Oct), and since PER-146 a coach whose plan has lapsed is refused the
 *   coach platform. Without the role: 403 `planning_not_available` (there's
 *   no athlete planning capability in the backend yet). With the role but no
 *   active coach plan: 403 `coach_subscription_required`, the same answer as
 *   the coach workspace routes. Checked here rather than with the scoped
 *   `coachSubscriptionGuard`, because this sub-app also carries the
 *   athlete's `GET /programs/:id`, which must stay open.
 * - There's no fake self-relationship: the assignment's assigner and client
 *   are both the caller.
 * - Safe to re-send (offline queue): when the caller already has this
 *   programme live from themselves, the first row comes back with 200.
 *   Live from a coach is 409 `already_assigned`.
 * - 422 `PROGRAM_EMPTY` when the programme has no workouts.
 */
export const myProgramAssignmentsCreateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(TrainerService)
  .use(ProgramService)
  .post(
    "/users/me/program-assignments",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);

      if (!(await ctx.TrainerRepository.isTrainer(userId))) {
        ctx.set.status = 403;
        return {
          code: "planning_not_available",
          message: "Planning your own programme isn't available on your plan",
        };
      }
      if (!(await hasActiveCoachSubscription(userId))) {
        ctx.set.status = 403;
        return {
          code: COACH_SUBSCRIPTION_REQUIRED,
          message: COACH_SUBSCRIPTION_REQUIRED_MESSAGE,
        };
      }

      const result = await assignProgrammeInSequence({
        assignerId: userId,
        clientId: userId,
        programId: ctx.body.programId,
        today: todayIso(),
        showInPlan: ctx.body.showInPlan,
        showInLibrary: ctx.body.showInLibrary,
        repository: ctx.ProgramAssignmentRepository,
      });

      if ("error" in result) {
        if (result.error === "not_found") {
          ctx.set.status = 404;
          return { code: "not_found", message: "Programme not found" };
        }
        if (result.error === "already_assigned") {
          const live = await ctx.ProgramAssignmentRepository.getLiveAssignment(
            userId,
            ctx.body.programId,
          );
          // `live` always exists here (the 409 was for this programme and
          // caller); only the assigner decides between replay and conflict.
          if (live?.assignedBy === userId) {
            ctx.set.status = 200;
            return { data: live };
          }
          ctx.set.status = 409;
          return {
            code: "already_assigned",
            message: "You already have this programme live",
          };
        }
        ctx.set.status = 422;
        return {
          code: "PROGRAM_EMPTY",
          message: "Add workouts to the programme before assigning it",
        };
      }

      ctx.set.status = 201;
      return { data: result.assignment };
    },
    {
      body: t.Object({
        programId: t.String({ minLength: 1 }),
        showInPlan: t.Optional(t.Boolean()),
        showInLibrary: t.Optional(t.Boolean()),
      }),
    },
  );
