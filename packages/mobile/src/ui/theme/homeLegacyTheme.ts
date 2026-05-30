/**
 * Legacy Home-screen theme shim.
 *
 * The Home sections + tiles are ported verbatim from `persistence-mobile/
 * components/home/*` — their JSX + StyleSheet structure, spacing,
 * typography, shadows, and layout are the V1 design we've decided to
 * preserve. This module re-exports the `Colors / Spacing / BorderRadius /
 * Shadows / Typography` schema the legacy files imported.
 *
 * THEME-BRIDGE ADOPTION (requirements.md "Revised 2026-05-29"): the `Colors`
 * values are sourced from the **new** handoff palette (`color` from
 * `./tokens`), not the legacy `colorPalette`. The schema keys are unchanged,
 * so every legacy screen that imports any `*LegacyTheme` (all four re-export
 * this object) renders the refreshed brand — cyan #00D4FF->#22D3EE, the
 * warm-cool $bg/$surface/$text ramp, cooler semantic tones — with zero
 * screen-file edits and no layout change. RN StyleSheet consumes these
 * concrete hex/rgba values directly (Tamagui `$token` strings would not
 * resolve here). Deletion of this shim is M11 Polish (12-production-readiness).
 *
 * Do not use outside `ui/components/home/*`. Anywhere else in the app
 * should consume the Tamagui token system (`@/ui/theme/tokens`).
 */
import { color } from "./tokens";

export const Colors = {
  primary: {
    light: color.$primaryBright, // #67E8F9
    DEFAULT: color.$primary, // #22D3EE (was #00D4FF)
    dark: color.$primary7, // #0E7490
  },
  background: {
    primary: color.$bg, // #0A0B12
    secondary: color.$surface, // #12141D
    tertiary: color.$surface2, // #1A1D29
  },
  surface: {
    primary: color.$surface, // #12141D
    secondary: color.$surface2, // #1A1D29
    tertiary: color.$surface3, // #232735
    border: color.$surface3, // #232735 (solid, RN-border-safe)
  },
  text: {
    primary: color.$text, // #F4F4F8
    secondary: color.$text2, // #C2C2CE
    tertiary: color.$text3, // #8A8A98
    inverse: color.$bg, // #0A0B12
  },
  success: {
    light: "#86EFAC",
    DEFAULT: color.$success, // #34D399
    dark: "#16A34A",
  },
  info: {
    light: "#93C5FD",
    DEFAULT: color.$info, // #60A5FA
    dark: "#2563EB",
  },
  warning: {
    light: "#FCD34D",
    DEFAULT: color.$warning, // #FBBF24
    dark: "#D97706",
  },
  error: {
    light: "#FCA5A5",
    DEFAULT: color.$error, // #F87171
    dark: "#DC2626",
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
    shadowColor: color.$primary, // #22D3EE
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  glow: {
    shadowColor: color.$primary, // #22D3EE
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
