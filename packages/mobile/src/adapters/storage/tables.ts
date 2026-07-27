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

/** Nutrition library surfaces. */
export const RECIPE_TABLES = ["cached_recipes", "cached_meals"] as const;

/** Home aggregate payload. `cached_dashboard` is the older Home slice. */
export const HOME_TABLES = ["cached_home", "cached_dashboard"] as const;

/**
 * The outbound mutation queue. Subscribing to this is how a surface learns that
 * a local write became a *pending* write, or that a drain resolved/failed one —
 * it is what lets the sync banner and the "unsynced row" overlay update without
 * polling.
 */
export const SYNC_QUEUE_TABLES = ["sync_queue"] as const;
