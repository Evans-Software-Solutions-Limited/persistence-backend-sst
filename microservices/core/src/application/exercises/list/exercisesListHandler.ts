import Elysia, { t } from "elysia";
import { ExerciseService } from "../../repositories/exerciseService";
import { getAuthUser } from "@persistence/api-utils/auth/supabaseAuth";

/**
 * GET /exercises — list with multi-axis filters + always-on visibility.
 *
 * Spec: design.md § Backend Endpoints > GET /exercises · AC 7.6, 7.7, 7.8
 *
 * Repeated-key array query params match the legacy wire format:
 *   GET /exercises?targeted_muscles_any=<uuid>&targeted_muscles_any=<uuid>
 *                  &category=strength&created_by=mine&created_by=system
 *
 * Auth is optional — unauthenticated callers see only system exercises
 * (created_by IS NULL). Authenticated callers see system ∪ own ∪
 * connected-PT customs. Certain created_by values (mine / pt / physio)
 * require auth and the handler returns 400 otherwise.
 */

const CREATED_BY_VALUES = ["mine", "system", "pt", "physio", "all"] as const;
const AUTH_REQUIRED_CREATED_BY = new Set(["mine", "pt", "physio"]);

function toStringArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export const exercisesListHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .use(ExerciseService)
  .get(
    "/exercises",
    async (ctx) => {
      const userId = ctx.user?.sub ?? null;

      const q = ctx.query.q ?? ctx.query.search;
      const category = toStringArray(ctx.query.category);
      const difficultyLevel = toStringArray(
        ctx.query.difficulty_level ?? ctx.query.difficulty,
      );
      const targetedMusclesAny = toStringArray(
        ctx.query.targeted_muscles_any ?? ctx.query.muscleGroup,
      );
      const equipmentAny = toStringArray(ctx.query.equipment_any);
      const createdBy = toStringArray(ctx.query.created_by);

      // Validate created_by enum values
      for (const value of createdBy) {
        if (!CREATED_BY_VALUES.includes(value as (typeof CREATED_BY_VALUES)[number])) {
          ctx.set.status = 400;
          return {
            error: `Invalid created_by value: "${value}". Expected one of: ${CREATED_BY_VALUES.join(", ")}`,
          };
        }
        if (AUTH_REQUIRED_CREATED_BY.has(value) && !userId) {
          ctx.set.status = 400;
          return {
            error: `created_by=${value} requires authentication`,
          };
        }
      }

      const exercises = await ctx.ExerciseRepository.list(
        {
          q,
          category,
          difficultyLevel,
          targetedMusclesAny,
          equipmentAny,
          createdByFilter: createdBy,
          limit: ctx.query.limit ?? 20,
          offset: ctx.query.offset ?? 0,
        },
        userId,
      );

      return { data: exercises };
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        search: t.Optional(t.String()),
        category: t.Optional(
          t.Union([t.String(), t.Array(t.String())]),
        ),
        difficulty_level: t.Optional(
          t.Union([t.String(), t.Array(t.String())]),
        ),
        difficulty: t.Optional(t.String()),
        targeted_muscles_any: t.Optional(
          t.Union([t.String(), t.Array(t.String())]),
        ),
        muscleGroup: t.Optional(t.String()),
        equipment_any: t.Optional(
          t.Union([t.String(), t.Array(t.String())]),
        ),
        created_by: t.Optional(
          t.Union([t.String(), t.Array(t.String())]),
        ),
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
    },
  );
