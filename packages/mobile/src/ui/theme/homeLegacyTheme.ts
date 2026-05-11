/**
 * Legacy Home-screen theme shim.
 *
 * The Home sections + tiles are ported verbatim from `persistence-mobile/
 * components/home/*` — their JSX + StyleSheet structure, spacing,
 * typography, shadows, and layout are the V1 design we've decided to
 * preserve. This module re-exports the `Colors / Spacing / BorderRadius /
 * Shadows / Typography` schema the legacy files imported, but backed by
 * V2 token values (cyan primary, warm-shifted darks, cooler semantic
 * colours) so the port can swap only the import path and keep the rest
 * of the StyleSheet code unchanged.
 *
 * Do not use outside `ui/components/home/*`. Anywhere else in the app
 * should consume the Tamagui token system (`@/ui/theme/tokens`).
 */
import { colorPalette } from "./tokens";

export const Colors = {
  primary: {
    light: colorPalette.primary300,
    DEFAULT: colorPalette.primary500,
    dark: colorPalette.primary700,
  },
  background: {
    primary: colorPalette.neutral1000,
    secondary: colorPalette.neutral950,
    tertiary: colorPalette.neutral900,
  },
  surface: {
    primary: colorPalette.neutral900,
    secondary: colorPalette.neutral800,
    tertiary: colorPalette.neutral800,
    border: colorPalette.neutral700,
  },
  text: {
    primary: colorPalette.neutral0,
    secondary: colorPalette.neutral300,
    tertiary: colorPalette.neutral500,
    inverse: colorPalette.black,
  },
  success: {
    light: colorPalette.successLight,
    DEFAULT: colorPalette.success,
    dark: colorPalette.successDark,
  },
  info: {
    light: colorPalette.infoLight,
    DEFAULT: colorPalette.info,
    dark: colorPalette.infoDark,
  },
  warning: {
    light: colorPalette.warningLight,
    DEFAULT: colorPalette.warning,
    dark: colorPalette.warningDark,
  },
  error: {
    light: colorPalette.errorLight,
    DEFAULT: colorPalette.error,
    dark: colorPalette.errorDark,
  },
} as const;

// Legacy spacing: xxs:2, xs:4, sm:8, md:16, lg:24, xl:32.
// V2 Tamagui tokens use md:12 — keep legacy values here so the ported
// StyleSheet spacing renders identically to the original app.
export const Spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  "2xl": 48,
} as const;

export const BorderRadius = {
  sm: 4,
  DEFAULT: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

export const Shadows = {
  small: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  medium: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  large: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  electric: {
    shadowColor: colorPalette.primary500,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  glow: {
    shadowColor: colorPalette.primary500,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 10,
  },
} as const;

export const Typography = {
  h1: {
    fontSize: 32,
    fontWeight: "700" as const,
    color: Colors.text.primary,
  },
  h2: {
    fontSize: 24,
    fontWeight: "600" as const,
    lineHeight: 32,
    color: Colors.text.primary,
  },
  h3: {
    fontSize: 20,
    fontWeight: "600" as const,
    lineHeight: 28,
    color: Colors.text.primary,
  },
  h4: {
    fontSize: 18,
    fontWeight: "600" as const,
    lineHeight: 24,
    color: Colors.text.primary,
  },
  body1: {
    fontSize: 16,
    fontWeight: "400" as const,
    lineHeight: 24,
    color: Colors.text.primary,
  },
  body2: {
    fontSize: 14,
    fontWeight: "400" as const,
    lineHeight: 20,
    color: Colors.text.secondary,
  },
  caption: {
    fontSize: 12,
    fontWeight: "400" as const,
    lineHeight: 16,
    color: Colors.text.tertiary,
  },
  button: {
    fontSize: 16,
    fontWeight: "600" as const,
    lineHeight: 20,
    color: Colors.text.primary,
  },
} as const;
