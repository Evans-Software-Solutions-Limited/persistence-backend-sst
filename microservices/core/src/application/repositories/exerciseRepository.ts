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
import {
  exercises,
  type Exercise,
  type NewExercise,
  muscleGroups,
  equipmentTypes,
  ptClientRelationships,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";

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
};

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
   * Visibility predicate applied to every `list()` and `getById()` call.
   *
   * A caller sees an exercise iff ANY of:
   *   • `created_by = SYSTEM_USER_ID` (system catalogue — legacy Supabase
   *     convention; see the constant's docstring).
   *   • `created_by IS NULL` (defensive — kept for forward-compat with a
   *     potential Neon migration that drops the sentinel, never matches
   *     against the live Supabase rows).
   *   • `created_by = caller.sub` (own custom).
   *   • `created_by` belongs to an active, non-AI PT/physio the caller is
   *     connected to.
   *
   * Unauthenticated callers see only system exercises.
   *
   * Spec: design.md § Backend Authorization Rules · AC 7.8
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
      inArray(exercises.createdBy, this.activeTrainerIdsSubquery(userId)),
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
      // Postgres array overlap: row's primary_muscles shares any uuid with filter
      conditions.push(
        sql`${exercises.primaryMuscles} && ${filters.targetedMusclesAny}::uuid[]`,
      );
    } else if (filters.muscleGroup) {
      conditions.push(
        sql`${filters.muscleGroup}::uuid = ANY(${exercises.primaryMuscles})`,
      );
    }

    if (filters.equipmentAny && filters.equipmentAny.length > 0) {
      conditions.push(
        sql`${exercises.equipmentRequired} && ${filters.equipmentAny}::uuid[]`,
      );
    }

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
   * visibility predicate `list()` applies. Order:
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
   * Both branches go through `sql` template parameterisation, so user
   * input never reaches Postgres unparameterised. The tokenizer strips
   * tsquery reserved characters before parameterisation so `to_tsquery`
   * cannot raise a syntax error from user input.
   *
   * Spec: specs/03-exercise-library/POSTGRES_FTS_INVESTIGATION.md.
   */
  async search(
    q: string,
    userId: string | null = null,
    limit = 20,
    offset = 0,
  ): Promise<{ rows: Exercise[]; total: number }> {
    const db = getDb();
    const tsq = toPrefixTsQuery(q);

    const matchCondition = tsq
      ? sql`(search_vector @@ to_tsquery('english', ${tsq}) OR ${exercises.name} %> ${q})`
      : sql`${exercises.name} %> ${q}`;

    const visibility = this.buildVisibilityCondition(userId);
    const where = and(visibility, matchCondition) as SQL;

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
   * `id, name, created_at`. The Drizzle schema also lists a
   * `description` column that does not exist in the live DB;
   * projecting `select()` would 500 on Postgres's "column
   * description does not exist". See memory/project_supabase_db_as_is.
   */
  async getEquipmentTypes(): Promise<EquipmentTypeRow[]> {
    const db = getDb();
    return db
      .select({
        id: equipmentTypes.id,
        name: equipmentTypes.name,
      })
      .from(equipmentTypes)
      .orderBy(equipmentTypes.name);
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
  async create(userId: string, data: CreateExerciseInput): Promise<Exercise> {
    const db = getDb();
    const result = await db
      .insert(exercises)
      .values({ ...data, createdBy: userId } as NewExercise)
      .returning();
    return result[0];
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
