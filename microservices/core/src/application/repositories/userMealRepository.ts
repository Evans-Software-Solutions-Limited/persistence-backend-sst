import { and, asc, eq, isNull, notInArray, sql } from "drizzle-orm";
import { userMeals, type UserMeal } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { MealSlot } from "./nutritionEntryRepository";

/**
 * "Your meals" (Design D, N1b) — a person's own named meals.
 *
 * Every method takes the JWT user's id and filters by it; no query here reads
 * or writes another user's rows.
 */

export type UserMealDTO = {
  id: string;
  name: string;
  logSlot: MealSlot;
  sortOrder: number;
  /** Set only on the four seeded defaults; never changes after seeding. */
  defaultKey: MealSlot | null;
  /** The phone's key for a meal it created offline (swap its `local-…` id). */
  clientRequestId: string | null;
  archivedAt: string | null;
  updatedAt: string;
};

export type ReplaceUserMealInput = {
  id?: string;
  clientRequestId?: string | null;
  name: string;
  logSlot: MealSlot;
  sortOrder: number;
};

export type ReplaceUserMealsResult =
  | { ok: true; meals: UserMealDTO[] }
  | { ok: false; error: "user_meal_not_found" | "duplicate_user_meal" };

/**
 * The four defaults, in the order and with the labels the shipped app already
 * shows (`MEAL_SLOTS` in packages/mobile/src/domain/services/nutrition.service.ts),
 * so switching to Your meals changes nothing on screen until the user edits it.
 */
export const DEFAULT_USER_MEALS: readonly {
  key: MealSlot;
  name: string;
  sortOrder: number;
}[] = [
  { key: "breakfast", name: "Breakfast", sortOrder: 0 },
  { key: "lunch", name: "Lunch", sortOrder: 1 },
  { key: "snack", name: "Snack", sortOrder: 2 },
  { key: "dinner", name: "Dinner", sortOrder: 3 },
];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A `local-…` id (or any non-uuid) can never name a stored row. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toDTO(row: UserMeal): UserMealDTO {
  return {
    id: row.id,
    name: row.name,
    logSlot: row.logSlot as MealSlot,
    sortOrder: row.sortOrder,
    defaultKey: (row.defaultKey as MealSlot | null) ?? null,
    clientRequestId: row.clientRequestId ?? null,
    archivedAt: row.archivedAt === null ? null : iso(row.archivedAt),
    updatedAt: iso(row.updatedAt),
  };
}

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export class UserMealRepository {
  static readonly key = "UserMealRepository";

  /**
   * The user's meals in display order, seeding the four defaults the first
   * time. Archived meals are left out unless asked for (the phone needs them to
   * label past entries logged into a meal since removed).
   */
  async list(
    userId: string,
    opts: { includeArchived?: boolean } = {},
  ): Promise<UserMealDTO[]> {
    const db = getDb();
    await this.ensureSeeded(db, userId);
    return this.select(db, userId, opts.includeArchived ?? false);
  }

  /**
   * Active meals WITHOUT seeding — for entry reads, which must stay
   * side-effect free for older bundles that never open Your meals. Empty until
   * the user's first `list()`; callers then fall back to `mealSlot`.
   */
  async listActive(userId: string): Promise<UserMealDTO[]> {
    return this.select(getDb(), userId, false);
  }

  /**
   * One of the caller's meals, archived or not, or null. An entry may be logged
   * into a meal archived on another device while this one was offline; that
   * must not lose the food log. A non-uuid id (`local-…`) is null rather than a
   * Postgres cast error.
   */
  async getOwned(userId: string, id: string): Promise<UserMealDTO | null> {
    if (!isUuid(id)) return null;
    const db = getDb();
    const rows = await db
      .select()
      .from(userMeals)
      .where(and(eq(userMeals.id, id), eq(userMeals.userId, userId)))
      .limit(1);
    return rows[0] ? toDTO(rows[0]) : null;
  }

  /**
   * `PUT /nutrition/user-meals`: the list replaces the user's meals.
   *
   * - an `id` that is one of the caller's meals updates it (and un-archives it);
   * - a uuid `id` that isn't the caller's rejects the whole PUT;
   * - a non-uuid `id` (`local-…`) counts as no id;
   * - no id: upsert on `clientRequestId` when given — so a PUT re-sent after a
   *   lost response updates the meal it created the first time instead of adding
   *   a second one — otherwise a plain insert;
   * - meals not in the list are archived; their entries keep `user_meal_id`.
   *
   * Last write wins (no revision), as the contract says. One transaction, so a
   * rejected PUT changes nothing.
   */
  async replace(
    userId: string,
    input: ReplaceUserMealInput[],
  ): Promise<ReplaceUserMealsResult> {
    const db = getDb();
    return db.transaction(async (tx) => {
      // Seed first so a fresh account's defaults exist (and are archived if
      // omitted) rather than being seeded back by a later first read.
      await this.ensureSeeded(tx, userId);

      const existing = await tx
        .select({ id: userMeals.id })
        .from(userMeals)
        .where(eq(userMeals.userId, userId));
      const owned = new Set(existing.map((r) => r.id));

      const seen = new Set<string>();
      for (const meal of input) {
        if (meal.id === undefined || !isUuid(meal.id)) continue;
        if (!owned.has(meal.id)) {
          return { ok: false as const, error: "user_meal_not_found" as const };
        }
        if (seen.has(meal.id)) {
          return { ok: false as const, error: "duplicate_user_meal" as const };
        }
        seen.add(meal.id);
      }

      const now = new Date();
      const kept: string[] = [];
      for (const meal of input) {
        const fields = {
          name: meal.name,
          logSlot: meal.logSlot,
          sortOrder: meal.sortOrder,
          archivedAt: null,
          updatedAt: now,
        };
        if (meal.id !== undefined && isUuid(meal.id)) {
          await tx
            .update(userMeals)
            .set(fields)
            .where(
              and(eq(userMeals.id, meal.id), eq(userMeals.userId, userId)),
            );
          kept.push(meal.id);
        } else if (meal.clientRequestId) {
          const [row] = await tx
            .insert(userMeals)
            .values({
              userId,
              clientRequestId: meal.clientRequestId,
              ...fields,
            })
            .onConflictDoUpdate({
              target: [userMeals.userId, userMeals.clientRequestId],
              set: fields,
            })
            .returning({ id: userMeals.id });
          kept.push(row.id);
        } else {
          const [row] = await tx
            .insert(userMeals)
            .values({ userId, ...fields })
            .returning({ id: userMeals.id });
          kept.push(row.id);
        }
      }

      await tx
        .update(userMeals)
        .set({ archivedAt: now, updatedAt: now })
        .where(
          and(
            eq(userMeals.userId, userId),
            isNull(userMeals.archivedAt),
            kept.length > 0 ? notInArray(userMeals.id, kept) : sql`true`,
          ),
        );

      return {
        ok: true as const,
        meals: await this.select(tx, userId, false),
      };
    });
  }

  private async select(
    db: Db | Tx,
    userId: string,
    includeArchived: boolean,
  ): Promise<UserMealDTO[]> {
    const rows = await db
      .select()
      .from(userMeals)
      .where(
        includeArchived
          ? eq(userMeals.userId, userId)
          : and(eq(userMeals.userId, userId), isNull(userMeals.archivedAt)),
      )
      .orderBy(asc(userMeals.sortOrder), asc(userMeals.createdAt));
    return rows.map(toDTO);
  }

  /**
   * Seed the four defaults when the user has no meals at all (archived count:
   * someone who removed every default is not re-seeded).
   *
   * Safe under concurrent first reads: both may see zero rows and both insert,
   * but the partial unique index on `(user_id, default_key)` turns the second
   * insert into a no-op. The ON CONFLICT is target-less on purpose — Postgres
   * then matches any unique index, partial included, which a targeted Drizzle
   * conflict (no predicate) could not.
   */
  private async ensureSeeded(db: Db | Tx, userId: string): Promise<void> {
    const any = await db
      .select({ id: userMeals.id })
      .from(userMeals)
      .where(eq(userMeals.userId, userId))
      .limit(1);
    if (any.length > 0) return;
    await db
      .insert(userMeals)
      .values(
        DEFAULT_USER_MEALS.map((d) => ({
          userId,
          name: d.name,
          logSlot: d.key,
          defaultKey: d.key,
          sortOrder: d.sortOrder,
        })),
      )
      .onConflictDoNothing();
  }
}
