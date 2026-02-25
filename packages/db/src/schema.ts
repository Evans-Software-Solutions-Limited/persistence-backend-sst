import {
  boolean,
  decimal,
  integer,
  jsonb,
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
]);

export const noteTypeEnum = pgEnum("note_type", [
  "progress",
  "injury",
  "milestone",
  "concern",
  "general",
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
  heightCm: decimal("height_cm", { precision: 5, scale: 2 }),
  weightKg: decimal("weight_kg", { precision: 5, scale: 2 }),
  availableEquipment: uuid("available_equipment").array().default([]),
  accessibilityNeeds: uuid("accessibility_needs").array().default([]),
  preferredUnits: text("preferred_units").default("metric"),
  isProfilePublic: boolean("is_profile_public").default(false),
  subscriptionId: uuid("subscription_id"),
  hasUsedUserTrial: boolean("has_used_user_trial").default(false),
  hasUsedTrainerTrial: boolean("has_used_trainer_trial").default(false),
  primaryGoalId: uuid("primary_goal_id").references(() => goalTypes.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
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
    uniqueIndex("user_subscriptions_active_unique")
      .on(t.userId)
      .where(sql`payment_status IN ('active', 'pending')`),
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

export const workoutSessions = pgTable("workout_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  workoutId: uuid("workout_id").references(() => workouts.id, {
    onDelete: "set null",
  }),
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
});

export const sessionExercises = pgTable("session_exercises", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => workoutSessions.id, { onDelete: "cascade" }),
  exerciseId: uuid("exercise_id")
    .notNull()
    .references(() => exercises.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull(),
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

// ─── Workout Assignments ──────────────────────────────────────────────────────

export const workoutAssignments = pgTable("workout_assignments", {
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
  assignedDate: text("assigned_date").notNull(),
  dueDate: text("due_date"),
  status: assignmentStatusEnum("status").default("assigned"),
  completedSessionId: uuid("completed_session_id").references(
    () => workoutSessions.id,
    { onDelete: "set null" },
  ),
  trainerNotes: text("trainer_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ─── Workout Programs ─────────────────────────────────────────────────────────

export const workoutPrograms = pgTable("workout_programs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  totalWeeks: integer("total_weeks").notNull(),
  createdBy: uuid("created_by").references(() => profiles.id, {
    onDelete: "cascade",
  }),
  isPublic: boolean("is_public").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const programWeeks = pgTable(
  "program_weeks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id")
      .notNull()
      .references(() => workoutPrograms.id, { onDelete: "cascade" }),
    weekNumber: integer("week_number").notNull(),
    name: text("name"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("program_weeks_program_week_idx").on(t.programId, t.weekNumber),
  ],
);

export const programWorkouts = pgTable("program_workouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  programWeekId: uuid("program_week_id")
    .notNull()
    .references(() => programWeeks.id, { onDelete: "cascade" }),
  workoutId: uuid("workout_id")
    .notNull()
    .references(() => workouts.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week"),
  sortOrder: integer("sort_order").default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("user_goals_user_goal_type_idx").on(t.userId, t.goalTypeId),
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
  (t) => [
    uniqueIndex("trainer_client_notes_trainer_client_fk").on(
      t.trainerId,
      t.clientId,
    ),
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

export type WorkoutAssignment = typeof workoutAssignments.$inferSelect;
export type NewWorkoutAssignment = typeof workoutAssignments.$inferInsert;

export type WorkoutProgram = typeof workoutPrograms.$inferSelect;
export type NewWorkoutProgram = typeof workoutPrograms.$inferInsert;

export type ProgramWeek = typeof programWeeks.$inferSelect;
export type NewProgramWeek = typeof programWeeks.$inferInsert;

export type ProgramWorkout = typeof programWorkouts.$inferSelect;
export type NewProgramWorkout = typeof programWorkouts.$inferInsert;

export type UserGoal = typeof userGoals.$inferSelect;
export type NewUserGoal = typeof userGoals.$inferInsert;

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

// Add missing import for sql
import { sql } from "drizzle-orm";
