import {
  desc,
  eq,
  ilike,
  and,
  or,
  isNull,
  inArray,
  sql,
  type SQL,
} from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";
import {
  exercises,
  type Exercise,
  type NewExercise,
  muscleGroups,
  equipmentTypes,
  ptClientRelationships,
  workoutExercises,
  workoutAssignments,
  programWorkouts,
  programAssignments,
  sessionExercises,
  workoutSessions,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { LIVE_ASSIGNMENT_STATUSES } from "./programRepository";

/**
 * A parameterised `ARRAY[$1, $2, …]::uuid[]` literal.
 *
 * ⚠ **Never interpolate a JS array directly before a `::uuid[]` cast.** Drizzle
 * renders a bare array as a comma-separated placeholder list wrapped in
 * PARENTHESES — the shape `IN (…)` wants — so `sql`${ids}::uuid[]`` compiles to
 * `($1, $2, $3)::uuid[]`. Postgres reads that as a ROW constructor and the query
 * dies at execution time, with a different error per arity:
 *
 *   - 2+ ids → `cannot cast type record to uuid[]`
 *   - 1 id   → `malformed array literal` (a lone `($1)` is just a scalar, so the
 *              cast tries to parse a UUID string as an array literal)
 *
 * Both are runtime-only. The unit suite mocks `getDb`, so a broken predicate
 * passes every gate and ships green — this is the second time that blind spot
 * has cost a production 500 (see memory/reference_drizzle_groupby_param_bug for
 * the first, a GROUP BY that blanked Home's weekly volume). The four call sites
 * are therefore covered by `PgDialect` render assertions in
 * `exerciseRepositoryArrayPredicates.test.ts`, which fail on the paren form.
 *
 * `ARRAY[]::uuid[]` is valid Postgres, so the empty case needs no special
 * handling — though every current caller guards on length anyway.
 */
function uuidArray(ids: readonly string[]): SQL {
  return sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::uuid[]`;
}

/**
 * Sentinel UUID used by the legacy Supabase DB to mark system-authored
 * exercises. The backend is still connected to the live Supabase
 * schema (not Neon), so this convention is load-bearing — rows with
 * this `created_by` value are the stock/system catalogue that every
 * user can see.
 *
 * DO NOT replace with `IS NULL` — the live DB does not store NULL
 * creators, so that predicate would silently hide every system
 * exercise.
 */
export const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Minimum length of a search term we'll send to Postgres. Below this
 * the handler returns 400 — `:*` prefix queries on a single char return
 * almost the whole catalogue.
 */
export const MIN_SEARCH_LENGTH = 2;

/**
 * Transform a free-text user query into a `to_tsquery`-safe string
 * with `:*` prefix matching on every token, AND-joined.
 *
 *   "press bench"        → "press:* & bench:*"
 *   "  bench   press  "  → "bench:* & press:*"
 *   "bench-press"        → "bench:* & press:*"
 *   "OR; DROP TABLE--"   → "or:* & drop:* & table:*"
 *
 * Returns `null` when nothing usable remains after stripping (caller
 * should bypass the FTS branch and fall through to the trigram fallback,
 * or 400 if used as the primary path).
 *
 * Approach is an allowlist: keep only Unicode letters, digits, and
 * whitespace; everything else collapses to a space. An allowlist is
 * safer than denylisting tsquery operators because non-operator
 * punctuation like `;` `,` `.` would otherwise become part of the
 * lexeme (e.g. `or;:*`), parse fine but match nothing — a silent dead
 * token. The allowlist also keeps the regex tiny and the surface
 * audit-able.
 */
export function toPrefixTsQuery(q: string): string | null {
  const tokens = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `${t}:*`).join(" & ");
}

/**
 * Shape returned by the muscle-groups reference-list endpoint.
 * Mirrors the actual Supabase columns — do not add fields that
 * aren't in the live table.
 */
export type MuscleGroupRow = {
  id: string;
  name: string;
  displayName: string | null;
};

/**
 * Shape returned by the equipment-types reference-list endpoint.
 * Supabase's equipment_types table has no display_name column;
 * the handler projects `display_name: null` for API-shape parity
 * across the three reference-list endpoints.
 */
export type EquipmentTypeRow = {
  id: string;
  name: string;
  /**
   * Picker grouping (spec-21 § 2.3b): free_weights | machines | cables |
   * bodyweight | cardio | accessories. Nullable — a row with no category
   * renders under "Other" rather than disappearing from the picker (AC-2.2).
   */
  category: string | null;
};

/**
 * The exercise fields the Loadout ranker (spec-21 § 6.2) and the model prompt
 * both need. A narrower projection than `Exercise` on purpose: a candidate pool
 * is up to 400 rows and the ranking signals are all this shape carries, plus the
 * two display fields the review step renders.
 *
 * Array columns are normalised to `[]` — they are nullable on rows that predate
 * the `.default([])`, and a null would make every ranking signal on that row
 * behave as a silent zero rather than an empty set.
 */
export interface AdaptationCandidate {
  id: string;
  name: string;
  category: string | null;
  difficultyLevel: string | null;
  movementType: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipmentRequired: string[];
  thumbnailUrl: string | null;
}

/**
 * `LIMIT 400` per adaptation (spec-21 § 6.3). Truncation is reported to the
 * caller and logged — E2 hit this cap on 28 of 80 fixture pools, so it is
 * ordinary behaviour at the catalogue's real size.
 */
export const ADAPTATION_CANDIDATE_CAP = 400;

const ADAPTATION_CANDIDATE_PROJECTION = {
  id: exercises.id,
  name: exercises.name,
  category: exercises.category,
  difficultyLevel: exercises.difficultyLevel,
  movementType: exercises.movementType,
  primaryMuscles: exercises.primaryMuscles,
  secondaryMuscles: exercises.secondaryMuscles,
  equipmentRequired: exercises.equipmentRequired,
  thumbnailUrl: exercises.thumbnailUrl,
};

function toAdaptationCandidate(row: {
  id: string;
  name: string;
  category: string | null;
  difficultyLevel: string | null;
  movementType: string | null;
  primaryMuscles: string[] | null;
  secondaryMuscles: string[] | null;
  equipmentRequired: string[] | null;
  thumbnailUrl: string | null;
}): AdaptationCandidate {
  return {
    ...row,
    primaryMuscles: row.primaryMuscles ?? [],
    secondaryMuscles: row.secondaryMuscles ?? [],
    equipmentRequired: row.equipmentRequired ?? [],
  };
}

/**
 * Filter shape for `list()`. Arrays OR-match within an axis; different axes
 * AND together.
 *
 * The handler is the single layer responsible for parsing query-string
 * params (single value vs repeated-key array) into this filter shape.
 * The repository trusts that callers have already normalised — no
 * back-compat single-string fallbacks here.
 *
 * `muscleGroup` is the exception: it's kept as a single-UUID alias for
 * `targetedMusclesAny` because the pre-M0 handler exposed it as a single
 * value and some callers still reach the repo that way.
 *
 * See specs/03-exercise-library/design.md § Backend Endpoints > GET /exercises.
 */
export interface ListExercisesFilters {
  /** Free-text search. Repository searches name + description + instructions. */
  q?: string;
  /** Back-compat alias for `q`. */
  search?: string;
  /** Single muscle-group UUID (pre-M0 alias; prefer `targetedMusclesAny`). */
  muscleGroup?: string;
  /** Multi-value muscle-group UUIDs — OR-matched within axis. */
  targetedMusclesAny?: string[];
  /** Multi-value equipment UUIDs — OR-matched within axis. */
  equipmentAny?: string[];
  /**
   * Loadout containment (spec-21 § 6.1, T-1.1): "everything this exercise
   * needs, I have". Renders `<available>::uuid[] @> COALESCE(equipment_required,
   * '{}')`.
   *
   * ⚠ This is NOT `equipmentAny`. That axis is array OVERLAP (`&&`) — "needs at
   * least one thing I have" — which would hand a barbell back squat to someone
   * holding a single dumbbell. An adaptation needs the asymmetric direction, so
   * the two axes coexist rather than one being widened.
   *
   * ⚠ `COALESCE` is load-bearing: `equipment_required` is nullable on rows that
   * predate the `.default([])`, and `@>` against NULL yields NULL — which would
   * silently drop every legacy row from every adaptation. Same class of bug this
   * repository already documents for `||` on `targetedMusclesAny`.
   *
   * Note `x @> '{}'` is always true, so bodyweight rows pass every context.
   * That is correct behaviour (design § 6.1).
   */
  equipmentSubsetOf?: string[];
  /** Category enum values — OR-matched within axis. */
  category?: string[];
  /** Difficulty enum values — OR-matched within axis. */
  difficultyLevel?: string[];
  /**
   * `created_by[]` filter — enum strings, never UUIDs.
   * Valid values: "mine" | "system" | "pt" | "physio" | "all".
   *
   * The repository ORs the enum values together; the visibility predicate
   * is always applied (see design.md § Backend Authorization Rules).
   */
  createdByFilter?: string[];
  limit?: number;
  offset?: number;
}

export type CreateExerciseInput = Omit<
  NewExercise,
  "id" | "createdBy" | "createdAt" | "updatedAt"
>;
export type UpdateExerciseInput = Partial<CreateExerciseInput>;

export class ExerciseRepository {
  static readonly key = "ExerciseRepository";

  /**
   * Single source of truth for "the trainers this client is connected to".
   *
   * Used by both the visibility predicate (always applied) and the
   * created_by=pt|physio filter (optional, narrows within visible set).
   * Keeping the criteria in one place means status-enum changes, new
   * flags, or the eventual physio role split land in exactly one spot.
   *
   * Drizzle emits this as an SQL fragment each time it's called — there's
   * no query-plan sharing at the DB layer in M0. Future work could hoist
   * it into a CTE if the cost becomes measurable.
   */
  private activeTrainerIdsSubquery(userId: string) {
    return getDb()
      .select({ trainerId: ptClientRelationships.trainerId })
      .from(ptClientRelationships)
      .where(
        and(
          eq(ptClientRelationships.clientId, userId),
          eq(ptClientRelationships.status, "active"),
          eq(ptClientRelationships.isAiTrainer, false),
        ),
      );
  }

  /**
   * Exercise ids the caller can read because the exercise belongs to a workout
   * in a LIVE programme (`status IN ('assigned','started')`) assigned to the
   * caller. Keys off the programme DEFINITION (`program_workouts`) rather than
   * materialised occurrences, so it covers EVERY week of the programme —
   * including not-yet-materialised occurrences of an indefinite programme
   * (specs/24-coach-authoring AC 3.6).
   *
   * Built with drizzle's connection-free `QueryBuilder` (not `getDb()`) so the
   * subquery is a pure, renderable SQL fragment: the assembled visibility SQL
   * can then be asserted via `PgDialect` in tests, closing the mocked-`getDb`
   * blind spot (see reference_drizzle_groupby_param_bug — mocked SQL ships
   * green). It still serialises + executes normally inside the real query.
   */
  private programmeAssignedExerciseIdsSubquery(userId: string) {
    return new QueryBuilder()
      .select({ exerciseId: workoutExercises.exerciseId })
      .from(workoutExercises)
      .innerJoin(
        programWorkouts,
        eq(programWorkouts.workoutId, workoutExercises.workoutId),
      )
      .innerJoin(
        programAssignments,
        eq(programAssignments.programId, programWorkouts.programId),
      )
      .where(
        and(
          eq(programAssignments.clientId, userId),
          inArray(programAssignments.status, [...LIVE_ASSIGNMENT_STATUSES]),
        ),
      );
  }

  /**
   * Exercise ids the caller can read because the exercise belongs to a workout
   * ASSIGNED to the caller — an ad-hoc single-workout assignment, OR a
   * materialised/past programme occurrence. ANY status (not just live), so an
   * exercise the caller actually trained stays readable in history after the
   * programme is completed/unassigned — avoids a `getById` 404 regression on
   * past-session detail. Complements the programme-definition branch above.
   * Connection-free `QueryBuilder`, same rationale as above.
   */
  private assignedWorkoutExerciseIdsSubquery(userId: string) {
    return new QueryBuilder()
      .select({ exerciseId: workoutExercises.exerciseId })
      .from(workoutExercises)
      .innerJoin(
        workoutAssignments,
        eq(workoutAssignments.workoutId, workoutExercises.workoutId),
      )
      .where(eq(workoutAssignments.clientId, userId));
  }

  /**
   * Visibility predicate applied to every `list()`, `count()`, `search()`, and
   * `getById()` call.
   *
   * A caller sees an exercise iff ANY of:
   *   • `created_by = SYSTEM_USER_ID` (system catalogue — legacy Supabase
   *     convention; see the constant's docstring).
   *   • `created_by IS NULL` (defensive — kept for forward-compat with a
   *     potential Neon migration that drops the sentinel, never matches
   *     against the live Supabase rows).
   *   • `created_by = caller.sub` (own custom).
   *   • the exercise is in a workout in a LIVE programme assigned to the caller.
   *   • the exercise is in a workout otherwise assigned to the caller.
   *
   * The last two branches REPLACE the previous blanket "any exercise created by
   * any linked active PT" branch: a coach's custom exercise is visible to a
   * client ONLY once it has been assigned (in a programme or a workout), not by
   * browsing/searching the whole catalogue (specs/24-coach-authoring STORY-003).
   * A coach reading the workout/programme they authored still sees the exercise
   * via the `created_by = caller.sub` branch. Note: the workout-detail payload
   * embeds exercise fields WITHOUT this predicate, so an assigned workout still
   * renders its exercises regardless (AC 3.4).
   *
   * Unauthenticated callers see only system exercises.
   *
   * Spec: specs/24-coach-authoring design.md § A.2; supersedes 03 AC 7.8.
   */
  private buildVisibilityCondition(userId: string | null): SQL {
    const systemClause = or(
      eq(exercises.createdBy, SYSTEM_USER_ID),
      isNull(exercises.createdBy),
    ) as SQL;

    if (!userId) {
      return systemClause;
    }

    return or(
      systemClause,
      eq(exercises.createdBy, userId),
      inArray(exercises.id, this.programmeAssignedExerciseIdsSubquery(userId)),
      inArray(exercises.id, this.assignedWorkoutExerciseIdsSubquery(userId)),
    ) as SQL;
  }

  /**
   * Translate `created_by[]` enum values into a single OR-combined SQL
   * condition that narrows within the already-visible set.
   *
   * "all" short-circuits (no extra constraint). Auth-required values
   * (`"mine"`, `"pt"`, `"physio"`) silently drop when `userId` is null —
   * the handler should have returned 400 before reaching here, but the
   * repository stays safe.
   *
   * Physio is treated identically to PT in M0 — no role distinction yet.
   * To avoid emitting duplicate SQL when the caller sends both "pt" and
   * "physio", or repeats any single value, we canonicalise physio→pt
   * and dedupe via a Set before building predicates.
   *
   * Spec: design.md § Backend Authorization Rules · AC 7.7
   */
  private buildCreatedByFilterCondition(
    filter: string[] | undefined,
    userId: string | null,
  ): SQL | undefined {
    if (!filter || filter.length === 0) return undefined;
    if (filter.includes("all")) return undefined;

    // Canonicalise physio→pt (identical predicate in M0), then dedupe.
    // This collapses `created_by=pt&created_by=physio` into one pt-trainer
    // subquery instead of two identical ones.
    const canonical = filter.map((v) => (v === "physio" ? "pt" : v));
    const deduped = Array.from(new Set(canonical));

    const predicates: SQL[] = [];

    for (const value of deduped) {
      switch (value) {
        case "mine":
          if (userId) predicates.push(eq(exercises.createdBy, userId));
          break;
        case "system":
          // System rows on Supabase use the SYSTEM_USER_ID sentinel;
          // IS NULL is kept as a belt-and-suspenders fallback.
          predicates.push(
            or(
              eq(exercises.createdBy, SYSTEM_USER_ID),
              isNull(exercises.createdBy),
            ) as SQL,
          );
          break;
        case "pt": {
          if (!userId) break;
          predicates.push(
            inArray(exercises.createdBy, this.activeTrainerIdsSubquery(userId)),
          );
          break;
        }
        default:
          // Unknown value — ignore (handler should validate).
          break;
      }
    }

    if (predicates.length === 0) return undefined;
    if (predicates.length === 1) return predicates[0];
    return or(...predicates) as SQL;
  }

  /**
   * Build the non-search filter conditions shared between `list()`,
   * `count()`, and `search()`: visibility, created_by, difficulty,
   * category, muscle, and equipment.
   *
   * Search uses this *plus* its own FTS / trigram predicate; the list
   * endpoint adds an `ilike` substring predicate on top. Centralising the
   * non-search axes here means a filter-axis bug fix in one place lands
   * for every endpoint that lists / searches exercises.
   */
  private buildNonSearchFilterConditions(
    filters: ListExercisesFilters,
    userId: string | null,
  ): SQL[] {
    const conditions: SQL[] = [];

    conditions.push(this.buildVisibilityCondition(userId));

    const createdByCond = this.buildCreatedByFilterCondition(
      filters.createdByFilter,
      userId,
    );
    if (createdByCond) conditions.push(createdByCond);

    if (filters.difficultyLevel && filters.difficultyLevel.length > 0) {
      conditions.push(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inArray(exercises.difficultyLevel, filters.difficultyLevel as any),
      );
    }

    if (filters.category && filters.category.length > 0) {
      conditions.push(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inArray(exercises.category, filters.category as any),
      );
    }

    if (filters.targetedMusclesAny && filters.targetedMusclesAny.length > 0) {
      // Postgres array overlap: row's primary_muscles shares any uuid
      // with filter. Matches legacy (`primary_muscles.ov.{…}`) and
      // user mental model — selecting "Chest" should surface
      // chest-as-primary movers, not every compound lift that
      // incidentally hits chest as a secondary. A prior attempt
      // widened this to `(primary || secondary) && …` to also catch
      // secondary movers, but (a) it over-matched ("abs" returning
      // ~1300 rows because nearly everything works core secondary)
      // and (b) Postgres `||` with a NULL operand returns NULL, which
      // makes the whole predicate NULL and silently drops every row
      // with `secondary_muscles IS NULL` — a regression on legacy
      // rows that pre-date the `default([])` column default.
      conditions.push(
        sql`${exercises.primaryMuscles} && ${uuidArray(filters.targetedMusclesAny)}`,
      );
    } else if (filters.muscleGroup) {
      conditions.push(
        sql`${filters.muscleGroup}::uuid = ANY(${exercises.primaryMuscles})`,
      );
    }

    if (filters.equipmentAny && filters.equipmentAny.length > 0) {
      conditions.push(
        sql`${exercises.equipmentRequired} && ${uuidArray(filters.equipmentAny)}`,
      );
    }

    // Loadout containment (spec-21 § 6.1). See the field's docstring for why
    // this is a separate axis from `equipmentAny` and why COALESCE is required.
    // An EMPTY array is a meaningful context ("I have nothing"), not "no
    // filter" — but the preview handler rejects an empty context with 400
    // before reaching here, so the length guard only affects callers that
    // omitted the axis entirely.
    if (filters.equipmentSubsetOf && filters.equipmentSubsetOf.length > 0) {
      conditions.push(
        sql`${uuidArray(filters.equipmentSubsetOf)} @> COALESCE(${exercises.equipmentRequired}, '{}'::uuid[])`,
      );
    }

    return conditions;
  }

  /**
   * Build the AND-combined WHERE clause for both `list()` and `count()`.
   *
   * Extracted so pagination's `total` count and the page slice run against
   * the exact same predicate — if these ever drift, `hasMore` can flip
   * true while the next page returns zero rows (and vice versa).
   */
  private buildListFilterConditions(
    filters: ListExercisesFilters,
    userId: string | null,
  ): SQL[] {
    const conditions = this.buildNonSearchFilterConditions(filters, userId);

    const searchText = filters.q ?? filters.search;
    if (searchText) {
      const escaped = searchText.replace(/[%_\\]/g, "\\$&");
      const pattern = `%${escaped}%`;
      // Matches legacy Algolia behaviour: case-insensitive substring across
      // name + description + instructions. Description / instructions are
      // nullable; ilike treats NULL as non-matching, which is the correct
      // semantic (a null description should never match a user query).
      conditions.push(
        or(
          ilike(exercises.name, pattern),
          ilike(exercises.description, pattern),
          ilike(exercises.instructions, pattern),
        ) as SQL,
      );
    }

    return conditions;
  }

  /**
   * List exercises visible to `userId` (or system-only when null), applying
   * the filter axes above. OR within array axes, AND across axes.
   *
   * Spec: design.md § Backend Endpoints > GET /exercises · AC 7.6, 7.7, 7.8
   */
  async list(
    filters: ListExercisesFilters,
    userId: string | null = null,
  ): Promise<Exercise[]> {
    const db = getDb();
    const limit = filters.limit ?? 20;
    const offset = filters.offset ?? 0;

    const conditions = this.buildListFilterConditions(filters, userId);

    return db
      .select()
      .from(exercises)
      .where(and(...conditions))
      .orderBy(desc(exercises.createdAt))
      .limit(limit)
      .offset(offset);
  }

  /**
   * Count rows matching the same visibility + filter predicate as `list()`,
   * ignoring limit/offset. Used by the handler to emit `meta.total` so the
   * mobile client can render pagination state without an extra round-trip.
   *
   * Always uses the shared `buildListFilterConditions` so the count cannot
   * drift from the page query — see that method's docstring.
   */
  async count(
    filters: ListExercisesFilters,
    userId: string | null = null,
  ): Promise<number> {
    const db = getDb();
    const conditions = this.buildListFilterConditions(filters, userId);

    const rows = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(exercises)
      .where(and(...conditions));

    return rows[0]?.total ?? 0;
  }

  /**
   * Full-text search across the exercise catalogue, scoped to the same
   * visibility + filter predicate `list()` applies. Order:
   *
   *   1. Combined relevance: `ts_rank * 2 + word_similarity`. ts_rank is
   *      weighted higher because for clean matches (criteria 1, 2, 4, 6 in
   *      the FTS investigation) we want lexeme-driven ordering; trigram is
   *      the typo-tolerant tie-breaker / fallback.
   *   2. Name ASC for deterministic tie-breaking on equal scores — without
   *      this, two equally-relevant rows can swap order across runs.
   *
   * The match predicate is `(FTS @@) OR (name %>)`. The trigram operator
   * `%>` is `word_similarity > pg_trgm.word_similarity_threshold` (default
   * 0.6) — that's the right granularity for "find this exercise by its
   * misspelt name". If tokenisation yields no usable token (the input is
   * pure punctuation), we drop the FTS branch and rely on trigram only.
   *
   * Filter axes (category / equipment / muscles / difficulty / created_by)
   * are AND-combined with the FTS predicate, so ranking happens *within*
   * the filtered set. Without this, `q + category=cardio` could return
   * top-100 ranked rows across the whole catalogue and then narrow client-
   * side to whatever cardio rows happened to rank within the first 100,
   * silently dropping any cardio match ranked at position 101+. The
   * `q` field on `filters` is ignored — the explicit `q` parameter is
   * authoritative.
   *
   * Both branches go through `sql` template parameterisation, so user
   * input never reaches Postgres unparameterised. The tokenizer strips
   * tsquery reserved characters before parameterisation so `to_tsquery`
   * cannot raise a syntax error from user input.
   *
   * Spec: specs/03-exercise-library/POSTGRES_FTS_INVESTIGATION.md.
   */
  async search(
    q: string,
    filters: Omit<
      ListExercisesFilters,
      "q" | "search" | "limit" | "offset"
    > = {},
    userId: string | null = null,
    limit = 20,
    offset = 0,
  ): Promise<{ rows: Exercise[]; total: number }> {
    const db = getDb();
    const tsq = toPrefixTsQuery(q);

    const matchCondition = tsq
      ? sql`(search_vector @@ to_tsquery('english', ${tsq}) OR ${exercises.name} %> ${q})`
      : sql`${exercises.name} %> ${q}`;

    const filterConditions = this.buildNonSearchFilterConditions(
      filters,
      userId,
    );
    const where = and(...filterConditions, matchCondition) as SQL;

    const primaryOrder = tsq
      ? sql`(ts_rank(search_vector, to_tsquery('english', ${tsq})) * 2 + word_similarity(${q}, ${exercises.name})) DESC`
      : sql`word_similarity(${q}, ${exercises.name}) DESC`;

    const [rows, totalResult] = await Promise.all([
      db
        .select()
        .from(exercises)
        .where(where)
        .orderBy(primaryOrder, sql`${exercises.name} ASC`)
        .limit(limit)
        .offset(offset),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(exercises)
        .where(where),
    ]);

    return { rows, total: totalResult[0]?.total ?? 0 };
  }

  /**
   * Fetch a single exercise by id if visible to `userId`. Returns null when
   * the row doesn't exist OR is not visible — handler treats either as 404
   * (no existence leak per AC 7.4/7.5/7.8).
   */
  async getById(
    id: string,
    userId: string | null = null,
  ): Promise<Exercise | null> {
    const db = getDb();
    const result = await db
      .select()
      .from(exercises)
      .where(and(eq(exercises.id, id), this.buildVisibilityCondition(userId)))
      .limit(1);
    return result[0] ?? null;
  }

  /**
   * Explicit column projection — not `select()` — so a future schema.ts
   * that adds fields not present in the live Supabase table doesn't
   * break the SELECT. Mirrors the exact column list the legacy mobile
   * app fetches from the same table.
   */
  async getMuscleGroups(): Promise<MuscleGroupRow[]> {
    const db = getDb();
    return db
      .select({
        id: muscleGroups.id,
        name: muscleGroups.name,
        displayName: muscleGroups.displayName,
      })
      .from(muscleGroups)
      .orderBy(muscleGroups.name);
  }

  /**
   * Explicit projection: `equipment_types` in Supabase has only
   * `id, name, created_at` (+ `category`, added by spec-21 Phase 0).
   * The Drizzle schema also lists a `description` column that does not
   * exist in the live DB; projecting `select()` would 500 on Postgres's
   * "column description does not exist". See
   * memory/project_supabase_db_as_is.
   *
   * `category` (spec-21 § 2.3b) groups the Loadout equipment picker from the
   * API rather than a hardcoded client list (AC-2.2). Nullable — an
   * uncategorised row renders under "Other" rather than disappearing.
   */
  async getEquipmentTypes(): Promise<EquipmentTypeRow[]> {
    const db = getDb();
    return db
      .select({
        id: equipmentTypes.id,
        name: equipmentTypes.name,
        category: equipmentTypes.category,
      })
      .from(equipmentTypes)
      .orderBy(equipmentTypes.name);
  }

  /**
   * Which of `ids` may the caller NOT read? Empty array = all readable.
   *
   * Loadout (spec-21 § 7.1): read-visibility is the SECURITY control on the
   * create-variation path and is re-verified on EVERY submitted row, so an
   * adaptation cannot be used to smuggle another coach's private exercise into
   * a workout the caller owns. Equipment containment, by contrast, is a quality
   * check the user may deliberately override (AC-4.2 / AC-4.3) — the asymmetry
   * is the point.
   *
   * Reuses `buildVisibilityCondition` rather than re-deriving the grant set, so
   * the predicate lives in exactly one place and a future grant (or revocation)
   * applies here automatically.
   */
  async findUnreadableExerciseIds(
    userId: string,
    ids: string[],
  ): Promise<string[]> {
    const unique = Array.from(new Set(ids));
    if (unique.length === 0) return [];

    const db = getDb();
    const rows = await db
      .select({ id: exercises.id })
      .from(exercises)
      .where(
        and(
          inArray(exercises.id, unique),
          this.buildVisibilityCondition(userId),
        ),
      );

    const readable = new Set(rows.map((r) => r.id));
    return unique.filter((id) => !readable.has(id));
  }

  /**
   * Stage 1 of the adaptation pipeline (spec-21 § 6.3, T-1.3) — ONE query per
   * adaptation, never one per exercise.
   *
   * Returns every exercise that is (a) performable with `equipmentTypeIds`
   * (containment, not overlap), (b) a primary mover for at least one muscle in
   * `muscleIds` (the union across every row needing a swap), and (c) readable by
   * the caller (`buildVisibilityCondition` — AC-3.6, so an adaptation can never
   * surface another coach's private exercise).
   *
   * Deliberately not `list()`: this path needs an explicit projection (the
   * ranking fields, which `Exercise` carries but the wire shape does not),
   * `name ASC` ordering so the cap truncates DETERMINISTICALLY rather than by
   * insertion date, and truncation visibility. `LIMIT cap + 1` detects the
   * overflow in the same round trip instead of paying for a `count(*)`.
   *
   * Truncation is REPORTED, never silent (§ 6.3). The caller logs it — 28 of
   * E2's 80 fixture pools hit the cap, so this is ordinary behaviour at the
   * catalogue's real size, not a fixture artefact.
   */
  async listAdaptationCandidates(
    userId: string,
    params: {
      muscleIds: string[];
      equipmentTypeIds: string[];
      excludeExerciseIds?: string[];
      cap?: number;
      search?: string;
    },
  ): Promise<{ candidates: AdaptationCandidate[]; truncated: boolean }> {
    if (params.muscleIds.length === 0) {
      return { candidates: [], truncated: false };
    }

    const db = getDb();
    const cap = params.cap ?? ADAPTATION_CANDIDATE_CAP;

    const conditions = this.buildNonSearchFilterConditions(
      {
        targetedMusclesAny: params.muscleIds,
        equipmentSubsetOf: params.equipmentTypeIds,
      },
      userId,
    );
    // Keep this identical to the mobile picker's `tokenizeSearch`: punctuation
    // is a separator, so `bench-press` and `bench/press` both find "Bench
    // Press". Otherwise the immediate client result disappears when the
    // debounced server response arrives.
    const searchTokens =
      params.search
        ?.toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean) ?? [];
    for (const token of searchTokens) {
      const escaped = token.replace(/[%_\\]/g, "\\$&");
      conditions.push(ilike(exercises.name, `%${escaped}%`));
    }

    const exclude = Array.from(new Set(params.excludeExerciseIds ?? []));
    if (exclude.length > 0) {
      conditions.push(sql`${exercises.id} <> ALL(${uuidArray(exclude)})`);
    }

    const rows = await db
      .select(ADAPTATION_CANDIDATE_PROJECTION)
      .from(exercises)
      .where(and(...conditions))
      .orderBy(sql`${exercises.name} ASC`)
      .limit(cap + 1);

    return {
      candidates: rows.slice(0, cap).map(toAdaptationCandidate),
      truncated: rows.length > cap,
    };
  }

  /**
   * The ranking fields for a specific set of exercise ids, in `name ASC` order.
   *
   * Used by `GET /exercises/substitutes` for the "others" list (the same muscle
   * filter WITHOUT containment, rendered dimmed — design § 6.4) and by the
   * preview's own source rows. Applies the visibility predicate: this feeds a
   * picker, so AC-3.6 binds exactly as it does for the candidate query.
   */
  async listRankableExercises(
    userId: string,
    params: {
      muscleIds: string[];
      excludeExerciseIds?: string[];
      cap?: number;
      search?: string;
    },
  ): Promise<{ candidates: AdaptationCandidate[]; truncated: boolean }> {
    return this.listAdaptationCandidates(userId, {
      muscleIds: params.muscleIds,
      // Omitting the containment axis entirely — an empty array would be
      // dropped by the length guard anyway, but passing none states the intent.
      equipmentTypeIds: [],
      excludeExerciseIds: params.excludeExerciseIds,
      cap: params.cap,
      search: params.search,
    });
  }

  /**
   * `equipment_required` for each of `ids`, keyed by exercise id. A missing row
   * (deleted between preview and save) is simply absent from the map — the
   * caller decides whether that is an error.
   *
   * NO visibility predicate, deliberately: the one caller
   * (`POST /workouts/:id/variations`, T-1.6) has already run
   * `findUnreadableExerciseIds` over the same ids, and that is the security
   * control. Re-applying the predicate here would silently turn a caller's
   * parent-carried row — exempt from the catalogue predicate by design — into a
   * containment failure instead of a pass.
   */
  async findEquipmentRequirements(
    ids: string[],
  ): Promise<Map<string, string[]>> {
    const unique = Array.from(new Set(ids));
    if (unique.length === 0) return new Map();

    const db = getDb();
    const rows = await db
      .select({
        id: exercises.id,
        equipmentRequired: exercises.equipmentRequired,
      })
      .from(exercises)
      .where(inArray(exercises.id, unique));

    return new Map(rows.map((r) => [r.id, r.equipmentRequired ?? []]));
  }

  /**
   * Which of `candidateIds` has the caller actually trained before? Backs the
   * §6.2 ranker's +8 "logged before" signal, which has no other data source.
   *
   * Intersected with the candidate ids rather than fetching the caller's whole
   * training history: the ranker only ever asks about candidates, and an
   * unbounded `DISTINCT exercise_id` over every session a long-standing user has
   * logged is a much larger scan for the same answer.
   *
   * Scoped by `workout_sessions.user_id` — a session logged by a coach ON BEHALF
   * of the caller still counts, because the caller performed it.
   */
  async listPreviouslyLoggedExerciseIds(
    userId: string,
    candidateIds: string[],
  ): Promise<string[]> {
    const unique = Array.from(new Set(candidateIds));
    if (unique.length === 0) return [];

    const db = getDb();
    const rows = await db
      .selectDistinct({ exerciseId: sessionExercises.exerciseId })
      .from(sessionExercises)
      .innerJoin(
        workoutSessions,
        eq(workoutSessions.id, sessionExercises.sessionId),
      )
      .where(
        and(
          eq(workoutSessions.userId, userId),
          inArray(sessionExercises.exerciseId, unique),
        ),
      );

    return rows.map((r) => r.exerciseId);
  }

  /**
   * Resolve equipment-type NAMES to ids. Backs the intensity-mismatch check
   * (spec-21 § 7.1b, T-1.11), whose "loadable" set is defined by name because it
   * cuts ACROSS `equipment_types.category` — `free_weights` holds Kettlebell,
   * Medicine Ball, Bench and Squat Rack, none of which can load a 4-6 rep
   * strength row.
   *
   * Explicit `id`-only projection: `equipment_types.description` is in
   * `schema.ts` but not in the live database, so a bare `select()` 500s.
   */
  async findEquipmentTypeIdsByName(names: string[]): Promise<string[]> {
    const unique = Array.from(new Set(names));
    if (unique.length === 0) return [];

    const db = getDb();
    const rows = await db
      .select({ id: equipmentTypes.id })
      .from(equipmentTypes)
      .where(inArray(equipmentTypes.name, unique));

    return rows.map((r) => r.id);
  }

  async getCategories(): Promise<string[]> {
    const db = getDb();
    const result = await db
      .selectDistinct({ category: exercises.category })
      .from(exercises);
    return result.map((r) => r.category as string).filter(Boolean);
  }

  /**
   * Create a custom exercise owned by `userId`. `created_by` is forced from
   * the JWT sub; never trusted from the request body.
   *
   * Spec: design.md § POST /exercises · AC 7.3
   */
  /**
   * Create a custom exercise.
   *
   * `clientRequestId` makes the create REPLAY-SAFE. The mobile sync queue cannot
   * distinguish "the request never arrived" from "it arrived, committed, and the
   * response was lost", so its retry used to insert a second exercise. With a key
   * present, a replay resolves to the row the first attempt created and returns
   * it unchanged — indistinguishable from the original success.
   *
   * Mirrors `SessionRepository.record`'s `clientSessionId` handling, which has
   * been the pattern for this since M13. Omitting the key preserves the previous
   * behaviour exactly (a plain insert), so legacy clients and direct-API callers
   * are unaffected.
   */
  async create(
    userId: string,
    data: CreateExerciseInput,
    clientRequestId?: string | null,
  ): Promise<Exercise> {
    const db = getDb();
    const key = clientRequestId ?? null;

    if (key === null) {
      const result = await db
        .insert(exercises)
        .values({ ...data, createdBy: userId } as NewExercise)
        .returning();
      return result[0];
    }

    // ON CONFLICT DO NOTHING against the FULL unique index on
    // (created_by, client_request_id), then read back on an empty return.
    //
    // The index must be full, not partial: `onConflictDoNothing({ target })`
    // emits no index predicate, and Postgres cannot infer a partial index
    // without one — it raises 42P10 instead. See the migration
    // (20260727120100) for the full reasoning, and
    // __tests__/clientRequestIdIdempotency.test.ts, which asserts the SQL this
    // call emits and the shape the migration creates actually agree.
    //
    // Doing it in this order (rather than SELECT-then-INSERT)
    // closes the window where two concurrent replays both see "no row yet" — the
    // index arbitrates, and the loser simply reads the winner's row.
    const inserted = await db
      .insert(exercises)
      .values({
        ...data,
        createdBy: userId,
        clientRequestId: key,
      } as NewExercise)
      .onConflictDoNothing({
        target: [exercises.createdBy, exercises.clientRequestId],
      })
      .returning();
    if (inserted[0]) return inserted[0];

    const existing = await db
      .select()
      .from(exercises)
      .where(
        and(
          eq(exercises.createdBy, userId),
          eq(exercises.clientRequestId, key),
        ),
      )
      .limit(1);
    // A conflict with nothing to read back would mean the index matched a row we
    // cannot see, which should be impossible while the index is scoped to
    // created_by. Fall back to a plain insert rather than returning undefined and
    // letting the handler serialise `data: undefined`.
    if (existing[0]) return existing[0];
    const fallback = await db
      .insert(exercises)
      .values({ ...data, createdBy: userId } as NewExercise)
      .returning();
    return fallback[0];
  }

  /**
   * Partial update. Returns null when the row doesn't exist OR the caller
   * isn't the creator — handler translates either to 404 (no existence
   * leak) per AC 7.4.
   *
   * Ownership is enforced atomically in the UPDATE's WHERE clause — no
   * pre-SELECT, no race window, one round trip. "Not found" and "not
   * owner" both yield an empty `returning()` array, which the spec
   * explicitly collapses to a single 404 outcome.
   *
   * Spec: design.md § PATCH /exercises/:id · AC 7.4
   */
  async update(
    id: string,
    userId: string,
    data: UpdateExerciseInput,
  ): Promise<Exercise | null> {
    const db = getDb();

    const result = await db
      .update(exercises)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(exercises.id, id), eq(exercises.createdBy, userId)))
      .returning();
    return result[0] ?? null;
  }

  /**
   * Hard delete, owner-only. Returns false when the row doesn't exist OR
   * the caller isn't the creator — handler translates either to 404.
   *
   * Ownership is enforced atomically in the DELETE's WHERE clause; see
   * `update` for the rationale.
   *
   * No soft-delete semantics in M0 (no `deleted_at` column).
   *
   * Spec: design.md § DELETE /exercises/:id · AC 7.5
   */
  async delete(id: string, userId: string): Promise<boolean> {
    const db = getDb();

    const result = await db
      .delete(exercises)
      .where(and(eq(exercises.id, id), eq(exercises.createdBy, userId)))
      .returning();
    return !!result[0];
  }
}
