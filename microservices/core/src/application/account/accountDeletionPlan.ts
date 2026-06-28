import { sql, type SQL } from "drizzle-orm";

/**
 * Account-deletion plan (08-profile-settings § Revised 2026-06-28, STORY-011).
 *
 * `public.profiles.id` is `REFERENCES auth.users(id) ON DELETE CASCADE`, and
 * ~30 tables reference `profiles.id ON DELETE CASCADE` — those are removed
 * automatically when the profile row is deleted. But a handful of FKs are
 * `NO ACTION` (verified against the live schema 2026-06-28). Deleting the
 * profile row without handling them first would either throw a foreign-key
 * violation or wrongly delete another user's data, so they are handled
 * explicitly here, in order, ahead of the profile delete.
 *
 * This is intentionally a data-driven plan (not ad-hoc SQL) so it can be
 * unit-tested + audited against the FK map, and so `profiles` is provably the
 * final step.
 */
export type AccountDeletionStep =
  /**
   * Null a cross-user attribution column (it lives on *other* users' rows —
   * a trainer who logged/assigned something for a client). Preserves the
   * other user's row and unblocks the NO-ACTION FK.
   */
  | { kind: "nullify"; table: string; column: string }
  /** Delete the deleting user's own rows behind a NO-ACTION FK. */
  | { kind: "delete"; table: string; column: string }
  /**
   * Null a FK column on rows that reference a table OWNED by the deleting
   * user. Used when another user's row (e.g. recipe_ingredients) holds a
   * NO-ACTION FK to one of the deleting user's rows (e.g. foods). Generated
   * SQL: `UPDATE <table> SET <column> = NULL WHERE <column> IN (SELECT id FROM <ownerTable> WHERE <ownerColumn> = $userId)`.
   */
  | {
      kind: "nullify-referencing-owned";
      table: string;
      column: string;
      ownerTable: string;
      ownerColumn: string;
    };

export const ACCOUNT_DELETION_STEPS: readonly AccountDeletionStep[] = [
  // 1) Null cross-user attribution (NO-ACTION FKs on other users' rows).
  { kind: "nullify", table: "body_measurements", column: "logged_by_user_id" },
  { kind: "nullify", table: "workout_sessions", column: "logged_by_user_id" },
  { kind: "nullify", table: "nutrition_entries", column: "logged_by_user_id" },
  { kind: "nullify", table: "nutrition_targets", column: "set_by_user_id" },
  { kind: "nullify", table: "user_goals", column: "assigned_by_user_id" },
  {
    kind: "nullify",
    table: "subscription_price_history",
    column: "changed_by",
  },

  // 2) Delete the user's own rows behind NO-ACTION FKs, in child-safe order.
  //    meals → meal_items and recipes → recipe_ingredients cascade off these.
  { kind: "delete", table: "nutrition_entries", column: "user_id" },
  { kind: "delete", table: "water_log", column: "user_id" },
  { kind: "delete", table: "meals", column: "user_id" },
  { kind: "delete", table: "recipes", column: "user_id" },
  // Null cross-user references to the user's foods (recipe_ingredients.food_id
  // is NO ACTION — another user's recipe may reference a food the deleting
  // user created). Must precede the foods delete.
  {
    kind: "nullify-referencing-owned",
    table: "recipe_ingredients",
    column: "food_id",
    ownerTable: "foods",
    ownerColumn: "created_by",
  },
  { kind: "delete", table: "foods", column: "created_by" },
  { kind: "delete", table: "nutrition_targets", column: "user_id" },
  { kind: "delete", table: "ai_usage_log", column: "user_id" },
  // subscription_status_transitions has NO foreign keys at all (verified
  // against the live schema), so it is neither a cascade child of profiles
  // nor blocked by one — it must be deleted explicitly or the user's billing
  // status-transition history (user_id + stripe_event_id) is orphaned.
  {
    kind: "delete",
    table: "subscription_status_transitions",
    column: "user_id",
  },

  // 3) Delete the profile — ON DELETE CASCADE FKs remove every remaining
  //    owned row (workouts, sessions, PRs, measurements, achievements,
  //    friendships, habits, health, notifications, devices, goals, streaks,
  //    volume, subscriptions, trainer relationships/notes/invites, ai_*).
  { kind: "delete", table: "profiles", column: "id" },
];

/**
 * Render one plan step to a parameterized SQL statement. Table/column names
 * are hardcoded constants (never user input) emitted as quoted identifiers;
 * the only bound value is `userId`.
 */
export function buildStatement(step: AccountDeletionStep, userId: string): SQL {
  const table = sql.identifier(step.table);
  const column = sql.identifier(step.column);
  if (step.kind === "nullify") {
    return sql`update ${table} set ${column} = null where ${column} = ${userId}`;
  }
  if (step.kind === "nullify-referencing-owned") {
    const ownerTable = sql.identifier(step.ownerTable);
    const ownerColumn = sql.identifier(step.ownerColumn);
    return sql`update ${table} set ${column} = null where ${column} in (select id from ${ownerTable} where ${ownerColumn} = ${userId})`;
  }
  return sql`delete from ${table} where ${column} = ${userId}`;
}
