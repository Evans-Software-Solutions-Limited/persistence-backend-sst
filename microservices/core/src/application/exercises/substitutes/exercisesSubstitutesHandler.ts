import Elysia, { t } from "elysia";
import { ExerciseService } from "../../repositories/exerciseService";
import { SavedGymService } from "../../repositories/savedGymService";
import { toStringArray } from "../../../shared/queryParams";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { toExerciseDisplay } from "../../loadout/engine/adaptWorkout";
import { rankSubstitutes } from "../../loadout/engine/rankSubstitutes";
import type { RankedCandidate } from "../../loadout/engine/rankSubstitutes";
import type { RankSignal } from "../../loadout/engine/reasons";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/** One ranked picker row: the display slice plus why it matched. */
export interface SubstituteEntry {
  id: string;
  name: string;
  category: string | null;
  difficultyLevel: string | null;
  thumbnailUrl: string | null;
  equipmentRequired: string[];
  matchedOn: RankSignal[];
}

/**
 * Declared rather than inferred, and that is load-bearing rather than style.
 *
 * `packages/web`'s Eden `treaty<CoreApi>` instantiates the entire route tree and
 * sits at TypeScript's instantiation-depth ceiling (`packages/web/src/lib/eden.ts`
 * documents the history). A handler whose response type is inferred from several
 * inline object literals contributes far more depth than one whose response is a
 * named alias, so annotating this keeps a new route from costing the whole
 * workspace a TS2589.
 */
export type SubstitutesResponse =
  | {
      data: {
        best: SubstituteEntry[];
        others: SubstituteEntry[];
        meta: { truncated: boolean };
      };
    }
  | { code: string; message: string; unknownEquipmentTypeIds?: string[] };

/**
 * GET /exercises/substitutes — the ranked feed behind the equipment-aware swap
 * picker (spec-21 § 6.4, T-1.7 / AC-4.2 / AC-4.4).
 *
 * `{ best, others }`:
 *
 *   - **best** — same muscle filter, equipment CONTAINMENT applied, § 6.2-ranked.
 *     These are the "you can actually do this today" options.
 *   - **others** — the same muscle filter WITHOUT containment, minus everything
 *     already in `best`. The client renders these de-emphasised and selectable
 *     only behind an explicit "doesn't fit your kit" acknowledgement (AC-4.2), so
 *     they are returned as a separate list rather than relied on to sort below
 *     `best` — rank order alone cannot express "this one is illegal".
 *
 * `equipment` is OPTIONAL, which is what lets ONE endpoint serve both surfaces
 * (AC-4.4): the Loadout review step always has a kit context, while the
 * standalone in-session swap may not. With no kit, `best` is empty by definition
 * (there is nothing to be compatible with) and the whole ranked list arrives as
 * `others` — not an error.
 *
 * ⚠ **Server-side, not client-side, and that is a data-isolation requirement.**
 * The ranking must respect `buildVisibilityCondition` (AC-3.6). The device's
 * cached exercise library is not visibility-aware, so ranking on-device — the
 * "lean client-side first" option in the GTM brief — would leak another coach's
 * private exercises into the picker.
 *
 * ⚠ **Route ordering: this MUST be registered before `exercisesGetHandler`** or
 * the `/exercises/:id` matcher captures "substitutes" as a literal id — the same
 * trap `api.ts` documents for `exercisesSearchHandler`. It therefore cannot join
 * the late-mounting `loadoutRoutes` sub-app, which is why it lives here beside
 * its sibling exercise handlers. Guarded by
 * `application/__tests__/exercisesRouteOrdering.test.ts`.
 */
export const exercisesSubstitutesHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(ExerciseService)
  .use(SavedGymService)
  .get(
    "/exercises/substitutes",
    async (ctx): Promise<SubstitutesResponse> => {
      const { sub: userId } = getUser(ctx);
      const forExerciseId = ctx.query.forExerciseId;
      const equipment = toStringArray(ctx.query.equipment);
      const limit = Math.min(
        Math.max(1, ctx.query.limit ?? DEFAULT_LIMIT),
        MAX_LIMIT,
      );

      // Visibility-scoped read: an exercise the caller cannot see is a 404, with
      // no existence leak (the repository's own convention).
      const source = await ctx.ExerciseRepository.getById(
        forExerciseId,
        userId,
      );
      if (!source) {
        ctx.set.status = 404;
        return { code: "not_found", message: "Exercise not found" };
      }

      if (equipment.length > 0) {
        // Validated rather than left to silently narrow `best`: these ids come
        // from the same picker the preview endpoint validates, and a typo that
        // quietly returns fewer compatible options is worse than a 400.
        const unknown =
          await ctx.SavedGymRepository.findUnknownEquipmentTypeIds(equipment);
        if (unknown.length > 0) {
          ctx.set.status = 400;
          return {
            code: "UNKNOWN_EQUIPMENT_TYPE",
            message: "One or more equipment types do not exist",
            unknownEquipmentTypeIds: unknown,
          };
        }
      }

      const sourceCandidate = {
        id: source.id,
        name: source.name,
        category: source.category ?? null,
        difficultyLevel: source.difficultyLevel ?? null,
        movementType: source.movementType ?? null,
        primaryMuscles: source.primaryMuscles ?? [],
        secondaryMuscles: source.secondaryMuscles ?? [],
        equipmentRequired: source.equipmentRequired ?? [],
        thumbnailUrl: source.thumbnailUrl,
      };

      // No primary movers recorded → nothing to rank against. An empty pair of
      // lists is the honest answer; the ranker's hard filter would return the
      // same thing after two pointless queries.
      if (sourceCandidate.primaryMuscles.length === 0) {
        return {
          data: { best: [], others: [], meta: { truncated: false } },
        };
      }

      // The two pools are independent, so they run concurrently. `best` is
      // skipped entirely when no kit was supplied — passing an empty containment
      // array would drop the predicate and make `best` identical to `others`.
      const [compatible, unconstrained] = await Promise.all([
        equipment.length > 0
          ? ctx.ExerciseRepository.listAdaptationCandidates(userId, {
              muscleIds: sourceCandidate.primaryMuscles,
              equipmentTypeIds: equipment,
              excludeExerciseIds: [source.id],
            })
          : Promise.resolve({ candidates: [], truncated: false }),
        ctx.ExerciseRepository.listRankableExercises(userId, {
          muscleIds: sourceCandidate.primaryMuscles,
          excludeExerciseIds: [source.id],
        }),
      ]);

      // The +8 "logged before" signal, intersected with the candidates rather
      // than fetched as the caller's whole training history.
      const loggedIds =
        await ctx.ExerciseRepository.listPreviouslyLoggedExerciseIds(userId, [
          ...compatible.candidates.map((candidate) => candidate.id),
          ...unconstrained.candidates.map((candidate) => candidate.id),
        ]);
      const rankContext = { loggedExerciseIds: new Set(loggedIds) };

      const toEntry = (ranked: RankedCandidate): SubstituteEntry => ({
        ...toExerciseDisplay(ranked.candidate),
        matchedOn: ranked.matchedOn,
      });

      const best = rankSubstitutes(
        sourceCandidate,
        compatible.candidates,
        rankContext,
      ).slice(0, limit);
      const bestIds = new Set(best.map((ranked) => ranked.candidate.id));

      const others = rankSubstitutes(
        sourceCandidate,
        unconstrained.candidates,
        rankContext,
      )
        .filter((ranked) => !bestIds.has(ranked.candidate.id))
        .slice(0, limit);

      return {
        data: {
          best: best.map(toEntry),
          others: others.map(toEntry),
          meta: {
            truncated: compatible.truncated || unconstrained.truncated,
          },
        },
      };
    },
    {
      query: t.Object({
        forExerciseId: t.String({ format: "uuid" }),
        equipment: t.Optional(
          t.Union([
            t.String({ format: "uuid" }),
            t.Array(t.String({ format: "uuid" })),
          ]),
        ),
        limit: t.Optional(t.Numeric()),
      }),
    },
  );
