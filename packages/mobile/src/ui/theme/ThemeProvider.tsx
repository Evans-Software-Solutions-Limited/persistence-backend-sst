import AsyncStorage from "@react-native-async-storage/async-storage";
import { TamaguiProvider } from "@tamagui/core";
import {
  type ReactNode,
  createContext,
  useCallback,
  useEffect,
  useState,
} from "react";
import { useColorScheme } from "react-native";

import config from "../../../tamagui.config";
import type {
  EffectiveTheme,
  ThemeContextValue,
  ThemePreference,
} from "./theme.types";
import { useAppFonts } from "./useAppFonts";

const STORAGE_KEY = "@persistence/theme-preference";

export const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolveTheme(
  preference: ThemePreference,
  systemScheme: string | null | undefined,
): EffectiveTheme {
  if (preference === "system") {
    return systemScheme === "light" ? "light" : "dark";
  }
  return preference;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [themePreference, setThemePreferenceState] =
    useState<ThemePreference>("dark");

  // Load Geist + Geist Mono before first paint so numerics render in the mono
  // typeface from the start (STORY-002 AC 2.1). On load failure we still
  // render — Tamagui falls back to the system font rather than hanging.
  const [fontsLoaded, fontError] = useAppFonts();

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === "dark" || stored === "light" || stored === "system") {
          setThemePreferenceState(stored);
        }
      })
      .catch(() => {
        // Fall back to system theme if storage read fails
      });
  }, []);

  const setThemePreference = useCallback((preference: ThemePreference) => {
    setThemePreferenceState(preference);
    AsyncStorage.setItem(STORAGE_KEY, preference);
  }, []);

  const effectiveTheme = resolveTheme(themePreference, systemScheme);
  const isDark = effectiveTheme === "dark";

  // Hold first paint until fonts resolve (or error out). Returning null keeps
  // the native splash visible; never block indefinitely on a font failure.
  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <ThemeContext.Provider
      value={{ themePreference, setThemePreference, effectiveTheme, isDark }}
    >
      <TamaguiProvider config={config} defaultTheme={effectiveTheme}>
        {children}
      </TamaguiProvider>
    </ThemeContext.Provider>
  );
}
