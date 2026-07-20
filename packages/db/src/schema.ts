import {
  boolean,
  check,
  date,
  decimal,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum("user_role", [
  "user",
  "personal_trainer",
  "physiotherapist",
  "admin",
]);

export const fitnessLevelEnum = pgEnum("fitness_level", [
  "beginner",
  "intermediate",
  "advanced",
  "elite",
]);

export const exerciseDifficultyEnum = pgEnum("exercise_difficulty", [
  "beginner",
  "intermediate",
  "advanced",
  "expert",
]);

export const exerciseCategoryEnum = pgEnum("exercise_category", [
  "strength",
  "cardio",
  "flexibility",
  "balance",
  "plyometric",
  "olympic",
  "mobility",
]);

export const workoutVisibilityEnum = pgEnum("workout_visibility", [
  "private",
  "friends",
  "public",
]);

export const sessionStatusEnum = pgEnum("session_status", [
  "in_progress",
  "completed",
  "cancelled",
]);

export const recordTypeEnum = pgEnum("record_type", [
  "1rm",
  "3rm",
  "5rm",
  "10rm",
  "max_reps",
  "max_weight",
  // Highest weight × reps in a single set, per exercise. Surfaced
  // alongside `1rm` + `max_weight` on the session-summary screen
  // (PR detection broadened in supabase/migrations/
  // 20260512090238_m3_record_type_max_volume.sql).
  "max_volume",
  "best_time",
  "longest_distance",
]);

export const achievementCategoryEnum = pgEnum("achievement_category", [
  "workout_count",
  "personal_record",
  "streak",
  "social",
  "special",
]);

export const friendshipStatusEnum = pgEnum("friendship_status", [
  "pending",
  "accepted",
  "blocked",
]);

export const ptRelationshipStatusEnum = pgEnum("pt_relationship_status", [
  "pending",
  "active",
  "inactive",
  "terminated",
]);

export const assignmentStatusEnum = pgEnum("assignment_status", [
  "assigned",
  "started",
  "completed",
  "skipped",
]);

export const goalStatusEnum = pgEnum("goal_status", [
  "active",
  "completed",
  "abandoned",
]);

export const goalTypeEnum = pgEnum("goal_type", [
  "strength",
  "endurance",
  "weight_loss",
  "muscle_gain",
  "habit_building",
  "custom",
]);

export const messageRoleEnum = pgEnum("message_role", [
  "user",
  "assistant",
  "system",
]);

export const healthProviderEnum = pgEnum("health_provider", [
  "apple_health",
  "google_fit",
  "fitbit",
  "samsung_health",
  "garmin",
  // specs/20-sleep-quicklog — manual sleep quick-log data_source. Added via
  // its own migration (ALTER TYPE ... ADD VALUE IF NOT EXISTS), never in the
  // same transaction as a query using it (Postgres restriction).
  "manual",
]);

export const syncStatusEnum = pgEnum("sync_status", [
  "connected",
  "disconnected",
  "error",
]);

export const notificationTypeEnum = pgEnum("notification_type", [
  "workout_assigned",
  "friend_request",
  "pt_request",
  "pt_accepted",
  "physio_request",
  "physio_accepted",
  "workout_reminder",
  "goal_milestone",
  "trainer_feedback",
  // M4 (06-progress-goals) streak events. Companion enum migration:
  // 20260607120000_m4_notification_type_streak_values.sql. Enum ownership is
  // 09-notifications-social's per cross-cuts § 5; M4 sequences the ADD VALUE.
  "streak_milestone",
  "streak_at_risk",
  "freeze_token_applied",
  // M9 (13-nutrition-tracking) nutrition-streak event. Companion enum
  // migration: 20260621120100_m9_notification_type_target_hit.sql. Enum
  // ownership is 09-notifications-social's per cross-cuts § 5; M9 sequences
  // the ADD VALUE before the nutrition-streak cron emits.
  "daily_nutrition_target_hit",
  // M8 (10-trainer-features) trainer on-behalf / assignment events. Companion
  // enum migration: 20260705150000_coach_notification_type_on_behalf_values.sql.
  // Enum ownership is 09-notifications-social's per cross-cuts § 5; Phase 3
  // (10.3) sequences the ADD VALUE before the on-behalf handlers emit.
  // (workout_assigned already exists above — the workout-assignment handler
  // reuses it.)
  "goal_assigned_by_trainer",
  "workout_logged_on_behalf",
  "measurement_logged_on_behalf",
  "nutrition_target_set_by_trainer",
  // M17 (Send brief) — coach → client free-text brief; the notification row
  // is the deliverable and deep-links to the athlete Training page. Companion
  // enum migration: 20260709120000_coach_brief_notification_type.sql.
  "coach_brief",
  // Trainer-client-caps — a client's join was rejected because the trainer is
  // at their plan's client-slot limit. Notifies the TRAINER (best-effort,
  // post-commit) with the upgrade pointer. Companion enum migration:
  // 20260711120000_trainer_client_limit_reached_notification_type.sql.
  "trainer_client_limit_reached",
  // Coach Mode Phase 8 — a coach accepted a client-initiated (invite-code)
  // pending relationship; sent to the ATHLETE. Companion enum migration:
  // 20260711140100_coach_request_accepted_notification_type.sql.
  "coach_request_accepted",
  // 25-coach-client-offboarding — a coach↔client relationship ended. Sent to
  // the COUNTERPARTY (client when the coach removed them; coach when the
  // client left), best-effort post-commit. Companion enum migration:
  // 20260720120100_coaching_relationship_ended_notification_type.sql.
  "coaching_relationship_ended",
]);

// M4 (06-progress-goals) — streak engine period types. cross-cuts § 3.1.
// Migration: 20260607120100_m4_progress_schema.sql.
export const streakTypeEnum = pgEnum("streak_type_enum", [
  "workout_streak", // weekly
  "habit_streak", // daily
  "measurement_streak", // weekly
  "nutrition_streak", // daily (M9-gated)
]);

// 18-habit-setup — habit categories + completion rules. cross-cuts § 3.7.
// Migration: 20260623120000_habit_setup_schema.sql.
export const habitCategoryEnum = pgEnum("habit_category_enum", [
  "water",
  "gym",
  "steps",
  "sleep",
  "calories",
]);

export const habitCompletionRuleEnum = pgEnum("habit_completion_rule_enum", [
  "count", // ≥ target qualifying events in the period (Gym: weekly sessions)
  "value_gte", // ≥ days_per_week days whose value ≥ target (Water/Steps/Sleep)
  "within_tolerance", // ≥ days_per_week days within target ± tolerance% (Calories)
]);

export const noteTypeEnum = pgEnum("note_type", [
  "progress",
  "injury",
  "milestone",
  "concern",
  "general",
]);

// 10-trainer-features — audit of every trainer on-behalf write. cross-cuts § 1.4.
// Migration: 20260705140000_trainer_actions_audit.sql. Append-only.
export const actionTypeEnum = pgEnum("action_type_enum", [
  "workout_logged_on_behalf",
  "measurement_logged_on_behalf",
  "nutrition_entry_logged_on_behalf",
  "goal_assigned",
  "nutrition_target_set",
  "workout_assigned",
  "client_note_added",
  "client_note_updated",
  "client_note_deleted",
  // Ad-hoc workout-assignment delete (DELETE
  // /trainers/me/clients/:clientId/workout-assignments/:id) — the create path
  // (workout_assigned) has audited since Phase 3; this closes the gap on the
  // delete path (cross-cuts § 1.4.2). Companion enum migration:
  // 20260706170000_workout_unassigned_audit_value.sql.
  "workout_unassigned",
  // M17 (Send brief) — POST /trainers/me/clients/:clientId/brief. The client's
  // notification row + this audit row land in ONE transaction (cross-cuts
  // § 1.4.2). Companion enum migration:
  // 20260709120100_coach_brief_sent_audit_value.sql.
  "brief_sent",
  // M18 (Live-session / Swap) — PATCH .../workout-assignments/:id replaces the
  // assignment's workout in place. Companion enum migration:
  // 20260709130000_workout_swapped_audit_value.sql.
  "workout_swapped",
  // Coach Mode Phase 8 — the coach accept/decline of a client-initiated
  // (invite-code) pending relationship
  // (POST /trainers/me/relationships/:id/respond). Companion enum migration:
  // 20260711140200_client_request_response_audit_values.sql.
  "client_request_accepted",
  "client_request_declined",
  // 25-coach-client-offboarding — a coach↔client relationship was ended
  // (coach removed a client, or a client left a coach). The soft-end UPDATE +
  // the assignment-teardown deletes + this audit row land in ONE transaction
  // (cross-cuts § 1.4.2). `payload.initiatedBy` records the direction.
  // Companion enum migration:
  // 20260720120000_relationship_terminated_audit_value.sql.
  "relationship_terminated",
]);

// ─── Lookup & Metadata ────────────────────────────────────────────────────────

export const muscleGroups = pgTable("muscle_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description"),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const muscleCategories = pgTable("muscle_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const muscleGroupCategories = pgTable(
  "muscle_group_categories",
  {
    muscleGroupId: uuid("muscle_group_id")
      .notNull()
      .references(() => muscleGroups.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => muscleCategories.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.muscleGroupId, t.categoryId] })],
);

export const equipmentTypes = pgTable("equipment_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const accessibilityTags = pgTable("accessibility_tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description"),
  category: text("category"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const goalTypes = pgTable("goal_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description"),
  category: text("category"),
  iconName: text("icon_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ─── User Profiles ────────────────────────────────────────────────────────────

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  email: text("email").unique(),
  fullName: text("full_name"),
  username: text("username").unique(),
  avatarUrl: text("avatar_url"),
  role: userRoleEnum("role").default("user"),
  fitnessLevel: fitnessLevelEnum("fitness_level").default("beginner"),
  dateOfBirth: text("date_of_birth"),
  // 'male' | 'female' | 'other' | null — biological-sex input for the Fuel
  // Targets Mifflin-St Jeor TDEE calculator (M9). CHECK-constrained in
  // migration 20260630120000_add_profile_gender.sql. NULL = never set.
  gender: text("gender"),
  heightCm: decimal("height_cm", { precision: 5, scale: 2 }),
  weightKg: decimal("weight_kg", { precision: 5, scale: 2 }),
  availableEquipment: uuid("available_equipment").array().default([]),
  accessibilityNeeds: uuid("accessibility_needs").array().default([]),
  // Unused — superseded by the independent weightUnit/heightUnit below
  // (migration 20260701120000_split_preferred_units.sql). Kept on the
  // schema since the column is still live in the DB and `dashboardRepository`
  // still projects it on the wire; no mobile UI reads it anymore.
  preferredUnits: text("preferred_units").default("metric"),
  // 'kg' | 'lb' — display-unit preference for the weigh-in sheet's weight
  // toggle. CHECK-constrained in migration
  // 20260701120000_split_preferred_units.sql. Independent of heightUnit
  // below (users routinely mix e.g. kg + ft/in).
  weightUnit: text("weight_unit").default("kg"),
  // 'cm' | 'ftin' — display-unit preference for Edit Profile's height
  // toggle. CHECK-constrained in migration
  // 20260701120000_split_preferred_units.sql.
  heightUnit: text("height_unit").default("cm"),
  // M4: IANA timezone identifier for user-local streak period rollover
  // (cross-cuts § 3.4). Migration 20260607120100_m4_progress_schema.sql.
  timezone: text("timezone").notNull().default("Europe/London"),
  isProfilePublic: boolean("is_profile_public").default(false),
  subscriptionId: uuid("subscription_id"),
  hasUsedUserTrial: boolean("has_used_user_trial").default(false),
  hasUsedTrainerTrial: boolean("has_used_trainer_trial").default(false),
  primaryGoalId: uuid("primary_goal_id").references(() => goalTypes.id),
  /**
   * Per-type notification preference map. Stored as JSONB on the profile
   * row to avoid a separate table for what is in practice a tiny,
   * low-frequency payload. Empty object (`{}`) is the default and reads
   * back as "all enabled" once the read handler applies defaults. Unknown
   * keys in the JSONB are dropped on the way out by the handler.
   *
   * Migration:
   *   supabase/migrations/20260527000000_m7_notification_preferences.sql
   *
   * Brad confirmed JSONB-on-profiles (option B) over a separate
   * `notification_preferences` table — matches the legacy app's pattern of
   * keeping user prefs on the profile row + one additive migration vs a
   * new table + RLS policies. See
   * specs/09-notifications-social/design.md § Notification preferences.
   */
  notificationPreferences: jsonb("notification_preferences")
    .notNull()
    .$type<Record<string, boolean>>()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  // 30-day soft-delete cooling-off (Cluster 2a). NULL/NULL = active account —
  // every existing row and every newly-created one. `DELETE /account` stamps
  // both; `POST /account/restore` clears both within the window; the nightly
  // purge worker hard-deletes once `now() >= purgeAfter`. Migration:
  // 20260713120000_account_soft_delete.sql.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  purgeAfter: timestamp("purge_after", { withTimezone: true }),
});

// ─── Subscriptions ────────────────────────────────────────────────────────────

export const subscriptionTiers = pgTable("subscription_tiers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tierName: text("tier_name").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  priceMonthly: decimal("price_monthly", { precision: 10, scale: 2 }).notNull(),
  priceYearly: decimal("price_yearly", { precision: 10, scale: 2 }),
  currency: text("currency").default("GBP"),
  features: jsonb("features")
    .notNull()
    .$type<Record<string, unknown>>()
    .default({}),
  workoutLimit: integer("workout_limit"),
  aiAccess: boolean("ai_access").default(false),
  aiWorkoutLimit: integer("ai_workout_limit").default(0),
  gymBuddyAccess: boolean("gym_buddy_access").default(false),
  gymBuddyCanCreateWorkouts: boolean("gym_buddy_can_create_workouts").default(
    false,
  ),
  gymBuddyCanSuggestWorkouts: boolean("gym_buddy_can_suggest_workouts").default(
    false,
  ),
  trainerClientLimit: integer("trainer_client_limit"),
  isTrainerTier: boolean("is_trainer_tier").default(false),
  analyticsAccess: boolean("analytics_access").default(false),
  exportAccess: boolean("export_access").default(false),
  isActive: boolean("is_active").default(true),
  stripePriceIdMonthly: text("stripe_price_id_monthly"),
  stripePriceIdYearly: text("stripe_price_id_yearly"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const userSubscriptions = pgTable(
  "user_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    tierName: text("tier_name")
      .notNull()
      .references(() => subscriptionTiers.tierName),
    currency: text("currency").default("GBP"),
    paymentStatus: text("payment_status").default("pending"),
    startsAt: timestamp("starts_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    billingCycle: text("billing_cycle").default("monthly"),
    nextBillingDate: timestamp("next_billing_date", { withTimezone: true }),
    externalSubscriptionId: text("external_subscription_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    // One LIVE subscription per user. Live = active|pending|trialing|past_due.
    // Terminal statuses (cancelled|expired|incomplete_expired) are excluded so
    // a user can resubscribe. `trialing` + `past_due` were added in spec 17 /
    // Phase A (migration 20260605120000) — the prior ('active','pending')
    // predicate left a hole where two concurrent new-trial sign-ups each
    // inserted a `trialing` row, yielding two billable Stripe subs. Keep this
    // predicate VERBATIM in lockstep with that migration.
    uniqueIndex("user_subscriptions_active_unique")
      .on(t.userId)
      .where(
        sql`payment_status IN ('active', 'pending', 'trialing', 'past_due')`,
      ),
    // One row per external (store) subscription id — the RevenueCat synthetic
    // `rc_<appUserId>` and the Stripe `sub_…` id. Prevents duplicate grants from
    // the non-atomic find->insert in the webhook paths and enables the idempotent
    // `INSERT ... ON CONFLICT (external_subscription_id)` upsert in
    // SubscriptionRepository.upsertByExternalId. Partial predicate is mandatory:
    // the column is nullable (free-tier / legacy rows) and multiple NULLs must
    // stay allowed. Keep this predicate VERBATIM in lockstep with migration
    // 20260717120000_user_subscriptions_external_id_unique.sql (spec-12.13).
    uniqueIndex("user_subscriptions_external_id_unique")
      .on(t.externalSubscriptionId)
      .where(sql`external_subscription_id IS NOT NULL`),
  ],
);

export const subscriptionLimits = pgTable(
  "subscription_limits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    limitType: text("limit_type").notNull(),
    currentCount: integer("current_count").default(0),
    limitValue: integer("limit_value"),
    resetDate: timestamp("reset_date", { withTimezone: true }).defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("subscription_limits_user_type_idx").on(t.userId, t.limitType),
  ],
);

/**
 * Idempotency log for Stripe webhook events.
 *
 * The webhook handler inserts the Stripe-assigned `event_id` BEFORE
 * dispatching to side effects, using ON CONFLICT DO NOTHING for dedup.
 * Stripe's at-least-once delivery guarantees mean a duplicate event will
 * eventually arrive; without this table the legacy webhook would re-run
 * mutations on every retry.
 *
 * Schema mirrors `supabase/migrations/20260520120000_stripe_webhook_events.sql`.
 */
export const stripeWebhookEvents = pgTable("stripe_webhook_events", {
  eventId: text("event_id").primaryKey(),
  type: text("type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  // Durable-claim lifecycle (spec 17 / Phase B): processing | done | failed.
  // Dedupe skips only `done`; `failed` / stale `processing` are re-claimable.
  // Defaults to 'done' so pre-existing (already-processed) rows keep deduping.
  status: text("status").notNull().default("done"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * RevenueCat webhook event idempotency + lifecycle log (M12 — RevenueCat
 * fronts both Apple IAP + Stripe). Mirrors `stripeWebhookEvents`: RevenueCat
 * delivers at-least-once and unordered, so the handler claims each event by
 * `event_id` before re-fetching the customer and upserting `user_subscriptions`.
 *
 * Schema mirrors `supabase/migrations/20260626120000_revenuecat_webhook_events.sql`.
 */
export const revenuecatWebhookEvents = pgTable("revenuecat_webhook_events", {
  eventId: text("event_id").primaryKey(),
  type: text("type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  // Durable-claim lifecycle: processing | done | failed. Dedupe skips only
  // `done`; `failed` / stale `processing` are re-claimable. Defaults to 'done'
  // so any pre-existing (already-processed) rows keep deduping.
  status: text("status").notNull().default("done"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Append-only ledger of `user_subscriptions.payment_status` transitions
 * (spec 17 / Phase D). Insert-only — never updated or deleted. Not FK-cascaded
 * so the audit trail outlives the subscription row it describes.
 */
export const subscriptionStatusTransitions = pgTable(
  "subscription_status_transitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userSubscriptionId: uuid("user_subscription_id").notNull(),
    userId: uuid("user_id"),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    source: text("source").notNull(),
    stripeEventId: text("stripe_event_id"),
    blocked: boolean("blocked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

// ─── Exercises ────────────────────────────────────────────────────────────────

export const exercises = pgTable("exercises", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  instructions: text("instructions"),
  videoUrl: text("video_url"),
  thumbnailUrl: text("thumbnail_url"),
  category: exerciseCategoryEnum("category").default("strength"),
  difficultyLevel:
    exerciseDifficultyEnum("difficulty_level").default("beginner"),
  regionType: text("region_type"),
  movementType: text("movement_type"),
  primaryMuscles: uuid("primary_muscles").array().default([]),
  secondaryMuscles: uuid("secondary_muscles").array().default([]),
  equipmentRequired: uuid("equipment_required").array().default([]),
  accessibilityRequirements: uuid("accessibility_requirements")
    .array()
    .default([]),
  accessibilityModifications: text("accessibility_modifications"),
  createdBy: uuid("created_by").references(() => profiles.id, {
    onDelete: "cascade",
  }),
  isPublic: boolean("is_public").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ─── Workouts ─────────────────────────────────────────────────────────────────

export const workouts = pgTable("workouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  createdBy: uuid("created_by").references(() => profiles.id, {
    onDelete: "cascade",
  }),
  visibility: workoutVisibilityEnum("visibility").default("private"),
  estimatedDurationMinutes: integer("estimated_duration_minutes")
    .notNull()
    .default(30),
  // Owner-visibility: does this workout appear in its author's personal
  // "My Workouts"? Distinct from workout_assignments.show_in_library (assigned
  // occurrence in the CLIENT's library) and the visibility enum (social
  // sharing). Default true — pre-existing + athlete-authored workouts are
  // personal; coach-authored workouts are created with false by the app.
  showInOwnerLibrary: boolean("show_in_owner_library").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const workoutExercises = pgTable("workout_exercises", {
  id: uuid("id").primaryKey().defaultRandom(),
  workoutId: uuid("workout_id")
    .notNull()
    .references(() => workouts.id, { onDelete: "cascade" }),
  exerciseId: uuid("exercise_id")
    .notNull()
    .references(() => exercises.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull(),
  supersetGroup: integer("superset_group"),
  targetSets: integer("target_sets"),
  targetRepsMin: integer("target_reps_min").notNull().default(1),
  targetRepsMax: integer("target_reps_max").notNull().default(1),
  targetDurationSeconds: integer("target_duration_seconds"),
  restSeconds: integer("rest_seconds").default(90),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ─── Workout Sessions ──────────────────────────────────────────────────────────

export const workoutSessions = pgTable(
  "workout_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    workoutId: uuid("workout_id").references(() => workouts.id, {
      onDelete: "set null",
    }),
    // M4 / cross-cuts § 1.1: NULL = self-logged; non-NULL = trainer logged on
    // behalf of user_id. M8 populates. Migration in m4_progress_schema.sql.
    loggedByUserId: uuid("logged_by_user_id").references(() => profiles.id),
    // M13 sync-hardening: client-generated stable id (the mobile
    // `active_sessions` local row id) for `POST /sessions/record` retry-dedup.
    // NULL for legacy / direct-API writes that don't supply one — NULLs are
    // distinct in a Postgres unique index, so existing rows never collide.
    clientSessionId: text("client_session_id"),
    name: text("name"),
    status: sessionStatusEnum("status").default("in_progress"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    totalDurationSeconds: integer("total_duration_seconds"),
    userNotes: text("user_notes"),
    trainerFeedback: text("trainer_feedback"),
    sessionRating: integer("session_rating"),
    overallRpe: integer("overall_rpe"),
    difficultyRanking: integer("difficulty_ranking"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    // M13 sync-hardening: dedup a retried `/sessions/record` submit. Scoped to
    // the session owner (the on-behalf path passes the client's id as user_id),
    // so a coach recording for two clients never collides. NULLs are distinct →
    // no backfill needed for the historical rows.
    uniqueIndex("workout_sessions_user_client_session_idx").on(
      t.userId,
      t.clientSessionId,
    ),
  ],
);

export const sessionExercises = pgTable("session_exercises", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => workoutSessions.id, { onDelete: "cascade" }),
  exerciseId: uuid("exercise_id")
    .notNull()
    .references(() => exercises.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull(),
  supersetGroup: integer("superset_group"),
  isSubstituted: boolean("is_substituted").notNull().default(false),
  originalExerciseId: uuid("original_exercise_id").references(
    () => exercises.id,
    { onDelete: "set null" },
  ),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const exerciseSets = pgTable("exercise_sets", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionExerciseId: uuid("session_exercise_id")
    .notNull()
    .references(() => sessionExercises.id, { onDelete: "cascade" }),
  setNumber: integer("set_number").notNull(),
  reps: integer("reps"),
  weightKg: decimal("weight_kg", { precision: 6, scale: 2 }),
  durationSeconds: integer("duration_seconds"),
  distanceMeters: decimal("distance_meters", { precision: 8, scale: 2 }),
  rpe: integer("rpe"),
  restAfterSeconds: integer("rest_after_seconds"),
  isPersonalRecord: boolean("is_personal_record").default(false),
  isCompleted: boolean("is_completed").notNull().default(false),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ─── Personal Records ──────────────────────────────────────────────────────────

export const personalRecords = pgTable(
  "personal_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "cascade" }),
    recordType: recordTypeEnum("record_type").notNull(),
    value: decimal("value", { precision: 10, scale: 2 }).notNull(),
    setId: uuid("set_id").references(() => exerciseSets.id, {
      onDelete: "set null",
    }),
    achievedAt: timestamp("achieved_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("personal_records_user_exercise_type_idx").on(
      t.userId,
      t.exerciseId,
      t.recordType,
    ),
  ],
);

// ─── Body Measurements ────────────────────────────────────────────────────────

export const bodyMeasurements = pgTable("body_measurements", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  // M4 / cross-cuts § 1.1: NULL = self-logged; non-NULL = trainer logged on
  // behalf. M8 populates. Migration in m4_progress_schema.sql.
  loggedByUserId: uuid("logged_by_user_id").references(() => profiles.id),
  weightKg: decimal("weight_kg", { precision: 5, scale: 2 }),
  bodyFatPercentage: decimal("body_fat_percentage", { precision: 4, scale: 2 }),
  chestCm: decimal("chest_cm", { precision: 5, scale: 2 }),
  waistCm: decimal("waist_cm", { precision: 5, scale: 2 }),
  hipsCm: decimal("hips_cm", { precision: 5, scale: 2 }),
  leftArmCm: decimal("left_arm_cm", { precision: 5, scale: 2 }),
  rightArmCm: decimal("right_arm_cm", { precision: 5, scale: 2 }),
  leftThighCm: decimal("left_thigh_cm", { precision: 5, scale: 2 }),
  rightThighCm: decimal("right_thigh_cm", { precision: 5, scale: 2 }),
  notes: text("notes"),
  measuredAt: timestamp("measured_at", { withTimezone: true }).defaultNow(),
});

// ─── Achievements ────────────────────────────────────────────────────────────

export const achievements = pgTable("achievements", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  category: achievementCategoryEnum("category").notNull(),
  requirements: jsonb("requirements").$type<Record<string, unknown>>(),
  iconUrl: text("icon_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const userAchievements = pgTable(
  "user_achievements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    achievementId: uuid("achievement_id")
      .notNull()
      .references(() => achievements.id, { onDelete: "cascade" }),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("user_achievements_user_achievement_idx").on(
      t.userId,
      t.achievementId,
    ),
  ],
);

// ─── Social - Friendships ────────────────────────────────────────────────────

export const friendships = pgTable(
  "friendships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    friendId: uuid("friend_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    status: friendshipStatusEnum("status").default("pending"),
    initiatedBy: uuid("initiated_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [uniqueIndex("friendships_user_friend_idx").on(t.userId, t.friendId)],
);

// ─── PT/Physio - Client Relationships ──────────────────────────────────────────

export const ptClientRelationships = pgTable(
  "pt_client_relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trainerId: uuid("trainer_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    status: ptRelationshipStatusEnum("status").default("pending"),
    isAiTrainer: boolean("is_ai_trainer").default(false),
    // Which party created the pending relationship — drives who accepts it and
    // who the notification trigger targets (Coach Mode Phase 8). 'trainer' =
    // email-invite (client accepts); 'client' = invite-code redeem (coach
    // accepts). Defaults 'trainer' so every historical row + email invite keeps
    // the M10 client-accept behaviour. Migration:
    // 20260711140000_pt_relationship_initiated_by.sql (text + CHECK, not an
    // enum, to keep the migration a single idempotent ADD COLUMN).
    initiatedBy: text("initiated_by").notNull().default("trainer"),
    relationshipReason: text("relationship_reason"),
    startDate: text("start_date"),
    endDate: text("end_date"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("pt_client_relationships_trainer_client_idx").on(
      t.trainerId,
      t.clientId,
    ),
  ],
);

// ─── Trainer Actions Audit ────────────────────────────────────────────────────
// Every trainer on-behalf write logs one row here INSIDE the same transaction as
// the target-row write (cross-cuts § 1.4.2). Append-only; retention forever.
// Migration: 20260705140000_trainer_actions_audit.sql.
export const trainerActionsAudit = pgTable(
  "trainer_actions_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trainerId: uuid("trainer_id")
      .notNull()
      .references(() => profiles.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => profiles.id),
    actionType: actionTypeEnum("action_type").notNull(),
    targetTable: text("target_table").notNull(),
    targetRowId: uuid("target_row_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("trainer_actions_audit_client_ts").on(t.clientId, t.createdAt.desc()),
    index("trainer_actions_audit_trainer_ts").on(
      t.trainerId,
      t.createdAt.desc(),
    ),
  ],
);

// ─── Client AI Summaries (Coach Mode Phase 6) ────────────────────────────────
//
// One row per (trainer, client, concluded client-local day) — the cache behind
// the coach's Client Detail "AI weekly summary" card (design.md § Module g).
// UNIQUE(trainer_id, client_id, covers_date) is the once-a-day cap; the manual
// refresh overwrites the row and bumps refresh_count (blocked at 1 ⇒ ≤2
// inferences/client/day). Backend-only (RLS on, no policies — see migration).
export const clientAiSummaries = pgTable(
  "client_ai_summaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trainerId: uuid("trainer_id")
      .notNull()
      .references(() => profiles.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => profiles.id),
    coversDate: date("covers_date").notNull(),
    summary: text("summary").notNull(),
    model: text("model").notNull(),
    refreshCount: integer("refresh_count").notNull().default(0),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("client_ai_summaries_trainer_client_date_key").on(
      t.trainerId,
      t.clientId,
      t.coversDate,
    ),
    index("client_ai_summaries_trainer_client_date").on(
      t.trainerId,
      t.clientId,
      t.coversDate.desc(),
    ),
  ],
);

// ─── Workout Assignments ──────────────────────────────────────────────────────

export const workoutAssignments = pgTable(
  "workout_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trainerId: uuid("trainer_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    workoutId: uuid("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),
    // M18 Swap — when a coach swaps this assignment's workout, the ORIGINAL
    // workout id is preserved here (COALESCE-first: survives re-swaps). NULL =
    // never swapped. For a programme occurrence this flags "override of the
    // programmed workout" while the programAssignmentId link stays intact.
    // Migration: 20260709130100_workout_assignments_swapped_from.sql.
    swappedFromWorkoutId: uuid("swapped_from_workout_id").references(
      () => workouts.id,
      { onDelete: "set null" },
    ),
    assignedDate: text("assigned_date").notNull(),
    dueDate: text("due_date"),
    status: assignmentStatusEnum("status").default("assigned"),
    completedSessionId: uuid("completed_session_id").references(
      () => workoutSessions.id,
      { onDelete: "set null" },
    ),
    trainerNotes: text("trainer_notes"),
    // NULL = ad-hoc single-workout assignment; non-NULL = a materialised
    // occurrence of a programme assignment (specs/19-programs D2).
    programAssignmentId: uuid("program_assignment_id").references(
      () => programAssignments.id,
      { onDelete: "cascade" },
    ),
    /** 0-based occurrence number within its programme assignment; NULL ad-hoc. */
    occurrenceIndex: integer("occurrence_index"),
    showInPlan: boolean("show_in_plan").notNull().default(true),
    showInLibrary: boolean("show_in_library").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    // Materialisation idempotency — concurrent horizon top-ups race safely
    // via ON CONFLICT DO NOTHING against this index.
    uniqueIndex("workout_assignments_pa_occurrence_uq")
      .on(t.programAssignmentId, t.occurrenceIndex)
      .where(sql`${t.programAssignmentId} is not null`),
    index("workout_assignments_client_due_idx").on(t.clientId, t.dueDate),
  ],
);

// ─── Workout Programs ─────────────────────────────────────────────────────────

// Flat-cycle model per specs/19-programs (D1): a programme is an ordered
// cycle of workouts. duration_weeks NULL = INDEFINITE programme (ongoing —
// e.g. weight loss); days_per_week drives occurrence scheduling.
export const workoutPrograms = pgTable("workout_programs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  durationWeeks: integer("duration_weeks"),
  daysPerWeek: integer("days_per_week").notNull().default(3),
  createdBy: uuid("created_by").references(() => profiles.id, {
    onDelete: "cascade",
  }),
  isPublic: boolean("is_public").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const programWorkouts = pgTable(
  "program_workouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id")
      .notNull()
      .references(() => workoutPrograms.id, { onDelete: "cascade" }),
    workoutId: uuid("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),
    /** 0-based order within the cycle; the same workout may repeat. */
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("program_workouts_program_position_uq").on(
      t.programId,
      t.position,
    ),
  ],
);

// One row per programme→client assignment. end_date stored at assign time
// (NULL = indefinite). At most one LIVE (assigned/started) row per
// (programme, client) — enforced by a partial unique index in SQL; Drizzle's
// uniqueIndex().where() mirrors it below.
export const programAssignments = pgTable(
  "program_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id")
      .notNull()
      .references(() => workoutPrograms.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    // Nullable + ON DELETE SET NULL (Cluster 2a, migration
    // 20260713120000_account_soft_delete.sql) — this is a coach's attribution
    // on the CLIENT's row, so deleting the coach's account must preserve the
    // client's assignment, not delete it. NULL = the assigning coach no
    // longer has an account.
    assignedBy: uuid("assigned_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    status: assignmentStatusEnum("status").notNull().default("assigned"),
    // Programme-level defaults copied onto materialised occurrences (D3).
    showInPlan: boolean("show_in_plan").notNull().default(true),
    showInLibrary: boolean("show_in_library").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("program_assignments_live_uq")
      .on(t.programId, t.clientId)
      .where(sql`${t.status} in ('assigned', 'started')`),
    index("program_assignments_client_status_idx").on(t.clientId, t.status),
    index("program_assignments_assigned_by_idx").on(t.assignedBy),
  ],
);

// ─── Goals ────────────────────────────────────────────────────────────────────

export const userGoals = pgTable(
  "user_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    goalTypeId: uuid("goal_type_id")
      .notNull()
      .references(() => goalTypes.id, { onDelete: "cascade" }),
    priority: integer("priority").default(1),
    isActive: boolean("is_active").default(true),
    targetDate: text("target_date"),
    notes: text("notes"),
    // M4 / cross-cuts § 2: NULL = self-set; non-NULL = trainer who assigned.
    assignedByUserId: uuid("assigned_by_user_id").references(() => profiles.id),
    // M4: goal-progress extension (nullable; existing goals unaffected).
    targetValue: numeric("target_value"),
    currentValue: numeric("current_value"),
    unit: text("unit"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("user_goals_user_goal_type_idx").on(t.userId, t.goalTypeId),
    index("user_goals_assigned_by_idx").on(t.assignedByUserId),
  ],
);

// ─── Streaks / Habits / Volume (M4 — 06-progress-goals) ─────────────────────
// cross-cuts § 3. Migration 20260607120100_m4_progress_schema.sql.

export const userStreaks = pgTable(
  "user_streaks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    streakType: streakTypeEnum("streak_type").notNull(),
    sourceGoalId: uuid("source_goal_id").references(() => userGoals.id, {
      onDelete: "cascade",
    }),
    period: text("period").notNull(), // 'daily' | 'weekly' | 'monthly'
    currentCount: integer("current_count").notNull().default(0),
    longestCount: integer("longest_count").notNull().default(0),
    lastPeriodEnd: date("last_period_end").notNull(),
    freezeTokens: integer("freeze_tokens").notNull().default(0),
    status: text("status").notNull().default("active"), // active | broken | paused
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    // Partial unique: one goal-driven streak per (user, goal); ad-hoc streaks
    // (source_goal_id IS NULL) are exempt.
    uniqueIndex("user_streaks_user_source_goal_uq")
      .on(t.userId, t.sourceGoalId)
      .where(sql`${t.sourceGoalId} IS NOT NULL`),
    // 18-habit-setup: one collection habit streak per user (source_goal_id
    // NULL is exempt from the index above, so it needs its own guard).
    uniqueIndex("user_streaks_collection_habit_uq")
      .on(t.userId)
      .where(
        sql`${t.streakType} = 'habit_streak' AND ${t.sourceGoalId} IS NULL`,
      ),
    index("user_streaks_user_status").on(t.userId, t.status),
    check(
      "user_streaks_period_chk",
      sql`${t.period} IN ('daily','weekly','monthly')`,
    ),
    check(
      "user_streaks_status_chk",
      sql`${t.status} IN ('active','broken','paused')`,
    ),
  ],
);

export const habitCompletions = pgTable(
  "habit_completions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => userGoals.id, { onDelete: "cascade" }),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    // User-local calendar date of completed_at, computed by the writer from
    // profiles.timezone. Uniqueness buckets on this (not a UTC day) so non-UTC
    // users' completions aren't dropped — see migration comment + PR #116.
    localCompletedDate: date("local_completed_date").notNull(),
    value: numeric("value"),
  },
  (t) => [
    // One completion per user / goal / user-local day.
    uniqueIndex("habit_completions_user_goal_local_day_uq").on(
      t.userId,
      t.goalId,
      t.localCompletedDate,
    ),
    index("habit_completions_user_goal_ts").on(
      t.userId,
      t.goalId,
      sql`${t.completedAt} DESC`,
    ),
  ],
);

// ─── Habit Setup (18-habit-setup) ───────────────────────────────────────────
// cross-cuts § 3.7. Migration 20260623120000_habit_setup_schema.sql.

// One row per enabled habit (1:1 with its user_goals row). period +
// completion_rule are server-derived from the category. days_per_week is the
// weekly slack (NULL for Gym). effective_from gates the first week the habit
// counts toward the collection streak; pending_config/pending_from carry a
// deferred edit promoted at the weekly rollover (anti-gaming — an edit never
// changes the in-progress week's bar).
export const habitConfigs = pgTable(
  "habit_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => userGoals.id, { onDelete: "cascade" }),
    category: habitCategoryEnum("category").notNull(),
    targetValue: numeric("target_value").notNull(),
    unit: text("unit").notNull(),
    period: text("period").notNull(), // 'daily' | 'weekly'
    completionRule: habitCompletionRuleEnum("completion_rule").notNull(),
    daysPerWeek: integer("days_per_week"), // 1..7 for daily habits; NULL for Gym
    tolerancePct: numeric("tolerance_pct"), // calories leniency; NULL otherwise
    effectiveFrom: date("effective_from").notNull(),
    pendingConfig: jsonb("pending_config").$type<Record<string, unknown>>(),
    pendingFrom: date("pending_from"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("habit_configs_goal_uq").on(t.goalId),
    uniqueIndex("habit_configs_user_cat_uq").on(t.userId, t.category),
    index("habit_configs_user_idx").on(t.userId),
    check("habit_configs_period_chk", sql`${t.period} IN ('daily','weekly')`),
    check(
      "habit_configs_dpw_chk",
      sql`${t.daysPerWeek} IS NULL OR ${t.daysPerWeek} BETWEEN 1 AND 7`,
    ),
    check("habit_configs_target_chk", sql`${t.targetValue} > 0`),
  ],
);

// Planned pause for the habit collection. goal_id NULL = all habits (default;
// scheduled from Home). ≥24h-advance + end-early are handler-enforced.
export const streakHolidays = pgTable(
  "streak_holidays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id").references(() => userGoals.id, {
      onDelete: "cascade",
    }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("streak_holidays_user_idx").on(t.userId, t.startDate),
    check("streak_holidays_range_chk", sql`${t.endDate} >= ${t.startDate}`),
  ],
);

export const weeklyVolumePerUser = pgTable(
  "weekly_volume_per_user",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    weekStart: date("week_start").notNull(), // Monday 00:00 user-local
    volumeKg: numeric("volume_kg").notNull().default("0"),
    sessionCount: integer("session_count").notNull().default(0),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("weekly_volume_per_user_user_week_uq").on(
      t.userId,
      t.weekStart,
    ),
    index("weekly_volume_per_user_user_week").on(
      t.userId,
      sql`${t.weekStart} DESC`,
    ),
  ],
);

export const volumeByMusclePerUser = pgTable(
  "volume_by_muscle_per_user",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    windowStart: date("window_start").notNull(),
    windowKind: text("window_kind").notNull(), // month|quarter|year|lifetime
    muscleGroup: text("muscle_group").notNull(), // muscle_groups.name (lowercase)
    volumeKg: numeric("volume_kg").notNull().default("0"),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("volume_by_muscle_per_user_uq").on(
      t.userId,
      t.windowStart,
      t.windowKind,
      t.muscleGroup,
    ),
    index("volume_by_muscle_per_user_user_window").on(
      t.userId,
      t.windowKind,
      sql`${t.windowStart} DESC`,
    ),
    check(
      "volume_by_muscle_window_kind_chk",
      sql`${t.windowKind} IN ('month','quarter','year','lifetime')`,
    ),
  ],
);

export const aiGoals = pgTable("ai_goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  goalType: goalTypeEnum("goal_type").notNull(),
  goalTypeId: uuid("goal_type_id").references(() => goalTypes.id),
  title: text("title").notNull(),
  description: text("description"),
  isAiGenerated: boolean("is_ai_generated").default(false),
  targetMetrics: jsonb("target_metrics").$type<Record<string, unknown>>(),
  targetDate: text("target_date"),
  status: goalStatusEnum("status").default("active"),
  currentProgress: jsonb("current_progress").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ─── AI Conversations ────────────────────────────────────────────────────────

export const aiConversations = pgTable("ai_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  role: messageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  context: jsonb("context").$type<Record<string, unknown>>(),
  conversationSessionId: uuid("conversation_session_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ─── Health Integration ───────────────────────────────────────────────────────

export const healthSyncConnections = pgTable(
  "health_sync_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    provider: healthProviderEnum("provider").notNull(),
    status: syncStatusEnum("status").default("connected"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("health_sync_connections_user_provider_idx").on(
      t.userId,
      t.provider,
    ),
  ],
);

export const dailyActivityData = pgTable(
  "daily_activity_data",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    activityDate: text("activity_date").notNull(),
    steps: integer("steps"),
    activeMinutes: integer("active_minutes"),
    caloriesBurned: integer("calories_burned"),
    distanceMeters: integer("distance_meters"),
    flightsClimbed: integer("flights_climbed"),
    restingHeartRate: integer("resting_heart_rate"),
    dataSource: healthProviderEnum("data_source"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("daily_activity_data_user_date_source_idx").on(
      t.userId,
      t.activityDate,
      t.dataSource,
    ),
  ],
);

export const sleepData = pgTable(
  "sleep_data",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    sleepDate: text("sleep_date").notNull(),
    durationMinutes: integer("duration_minutes"),
    qualityScore: integer("quality_score"),
    deepSleepMinutes: integer("deep_sleep_minutes"),
    lightSleepMinutes: integer("light_sleep_minutes"),
    remSleepMinutes: integer("rem_sleep_minutes"),
    awakeMinutes: integer("awake_minutes"),
    sleepStart: timestamp("sleep_start", { withTimezone: true }),
    sleepEnd: timestamp("sleep_end", { withTimezone: true }),
    dataSource: healthProviderEnum("data_source"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("sleep_data_user_date_source_idx").on(
      t.userId,
      t.sleepDate,
      t.dataSource,
    ),
  ],
);

// ─── Notifications ────────────────────────────────────────────────────────────

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  type: notificationTypeEnum("type").notNull(),
  title: text("title").notNull(),
  message: text("message"),
  data: jsonb("data").$type<Record<string, unknown>>(),
  isRead: boolean("is_read").default(false),
  readAt: timestamp("read_at", { withTimezone: true }),
  relatedEntityType: text("related_entity_type"),
  relatedEntityId: uuid("related_entity_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ─── Trainer Invitations ──────────────────────────────────────────────────────

export const trainerInvitations = pgTable(
  "trainer_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trainerId: uuid("trainer_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    clientEmail: text("client_email").notNull(),
    relationshipReason: text("relationship_reason"),
    status: text("status").default("pending"),
    invitedAt: timestamp("invited_at", { withTimezone: true }).defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("trainer_invitations_unique_pending")
      .on(t.trainerId, t.clientEmail)
      .where(sql`status = 'pending'`),
  ],
);

// ─── Trainer Invite Codes ─────────────────────────────────────────────────────

export const trainerInviteCodes = pgTable(
  "trainer_invite_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trainerId: uuid("trainer_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    status: text("status").notNull().default("active"),
    usedBy: uuid("used_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("trainer_invite_codes_code_active_uq")
      .on(t.code)
      .where(sql`status = 'active'`),
    // Enforces "at most one active code per trainer" — mirrors the partial
    // unique index in 20260625120000_trainer_invite_codes.sql. Declared here
    // so the Drizzle schema stays in parity with the DB (avoids drizzle-kit
    // flagging it for drop if push/generate is ever wired up).
    uniqueIndex("trainer_invite_codes_trainer_active_uq")
      .on(t.trainerId)
      .where(sql`status = 'active'`),
  ],
);

export type TrainerInviteCode = typeof trainerInviteCodes.$inferSelect;
export type NewTrainerInviteCode = typeof trainerInviteCodes.$inferInsert;

// ─── User Devices ────────────────────────────────────────────────────────────

export const userDevices = pgTable(
  "user_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    deviceToken: text("device_token").notNull(),
    platform: text("platform").notNull(),
    deviceInfo: jsonb("device_info")
      .$type<Record<string, unknown>>()
      .default({}),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("user_devices_user_token_idx").on(t.userId, t.deviceToken),
  ],
);

// ─── Subscription Price History ───────────────────────────────────────────────

export const subscriptionPriceHistory = pgTable("subscription_price_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  tierName: text("tier_name")
    .notNull()
    .references(() => subscriptionTiers.tierName, { onDelete: "cascade" }),
  priceMonthlyOld: decimal("price_monthly_old", { precision: 10, scale: 2 }),
  priceMonthlyNew: decimal("price_monthly_new", { precision: 10, scale: 2 }),
  priceYearlyOld: decimal("price_yearly_old", { precision: 10, scale: 2 }),
  priceYearlyNew: decimal("price_yearly_new", { precision: 10, scale: 2 }),
  currency: text("currency").default("GBP"),
  changedBy: uuid("changed_by").references(() => profiles.id),
  changeReason: text("change_reason"),
  changedAt: timestamp("changed_at", { withTimezone: true }).defaultNow(),
});

// ─── Trainer Client Notes ────────────────────────────────────────────────────

export const trainerClientNotes = pgTable(
  "trainer_client_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trainerId: uuid("trainer_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    noteType: noteTypeEnum("note_type").default("progress"),
    title: text("title").notNull(),
    content: text("content").notNull(),
    isPrivate: boolean("is_private").default(false),
    sessionId: uuid("session_id").references(() => workoutSessions.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  // Mirrors the real DB (migration 20260117234613): plain per-column indexes and
  // a composite FK to pt_client_relationships — there is NO unique constraint on
  // (trainer_id, client_id), so a coach keeps MANY notes per client. (An earlier
  // schema mirror wrongly declared a uniqueIndex here, which never existed in
  // Supabase; corrected 2026-07-09 with the notes-CRUD work.)
  (t) => [
    index("idx_trainer_client_notes_trainer").on(t.trainerId),
    index("idx_trainer_client_notes_client").on(t.clientId),
    index("idx_trainer_client_notes_type").on(t.noteType),
    index("idx_trainer_client_notes_created").on(t.createdAt.desc()),
  ],
);

// ─── Type Exports ────────────────────────────────────────────────────────────

export type MuscleGroup = typeof muscleGroups.$inferSelect;
export type NewMuscleGroup = typeof muscleGroups.$inferInsert;

export type MuscleCategory = typeof muscleCategories.$inferSelect;
export type NewMuscleCategory = typeof muscleCategories.$inferInsert;

export type EquipmentType = typeof equipmentTypes.$inferSelect;
export type NewEquipmentType = typeof equipmentTypes.$inferInsert;

export type AccessibilityTag = typeof accessibilityTags.$inferSelect;
export type NewAccessibilityTag = typeof accessibilityTags.$inferInsert;

export type GoalType = typeof goalTypes.$inferSelect;
export type NewGoalType = typeof goalTypes.$inferInsert;

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;

export type SubscriptionTier = typeof subscriptionTiers.$inferSelect;
export type NewSubscriptionTier = typeof subscriptionTiers.$inferInsert;

export type UserSubscription = typeof userSubscriptions.$inferSelect;
export type NewUserSubscription = typeof userSubscriptions.$inferInsert;

export type SubscriptionLimit = typeof subscriptionLimits.$inferSelect;
export type NewSubscriptionLimit = typeof subscriptionLimits.$inferInsert;

export type Exercise = typeof exercises.$inferSelect;
export type NewExercise = typeof exercises.$inferInsert;

export type Workout = typeof workouts.$inferSelect;
export type NewWorkout = typeof workouts.$inferInsert;

export type WorkoutExercise = typeof workoutExercises.$inferSelect;
export type NewWorkoutExercise = typeof workoutExercises.$inferInsert;

export type WorkoutSession = typeof workoutSessions.$inferSelect;
export type NewWorkoutSession = typeof workoutSessions.$inferInsert;

export type SessionExercise = typeof sessionExercises.$inferSelect;
export type NewSessionExercise = typeof sessionExercises.$inferInsert;

export type ExerciseSet = typeof exerciseSets.$inferSelect;
export type NewExerciseSet = typeof exerciseSets.$inferInsert;

export type PersonalRecord = typeof personalRecords.$inferSelect;
export type NewPersonalRecord = typeof personalRecords.$inferInsert;

export type BodyMeasurement = typeof bodyMeasurements.$inferSelect;
export type NewBodyMeasurement = typeof bodyMeasurements.$inferInsert;

export type Achievement = typeof achievements.$inferSelect;
export type NewAchievement = typeof achievements.$inferInsert;

export type UserAchievement = typeof userAchievements.$inferSelect;
export type NewUserAchievement = typeof userAchievements.$inferInsert;

export type Friendship = typeof friendships.$inferSelect;
export type NewFriendship = typeof friendships.$inferInsert;

export type PtClientRelationship = typeof ptClientRelationships.$inferSelect;
export type NewPtClientRelationship = typeof ptClientRelationships.$inferInsert;

export type TrainerActionAudit = typeof trainerActionsAudit.$inferSelect;
export type NewTrainerActionAudit = typeof trainerActionsAudit.$inferInsert;
export type ClientAiSummary = typeof clientAiSummaries.$inferSelect;
export type NewClientAiSummary = typeof clientAiSummaries.$inferInsert;
export type ActionType = (typeof actionTypeEnum.enumValues)[number];

export type WorkoutAssignment = typeof workoutAssignments.$inferSelect;
export type NewWorkoutAssignment = typeof workoutAssignments.$inferInsert;

export type WorkoutProgram = typeof workoutPrograms.$inferSelect;
export type NewWorkoutProgram = typeof workoutPrograms.$inferInsert;

export type ProgramWorkout = typeof programWorkouts.$inferSelect;
export type NewProgramWorkout = typeof programWorkouts.$inferInsert;

export type ProgramAssignment = typeof programAssignments.$inferSelect;
export type NewProgramAssignment = typeof programAssignments.$inferInsert;

export type UserGoal = typeof userGoals.$inferSelect;
export type NewUserGoal = typeof userGoals.$inferInsert;

export type UserStreak = typeof userStreaks.$inferSelect;
export type NewUserStreak = typeof userStreaks.$inferInsert;

export type HabitCompletion = typeof habitCompletions.$inferSelect;
export type NewHabitCompletion = typeof habitCompletions.$inferInsert;

export type HabitConfig = typeof habitConfigs.$inferSelect;
export type NewHabitConfig = typeof habitConfigs.$inferInsert;

export type StreakHoliday = typeof streakHolidays.$inferSelect;
export type NewStreakHoliday = typeof streakHolidays.$inferInsert;

export type WeeklyVolumePerUser = typeof weeklyVolumePerUser.$inferSelect;
export type NewWeeklyVolumePerUser = typeof weeklyVolumePerUser.$inferInsert;

export type VolumeByMusclePerUser = typeof volumeByMusclePerUser.$inferSelect;
export type NewVolumeByMusclePerUser =
  typeof volumeByMusclePerUser.$inferInsert;

export type AiGoal = typeof aiGoals.$inferSelect;
export type NewAiGoal = typeof aiGoals.$inferInsert;

export type AiConversation = typeof aiConversations.$inferSelect;
export type NewAiConversation = typeof aiConversations.$inferInsert;

export type HealthSyncConnection = typeof healthSyncConnections.$inferSelect;
export type NewHealthSyncConnection = typeof healthSyncConnections.$inferInsert;

export type DailyActivityData = typeof dailyActivityData.$inferSelect;
export type NewDailyActivityData = typeof dailyActivityData.$inferInsert;

export type SleepData = typeof sleepData.$inferSelect;
export type NewSleepData = typeof sleepData.$inferInsert;

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

export type TrainerInvitation = typeof trainerInvitations.$inferSelect;
export type NewTrainerInvitation = typeof trainerInvitations.$inferInsert;

export type UserDevice = typeof userDevices.$inferSelect;
export type NewUserDevice = typeof userDevices.$inferInsert;

export type SubscriptionPriceHistory =
  typeof subscriptionPriceHistory.$inferSelect;
export type NewSubscriptionPriceHistory =
  typeof subscriptionPriceHistory.$inferInsert;

export type TrainerClientNote = typeof trainerClientNotes.$inferSelect;
export type NewTrainerClientNote = typeof trainerClientNotes.$inferInsert;

// ─── M9 (13-nutrition-tracking) — Nutrition (Fuel) Tier-A ───────────────────
// Migration: 20260621120000_m9_nutrition_schema.sql (+ the target-hit enum
// value in 20260621120100_*). FK-dependency order mirrors the migration.

export const foods = pgTable(
  "foods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    brand: text("brand"),
    // Not globally unique — the OFF/curated catalogue is deduped by the
    // partial unique index below; private user foods may reuse a barcode.
    barcode: text("barcode"),
    kcal: numeric("kcal").notNull(),
    proteinG: numeric("protein_g").notNull(),
    carbsG: numeric("carbs_g").notNull(),
    fatG: numeric("fat_g").notNull(),
    servingSize: numeric("serving_size").notNull(),
    servingUnit: text("serving_unit").notNull(),
    // Real pack serving size (grams), from OFF `serving_quantity`. Macros stay
    // per-100g (serving_size=100); this is a display/scale multiplier for the
    // scan sheet's "Serving" tab so it can mean the real pack (e.g. 220 g) not
    // a flat 100 g. Nullable: OFF often omits it, and pre-existing seeded rows
    // are null (Serving tab falls back to serving_size for those).
    servingQuantity: numeric("serving_quantity"),
    // 'user' | 'openfoodfacts' | 'ai_recognized'
    source: text("source").notNull().default("user"),
    createdBy: uuid("created_by").references(() => profiles.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("foods_source_idx").on(t.source),
    // Dedup the shareable (OFF/curated) catalogue by barcode without blocking
    // private user foods that reuse one. Seed/delta upserts conflict-target
    // this partial index (PR #124 review — High).
    uniqueIndex("foods_barcode_shareable_uq")
      .on(t.barcode)
      .where(sql`source <> 'user' AND barcode IS NOT NULL`),
    index("foods_barcode_idx").on(t.barcode),
  ],
);

export const recipes = pgTable(
  "recipes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    name: text("name").notNull(),
    photoUrl: text("photo_url"),
    servings: numeric("servings").notNull().default("1"),
    instructions: text("instructions"),
    // 'manual' | 'url_import' | 'ai_extracted'
    source: text("source").notNull().default("manual"),
    sourceUrl: text("source_url"),
    totalKcal: numeric("total_kcal"), // materialised from ingredients
    totalProteinG: numeric("total_protein_g"),
    totalCarbsG: numeric("total_carbs_g"),
    totalFatG: numeric("total_fat_g"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("recipes_user_idx").on(t.userId)],
);

export const recipeIngredients = pgTable(
  "recipe_ingredients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    foodId: uuid("food_id").references(() => foods.id),
    customName: text("custom_name"), // when not linked to a food row
    quantity: numeric("quantity").notNull(),
    unit: text("unit").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [index("recipe_ingredients_recipe_idx").on(t.recipeId)],
);

export const meals = pgTable(
  "meals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    name: text("name").notNull(),
    photoUrl: text("photo_url"),
    totalKcal: numeric("total_kcal").notNull(),
    totalProteinG: numeric("total_protein_g").notNull(),
    totalCarbsG: numeric("total_carbs_g").notNull(),
    totalFatG: numeric("total_fat_g").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("meals_user_idx").on(t.userId)],
);

export const mealItems = pgTable(
  "meal_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mealId: uuid("meal_id")
      .notNull()
      .references(() => meals.id, { onDelete: "cascade" }),
    foodId: uuid("food_id").references(() => foods.id, {
      onDelete: "set null",
    }),
    recipeId: uuid("recipe_id").references(() => recipes.id, {
      onDelete: "set null",
    }),
    servings: numeric("servings").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [index("meal_items_meal_idx").on(t.mealId)],
);

export const nutritionEntries = pgTable(
  "nutrition_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    // ON DELETE SET NULL — macros are denormalised below, so deleting the
    // source food/recipe/meal preserves logged history (and never 500s the
    // delete via FK RESTRICT). Review fix (PR #124).
    foodId: uuid("food_id").references(() => foods.id, {
      onDelete: "set null",
    }), // nullable one-off
    recipeId: uuid("recipe_id").references(() => recipes.id, {
      onDelete: "set null",
    }),
    mealId: uuid("meal_id").references(() => meals.id, {
      onDelete: "set null",
    }),
    mealSlot: text("meal_slot").notNull(),
    servings: numeric("servings").notNull(),
    kcal: numeric("kcal").notNull(), // denormalised for fast reads
    proteinG: numeric("protein_g").notNull(),
    carbsG: numeric("carbs_g").notNull(),
    fatG: numeric("fat_g").notNull(),
    loggedAt: timestamp("logged_at", { withTimezone: true }).notNull(),
    // cross-cuts § 1.1 — M8 trainer-on-behalf; NULL = self-logged
    loggedByUserId: uuid("logged_by_user_id").references(() => profiles.id),
    aiEstimated: boolean("ai_estimated").notNull().default(false),
    aiConfidence: numeric("ai_confidence"), // 0..1, populated when ai_estimated (M9.5)
    // Client-supplied label for one-off/AI-estimated entries (no foodId/recipeId/
    // mealId) — stored and returned verbatim, never derived or validated server-side.
    customName: text("custom_name"),
  },
  (t) => [
    index("nutrition_entries_user_date").on(t.userId, t.loggedAt),
    index("nutrition_entries_user_slot_date").on(
      t.userId,
      t.mealSlot,
      t.loggedAt,
    ),
    check(
      "nutrition_entries_meal_slot_chk",
      sql`${t.mealSlot} IN ('breakfast','lunch','snack','dinner')`,
    ),
  ],
);

export const nutritionTargets = pgTable("nutrition_targets", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => profiles.id),
  dailyKcal: numeric("daily_kcal").notNull(),
  proteinG: numeric("protein_g").notNull(),
  carbsG: numeric("carbs_g").notNull(),
  fatG: numeric("fat_g").notNull(),
  waterCups: integer("water_cups").notNull().default(8),
  preset: text("preset").default("custom"),
  // cross-cuts § 1.5 — trainer attribution (M8 writes via the trainer route)
  setByUserId: uuid("set_by_user_id").references(() => profiles.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const waterLog = pgTable(
  "water_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    cups: integer("cups").notNull(),
    loggedDate: date("logged_date").notNull(),
  },
  (t) => [uniqueIndex("water_log_user_date_uq").on(t.userId, t.loggedDate)],
);

// Contract stub — cross-cuts § 4.2. Table created in M9; written in M9.5.
export const aiUsageLog = pgTable(
  "ai_usage_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    endpoint: text("endpoint").notNull(),
    requestSizeBytes: integer("request_size_bytes"),
    responseSizeBytes: integer("response_size_bytes"),
    ms: integer("ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("ai_usage_log_user_ts").on(t.userId, t.createdAt)],
);

export type Food = typeof foods.$inferSelect;
export type NewFood = typeof foods.$inferInsert;
export type Recipe = typeof recipes.$inferSelect;
export type NewRecipe = typeof recipes.$inferInsert;
export type RecipeIngredient = typeof recipeIngredients.$inferSelect;
export type NewRecipeIngredient = typeof recipeIngredients.$inferInsert;
export type Meal = typeof meals.$inferSelect;
export type NewMeal = typeof meals.$inferInsert;
export type MealItem = typeof mealItems.$inferSelect;
export type NewMealItem = typeof mealItems.$inferInsert;
export type NutritionEntry = typeof nutritionEntries.$inferSelect;
export type NewNutritionEntry = typeof nutritionEntries.$inferInsert;
export type NutritionTarget = typeof nutritionTargets.$inferSelect;
export type NewNutritionTarget = typeof nutritionTargets.$inferInsert;
export type WaterLog = typeof waterLog.$inferSelect;
export type NewWaterLog = typeof waterLog.$inferInsert;
export type AiUsageLog = typeof aiUsageLog.$inferSelect;
export type NewAiUsageLog = typeof aiUsageLog.$inferInsert;

// Add missing import for sql
import { sql } from "drizzle-orm";
