import Elysia, { t } from "elysia";
import { ExerciseService } from "../../repositories/exerciseService";
import { toStringArray } from "../../../shared/queryParams";
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

/**
 * Hard cap on `?limit=` values from clients. Two reasons this exists:
 *
 *   1. A misbehaving or malicious caller asking for `limit=1000000` would
 *      force Supabase to materialise every row into memory and serialise
 *      a huge JSON — enough to blow Lambda's 6 MB response limit or
 *      exhaust the pooler connection's working memory.
 *   2. The mobile full-library refresh requests up to REFRESH_PAGE_SIZE
 *      rows in a single call so the current ~2.3k catalogue completes in
 *      one round-trip. 3000 gives that path headroom plus a buffer for
 *      catalogue growth without turning into a DoS vector.
 *
 * Payload math: at ~800 bytes/row raw JSON, 3000 rows ≈ 2.4 MB — well
 * under Lambda's 6 MB sync-response cap. Revisit if the average row
 * grows (e.g. adding long instructional fields).
 *
 * Requests that exceed the cap are silently clamped — no 4xx. The client
 * still gets a valid (smaller) page; the walk just needs more iterations.
 * Returning an error here would break existing callers that happened to
 * pass a too-large number on one request.
 */
const MAX_LIMIT = 3000;
const DEFAULT_LIMIT = 20;

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
      // Clamp against MAX_LIMIT — see constant docstring.
      const limit = Math.min(Math.max(1, rawLimit), MAX_LIMIT);
      const offset = Math.max(0, ctx.query.offset ?? 0);

      const repoFilters = {
        q,
        category,
        difficultyLevel,
        targetedMusclesAny,
        equipmentAny,
        createdByFilter: createdBy,
        limit,
        offset,
      };

      // Page slice + total count in parallel — the two queries share the
      // exact same WHERE predicate via `buildListFilterConditions`, so
      // `hasMore` can be derived on the client without a second round-trip.
      const [exercises, total] = await Promise.all([
        ctx.ExerciseRepository.list(repoFilters, userId),
        ctx.ExerciseRepository.count(repoFilters, userId),
      ]);

      // Double-envelope wire shape: the outer `data` is the generic
      // success envelope every endpoint uses (`{ data: T }`); the inner
      // object is the paginated-page payload the mobile adapter
      // (`sst-api.adapter.ts:ApiExercisesPage`) expects. Breaking this
      // contract → `result.value.data.map` crashes the Exercise list UI.
      return {
        data: {
          data: exercises,
          meta: { total, offset, limit },
        },
      };
    },
    {
      // UUID-typed axes validate at the query-schema layer so non-UUID
      // input returns a clean 422 rather than surfacing as a Postgres
      // cast error (500) when the repository applies ::uuid[] casts.
      query: t.Object({
        q: t.Optional(t.String()),
        search: t.Optional(t.String()),
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
