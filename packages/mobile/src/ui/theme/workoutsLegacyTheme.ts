/**
 * Legacy Workouts-screen theme shim.
 *
 * The Workouts components + screens are ported verbatim from
 * `persistence-mobile/components/workouts/*` and `persistence-mobile/
 * app/(tabs)/workouts.tsx` + `app/workout-{creator,editor}.tsx`. Re-
 * exports the same `Colors / Spacing / BorderRadius / Shadows /
 * Typography` schema the legacy files imported, backed by V2 token
 * values via `homeLegacyTheme`. Same pattern that M1 used for Home.
 *
 * Audit: the only Colors fields legacy workouts components depend on
 * (Colors.primary / .background / .surface / .text / .success /
 * .warning / .error) are all present in `homeLegacyTheme`. Colors.info
 * is only referenced from the M3 Active-Session screens which this PR
 * does not port — when those land, extend this module rather than
 * editing the home shim.
 *
 * Do not use outside `ui/components/workouts/*`,
 * `ui/containers/Workout*Container.tsx`, or
 * `ui/presenters/Workout*Presenter.tsx`. Anywhere else should consume
 * the Tamagui token system (`@/ui/theme/tokens`).
 *
 * Spec: specs/04-workout-management/design.md § UI Components (mobile)
 */
export {
  Colors,
  Spacing,
  BorderRadius,
  Shadows,
  Typography,
} from "./homeLegacyTheme";
