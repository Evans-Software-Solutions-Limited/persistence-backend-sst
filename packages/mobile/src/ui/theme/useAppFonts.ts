// Loads Geist + Geist Mono via expo-font so Tamagui's `$display` / `$body` /
// `$mono` families resolve to the real typefaces on iOS + Android.
//
// Implements 01-design-system/requirements.md STORY-002 AC 2.1. The map keys
// here are the font face names referenced by `fonts.ts` `face` maps
// (Geist_400Regular, GeistMono_600SemiBold, …) and registered with the OS by
// expo-font's `useFonts`.

import {
  Geist_400Regular,
  Geist_400Regular_Italic,
  Geist_500Medium,
  Geist_500Medium_Italic,
  Geist_600SemiBold,
  Geist_600SemiBold_Italic,
  Geist_700Bold,
  Geist_700Bold_Italic,
  Geist_800ExtraBold,
  Geist_800ExtraBold_Italic,
  Geist_900Black,
  Geist_900Black_Italic,
} from "@expo-google-fonts/geist";
import {
  GeistMono_400Regular,
  GeistMono_400Regular_Italic,
  GeistMono_500Medium,
  GeistMono_500Medium_Italic,
  GeistMono_600SemiBold,
  GeistMono_600SemiBold_Italic,
} from "@expo-google-fonts/geist-mono";
import { useFonts } from "expo-font";

/**
 * The full Geist + Geist Mono face map loaded at app boot. Only the weights
 * the design system actually uses are bundled (display 400-900, mono 400-600)
 * to keep the bundle lean.
 */
export const APP_FONT_MAP = {
  // Geist (display + body)
  Geist_400Regular,
  Geist_400Regular_Italic,
  Geist_500Medium,
  Geist_500Medium_Italic,
  Geist_600SemiBold,
  Geist_600SemiBold_Italic,
  Geist_700Bold,
  Geist_700Bold_Italic,
  Geist_800ExtraBold,
  Geist_800ExtraBold_Italic,
  Geist_900Black,
  Geist_900Black_Italic,
  // Geist Mono (numerics)
  GeistMono_400Regular,
  GeistMono_400Regular_Italic,
  GeistMono_500Medium,
  GeistMono_500Medium_Italic,
  GeistMono_600SemiBold,
  GeistMono_600SemiBold_Italic,
} as const;

/**
 * Hook that loads the Geist typefaces. Returns `[loaded, error]` from
 * expo-font's `useFonts`. The root provider gates first paint on `loaded` (or
 * `error`, so a font-load failure still renders with the system fallback
 * rather than hanging on a blank screen).
 */
export function useAppFonts(): readonly [boolean, Error | null] {
  const [loaded, error] = useFonts(APP_FONT_MAP);
  return [loaded, error] as const;
}
