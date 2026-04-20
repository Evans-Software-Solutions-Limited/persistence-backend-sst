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
  type MuscleGroup,
  equipmentTypes,
  type EquipmentType,
  ptClientRelationships,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";

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
   * Visibility predicate applied to every `list()` and `getById()` call.
   *
   * A caller sees an exercise iff ANY of:
   *   • `created_by IS NULL` (system)
   *   • `created_by = caller.sub` (own custom)
   *   • `created_by` belongs to an active, non-AI PT/physio they're connected to
   *
   * Unauthenticated callers see only system exercises.
   *
   * Spec: design.md § Backend Authorization Rules · AC 7.8
   */
  private buildVisibilityCondition(userId: string | null): SQL {
    if (!userId) {
      return isNull(exercises.createdBy);
    }

    const activeTrainerIds = getDb()
      .select({ trainerId: ptClientRelationships.trainerId })
      .from(ptClientRelationships)
      .where(
        and(
          eq(ptClientRelationships.clientId, userId),
          eq(ptClientRelationships.status, "active"),
          eq(ptClientRelationships.isAiTrainer, false),
        ),
      );

    return or(
      isNull(exercises.createdBy),
      eq(exercises.createdBy, userId),
      inArray(exercises.createdBy, activeTrainerIds),
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
   *
   * Spec: design.md § Backend Authorization Rules · AC 7.7
   */
  private buildCreatedByFilterCondition(
    filter: string[] | undefined,
    userId: string | null,
  ): SQL | undefined {
    if (!filter || filter.length === 0) return undefined;
    if (filter.includes("all")) return undefined;

    const db = getDb();
    const predicates: SQL[] = [];

    for (const value of filter) {
      switch (value) {
        case "mine":
          if (userId) predicates.push(eq(exercises.createdBy, userId));
          break;
        case "system":
          predicates.push(isNull(exercises.createdBy));
          break;
        case "pt":
        case "physio": {
          if (!userId) break;
          const trainerIds = db
            .select({ trainerId: ptClientRelationships.trainerId })
            .from(ptClientRelationships)
            .where(
              and(
                eq(ptClientRelationships.clientId, userId),
                eq(ptClientRelationships.status, "active"),
                eq(ptClientRelationships.isAiTrainer, false),
              ),
            );
          predicates.push(inArray(exercises.createdBy, trainerIds));
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

    return db
      .select()
      .from(exercises)
      .where(and(...conditions))
      .orderBy(desc(exercises.createdAt))
      .limit(limit)
      .offset(offset);
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

  async getMuscleGroups(): Promise<MuscleGroup[]> {
    const db = getDb();
    return db.select().from(muscleGroups).orderBy(muscleGroups.name);
  }

  async getEquipmentTypes(): Promise<EquipmentType[]> {
    const db = getDb();
    return db.select().from(equipmentTypes).orderBy(equipmentTypes.name);
  }

  async getCategories(): Promise<string[]> {
    const db = getDb();
    const result = await db
      .selectDistinct({ category: exercises.category })
      .from(exercises)
      .where(eq(exercises.isPublic, true));
    return result.map((r) => r.category as string);
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
