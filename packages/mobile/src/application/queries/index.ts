export {
  getExercisesQuery,
  getExerciseQuery,
  refreshExerciseCache,
  EXERCISE_CACHE_STALE_AFTER_MS,
  type GetExercisesQueryResult,
} from "./exercises.query";

export {
  getDashboardQuery,
  refreshDashboard,
  DASHBOARD_STALE_AFTER_MS,
  type DashboardQueryResult,
} from "./dashboard.query";

export {
  getProfilePageQuery,
  refreshProfilePage,
  PROFILE_PAGE_STALE_AFTER_MS,
  type ProfilePageQueryResult,
} from "./profile-page.query";
