import { colorPalette as c } from "./tokens";

const sharedTokens = {
  primary: c.primary500,
  primaryLight: c.primary300,
  primaryDark: c.primary700,
  secondary: c.gold500,
  secondaryLight: c.gold300,
  secondaryDark: c.gold700,
  success: c.success,
  successLight: c.successLight,
  successDark: c.successDark,
  warning: c.warning,
  warningLight: c.warningLight,
  warningDark: c.warningDark,
  error: c.error,
  errorLight: c.errorLight,
  errorDark: c.errorDark,
  info: c.info,
  infoLight: c.infoLight,
  infoDark: c.infoDark,
};

export const darkTheme = {
  ...sharedTokens,

  // Backgrounds
  background: c.neutral1000,
  backgroundSecondary: c.neutral950,
  backgroundTertiary: c.neutral700,

  // Surfaces (tonal elevation — lighter = higher)
  surface: c.neutral900,
  surfaceSecondary: c.neutral800,
  surfaceTertiary: c.neutral700,

  // Text
  color: c.white,
  colorSecondary: c.neutral300,
  colorMuted: c.neutral500,
  colorInverse: c.neutral1000,

  // Borders
  borderColor: c.neutral800,
  borderColorFocus: c.primary500,
  borderColorError: c.error,

  // Interactive states
  backgroundHover: "rgba(0, 212, 255, 0.08)",
  backgroundPress: "rgba(0, 212, 255, 0.12)",
  backgroundFocus: "rgba(0, 212, 255, 0.16)",
  backgroundDisabled: "rgba(255, 255, 255, 0.08)",
  colorDisabled: c.neutral600,

  // Overlay
  overlay: "rgba(10, 10, 15, 0.8)",

  // Shadows (used on light mode primarily; dark uses tonal elevation)
  shadowColor: "rgba(0, 0, 0, 0.3)",
  shadowColorFocus: "rgba(0, 212, 255, 0.25)",

  // Placeholder
  placeholderColor: c.neutral500,
};

export const lightTheme = {
  ...sharedTokens,

  // Backgrounds
  background: c.neutral50,
  backgroundSecondary: c.neutral0,
  backgroundTertiary: c.neutral100,

  // Surfaces
  surface: c.neutral0,
  surfaceSecondary: c.neutral50,
  surfaceTertiary: c.neutral100,

  // Text
  color: c.neutral1000,
  colorSecondary: c.neutral600,
  colorMuted: c.neutral500,
  colorInverse: c.white,

  // Borders
  borderColor: c.neutral200,
  borderColorFocus: c.primary500,
  borderColorError: c.error,

  // Interactive states
  backgroundHover: "rgba(0, 212, 255, 0.06)",
  backgroundPress: "rgba(0, 212, 255, 0.10)",
  backgroundFocus: "rgba(0, 212, 255, 0.12)",
  backgroundDisabled: "rgba(0, 0, 0, 0.05)",
  colorDisabled: c.neutral400,

  // Overlay
  overlay: "rgba(0, 0, 0, 0.5)",

  // Shadows
  shadowColor: "rgba(0, 0, 0, 0.08)",
  shadowColorFocus: "rgba(0, 212, 255, 0.15)",

  // Placeholder
  placeholderColor: c.neutral400,
};

export const themes = {
  dark: darkTheme,
  light: lightTheme,
} as const;
