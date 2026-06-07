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
export { useGetHabits, buildHabitGrid, type HabitsState } from "./useGetHabits";
export { useToggleHabitDay } from "./useToggleHabitDay";
export { useLogMeasurement } from "./useLogMeasurement";
export { useUseFreezeToken } from "./useUseFreezeToken";
