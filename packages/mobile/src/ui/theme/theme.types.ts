export type ThemePreference = "system" | "dark" | "light";
export type EffectiveTheme = "dark" | "light";

export type ThemeContextValue = {
  themePreference: ThemePreference;
  setThemePreference: (preference: ThemePreference) => void;
  effectiveTheme: EffectiveTheme;
  isDark: boolean;
};
