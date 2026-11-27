/**
 * @persistence/form-limits (PER-147, Brad 25 Nov): the input limits the API
 * enforces and the web and mobile forms check before they send. One source,
 * imported by the Elysia routes in `microservices/core` and by the app form
 * schemas (`packages/web/src/coach/lib/*Form.ts`,
 * `packages/mobile/src/ui/forms/*`).
 *
 * Plain constants on purpose: no dependencies, so Metro, Vite and Bun all
 * resolve it as TypeScript source like `@persistence/training-metrics`.
 *
 * Changing a value here changes what the API accepts. Shipped apps (1.2.0
 * and later) send against these limits, so loosening is safe; tightening
 * can refuse a request an older app allows. The pinned values are tested in
 * `index.test.ts` and in core's `formLimits.test.ts`.
 */

/** Coach's client profile (C11a): `POST`/`PATCH /trainers/me/client-profiles`. */
export const CLIENT_PROFILE_LIMITS = {
  displayNameMax: 80,
  contactEmailMax: 320,
  contactPhoneMax: 40,
  goalMax: 200,
  privateNotesMax: 4000,
} as const;

/** Set-up sections (C11b): `PUT …/client-profiles/:id/setup/:section`. */
export const CLIENT_SETUP_LIMITS = {
  /** Daily calories in a coach-set target, 0 to this. */
  maxKcal: 20_000,
  /** Protein, carbs or fat in grams, 0 to this. */
  maxMacroG: 2_000,
  /** Welcome message, trimmed. */
  welcomeMessageMax: 1000,
} as const;

/** C3.9 client settings: `PATCH /trainers/me/clients/:id/settings`. */
export const CLIENT_SETTINGS_LIMITS = {
  sessionsPerWeekMin: 1,
  sessionsPerWeekMax: 14,
} as const;

/** Coach forms (C10b): `POST`/`PATCH /trainers/me/forms`. */
export const COACH_FORM_LIMITS = {
  titleMax: 120,
  maxQuestions: 40,
  promptMax: 300,
  helpMax: 300,
  minOptions: 2,
  maxOptions: 12,
  optionMax: 100,
  unitMax: 20,
} as const;

/** Send rules (C10c/C10h) and one client's rule (C10j). */
export const FORM_SCHEDULE_LIMITS = {
  weekdayMin: 1,
  weekdayMax: 7,
  maxReminders: 5,
  /** A reminder is 1 to this many hours after the send. */
  maxReminderHours: 720,
  /** Due is 1 to this many hours after the send. */
  maxDueHours: 2160,
  maxSelectedClients: 500,
} as const;

/** A coach's reply to a check-in (C3.3). */
export const FORM_REPLY_MAX = 2000;

/**
 * Your meals (N1b): `PUT /nutrition/user-meals`. `nameMax` is the route
 * schema's raw-length guard; `storedNameMax` is the real limit the handler
 * enforces after trimming (400 `invalid_user_meal_name`) and that the
 * `user_meals_name_len_chk` database check (1–40) stores.
 */
export const USER_MEAL_LIMITS = {
  nameMax: 80,
  storedNameMax: 40,
  maxMeals: 30,
} as const;

/**
 * Meal plans (N5, N29–N34, coach C1): plan create/update routes.
 * `nameMax` / `mealNameMax` are the route schema's raw-length guards; the
 * `stored…` values are what `resolvePlanInput` keeps after trimming (longer
 * → 400 `invalid_plan_name` / `invalid_meal_name`). `noteMax` is a coach's
 * note on a sent plan, which the server trims to this length
 * (`assignments.ts` `MAX_NOTE_LENGTH`).
 */
export const MEAL_PLAN_LIMITS = {
  nameMax: 200,
  mealNameMax: 80,
  storedNameMax: 80,
  storedMealNameMax: 40,
  noteMax: 500,
} as const;

/**
 * Reps per set (PER-111 / PER-139): `setTargets` on a workout exercise in
 * workout create and update. Set count 1 to `maxSets`; each set's target
 * reps 1 to `maxReps`. Read by core's `workouts/shared/setTargets.ts` and
 * the mobile set editor (`packages/mobile/src/ui/forms/workoutForms.ts`).
 */
export const SET_TARGET_LIMITS = {
  maxSets: 20,
  maxReps: 100,
} as const;
