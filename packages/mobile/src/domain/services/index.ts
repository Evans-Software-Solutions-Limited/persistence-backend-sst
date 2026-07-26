export {
  filterExercises,
  scoreExercise,
  validateExerciseInput,
} from "./exercise.service";

export {
  type IdFactory,
  type SessionContext,
  createSessionFromWorkout,
  createEmptySession,
  addSetToExercise,
  renumberSets,
  completeSet,
  substituteExercise,
  addExerciseToSession,
  removeExerciseFromSession,
  setExerciseNotes,
  addSupersetSet,
  removeSupersetSet,
  calculateVolume,
  calculateSummary,
  detectPersonalRecords,
} from "./sessionService";

export {
  isFreeTier,
  isSubscriptionActive,
  canCancelSubscription,
  isTrialing,
  isCancelledButActive,
  shouldShowTrialBanner,
  getSubscriptionDisplayInfo,
} from "./subscriptionService";

export {
  deriveStreak,
  deriveCollectionStreak,
  collectionWeekMet,
  type StreakDerivationPeriod,
  type DeriveStreakCompletion,
  type StreakHolidayRange,
  type DeriveCollectionStreakOptions,
} from "./streak.service";

export {
  type MacroSum,
  type Sex,
  type TdeeProfile,
  type ActivityLevel,
  type MacroSplit,
  type GoalTone,
  type GoalLabel,
  type GoalHit,
  type EntryNameLookups,
  type PortionMode,
  MEAL_SLOTS,
  GRAMS_PER_CUP,
  heroRingPct,
  macroPct,
  entryDisplayLabel,
  portionToServings,
  ACTIVITY_LEVELS,
  DEFAULT_ACTIVITY_ID,
  computeConsumed,
  computeRemaining,
  groupBySlot,
  flattenFuelEntries,
  recomputeFuelToday,
  setFuelWater,
  setFuelTargets,
  scaleFoodMacros,
  scaleRecipeMacros,
  perServingDivisor,
  activityMultiplier,
  bmrMifflinStJeor,
  tdee,
  goalDelta,
  goalAdjustedKcal,
  recommendedSplit,
  macrosFromKcal,
  goalLabel,
  withinBand,
  detectDailyGoalHit,
  rescaleAiFoodItem,
  sumKeptAiItemsKcal,
  defaultMealSlot,
  type RecipeDraftIngredientRow,
  computeRecipeDraftMacros,
} from "./nutrition.service";

// AI-estimation failure copy, chosen by HTTP status (2026-07-26 incident — see
// the module docblock). Shared by both AI surfaces so they cannot drift.
export {
  aiEstimateErrorMessage,
  type AiEstimateSurface,
} from "./aiErrorMessage";
