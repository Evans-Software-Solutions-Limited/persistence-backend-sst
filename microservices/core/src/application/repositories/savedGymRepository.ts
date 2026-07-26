import { and, desc, eq, inArray } from "drizzle-orm";
import { savedGyms, equipmentTypes } from "@persistence/db";
import { getDb } from "@persistence/db/client";

/**
 * Loadout (spec-21 § 2.1 / § 3.1) — CRUD over a user's named equipment sets.
 *
 * A saved gym is the reusable half of Loadout's collect step: "Hotel gym",
 * "Garage", "PureGym Leeds". Its `equipmentTypeIds` become the equipment
 * context for an adaptation (AC-2.1).
 *
 * Two conventions, both load-bearing:
 *
 *   1. **Method signatures follow the house rule** (`workoutRepository`):
 *      list/create take `(userId, …)`; per-row reads/writes take
 *      `(id, userId, …)`.
 *
 *   2. **Ownership is folded into the WHERE of the mutating statement** — never
 *      a separate SELECT first (`workoutRepository.ts:398-401`: "no separate
 *      SELECT, no TOCTOU window"). A zero-row result is a 404, with no
 *      403/404 distinction: another user's gym and a nonexistent gym are
 *      indistinguishable to the caller, which is the point.
 */

/** Row shape returned to callers. Explicitly projected, never `select()`. */
export interface SavedGymRow {
  id: string;
  name: string;
  equipmentTypeIds: string[];
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface SavedGymInput {
  name: string;
  equipmentTypeIds: string[];
}

export type SavedGymUpdateInput = Partial<SavedGymInput>;

/**
 * Discriminated results rather than thrown errors, matching
 * `ProgramRepository.delete`'s `"has_live_assignments" | "not_found"` style.
 * `unknownEquipmentTypeIds` is returned so the 400 can name exactly which ids
 * were rejected instead of making the client guess.
 */
export type SavedGymCreateResult =
  | { status: "ok"; gym: SavedGymRow }
  | { status: "duplicate_name" }
  | { status: "unknown_equipment"; unknownEquipmentTypeIds: string[] };

/**
 * `not_found` is on the UPDATE result only. A create has no row to miss, so
 * including it in the shared union would force the create handler to carry a
 * branch that can never execute — and an unreachable branch is a lie about the
 * contract as well as an uncoverable line.
 */
export type SavedGymUpdateResult =
  | SavedGymCreateResult
  | { status: "not_found" };

/**
 * Postgres unique_violation. The per-user name uniqueness index is an
 * EXPRESSION index (`lower(btrim(name))`), which Drizzle's
 * `onConflictDoNothing` cannot infer a conflict target for — so the duplicate
 * is detected by catching the violation rather than by a pre-flight SELECT.
 * That is also the race-free option: a pre-flight check has a window between
 * the read and the insert.
 */
const PG_UNIQUE_VIOLATION = "23505";
const SAVED_GYM_NAME_INDEX = "saved_gyms_user_name_key";
/** Matches `stripe/pgErrors.isUniqueViolation`'s bound. */
const CAUSE_CHAIN_DEPTH = 4;

/**
 * ⚠ The SQLSTATE is NOT on the thrown error. Drizzle wraps the driver error in a
 * `DrizzleQueryError` and the postgres.js error — the one carrying `code` and
 * `constraint_name` — hangs off `.cause`. Checking only the top level makes this
 * return false for every real duplicate, so the violation rethrows and the
 * COMMON case (two gyms called "Garage") becomes an opaque 500 instead of a 409.
 *
 * The repo documents this in two places already: `stripe/pgErrors.ts` ("Drizzle
 * wraps with a `cause` chain, so we walk it up to a bounded depth") and
 * `shared/errorHandler.ts`. Walk the chain.
 *
 * `stripe/pgErrors.isUniqueViolation` is deliberately NOT reused: it also
 * literal-matches `user_subscriptions_active_unique` in the message as a
 * belt-and-braces fallback, so it would answer true for a violation on a
 * different table, and it cannot check WHICH constraint fired. Here the
 * constraint identity is the whole point.
 */
function isSavedGymNameConflict(err: unknown): boolean {
  let cursor: unknown = err;
  for (
    let depth = 0;
    depth < CAUSE_CHAIN_DEPTH && cursor !== undefined && cursor !== null;
    depth += 1
  ) {
    const e = cursor as { code?: unknown; constraint_name?: unknown };
    if (e.code === PG_UNIQUE_VIOLATION) {
      // Guard on the constraint name so an unrelated future unique index on
      // this table doesn't get silently reported as a duplicate NAME. If a
      // driver upgrade stops populating it, fall back to treating a unique
      // violation on this single-unique-index table as the name conflict it can
      // only be today.
      return (
        e.constraint_name === SAVED_GYM_NAME_INDEX ||
        e.constraint_name === undefined
      );
    }
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return false;
}

export class SavedGymRepository {
  static readonly key = "SavedGymRepository";

  /** The caller's gyms, newest first. Backed by `saved_gyms_user_created_idx`. */
  async list(userId: string): Promise<SavedGymRow[]> {
    const db = getDb();
    return db
      .select(SAVED_GYM_PROJECTION)
      .from(savedGyms)
      .where(eq(savedGyms.userId, userId))
      .orderBy(desc(savedGyms.createdAt));
  }

  async getById(id: string, userId: string): Promise<SavedGymRow | null> {
    const db = getDb();
    const rows = await db
      .select(SAVED_GYM_PROJECTION)
      .from(savedGyms)
      .where(and(eq(savedGyms.id, id), eq(savedGyms.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(
    userId: string,
    input: SavedGymInput,
  ): Promise<SavedGymCreateResult> {
    const db = getDb();

    const unknown = await this.findUnknownEquipmentTypeIds(
      input.equipmentTypeIds,
    );
    if (unknown.length > 0) {
      return { status: "unknown_equipment", unknownEquipmentTypeIds: unknown };
    }

    try {
      const [gym] = await db
        .insert(savedGyms)
        .values({
          userId,
          name: input.name.trim(),
          equipmentTypeIds: dedupe(input.equipmentTypeIds),
        })
        .returning(SAVED_GYM_PROJECTION);
      return { status: "ok", gym };
    } catch (err) {
      if (isSavedGymNameConflict(err)) return { status: "duplicate_name" };
      throw err;
    }
  }

  /**
   * Present-only patch: an omitted field is left untouched. Ownership is in the
   * UPDATE's WHERE, so a zero-row result means "doesn't exist OR isn't yours"
   * and surfaces as 404 either way.
   */
  async update(
    id: string,
    userId: string,
    input: SavedGymUpdateInput,
  ): Promise<SavedGymUpdateResult> {
    const db = getDb();

    if (input.equipmentTypeIds !== undefined) {
      const unknown = await this.findUnknownEquipmentTypeIds(
        input.equipmentTypeIds,
      );
      if (unknown.length > 0) {
        return {
          status: "unknown_equipment",
          unknownEquipmentTypeIds: unknown,
        };
      }
    }

    const patch: { name?: string; equipmentTypeIds?: string[] } = {};
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.equipmentTypeIds !== undefined)
      patch.equipmentTypeIds = dedupe(input.equipmentTypeIds);

    try {
      const [updated] = await db
        .update(savedGyms)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(savedGyms.id, id), eq(savedGyms.userId, userId)))
        .returning(SAVED_GYM_PROJECTION);
      return updated ? { status: "ok", gym: updated } : { status: "not_found" };
    } catch (err) {
      if (isSavedGymNameConflict(err)) return { status: "duplicate_name" };
      throw err;
    }
  }

  /**
   * Ownership folded into the DELETE's WHERE (same as `update`) so a concurrent
   * delete surfaces as 404 rather than 500. Variations built from this gym
   * SURVIVE — `workouts.source_gym_id` is `ON DELETE SET NULL` and each
   * variation keeps its frozen `source_equipment_type_ids` snapshot (AC-7.3).
   */
  async delete(id: string, userId: string): Promise<boolean> {
    const db = getDb();
    const rows = await db
      .delete(savedGyms)
      .where(and(eq(savedGyms.id, id), eq(savedGyms.userId, userId)))
      .returning({ id: savedGyms.id });
    return rows.length > 0;
  }

  /**
   * `equipment_type_ids` cannot carry a FK — Postgres has no array-element FKs
   * — so validity is enforced here and an unknown id is a 400 (design § 2.1).
   *
   * Explicit `id`-only projection: `equipment_types.description` is declared in
   * `schema.ts` but does NOT exist in the live database, so a bare `select()`
   * 500s (see `exerciseRepository.getEquipmentTypes`).
   */
  async findUnknownEquipmentTypeIds(ids: string[]): Promise<string[]> {
    const unique = dedupe(ids);
    if (unique.length === 0) return [];

    const db = getDb();
    const rows = await db
      .select({ id: equipmentTypes.id })
      .from(equipmentTypes)
      .where(inArray(equipmentTypes.id, unique));

    const known = new Set(rows.map((r) => r.id));
    return unique.filter((id) => !known.has(id));
  }
}

/**
 * Shared explicit projection. Declared once so the list, get and both
 * `returning()` shapes cannot drift apart.
 */
const SAVED_GYM_PROJECTION = {
  id: savedGyms.id,
  name: savedGyms.name,
  equipmentTypeIds: savedGyms.equipmentTypeIds,
  createdAt: savedGyms.createdAt,
  updatedAt: savedGyms.updatedAt,
};

/**
 * The picker can hand back the same equipment twice (two paths select the same
 * chip). Storing duplicates would make `@>` containment checks and the kit
 * summary both noisier without changing their meaning, so collapse on write.
 */
function dedupe(ids: string[]): string[] {
  return Array.from(new Set(ids));
}
