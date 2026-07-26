import Elysia, { t } from "elysia";
import { WorkoutService } from "../../repositories/workoutService";
import { ExerciseService } from "../../repositories/exerciseService";
import { SavedGymService } from "../../repositories/savedGymService";
import {
  findInvalidRepRangeIndex,
  workoutExerciseInputSchema,
} from "../../workouts/shared/schemas";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import {
  assertEntitlement,
  EntitlementError,
} from "../../entitlement/assertEntitlement";

/**
 * POST /workouts/:id/variations — persist a reviewed adaptation as a variation
 * under the parent.
 *
 * Loadout (spec-21) AC-1.2 / AC-1.4 / AC-5.1. Phase 0 ships the PERSISTENCE
 * half; Phase 1 adds the preview endpoint that computes the plan this receives.
 *
 * ## Guard order (deliberate)
 *
 *   input validation → parent `canRead` → `loadout` entitlement → exercise
 *   read-visibility → insert
 *
 * Validation first so a malformed payload gets the more informative 400 rather
 * than a 402. `canRead` before the entitlement check so a caller poking at a
 * workout they can't see gets 404 and learns nothing about it — a 402 would
 * confirm the workout exists. Entitlement before the write so no variation is
 * ever inserted for a caller who isn't entitled.
 *
 * ## What is NOT trusted from the client
 *
 * The preview response is not trusted on the way back in (design § 7):
 *
 *   - Every submitted `exerciseId` is re-verified for READ-VISIBILITY. This is
 *     the security control and it applies to every row with no exceptions — an
 *     override cannot be used to smuggle in another coach's private exercise.
 *     (Design § 7.1 sequences this with Phase 1's T-1.6; it is pulled forward
 *     because shipping a create path that skips it would leave a knowingly open
 *     hole for a whole phase.)
 *   - `visibility` is not accepted at all — a variation is always `private`
 *     (design § 2.2). Inheriting a public parent's visibility would publish the
 *     caller's gym kit into every other user's browse.
 *   - `variationKind` and `parentWorkoutId` are set server-side.
 *
 * EQUIPMENT CONTAINMENT is deliberately NOT verified here. It is a quality
 * check the user may override on purpose after an explicit "doesn't fit your
 * kit" acknowledgement (AC-4.2 / AC-4.3), and Phase 1 owns the asymmetric
 * re-verification (containment only on rows not flagged `isUserOverride`).
 * Phase 0 has no candidate/ranking machinery to check against.
 */
export const workoutVariationsCreateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(WorkoutService)
  .use(ExerciseService)
  .use(SavedGymService)
  .post(
    "/workouts/:id/variations",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const parentId = ctx.params.id;
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

      const badIndex = findInvalidRepRangeIndex(exercises);
      if (badIndex !== null) {
        ctx.set.status = 400;
        return {
          error: "targetRepsMin cannot exceed targetRepsMax for any exercise",
        };
      }

      const canRead = await ctx.WorkoutRepository.canReadWorkout(
        parentId,
        userId,
      );
      if (!canRead) {
        ctx.set.status = 404;
        return { code: "not_found", message: "Workout not found" };
      }

      const verdict = await assertEntitlement(userId, "loadout");
      if (!verdict.allowed) {
        throw new EntitlementError(verdict, "loadout");
      }

      // Read-visibility on EVERY submitted row — see the header comment.
      const unreadable = await ctx.ExerciseRepository.findUnreadableExerciseIds(
        userId,
        exercises.map((ex) => ex.exerciseId),
      );
      if (unreadable.length > 0) {
        ctx.set.status = 400;
        return {
          code: "EXERCISE_NOT_VISIBLE",
          message: "One or more exercises are not available to you",
          unreadableExerciseIds: unreadable,
        };
      }

      // Gym OWNERSHIP, when a gym is claimed. Not cosmetic: `listVariations`
      // LEFT JOINs `saved_gyms` to return `sourceGymName`, so accepting an
      // arbitrary gym id would echo ANOTHER USER'S gym name back to this caller.
      // The FK alone doesn't help — it only proves the row exists.
      if (sourceGymId != null) {
        const gym = await ctx.SavedGymRepository.getById(sourceGymId, userId);
        if (!gym) {
          ctx.set.status = 400;
          return {
            code: "UNKNOWN_SAVED_GYM",
            message: "Saved gym not found",
          };
        }
      }

      const variation = await ctx.WorkoutRepository.createVariation(
        userId,
        parentId,
        {
          name,
          description: description ?? null,
          estimatedDurationMinutes: estimatedDurationMinutes ?? 30,
          sourceGymId: sourceGymId ?? null,
          sourceEquipmentTypeIds: sourceEquipmentTypeIds ?? [],
          exercises,
        },
      );

      ctx.set.status = 201;
      return { data: variation };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 200 }),
        description: t.Optional(t.Union([t.String(), t.Null()])),
        estimatedDurationMinutes: t.Optional(t.Number()),
        // The saved gym this was adapted for, when one was used. Not validated
        // for ownership here — the FK is `ON DELETE SET NULL` and the column is
        // descriptive, so a bad id is at worst a wrong label on the caller's own
        // row. Phase 1 resolves the gym itself when computing the preview.
        sourceGymId: t.Optional(
          t.Union([t.String({ format: "uuid" }), t.Null()]),
        ),
        sourceEquipmentTypeIds: t.Optional(
          t.Array(t.String({ format: "uuid" })),
        ),
        exercises: t.Array(
          t.Composite([
            workoutExerciseInputSchema,
            t.Object({
              substitutedFromExerciseId: t.Optional(
                t.Union([t.String({ format: "uuid" }), t.Null()]),
              ),
              // Structured reason code (design § 7.2), stored as jsonb. Phase 1
              // generates it server-side; Phase 0 stores whatever the reviewed
              // plan carries so provenance survives the round trip (AC-3.3).
              substitutionReason: t.Optional(t.Unknown()),
              isUserOverride: t.Optional(t.Boolean()),
            }),
          ]),
        ),
      }),
    },
  );
