import Elysia, { t } from "elysia";
import { ExerciseService } from "../../repositories/exerciseService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * POST /exercises — create a custom exercise scoped to the caller.
 *
 * Spec: design.md § POST /exercises · AC 7.3
 * - Auth required; created_by forced from JWT sub (never trusted from body)
 * - Body shape matches legacy snake_case / UUID-array contract so ported
 *   mobile code reaches the server unchanged
 */
export const exercisesCreateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(ExerciseService)
  .post(
    "/exercises",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const body = ctx.body;

      const name = body.name?.trim() ?? "";
      if (name.length === 0) {
        ctx.set.status = 400;
        return { error: "Exercise name is required" };
      }
      if (name.length < 2) {
        ctx.set.status = 400;
        return { error: "Exercise name must be at least 2 characters" };
      }
      if (name.length > 100) {
        ctx.set.status = 400;
        return { error: "Exercise name must be 100 characters or fewer" };
      }

      const exercise = await ctx.ExerciseRepository.create(userId, {
        name,
        description: body.description ?? null,
        instructions: body.instructions ?? null,
        videoUrl: body.video_url ?? null,
        thumbnailUrl: body.thumbnail_url ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        category: (body.category ?? "strength") as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        difficultyLevel: (body.difficulty_level ?? "beginner") as any,
        regionType: body.region_type ?? null,
        movementType: body.movement_type ?? null,
        primaryMuscles: body.primary_muscles ?? [],
        secondaryMuscles: body.secondary_muscles ?? [],
        equipmentRequired: body.equipment_required ?? [],
        accessibilityRequirements: body.accessibility_requirements ?? [],
        accessibilityModifications: body.accessibility_modifications ?? null,
        isPublic: body.is_public ?? false,
      });

      ctx.set.status = 201;
      return { data: exercise };
    },
    {
      body: t.Object({
        name: t.String(),
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
        primary_muscles: t.Optional(t.Array(t.String({ format: "uuid" }))),
        secondary_muscles: t.Optional(t.Array(t.String({ format: "uuid" }))),
        equipment_required: t.Optional(t.Array(t.String({ format: "uuid" }))),
        accessibility_requirements: t.Optional(
          t.Array(t.String({ format: "uuid" })),
        ),
        accessibility_modifications: t.Optional(t.String()),
        is_public: t.Optional(t.Boolean()),
      }),
    },
  );
