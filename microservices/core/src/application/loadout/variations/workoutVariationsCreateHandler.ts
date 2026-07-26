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
 *   1. input validation (name, rep ranges)
 *   2. parent readable            → 404
 *   3. parent is not itself a variation → 400
 *   4. `loadout` entitlement      → 402
 *   5. exercise read-visibility   → 400
 *   6. substituted-from ids       → 400
 *   7. saved-gym ownership        → 400
 *   8. kit snapshot validity      → 400
 *   9. insert
 *
 * Validation first so a malformed payload gets the more informative 400 rather
 * than a 402. The parent read check before the entitlement check so a caller
 * poking at a workout they can't see gets 404 and learns nothing about it — a
 * 402 would confirm the workout exists. Entitlement before every remaining check
 * and before the write, so an unentitled caller neither writes anything nor gets
 * free validation of their payload.
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

      const parent = await ctx.WorkoutRepository.findReadableWorkout(
        parentId,
        userId,
      );
      if (!parent) {
        ctx.set.status = 404;
        return { code: "not_found", message: "Workout not found" };
      }

      // A variation of a variation would be UNREACHABLE from every listing
      // surface: the `parent_workout_id IS NULL` library predicate hides it, and
      // `listVariations(root)` filters on `parent_workout_id = root` so it never
      // appears under the original either. Adapt the ROOT workout again instead —
      // that is also the semantically right thing, since each variation is a
      // point-in-time adaptation OF the original, not of another adaptation.
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

      // Read-visibility on every submitted row, with ONE exemption: rows
      // carried over from the parent.
      //
      // `findReadableWorkout` grants own / public / friends / assigned, but the
      // exercise-catalogue predicate (`buildVisibilityCondition`) grants only
      // system / own-custom / programme-assigned / workout-assigned — there is no
      // "this exercise is in a workout I can read" branch. Without the exemption,
      // adapting a PUBLIC template or a friend's workout that uses the owner's
      // custom exercises would 400 on an exercise the caller is looking at on
      // screen — exactly the case AC-1.2 mandates.
      //
      // The exemption grants nothing new: `fetchExercisesForWorkouts` embeds
      // exercise fields WITHOUT the catalogue predicate (documented as
      // intentional in `exerciseRepository.ts`), so these rows are already
      // readable via workout detail. Anything NOT in the parent — i.e. every
      // swap — must still pass the catalogue predicate, which is what stops an
      // adaptation being used to smuggle in another coach's private exercise.
      const parentExerciseIds = new Set(
        await ctx.WorkoutRepository.listExerciseIdsForWorkout(parentId),
      );
      const unreadable = (
        await ctx.ExerciseRepository.findUnreadableExerciseIds(
          userId,
          exercises.map((ex) => ex.exerciseId),
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

      // `substitutedFromExerciseId` must name a row the PARENT actually
      // contained — that is what "substituted FROM" means, and it is the only
      // client-supplied id on this request that has a FK behind it. Unvalidated,
      // a client that sends the workout_exercises row id (or the workout id) by
      // mistake gets Postgres 23503, which aborts the whole createVariation
      // transaction and surfaces as an opaque 500 — `coreErrorHandler` maps only
      // 22P02 to 400 — losing the user's reviewed adaptation with no actionable
      // error. `parentExerciseIds` is already in hand, so the check is free.
      const badSubstitutions = exercises
        .map((ex) => ex.substitutedFromExerciseId)
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

      // The frozen kit snapshot gets the SAME validation the saved-gym kit gets.
      // It is not decorative: Phase 2 renders it as the variation's kit summary
      // and Phase 4 reads it back as the equipment context, so a bogus id becomes
      // a chip with no name and a duplicate becomes the same chip twice.
      const kit = sourceEquipmentTypeIds ?? [];
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

      const variation = await ctx.WorkoutRepository.createVariation(
        userId,
        parentId,
        {
          name,
          description: description ?? null,
          estimatedDurationMinutes: estimatedDurationMinutes ?? 30,
          sourceGymId: sourceGymId ?? null,
          // Deduped for the same reason SavedGymRepository dedupes: two picker
          // paths can select the same chip, and storing it twice changes nothing
          // except making the kit summary and Phase 1's containment checks noisier.
          sourceEquipmentTypeIds: Array.from(new Set(kit)),
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
        // The saved gym this was adapted for, when one was used. Ownership IS
        // checked in the handler (step 7) — `listVariations` LEFT JOINs
        // `saved_gyms` for `sourceGymName`, so an unowned id would echo another
        // user's gym name back to the caller. Do not remove that check on the
        // strength of the FK: the FK only proves the row exists.
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
