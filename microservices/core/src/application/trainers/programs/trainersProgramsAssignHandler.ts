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
