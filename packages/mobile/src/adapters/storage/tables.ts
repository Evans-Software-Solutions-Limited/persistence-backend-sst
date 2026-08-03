/**
 * Local SQLite table names, grouped by the read surface that depends on them.
 *
 * These exist so `StoragePort.subscribe` callers name tables through one
 * reviewed constant instead of scattering string literals across hooks — a
 * typo'd table name in a subscription is silent (you simply never get woken),
 * which is the same failure the change bus was built to remove.
 *
 * Keep in sync with the `CREATE TABLE IF NOT EXISTS` block in
 * `sqlite.adapter.ts`. Regenerate the full list with:
 *   grep -o 'CREATE TABLE IF NOT EXISTS [a-z_]*' \
 *     packages/mobile/src/adapters/storage/sqlite.adapter.ts
 */

/** Workouts list slices + the per-workout detail rows the lists join against. */
export const WORKOUT_TABLES = [
  "cached_workouts",
  "cached_workout_detail",
  "cached_coach_workout_library",
] as const;

/** The exercise library (system rows and locally-created customs alike). */
export const EXERCISE_TABLES = ["cached_exercises"] as const;

/**
 * Nutrition library surfaces, split per resource for the same reason
 * `HOME_TABLES` is narrow — see the note there. `useGetRecipes` reads only
 * `cached_recipes` and `useGetMeals` only `cached_meals`; both previously
 * subscribed to both, so each was woken (and, once a read could return null,
 * would refetch over the network) for the other's local writes.
 */
export const RECIPE_TABLES = ["cached_recipes"] as const;
export const MEAL_TABLES = ["cached_meals"] as const;

/**
 * Mealprint food preferences (spec-26). One table, narrow for the same reason as
 * the two above: the editor writes it optimistically and the entry card and the
 * suggest sheet both read it, so a local write must wake them — but nothing else
 * should.
 */
export const MEALPRINT_PREFERENCE_TABLES = [
  "cached_mealprint_preferences",
] as const;

/**
 * Home aggregate payload.
 *
 * ⚠ `cached_dashboard` is deliberately NOT here, despite being the older Home
 * slice of the same shape. These constants name the tables a resource READS, and
 * that contract is load-bearing: `useCachedResource` treats a subscribed table
 * whose row has vanished as an invalidation and kicks a silent network refresh.
 * Listing a table the resource doesn't read turns every unrelated invalidation of
 * it into a wasted round trip — `useGetHome` reads `cached_home` only, so
 * including `cached_dashboard` made `ActiveSessionContainer`'s per-set
 * `invalidateDashboard()` cost a fetch mid-workout where it had been a local
 * re-read. Whichever hook actually reads `cached_dashboard` should declare it.
 */
export const HOME_TABLES = ["cached_home"] as const;

/**
 * The outbound mutation queue. Subscribing to this is how a surface learns that
 * a local write became a *pending* write, or that a drain resolved/failed one —
 * it is what lets the sync banner and the "unsynced row" overlay update without
 * polling.
 */
export const SYNC_QUEUE_TABLES = ["sync_queue"] as const;
