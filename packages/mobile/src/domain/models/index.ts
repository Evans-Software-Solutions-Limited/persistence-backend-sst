export {
  type Exercise,
  type ExerciseCategory,
  type ExerciseDifficulty,
  type MuscleGroup,
  type EquipmentType,
  type ExerciseFilters,
  type CreateExerciseInput,
  EXERCISE_CATEGORIES,
  EXERCISE_DIFFICULTIES,
  MUSCLE_GROUPS,
  EQUIPMENT_TYPES,
  MUSCLE_GROUP_LABELS,
  EQUIPMENT_LABELS,
  CATEGORY_LABELS,
  DIFFICULTY_LABELS,
} from "./exercise";

export {
  type ReferenceEntry,
  type ReferenceList,
  type ReferenceListKind,
  REFERENCE_LIST_STALE_AFTER_MS,
  isReferenceListStale,
} from "./reference-list";

export { type PersonalRecord, type RecordType, RECORD_TYPES } from "./record";

export {
  type CachedDashboard,
  type DashboardActiveGoal,
  type DashboardLatestMeasurement,
  type DashboardPayload,
  type DashboardPROfTheWeek,
  type DashboardProfile,
  type DashboardProgress,
  type DashboardRecentActivity,
  type DashboardRecentWorkout,
  type DashboardSubscription,
  DASHBOARD_STALE_AFTER_MS,
  isDashboardStale,
} from "./dashboard";

export {
  type Workout,
  type WorkoutExercise,
  type WorkoutExerciseRef,
  type WorkoutExerciseInput,
  type WorkoutVisibility,
  type WorkoutListType,
  type WorkoutQuota,
  type CreateWorkoutInput,
  type UpdateWorkoutInput,
  type CachedWorkoutsList,
  type CachedWorkoutDetail,
  WORKOUTS_LIST_STALE_AFTER_MS,
  isWorkoutsListStale,
  isWorkoutDetailStale,
} from "./workout";

export {
  type WorkoutSession,
  type SessionExercise,
  type ExerciseSet,
  type SessionStatus,
  type SessionSummary,
} from "./session";

export {
  type SubscriptionTierName,
  type SubscriptionRole,
  type SubscriptionStatus,
  type BillingCycle,
  type ChangeType,
  type SubscriptionTier,
  type ScheduledChange,
  type MySubscription,
  type CreateSubscriptionResult,
  type CancelSubscriptionResult,
} from "./subscription";

export {
  type NotificationType,
  type WireNotificationType,
  type Notification,
  type NotificationsPage,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_LABELS,
  isKnownNotificationType,
  notificationTypeLabel,
  isUnread,
} from "./notification";

export {
  type NotificationPreferences,
  type NotificationCategory,
  CATEGORIES,
  DEFAULT_OPT_IN,
  isTypeEnabled,
  normalizePreferences,
} from "./notification-preferences";

// ── M4 (06-progress-goals) ──────────────────────────────────────────────────
export {
  type Streak,
  type StreakType,
  type StreakPeriod,
  type StreakStatus,
  STREAK_TYPES,
} from "./streak";

export {
  type HabitCompletion,
  type Habit,
  type HabitTileTone,
} from "./habit-completion";

export {
  type Achievement,
  type AchievementCategory,
} from "./achievement";

export {
  type RingDatum,
  type Rings,
  type MicroPills,
  type WeeklyVolumeDay,
  type WeeklyVolume,
  type MuscleVolume,
  type VolumeStats,
  type BodyTrendPoint,
  type HomePayload,
  HOME_STALE_AFTER_MS,
  isHomeStale,
} from "./progress";
