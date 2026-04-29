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
import {
  Colors as HomeColors,
  Spacing as HomeSpacing,
  BorderRadius as HomeBorderRadius,
  Shadows as HomeShadows,
  Typography as HomeTypography,
} from "./homeLegacyTheme";

// Local re-export aliases so istanbul tracks the file as covered when
// any consumer imports it. Without this — when the module was a pure
// `export { … } from './homeLegacyTheme'` re-export — the transpiled
// output had no executable lines for istanbul to instrument and the
// file registered 0% coverage despite being imported everywhere.
export const Colors = HomeColors;
export const Spacing = HomeSpacing;
export const BorderRadius = HomeBorderRadius;
export const Shadows = HomeShadows;
export const Typography = HomeTypography;
