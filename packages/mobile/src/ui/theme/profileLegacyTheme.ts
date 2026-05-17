/**
 * Legacy Profile-screen theme shim. Same pattern as
 * `workoutsLegacyTheme` — re-exports the V1 schema (`Colors / Spacing
 * / BorderRadius / Shadows / Typography`) so the Profile presenter
 * ports verbatim from `persistence-mobile/app/(tabs)/profile.tsx`
 * with only its import path swapped.
 *
 * Do not use outside `ui/presenters/ProfilePresenter.tsx` or
 * `ui/containers/ProfileContainer.tsx`. Other surfaces should consume
 * the Tamagui token system (`@/ui/theme/tokens`).
 */
import {
  Colors as HomeColors,
  Spacing as HomeSpacing,
  BorderRadius as HomeBorderRadius,
  Shadows as HomeShadows,
  Typography as HomeTypography,
} from "./homeLegacyTheme";

export const Colors = HomeColors;
export const Spacing = HomeSpacing;
export const BorderRadius = HomeBorderRadius;
export const Shadows = HomeShadows;
export const Typography = HomeTypography;
