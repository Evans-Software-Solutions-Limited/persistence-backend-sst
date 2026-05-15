import Elysia, { t } from "elysia";
import { MIN_SEARCH_LENGTH } from "../../repositories/exerciseRepository";
import { ExerciseService } from "../../repositories/exerciseService";
import { toStringArray } from "../../../shared/queryParams";
import { getAuthUser } from "@persistence/api-utils/auth/supabaseAuth";

const CREATED_BY_VALUES = ["mine", "system", "pt", "physio", "all"] as const;
const AUTH_REQUIRED_CREATED_BY = new Set(["mine", "pt", "physio"]);

/**
 * GET /exercises/search — full-text + trigram fuzzy search over the
 * exercise catalogue, scoped to the same visibility predicate as
 * `GET /exercises` (system ∪ own customs ∪ connected-PT customs;
 * unauthenticated → system only).
 *
 * `q` is required, trimmed, and must be at least MIN_SEARCH_LENGTH
 * after trim — 1-char prefix queries return almost the entire
 * catalogue, so we reject them up-front to avoid wasting work.
 *
 * Route MUST be registered before `GET /exercises/:id` in api.ts —
 * otherwise the `:id` matcher captures "search" as a literal id and the
 * request never reaches this handler.
 *
 * Spec: specs/03-exercise-library/POSTGRES_FTS_INVESTIGATION.md.
 */

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

export const exercisesSearchHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .use(ExerciseService)
  .get(
    "/exercises/search",
    async (ctx) => {
      const userId = ctx.user?.sub ?? null;
      const qRaw = ctx.query.q.trim();

      if (qRaw.length < MIN_SEARCH_LENGTH) {
        ctx.set.status = 400;
        return {
          error: `q must be at least ${MIN_SEARCH_LENGTH} characters after trim`,
        };
      }

      // Same filter parsing pattern + validation as exercisesListHandler.
      // Search returns ranked results within the filter set, so a query
      // like `?q=press&category=cardio` ranks press-matching cardio rows
      // — not "top 100 press matches that happen to be cardio".
      const category = toStringArray(ctx.query.category);
      const difficultyLevel = toStringArray(
        ctx.query.difficulty_level ?? ctx.query.difficulty,
      );
      const targetedMusclesAny = toStringArray(
        ctx.query.targeted_muscles_any ?? ctx.query.muscleGroup,
      );
      const equipmentAny = toStringArray(ctx.query.equipment_any);
      const createdBy = toStringArray(ctx.query.created_by);

      for (const value of createdBy) {
        if (
          !CREATED_BY_VALUES.includes(
            value as (typeof CREATED_BY_VALUES)[number],
          )
        ) {
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

      const rawLimit = ctx.query.limit ?? DEFAULT_LIMIT;
      // Clamp against MAX_LIMIT — search responses don't need full-catalogue
      // pagination ceilings; 100 covers any sane "show me ranked matches"
      // request and protects Lambda payload size.
      const limit = Math.min(Math.max(1, rawLimit), MAX_LIMIT);
      const offset = Math.max(0, ctx.query.offset ?? 0);

      const { rows, total } = await ctx.ExerciseRepository.search(
        qRaw,
        {
          category,
          difficultyLevel,
          targetedMusclesAny,
          equipmentAny,
          createdByFilter: createdBy,
        },
        userId,
        limit,
        offset,
      );

      // Same double-envelope wire shape as `GET /exercises`: outer `data`
      // is the generic success envelope; inner is the paginated page
      // payload. Mobile adapter mirrors this shape.
      return {
        data: {
          data: rows,
          meta: { total, offset, limit },
        },
      };
    },
    {
      // UUID-typed axes validate at the query-schema layer (same as the
      // list endpoint) so non-UUID input returns a clean 422 rather than
      // surfacing as a Postgres cast error.
      query: t.Object({
        q: t.String(),
        category: t.Optional(t.Union([t.String(), t.Array(t.String())])),
        difficulty_level: t.Optional(
          t.Union([t.String(), t.Array(t.String())]),
        ),
        difficulty: t.Optional(t.String()),
        targeted_muscles_any: t.Optional(
          t.Union([
            t.String({ format: "uuid" }),
            t.Array(t.String({ format: "uuid" })),
          ]),
        ),
        muscleGroup: t.Optional(t.String({ format: "uuid" })),
        equipment_any: t.Optional(
          t.Union([
            t.String({ format: "uuid" }),
            t.Array(t.String({ format: "uuid" })),
          ]),
        ),
        created_by: t.Optional(t.Union([t.String(), t.Array(t.String())])),
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
    },
  );
