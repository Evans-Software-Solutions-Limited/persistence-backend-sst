// Tamagui themes.
//
// V2 is dark-only (locked decision #6). The dark theme's semantic values are
// refreshed to the May 2026 handoff palette — this is where the brand-cyan
// shift (#00D4FF → #22D3EE, locked decision #1) and the surface/text ramp
// land, because Tamagui themes override tokens of the same name.
//
// The light theme is preserved structurally (post-launch consideration) so
// both themes expose the same key set; its accent is shifted to the new cyan
// to stay consistent with the brand.

import { color as t } from "./tokens";

const sharedTokens = {
  // Brand accents — refreshed to handoff palette
  primary: t.$primary, // #22D3EE (was #00D4FF)
  primaryLight: t.$primaryBright, // #67E8F9
  primaryDark: t.$primary7, // #0E7490
  secondary: t.$gold, // #F5C518
  secondaryLight: t.$goldBright, // #FCD34D
  secondaryDark: t.$gold7, // #B45309

  // Semantic — refreshed to handoff palette
  success: t.$success, // #34D399
  successLight: "#86EFAC",
  successDark: "#16A34A",
  warning: t.$warning, // #FBBF24
  warningLight: "#FCD34D",
  warningDark: "#D97706",
  error: t.$error, // #F87171
  errorLight: "#FCA5A5",
  errorDark: "#DC2626",
  info: t.$info, // #60A5FA
  infoLight: "#80DFFF",
  infoDark: "#0088A3",
};

export const darkTheme = {
  ...sharedTokens,

  // Backgrounds — handoff surface ramp
  background: t.$bg, // #0A0B12
  backgroundSecondary: t.$surface, // #12141D
  backgroundTertiary: t.$surface3, // #232735

  // Surfaces (tonal elevation — lighter = higher)
  surface: t.$surface, // #12141D
  surfaceSecondary: t.$surface2, // #1A1D29
  surfaceTertiary: t.$surface3, // #232735

  // Text — handoff text ramp
  color: t.$text, // #F4F4F8
  colorSecondary: t.$text2, // #C2C2CE
  colorMuted: t.$text3, // #8A8A98
  colorInverse: t.$bg, // #0A0B12

  // Borders — handoff border ramp
  borderColor: t.$border,
  borderColorFocus: t.$primary,
  borderColorError: t.$error,

  // Interactive states (cyan-tinted, refreshed to #22D3EE)
  backgroundHover: "rgba(34, 211, 238, 0.08)",
  backgroundPress: "rgba(34, 211, 238, 0.12)",
  backgroundFocus: "rgba(34, 211, 238, 0.16)",
  backgroundDisabled: "rgba(255, 255, 255, 0.08)",
  colorDisabled: t.$text4, // #5C5C68

  // Overlay
  overlay: "rgba(10, 11, 18, 0.8)",

  // Shadows
  shadowColor: "rgba(0, 0, 0, 0.4)",
  shadowColorFocus: "rgba(34, 211, 238, 0.25)",

  // Placeholder
  placeholderColor: t.$text3,
};

export const lightTheme = {
  ...sharedTokens,

  // Backgrounds
  background: "#F5F5F7",
  backgroundSecondary: "#FFFFFF",
  backgroundTertiary: "#E8E8EC",

  // Surfaces
  surface: "#FFFFFF",
  surfaceSecondary: "#F5F5F7",
  surfaceTertiary: "#E8E8EC",

  // Text
  color: "#0A0B12",
  colorSecondary: "#4A4A56",
  colorMuted: "#6B6B78",
  colorInverse: "#FFFFFF",

  // Borders
  borderColor: "#D1D1D8",
  borderColorFocus: t.$primary,
  borderColorError: t.$error,

  // Interactive states
  backgroundHover: "rgba(34, 211, 238, 0.06)",
  backgroundPress: "rgba(34, 211, 238, 0.10)",
  backgroundFocus: "rgba(34, 211, 238, 0.12)",
  backgroundDisabled: "rgba(0, 0, 0, 0.05)",
  colorDisabled: "#8E8E9A",

  // Overlay
  overlay: "rgba(0, 0, 0, 0.5)",

  // Shadows
  shadowColor: "rgba(0, 0, 0, 0.08)",
  shadowColorFocus: "rgba(34, 211, 238, 0.15)",

  // Placeholder
  placeholderColor: "#8E8E9A",
};

export const themes = {
  dark: darkTheme,
  light: lightTheme,
} as const;
