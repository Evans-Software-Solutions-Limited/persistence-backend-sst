-- =====================================================
-- INITIAL SCHEMA - ALL TABLES, ENUMS, AND INDEXES
-- =====================================================

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Note: pgTAP extension is NOT included here as it's only needed for testing
-- To run tests, install pgTAP manually or via test setup:
--   CREATE EXTENSION IF NOT EXISTS "pgtap";
-- This keeps production migrations clean and avoids unnecessary extensions

-- =====================================================
-- ENUMS
-- =====================================================

CREATE TYPE user_role AS ENUM ('user', 'personal_trainer', 'physiotherapist', 'admin');
CREATE TYPE fitness_level AS ENUM ('beginner', 'intermediate', 'advanced', 'elite');
CREATE TYPE exercise_difficulty AS ENUM ('beginner', 'intermediate', 'advanced', 'expert');
CREATE TYPE exercise_category AS ENUM ('strength', 'cardio', 'flexibility', 'balance', 'plyometric', 'olympic', 'mobility');
CREATE TYPE workout_visibility AS ENUM ('private', 'friends', 'public');
CREATE TYPE session_status AS ENUM ('in_progress', 'completed', 'cancelled');
CREATE TYPE record_type AS ENUM ('1rm', '3rm', '5rm', '10rm', 'max_reps', 'max_weight', 'best_time', 'longest_distance');
CREATE TYPE achievement_category AS ENUM ('workout_count', 'personal_record', 'streak', 'social', 'special');
CREATE TYPE friendship_status AS ENUM ('pending', 'accepted', 'blocked');
CREATE TYPE pt_relationship_status AS ENUM ('pending', 'active', 'inactive', 'terminated');
CREATE TYPE assignment_status AS ENUM ('assigned', 'started', 'completed', 'skipped');
CREATE TYPE goal_status AS ENUM ('active', 'completed', 'abandoned');
CREATE TYPE goal_type AS ENUM ('strength', 'endurance', 'weight_loss', 'muscle_gain', 'habit_building', 'custom');
CREATE TYPE message_role AS ENUM ('user', 'assistant', 'system');
CREATE TYPE health_provider AS ENUM ('apple_health', 'google_fit', 'fitbit', 'samsung_health', 'garmin');
CREATE TYPE sync_status AS ENUM ('connected', 'disconnected', 'error');
CREATE TYPE notification_type AS ENUM (
    'workout_assigned',
    'friend_request',
    'pt_request',
    'pt_accepted',
    'physio_request',
    'physio_accepted',
    'workout_reminder',
    'goal_milestone',
    'trainer_feedback'
);

-- =====================================================
-- LOOKUP/METADATA TABLES
-- =====================================================

-- Muscle Groups
CREATE TABLE muscle_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    display_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Muscle Categories
CREATE TABLE muscle_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Muscle Group Categories (junction table)
CREATE TABLE muscle_group_categories (
    muscle_group_id UUID REFERENCES muscle_groups(id) ON DELETE CASCADE,
    category_id UUID REFERENCES muscle_categories(id) ON DELETE CASCADE,
    PRIMARY KEY (muscle_group_id, category_id)
);

-- Equipment Types
CREATE TABLE equipment_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Accessibility Tags
CREATE TABLE accessibility_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    category TEXT, -- 'requirement', 'limitation', 'modification'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Goal Types
CREATE TABLE goal_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    category TEXT, -- 'performance', 'health', 'aesthetic', 'recovery'
    icon_name TEXT, -- For UI icon reference
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- USER PROFILES
-- =====================================================

CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE,
    full_name TEXT,
    username TEXT UNIQUE,
    avatar_url TEXT,
    role user_role DEFAULT 'user',
    
    -- Fitness Profile
    fitness_level fitness_level DEFAULT 'beginner',
    date_of_birth DATE,
    height_cm DECIMAL(5,2),
    weight_kg DECIMAL(5,2),
    
    -- Equipment & Accessibility
    available_equipment UUID[] DEFAULT '{}',
    accessibility_needs UUID[] DEFAULT '{}',
    
    -- Settings
    preferred_units TEXT DEFAULT 'metric',
    is_profile_public BOOLEAN DEFAULT false,

    -- Single source of truth: points to active subscription in user_subscriptions table
    subscription_id UUID, -- FK constraint added later to avoid circular dependency

    -- Trial flags (moved here since they're user-specific, not subscription-specific)
    has_used_user_trial BOOLEAN DEFAULT false,
    has_used_trainer_trial BOOLEAN DEFAULT false,
    
    -- Goals
    primary_goal_id UUID REFERENCES goal_types(id),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- SUBSCRIPTION SYSTEM
-- =====================================================

CREATE TABLE subscription_tiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tier_name TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    price_monthly DECIMAL(10,2) NOT NULL,
    price_yearly DECIMAL(10,2),
    currency TEXT DEFAULT 'GBP',
    features JSONB NOT NULL DEFAULT '{}',
    workout_limit INTEGER, -- NULL = unlimited
    ai_access BOOLEAN DEFAULT false,
    ai_workout_limit INTEGER DEFAULT 0, -- Monthly limit for AI-generated workouts
    gym_buddy_access BOOLEAN DEFAULT false, -- Access to gym buddy chatbot
    gym_buddy_can_create_workouts BOOLEAN DEFAULT false, -- Gym buddy can create workout plans
    gym_buddy_can_suggest_workouts BOOLEAN DEFAULT false, -- Gym buddy can suggest workout swaps
    trainer_client_limit INTEGER, -- Max clients for trainer tiers (NULL = not a trainer tier)
    is_trainer_tier BOOLEAN DEFAULT false, -- Whether this is a trainer subscription tier
    analytics_access BOOLEAN DEFAULT false,
    export_access BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    stripe_price_id_monthly TEXT, -- Stripe Price ID for monthly billing
    stripe_price_id_yearly TEXT, -- Stripe Price ID for yearly billing
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE user_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    tier_name TEXT NOT NULL REFERENCES subscription_tiers(tier_name),
    currency TEXT DEFAULT 'GBP',
    
    -- Payment tracking (pending, active, trialing, expired, cancelled, grace_period, past_due)
    payment_status TEXT DEFAULT 'pending',
    
    -- Subscription dates
    starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    trial_ends_at TIMESTAMPTZ,
    
    -- Billing
    billing_cycle TEXT DEFAULT 'monthly',
    next_billing_date TIMESTAMPTZ,
    
    -- External subscription ID (Stripe subscription ID)
    external_subscription_id TEXT,
    
    -- Metadata (stores Stripe data: stripe_customer_id, stripe_subscription_id, stripe_payment_method_id, platform, payment_type, etc.)
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE subscription_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    limit_type TEXT NOT NULL,
    current_count INTEGER DEFAULT 0,
    limit_value INTEGER,
    reset_date TIMESTAMPTZ DEFAULT NOW(),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, limit_type)
);

-- Add FK constraint for subscription_id (after both tables exist to avoid circular dependency)
ALTER TABLE profiles ADD CONSTRAINT fk_profiles_subscription_id FOREIGN KEY (subscription_id) REFERENCES user_subscriptions(id);

-- professional_subscriptions table removed - trainer limits now managed via subscription_tiers.trainer_client_limit
-- slot limits are determined by subscription tier

-- =====================================================
-- EXERCISES
-- =====================================================

CREATE TABLE exercises (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    instructions TEXT,
    
    -- Media
    video_url TEXT,
    thumbnail_url TEXT,
    
    -- Classification
    category exercise_category DEFAULT 'strength',
    difficulty_level exercise_difficulty DEFAULT 'beginner',
    
    -- Exercise tagging
    region_type TEXT CHECK (region_type IN ('Upper', 'Lower', 'Core', 'Full Body')),
    movement_type TEXT CHECK (movement_type IN ('Push', 'Pull', 'Push–Pull')),
    
    -- Muscle Groups
    primary_muscles UUID[] DEFAULT '{}',
    secondary_muscles UUID[] DEFAULT '{}',
    
    -- Equipment
    equipment_required UUID[] DEFAULT '{}',
    
    -- Accessibility
    accessibility_requirements UUID[] DEFAULT '{}',
    accessibility_modifications TEXT,
    
    -- Ownership & Visibility
    created_by UUID REFERENCES profiles(id) ON DELETE CASCADE,
    is_public BOOLEAN DEFAULT true,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- WORKOUTS
-- =====================================================

CREATE TABLE workouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    
    -- Ownership
    created_by UUID REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Visibility
    visibility workout_visibility DEFAULT 'private',
    
    -- Estimated duration in minutes (required)
    estimated_duration_minutes INTEGER NOT NULL DEFAULT 30,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- WORKOUT EXERCISES
-- =====================================================

CREATE TABLE workout_exercises (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workout_id UUID NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    
    -- Order in workout
    sort_order INTEGER NOT NULL,
    
    -- Superset grouping
    superset_group INTEGER,
    
    -- Target values (rep ranges)
    target_sets INTEGER,
    target_reps_min INTEGER NOT NULL DEFAULT 1,
    target_reps_max INTEGER NOT NULL DEFAULT 1,
    target_duration_seconds INTEGER,
    
    -- Rest period
    rest_seconds INTEGER DEFAULT 90,
    
    -- Notes
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    CHECK (target_reps_min >= 1),
    CHECK (target_reps_max >= target_reps_min)
);

-- =====================================================
-- WORKOUT SESSIONS
-- =====================================================

CREATE TABLE workout_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    workout_id UUID REFERENCES workouts(id) ON DELETE SET NULL,
    
    -- Session details
    name TEXT,
    status session_status DEFAULT 'in_progress',
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    
    -- Duration in seconds
    total_duration_seconds INTEGER,
    
    -- Feedback
    user_notes TEXT,
    trainer_feedback TEXT,
    session_rating INTEGER CHECK (session_rating >= 1 AND session_rating <= 5),
    overall_rpe INTEGER CHECK (overall_rpe >= 1 AND overall_rpe <= 10),
    difficulty_ranking INTEGER CHECK (difficulty_ranking >= 1 AND difficulty_ranking <= 10),
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- SESSION EXERCISES
-- =====================================================

CREATE TABLE session_exercises (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
    exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    
    -- Order in session
    sort_order INTEGER NOT NULL,
    
    -- Notes
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- EXERCISE SETS
-- =====================================================

CREATE TABLE exercise_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_exercise_id UUID NOT NULL REFERENCES session_exercises(id) ON DELETE CASCADE,
    
    -- Set details
    set_number INTEGER NOT NULL,
    reps INTEGER,
    weight_kg DECIMAL(6,2),
    duration_seconds INTEGER,
    distance_meters DECIMAL(8,2),
    
    -- Optional metrics
    rpe INTEGER CHECK (rpe >= 1 AND rpe <= 10),
    rest_after_seconds INTEGER,
    
    -- Was this a PR?
    is_personal_record BOOLEAN DEFAULT false,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- PERSONAL RECORDS
-- =====================================================

CREATE TABLE personal_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    
    -- Record details
    record_type record_type NOT NULL,
    value DECIMAL(10,2) NOT NULL,
    
    -- Reference to the set that achieved this
    set_id UUID REFERENCES exercise_sets(id) ON DELETE SET NULL,
    
    achieved_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, exercise_id, record_type)
);

-- =====================================================
-- BODY MEASUREMENTS
-- =====================================================

CREATE TABLE body_measurements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Measurements
    weight_kg DECIMAL(5,2),
    body_fat_percentage DECIMAL(4,2),
    
    -- Circumferences in cm
    chest_cm DECIMAL(5,2),
    waist_cm DECIMAL(5,2),
    hips_cm DECIMAL(5,2),
    left_arm_cm DECIMAL(5,2),
    right_arm_cm DECIMAL(5,2),
    left_thigh_cm DECIMAL(5,2),
    right_thigh_cm DECIMAL(5,2),
    
    -- Notes
    notes TEXT,
    
    measured_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- GAMIFICATION - ACHIEVEMENTS
-- =====================================================

CREATE TABLE achievements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    category achievement_category NOT NULL,
    requirements JSONB,
    icon_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE user_achievements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    achievement_id UUID NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
    unlocked_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, achievement_id)
);

-- =====================================================
-- SOCIAL - FRIENDSHIPS
-- =====================================================

CREATE TABLE friendships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    friend_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status friendship_status DEFAULT 'pending',
    initiated_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, friend_id),
    CHECK (user_id != friend_id)
);

-- =====================================================
-- PT/PHYSIO - CLIENT RELATIONSHIPS
-- =====================================================

CREATE TABLE pt_client_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status pt_relationship_status DEFAULT 'pending',
    
    -- AI trainer flag
    is_ai_trainer BOOLEAN DEFAULT false,
    
    -- Relationship details
    relationship_reason TEXT,
    start_date DATE,
    end_date DATE,
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(trainer_id, client_id),
    CHECK (trainer_id != client_id)
);

-- =====================================================
-- WORKOUT ASSIGNMENTS
-- =====================================================

CREATE TABLE workout_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    workout_id UUID NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    
    -- When should this be done
    assigned_date DATE NOT NULL,
    due_date DATE,
    
    status assignment_status DEFAULT 'assigned',
    
    -- Link to completed session
    completed_session_id UUID REFERENCES workout_sessions(id) ON DELETE SET NULL,
    
    -- Notes
    trainer_notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- WORKOUT PROGRAMS
-- =====================================================

CREATE TABLE workout_programs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    total_weeks INTEGER NOT NULL,
    created_by UUID REFERENCES profiles(id) ON DELETE CASCADE,
    is_public BOOLEAN DEFAULT false,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE program_weeks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id UUID NOT NULL REFERENCES workout_programs(id) ON DELETE CASCADE,
    week_number INTEGER NOT NULL,
    name TEXT,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(program_id, week_number)
);

CREATE TABLE program_workouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_week_id UUID NOT NULL REFERENCES program_weeks(id) ON DELETE CASCADE,
    workout_id UUID NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    day_of_week INTEGER CHECK (day_of_week >= 1 AND day_of_week <= 7),
    sort_order INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- GOALS
-- =====================================================

CREATE TABLE user_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    goal_type_id UUID NOT NULL REFERENCES goal_types(id) ON DELETE CASCADE,
    priority INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    target_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, goal_type_id)
);

CREATE TABLE ai_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    goal_type goal_type NOT NULL,
    goal_type_id UUID REFERENCES goal_types(id),
    title TEXT NOT NULL,
    description TEXT,
    is_ai_generated BOOLEAN DEFAULT false,
    target_metrics JSONB,
    target_date DATE,
    status goal_status DEFAULT 'active',
    current_progress JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- AI CONVERSATIONS
-- =====================================================

CREATE TABLE ai_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role message_role NOT NULL,
    content TEXT NOT NULL,
    context JSONB,
    conversation_session_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- HEALTH INTEGRATION
-- =====================================================

CREATE TABLE health_sync_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    provider health_provider NOT NULL,
    status sync_status DEFAULT 'connected',
    last_synced_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, provider)
);

CREATE TABLE daily_activity_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    activity_date DATE NOT NULL,
    steps INTEGER,
    active_minutes INTEGER,
    calories_burned INTEGER,
    distance_meters INTEGER,
    flights_climbed INTEGER,
    resting_heart_rate INTEGER,
    data_source health_provider,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, activity_date, data_source)
);

CREATE TABLE sleep_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    sleep_date DATE NOT NULL,
    duration_minutes INTEGER,
    quality_score INTEGER CHECK (quality_score >= 1 AND quality_score <= 100),
    deep_sleep_minutes INTEGER,
    light_sleep_minutes INTEGER,
    rem_sleep_minutes INTEGER,
    awake_minutes INTEGER,
    sleep_start TIMESTAMPTZ,
    sleep_end TIMESTAMPTZ,
    data_source health_provider,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, sleep_date, data_source)
);

-- =====================================================
-- NOTIFICATIONS
-- =====================================================

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type notification_type NOT NULL,
    title TEXT NOT NULL,
    message TEXT,
    data JSONB,
    is_read BOOLEAN DEFAULT false,
    read_at TIMESTAMPTZ,
    related_entity_type TEXT,
    related_entity_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- INDEXES
-- =====================================================

-- Profiles
CREATE INDEX idx_profiles_role ON profiles(role);
CREATE INDEX idx_profiles_subscription_id ON profiles(subscription_id);
CREATE INDEX idx_profiles_has_used_user_trial ON profiles(has_used_user_trial) WHERE has_used_user_trial = true;
CREATE INDEX idx_profiles_has_used_trainer_trial ON profiles(has_used_trainer_trial) WHERE has_used_trainer_trial = true;

-- Exercises
CREATE INDEX idx_exercises_primary_muscles ON exercises USING GIN(primary_muscles);
CREATE INDEX idx_exercises_equipment ON exercises USING GIN(equipment_required);
CREATE INDEX idx_exercises_difficulty ON exercises(difficulty_level);
CREATE INDEX idx_exercises_created_by ON exercises(created_by);
CREATE INDEX idx_exercises_region_type ON exercises(region_type);
CREATE INDEX idx_exercises_movement_type ON exercises(movement_type);

-- Workouts
CREATE INDEX idx_workouts_created_by ON workouts(created_by);
CREATE INDEX idx_workouts_visibility ON workouts(visibility);

-- Workout Exercises
CREATE INDEX idx_workout_exercises_workout ON workout_exercises(workout_id);
CREATE INDEX idx_workout_exercises_exercise ON workout_exercises(exercise_id);
CREATE INDEX idx_workout_exercises_workout_id ON workout_exercises(workout_id);
CREATE INDEX idx_workout_exercises_superset ON workout_exercises(workout_id, superset_group) WHERE superset_group IS NOT NULL;

-- Workout Sessions
CREATE INDEX idx_workout_sessions_user ON workout_sessions(user_id);
CREATE INDEX idx_workout_sessions_workout ON workout_sessions(workout_id);
CREATE INDEX idx_workout_sessions_started ON workout_sessions(started_at);

-- Session Exercises
CREATE INDEX idx_session_exercises_session ON session_exercises(session_id);
CREATE INDEX idx_session_exercises_exercise ON session_exercises(exercise_id);

-- Exercise Sets
CREATE INDEX idx_exercise_sets_session_exercise ON exercise_sets(session_exercise_id);

-- Personal Records
CREATE INDEX idx_personal_records_user ON personal_records(user_id);
CREATE INDEX idx_personal_records_exercise ON personal_records(exercise_id);

-- Body Measurements
CREATE INDEX idx_body_measurements_user ON body_measurements(user_id);
CREATE INDEX idx_body_measurements_date ON body_measurements(measured_at);

-- User Achievements
CREATE INDEX idx_user_achievements_user ON user_achievements(user_id);

-- Friendships
CREATE INDEX idx_friendships_user ON friendships(user_id);
CREATE INDEX idx_friendships_friend ON friendships(friend_id);
CREATE INDEX idx_friendships_status ON friendships(status);

-- PT Relationships
CREATE INDEX idx_pt_relationships_trainer ON pt_client_relationships(trainer_id);
CREATE INDEX idx_pt_relationships_client ON pt_client_relationships(client_id);
CREATE INDEX idx_pt_relationships_status ON pt_client_relationships(status);

-- Workout Assignments
CREATE INDEX idx_workout_assignments_trainer ON workout_assignments(trainer_id);
CREATE INDEX idx_workout_assignments_client ON workout_assignments(client_id);
CREATE INDEX idx_workout_assignments_status ON workout_assignments(status);
CREATE INDEX idx_workout_assignments_due_date ON workout_assignments(due_date);

-- Workout Programs
CREATE INDEX idx_workout_programs_created_by ON workout_programs(created_by);
CREATE INDEX idx_program_weeks_program ON program_weeks(program_id);
CREATE INDEX idx_program_workouts_week ON program_workouts(program_week_id);
CREATE INDEX idx_program_workouts_workout ON program_workouts(workout_id);

-- Goals
CREATE INDEX idx_user_goals_user ON user_goals(user_id);
CREATE INDEX idx_user_goals_active ON user_goals(is_active);
CREATE INDEX idx_ai_goals_user ON ai_goals(user_id);
CREATE INDEX idx_ai_goals_status ON ai_goals(status);

-- AI Conversations
CREATE INDEX idx_ai_conversations_user ON ai_conversations(user_id);
CREATE INDEX idx_ai_conversations_session ON ai_conversations(conversation_session_id);
CREATE INDEX idx_ai_conversations_created ON ai_conversations(created_at);

-- Health
CREATE INDEX idx_health_sync_user ON health_sync_connections(user_id);
CREATE INDEX idx_daily_activity_user ON daily_activity_data(user_id);
CREATE INDEX idx_daily_activity_date ON daily_activity_data(activity_date);
CREATE INDEX idx_sleep_data_user ON sleep_data(user_id);
CREATE INDEX idx_sleep_data_date ON sleep_data(sleep_date);

-- Notifications
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_is_read ON notifications(is_read);
CREATE INDEX idx_notifications_created ON notifications(created_at);

-- Subscriptions
CREATE INDEX idx_user_subscriptions_user ON user_subscriptions(user_id);
CREATE INDEX idx_user_subscriptions_transaction_id ON user_subscriptions ((metadata->>'transaction_id')) WHERE metadata->>'transaction_id' IS NOT NULL;
CREATE INDEX idx_user_subscriptions_external_id ON user_subscriptions(external_subscription_id) WHERE external_subscription_id IS NOT NULL;
CREATE INDEX idx_user_subscriptions_status ON user_subscriptions(payment_status);
CREATE INDEX idx_subscription_limits_user ON subscription_limits(user_id);

-- Muscle Categories
CREATE INDEX idx_muscle_group_categories_muscle_group_id ON muscle_group_categories(muscle_group_id);
CREATE INDEX idx_muscle_group_categories_category_id ON muscle_group_categories(category_id);
CREATE INDEX idx_muscle_categories_sort_order ON muscle_categories(sort_order);

-- =====================================================
-- UNIQUE CONSTRAINTS
-- =====================================================

-- User subscriptions: only one active/pending per user
CREATE UNIQUE INDEX user_subscriptions_active_unique 
ON user_subscriptions (user_id) 
WHERE payment_status IN ('active', 'pending');

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TYPE user_role IS 'User roles: user (regular), personal_trainer (PT), physiotherapist (physio), admin';
COMMENT ON COLUMN profiles.role IS 'Primary user role. Use is_* flags for multi-role support';
COMMENT ON COLUMN profiles.primary_goal_id IS 'Quick reference to users primary training goal';
COMMENT ON COLUMN pt_client_relationships.is_ai_trainer IS 'True if this is an AI PT subscription (client can cancel), false for human PTs';
COMMENT ON COLUMN pt_client_relationships.relationship_reason IS 'Why this relationship exists (e.g., "ACL recovery", "Marathon training", "General fitness")';
COMMENT ON COLUMN workout_exercises.superset_group IS 'Groups exercises together for supersets. Exercises with the same value belong to the same superset.';
COMMENT ON COLUMN workout_exercises.target_reps_min IS 'Minimum reps in the target rep range';
COMMENT ON COLUMN workout_exercises.target_reps_max IS 'Maximum reps in the target rep range';
COMMENT ON COLUMN workout_sessions.difficulty_ranking IS 'User''s perceived difficulty of the workout (1-10 scale). Separate from session_rating (workout quality) and overall_rpe (perceived exertion).';
COMMENT ON COLUMN exercises.region_type IS 'Body region targeted: Upper, Lower, Core, or Full Body';
COMMENT ON COLUMN exercises.movement_type IS 'Movement pattern: Push, Pull, or Push–Pull';
COMMENT ON COLUMN user_goals.priority IS '1 = primary goal, 2+ = secondary goals';
COMMENT ON COLUMN subscription_tiers.currency IS 'Currency code for pricing (GBP for UK market)';
COMMENT ON COLUMN user_subscriptions.currency IS 'Currency for the subscription pricing';
COMMENT ON TABLE goal_types IS 'Predefined goal types users can select (marathon training, strength, recovery, etc.)';
COMMENT ON TABLE user_goals IS 'User-selected goals for personalized training plans and AI recommendations';
COMMENT ON COLUMN subscription_tiers.ai_workout_limit IS 'Monthly limit for AI-generated workouts (0 = none, NULL = unlimited)';
COMMENT ON COLUMN subscription_tiers.gym_buddy_access IS 'Whether user has access to gym buddy chatbot';
COMMENT ON COLUMN subscription_tiers.gym_buddy_can_create_workouts IS 'Whether gym buddy can create workout plans for user';
COMMENT ON COLUMN subscription_tiers.gym_buddy_can_suggest_workouts IS 'Whether gym buddy can suggest workout swaps/modifications';
COMMENT ON COLUMN subscription_tiers.trainer_client_limit IS 'Maximum number of clients for trainer tiers (NULL for non-trainer tiers)';
COMMENT ON COLUMN subscription_tiers.is_trainer_tier IS 'Whether this is a trainer subscription tier';
COMMENT ON TABLE subscription_tiers IS 'Available subscription tiers with GBP pricing for UK market';
COMMENT ON TABLE user_subscriptions IS 'User subscription records using native IAP (Apple/Google). Users can have multiple subscription records (for resubscription), but only one active/pending subscription at a time. IAP transaction data stored in metadata JSONB.';
COMMENT ON TABLE subscription_limits IS 'Tracks usage limits for each user';
COMMENT ON INDEX user_subscriptions_active_unique IS 'Ensures only one active or pending subscription per user, allowing cancelled users to resubscribe';

