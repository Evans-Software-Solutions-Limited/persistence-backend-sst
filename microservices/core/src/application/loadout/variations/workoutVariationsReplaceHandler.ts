import Elysia, { t } from "elysia";
import { WorkoutService } from "../../repositories/workoutService";
import { ExerciseService } from "../../repositories/exerciseService";
import { SavedGymService } from "../../repositories/savedGymService";
import { findInvalidRepRangeIndex } from "../../workouts/shared/schemas";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import {
  assertEntitlement,
  EntitlementError,
} from "../../entitlement/assertEntitlement";
import { workoutVariationBodySchema } from "./workoutVariationsCreateHandler";

/**
 * PUT /workouts/:parentId/variations/:variationId — replace an owned reviewed
 * Loadout setup without replacing its workout identity or session history.
 *
 * The validation mirrors create: readable root parent, entitlement, exercise
 * visibility, substituted-from containment, owned gym, valid kit and equipment
 * containment. The repository folds variation ownership + relationship into
 * the transactional UPDATE predicate.
 */
export const workoutVariationsReplaceHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(WorkoutService)
  .use(ExerciseService)
  .use(SavedGymService)
  .put(
    "/workouts/:parentId/variations/:variationId",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { parentId, variationId } = ctx.params;
      const {
        name,
        description,
        estimatedDurationMinutes,
        sourceGymId,
        sourceEquipmentTypeIds,
        exercises,
      } = ctx.body;

      if (name.trim().length === 0) {
        ctx.set.status = 400;
        return { error: "Variation name is required" };
      }

      if (findInvalidRepRangeIndex(exercises) !== null) {
        ctx.set.status = 400;
        return {
          error: "targetRepsMin cannot exceed targetRepsMax for any exercise",
        };
      }

      const parent = await ctx.WorkoutRepository.findReadableWorkout(
        parentId,
        userId,
      );
      if (!parent) {
        ctx.set.status = 404;
        return { code: "not_found", message: "Workout not found" };
      }
      if (parent.parentWorkoutId != null) {
        ctx.set.status = 400;
        return {
          code: "PARENT_IS_A_VARIATION",
          message: "Adapt the original workout, not one of its saved setups",
          rootWorkoutId: parent.parentWorkoutId,
        };
      }

      const verdict = await assertEntitlement(userId, "loadout");
      if (!verdict.allowed) {
        throw new EntitlementError(verdict, "loadout");
      }

      const parentExerciseIds = new Set(
        await ctx.WorkoutRepository.listExerciseIdsForWorkout(parentId),
      );
      const unreadable = (
        await ctx.ExerciseRepository.findUnreadableExerciseIds(
          userId,
          exercises.map((exercise) => exercise.exerciseId),
        )
      ).filter((id) => !parentExerciseIds.has(id));
      if (unreadable.length > 0) {
        ctx.set.status = 400;
        return {
          code: "EXERCISE_NOT_VISIBLE",
          message: "One or more exercises are not available to you",
          unreadableExerciseIds: unreadable,
        };
      }

      const badSubstitutions = exercises
        .map((exercise) => exercise.substitutedFromExerciseId)
        .filter((id): id is string => id != null && !parentExerciseIds.has(id));
      if (badSubstitutions.length > 0) {
        ctx.set.status = 400;
        return {
          code: "UNKNOWN_SUBSTITUTED_FROM_EXERCISE",
          message:
            "substitutedFromExerciseId must be an exercise the parent workout contained",
          substitutedFromExerciseIds: badSubstitutions,
        };
      }

      let gymKit: string[] | null = null;
      if (sourceGymId != null) {
        const gym = await ctx.SavedGymRepository.getById(sourceGymId, userId);
        if (!gym) {
          ctx.set.status = 400;
          return { code: "UNKNOWN_SAVED_GYM", message: "Saved gym not found" };
        }
        gymKit = gym.equipmentTypeIds;
      }

      const hasExplicitSnapshot = sourceEquipmentTypeIds !== undefined;
      const kit = sourceEquipmentTypeIds ?? gymKit ?? [];
      if (kit.length === 0) {
        ctx.set.status = 400;
        return {
          code: "EMPTY_EQUIPMENT_CONTEXT",
          message:
            "At least one equipment type is required; use the bodyweight equipment type for bodyweight-only setups",
        };
      }
      const unknownKit =
        await ctx.SavedGymRepository.findUnknownEquipmentTypeIds(kit);
      if (unknownKit.length > 0) {
        ctx.set.status = 400;
        return {
          code: "UNKNOWN_EQUIPMENT_TYPE",
          message: "One or more equipment types do not exist",
          unknownEquipmentTypeIds: unknownKit,
        };
      }

      const containmentContext = hasExplicitSnapshot ? kit : gymKit;
      if (containmentContext !== null && containmentContext.length > 0) {
        const available = new Set(containmentContext);
        const checkable = exercises.filter(
          (exercise) => exercise.isUserOverride !== true,
        );
        const requirements =
          await ctx.ExerciseRepository.findEquipmentRequirements(
            checkable.map((exercise) => exercise.exerciseId),
          );
        const incompatible = checkable.filter((exercise) =>
          (requirements.get(exercise.exerciseId) ?? []).some(
            (id) => !available.has(id),
          ),
        );
        if (incompatible.length > 0) {
          ctx.set.status = 400;
          return {
            code: "EQUIPMENT_NOT_AVAILABLE",
            message:
              "One or more exercises need equipment this setup does not have. Flag the row as a user override to keep it anyway.",
            incompatibleExerciseIds: incompatible.map(
              (exercise) => exercise.exerciseId,
            ),
          };
        }
      }

      const variation = await ctx.WorkoutRepository.replaceVariation(
        userId,
        parentId,
        variationId,
        {
          name,
          description: description ?? null,
          estimatedDurationMinutes,
          sourceGymId: sourceGymId ?? null,
          sourceEquipmentTypeIds: Array.from(new Set(kit)),
          exercises,
        },
      );
      if (!variation) {
        ctx.set.status = 404;
        return { code: "not_found", message: "Saved setup not found" };
      }

      return { data: variation };
    },
    {
      params: t.Object({
        parentId: t.String({ format: "uuid" }),
        variationId: t.String({ format: "uuid" }),
      }),
      body: workoutVariationBodySchema,
    },
  );
