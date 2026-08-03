export { useAdapters, AdapterProvider } from "./useAdapters";
export { useReferenceLists } from "./useReferenceLists";
export type { ReferenceListsState } from "./useReferenceLists";
export {
  useExerciseFiltersPending,
  ExerciseFiltersPendingProvider,
} from "./useExerciseFiltersPending";
export type { ExerciseFiltersPendingContextValue } from "./useExerciseFiltersPending";
export { useDashboard } from "./useDashboard";
export type { DashboardState } from "./useDashboard";
export { useHealthData, HEALTH_READ_RATE_LIMIT_MS } from "./useHealthData";
export type { HealthDataState } from "./useHealthData";

// ── M4 (06-progress-goals) Progress/Home hooks ─────────────────────────────
export {
  useCachedResource,
  type CachedResourceState,
  type CachedResourceConfig,
} from "./useCachedResource";
export { useGetHome } from "./useGetHome";
export { useGetTodayRings } from "./useGetTodayRings";
export { useGetWeeklyVolume } from "./useGetWeeklyVolume";
export { useGetRecentPRs } from "./useGetRecentPRs";
export { useGetPRHistory } from "./useGetPRHistory";
export { useGetVolumeStats } from "./useGetVolumeStats";
export { useGetBodyMeasurements } from "./useGetBodyMeasurements";
export { useGetAchievements } from "./useGetAchievements";
export { useGetStreaks } from "./useGetStreaks";
export { useGetHabits, buildHabitGrid, type HabitsState } from "./useGetHabits";
export { useLogMeasurement } from "./useLogMeasurement";
export { useUseFreezeToken } from "./useUseFreezeToken";

// ── M9 (13-nutrition-tracking / Fuel) hooks ────────────────────────────────
export {
  useGetFuelToday,
  FUEL_TODAY_STALE_AFTER_MS,
  type FuelTodayState,
} from "./useGetFuelToday";
export {
  useGetNutritionEntries,
  type NutritionEntriesState,
} from "./useGetNutritionEntries";
export { useGetNutritionTarget } from "./useGetNutritionTarget";
export { useGetWaterToday, type WaterTodayState } from "./useGetWaterToday";
export { useGetRecipes } from "./useGetRecipes";
export { useGetRecipe } from "./useGetRecipe";
export { useGetMeals } from "./useGetMeals";
export { useSearchFoods, type SearchFoodsState } from "./useSearchFoods";
export { useResolveBarcode, type ResolveBarcode } from "./useResolveBarcode";
export { useLogEntry } from "./useLogEntry";
export { useEditEntry } from "./useEditEntry";
export { useDeleteEntry } from "./useDeleteEntry";
export { useSetWater } from "./useSetWater";
export { useSetTargets } from "./useSetTargets";
export { useMealprintPreferences } from "./useMealprintPreferences";
export { useSetMealprintPreferences } from "./useSetMealprintPreferences";
export {
  useMealSuggest,
  type MealSuggestStage,
  type MealSuggestFailure,
  type UseMealSuggest,
} from "./useMealSuggest";
// ⚠ `useMealprintGate` and `useMealprintEntry` are deliberately NOT exported
// here, and `useLoadoutGate` is absent for the same reason: both import
// `expo-router`'s singleton `router`, and this barrel is imported wholesale by
// suites that mock neither expo-router nor react-query (`nutrition-hooks`,
// `progress-hooks`). Re-exporting them pulls expo-router's native
// `messageSocket` into those suites and they fail to LOAD — not a test failure
// with a useful message, a module-resolution crash. Import them by path.
export { useCreateFood } from "./useCreateFood";
export { useCreateRecipe } from "./useCreateRecipe";
export { useCreateMeal } from "./useCreateMeal";
export {
  useImportRecipeUrl,
  type ImportRecipeResult,
} from "./useImportRecipeUrl";
export {
  useExtractRecipePhoto,
  type ExtractRecipeResult,
} from "./useExtractRecipePhoto";
export { useResolveIngredient } from "./useResolveIngredient";
export { useEstimateRecipe } from "./useEstimateRecipe";
// NOTE: useNutritionAiGate is intentionally NOT re-exported here — it pulls in
// useFeatureGate → expo-router, which would break every barrel consumer that
// runs without the expo-router test mock (same reason useFeatureGate isn't in
// the barrel). Import it directly: `@/ui/hooks/useNutritionAiGate`.
