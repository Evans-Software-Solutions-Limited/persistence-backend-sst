import Elysia, { t } from "elysia";
import { ExerciseService } from "../../repositories/exerciseService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * PATCH /exercises/:id — partial update, owner-only.
 *
 * Spec: design.md § PATCH /exercises/:id · AC 7.4
 * - Non-owner → 404 (NOT 403) to avoid leaking existence of other users' customs
 * - Non-existent → 404
 * - Any subset of POST body fields accepted; unset fields untouched
 */
export const exercisesUpdateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(ExerciseService)
  .patch(
    "/exercises/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { id } = ctx.params;
      const body = ctx.body;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: Record<string, any> = {};

      if (body.name !== undefined) {
        const trimmed = body.name.trim();
        if (trimmed.length === 0) {
          ctx.set.status = 400;
          return { error: "Exercise name cannot be empty" };
        }
        if (trimmed.length > 100) {
          ctx.set.status = 400;
          return { error: "Exercise name must be 100 characters or fewer" };
        }
        updateData.name = trimmed;
      }
      if (body.description !== undefined)
        updateData.description = body.description;
      if (body.instructions !== undefined)
        updateData.instructions = body.instructions;
      if (body.video_url !== undefined) updateData.videoUrl = body.video_url;
      if (body.thumbnail_url !== undefined)
        updateData.thumbnailUrl = body.thumbnail_url;
      if (body.category !== undefined) updateData.category = body.category;
      if (body.difficulty_level !== undefined)
        updateData.difficultyLevel = body.difficulty_level;
      if (body.region_type !== undefined)
        updateData.regionType = body.region_type;
      if (body.movement_type !== undefined)
        updateData.movementType = body.movement_type;
      if (body.primary_muscles !== undefined)
        updateData.primaryMuscles = body.primary_muscles;
      if (body.secondary_muscles !== undefined)
        updateData.secondaryMuscles = body.secondary_muscles;
      if (body.equipment_required !== undefined)
        updateData.equipmentRequired = body.equipment_required;
      if (body.accessibility_requirements !== undefined)
        updateData.accessibilityRequirements = body.accessibility_requirements;
      if (body.accessibility_modifications !== undefined)
        updateData.accessibilityModifications = body.accessibility_modifications;
      if (body.is_public !== undefined) updateData.isPublic = body.is_public;

      const exercise = await ctx.ExerciseRepository.update(
        id,
        userId,
        updateData,
      );

      if (!exercise) {
        ctx.set.status = 404;
        return { error: "Exercise not found" };
      }

      return { data: exercise };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        name: t.Optional(t.String()),
        description: t.Optional(t.String()),
        instructions: t.Optional(t.String()),
        video_url: t.Optional(t.String()),
        thumbnail_url: t.Optional(t.String()),
        category: t.Optional(
          t.Union([
            t.Literal("strength"),
            t.Literal("cardio"),
            t.Literal("flexibility"),
            t.Literal("balance"),
            t.Literal("plyometric"),
            t.Literal("olympic"),
            t.Literal("mobility"),
          ]),
        ),
        difficulty_level: t.Optional(
          t.Union([
            t.Literal("beginner"),
            t.Literal("intermediate"),
            t.Literal("advanced"),
            t.Literal("expert"),
          ]),
        ),
        region_type: t.Optional(t.String()),
        movement_type: t.Optional(t.String()),
        primary_muscles: t.Optional(
          t.Array(t.String({ format: "uuid" })),
        ),
        secondary_muscles: t.Optional(
          t.Array(t.String({ format: "uuid" })),
        ),
        equipment_required: t.Optional(
          t.Array(t.String({ format: "uuid" })),
        ),
        accessibility_requirements: t.Optional(
          t.Array(t.String({ format: "uuid" })),
        ),
        accessibility_modifications: t.Optional(t.String()),
        is_public: t.Optional(t.Boolean()),
      }),
    },
  );
