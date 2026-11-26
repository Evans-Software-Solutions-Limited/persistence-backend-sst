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
 * Mealprint ACCEPTED day plans (spec-26 Phase 2). The Fuel card, the ghost
 * rows and the Today/adherence view all read the active-plan-for-a-date row —
 * accept/log/replace/re-date/archive/delete all write or remove it, so a
 * write from any of those has to wake all three readers.
 */
export const MEAL_PLAN_TABLES = ["cached_meal_plans"] as const;

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
 * Cross-session "Previous" set hints (`recent_sets`). Written by two paths:
 * `completeSessionCommand` when a session finishes ON this device, and
 * `hydrateRecentSetsCommand` which backfills the whole cache from the server on
 * a fresh install. The active-session screen reads this table to show the
 * PREV column, so a write from either path — crucially the async fresh-install
 * backfill that lands AFTER the screen has already mounted and read an empty
 * cache — must wake the read. Without this subscription the backfill is
 * invisible until the screen is re-focused, which is why a fresh install showed
 * blank hints for the whole first workout.
 */
export const RECENT_SETS_TABLES = ["recent_sets"] as const;

/**
 * The outbound mutation queue. Subscribing to this is how a surface learns that
 * a local write became a *pending* write, or that a drain resolved/failed one —
 * it is what lets the sync banner and the "unsynced row" overlay update without
 * polling.
 */
export const SYNC_QUEUE_TABLES = ["sync_queue"] as const;

/**
 * PER-141: the phone's training log of finished workouts. The You page,
 * History and Recap read it; the summary screen writes it.
 */
export const TRAINING_LOG_TABLES = ["training_log"] as const;

/** PER-126: the athlete's coaches (Coach tab, You → Coaching). */
export const MY_COACHES_TABLES = ["cached_my_coaches"] as const;
/** PER-132 Your meals (one list per user). */
export const USER_MEAL_TABLES = ["cached_user_meals"] as const;
/** PER-133 list meal plans (mine + from coaches; one payload per user). */
export const NUTRITION_PLAN_TABLES = ["cached_nutrition_plans"] as const;
/** PER-133 shopping list across plans, with this phone's ticks. */
export const PLANS_SHOPPING_TABLES = ["cached_plans_shopping"] as const;
/** PER-129 coach forms library (with current versions), per coach. */
export const COACH_FORMS_TABLES = [
  "cached_coach_forms",
  "coach_form_conflicts",
] as const;
/** PER-129 send rules, per coach. */
export const COACH_FORM_SCHEDULES_TABLES = [
  "cached_coach_form_schedules",
  "coach_form_conflicts",
] as const;
/** PER-129 C10g counts, per coach. */
export const COACH_FORM_STATS_TABLES = ["cached_coach_form_stats"] as const;
/** PER-129 a client's "Sent to" forms. */
export const COACH_CLIENT_FORMS_TABLES = ["cached_coach_client_forms"] as const;
/** PER-129 a client's form responses. */
export const COACH_FORM_RESPONSES_TABLES = [
  "cached_coach_form_responses",
] as const;
/** PER-137 progress photos: the gallery cache. */
export const PROGRESS_PHOTO_TABLES = ["cached_progress_photos"] as const;
/** PER-137 sets saved on this phone and waiting to upload. */
export const PENDING_PROGRESS_PHOTO_TABLES = [
  "pending_progress_photos",
] as const;
/** PER-130 the athlete's due forms, with their questions. */
export const FORM_REQUESTS_TABLES = ["cached_form_requests"] as const;
/** PER-130 each due form's draft and send state on this phone. */
export const FORM_LOCAL_TABLES = ["form_request_local"] as const;
