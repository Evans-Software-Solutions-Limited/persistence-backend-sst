/**
 * Legacy Subscription-screen theme shim.
 *
 * The M10 subscription components (cards, selection screen, management
 * screen, payment form, modals) are ported verbatim from
 * `persistence-mobile/components/subscription/*`,
 * `persistence-mobile/components/payment/*`, and
 * `persistence-mobile/app/(auth)/subscription-*`. Re-exports the
 * `Colors / Spacing / BorderRadius / Shadows / Typography` schema
 * legacy files import, backed by the V2 token system via
 * `homeLegacyTheme`. Same pattern M1 (Home) and M2 (Workouts) used.
 *
 * Do not use outside `ui/components/subscription/*`,
 * `ui/containers/Subscription*Container.tsx`, or
 * `ui/presenters/Subscription*Presenter.tsx`. Anywhere else should
 * consume the Tamagui token system (`@/ui/theme/tokens`).
 */
export {
  Colors,
  Spacing,
  BorderRadius,
  Shadows,
  Typography,
} from "./homeLegacyTheme";
