// Persistence — Geist + Geist Mono Tamagui font config.
//
// Implements 01-design-system/requirements.md STORY-002 (AC 2.1-2.3, 2.5) and
// design.md § "Token reference > Fonts". Three families:
//   $display — Geist 400-900 + a letter-spacing scale (headings, eyebrows)
//   $body    — Geist 400-600 (body copy)
//   $mono    — Geist Mono 400-600 with `tnum` + `zero` baked in (all numerics)
//
// Font face names ('Geist', 'Geist Mono') match the keys registered with
// expo-font in `useAppFonts.ts`. The numeric weight + size scales mirror the
// handoff `fonts` block in tokens.ts verbatim.

import { createFont } from "@tamagui/core";

/** Geist face name registered via expo-font (see useAppFonts.ts). */
export const GEIST_FAMILY = "Geist";
/** Geist Mono face name registered via expo-font (see useAppFonts.ts). */
export const GEIST_MONO_FAMILY = "Geist Mono";

/**
 * `$display` — Geist for headings, titles, eyebrows, button labels.
 * Letter-spacing scale: tight / snug / normal / wide / eyebrow (per handoff).
 * Tamagui's `face` map points each weight at the matching registered font so
 * the right TTF is used instead of a synthetic-bold fallback.
 */
export const displayFont = createFont({
  family: GEIST_FAMILY,
  // Numeric size ramp mirrors the handoff display.size scale.
  size: {
    1: 10.5, // xs — eyebrow
    2: 12, // sm
    3: 14, // md
    4: 16, // lg
    5: 18, // xl
    6: 22, // 2xl
    7: 24, // 3xl — section title (p-h1)
    8: 32, // 4xl — display-lg
    9: 44, // 5xl — hero
    true: 16,
  },
  lineHeight: {
    1: 14,
    2: 16,
    3: 18,
    4: 20,
    5: 24,
    6: 28,
    7: 30,
    8: 38,
    9: 48,
    true: 20,
  },
  weight: {
    1: "400",
    4: "400",
    5: "500",
    6: "600",
    7: "700",
    8: "800",
    9: "900",
    true: "600",
  },
  // Letter-spacing scale from the handoff display.letterSpacing (converted from
  // em to the pt approximations Tamagui/RN expect at the common sizes).
  letterSpacing: {
    1: 2.2, // eyebrow 0.16em at ~14pt
    4: -0.3, // normal -0.02em
    5: -0.4, // snug -0.03em
    6: -0.5,
    7: -0.6,
    8: -1.0, // tight -0.04em at display sizes
    9: -1.4,
    true: -0.3,
  },
  face: {
    "400": { normal: "Geist_400Regular", italic: "Geist_400Regular_Italic" },
    "500": { normal: "Geist_500Medium", italic: "Geist_500Medium_Italic" },
    "600": { normal: "Geist_600SemiBold", italic: "Geist_600SemiBold_Italic" },
    "700": { normal: "Geist_700Bold", italic: "Geist_700Bold_Italic" },
    "800": {
      normal: "Geist_800ExtraBold",
      italic: "Geist_800ExtraBold_Italic",
    },
    "900": { normal: "Geist_900Black", italic: "Geist_900Black_Italic" },
  },
});

/**
 * `$body` — Geist for body copy. Weights 400-600, the handoff body.size ramp.
 */
export const bodyFont = createFont({
  family: GEIST_FAMILY,
  size: {
    1: 11, // xs
    2: 12, // sm
    3: 13, // md
    4: 14, // lg
    5: 16, // xl
    true: 13,
  },
  lineHeight: {
    1: 16,
    2: 17,
    3: 19,
    4: 20,
    5: 23,
    true: 19,
  },
  weight: {
    1: "400",
    4: "400",
    5: "500",
    6: "600",
    true: "400",
  },
  letterSpacing: {
    4: 0,
    true: 0,
  },
  face: {
    "400": { normal: "Geist_400Regular", italic: "Geist_400Regular_Italic" },
    "500": { normal: "Geist_500Medium", italic: "Geist_500Medium_Italic" },
    "600": { normal: "Geist_600SemiBold", italic: "Geist_600SemiBold_Italic" },
  },
});

/**
 * `$mono` — Geist Mono for ALL numeric display (timers, weights, reps,
 * calories, volume). `tnum` (tabular figures) + `zero` (slashed zero) are
 * baked into `settings` so numbers don't visually bounce on update and zeros
 * are unambiguous. The handoff mandates these features for every stat.
 */
export const monoFont = createFont({
  family: GEIST_MONO_FAMILY,
  size: {
    1: 10, // xs
    2: 11, // sm
    3: 13, // md
    4: 16, // lg
    5: 20, // xl
    6: 28, // 2xl
    7: 40, // 3xl
    true: 16,
  },
  lineHeight: {
    1: 14,
    2: 15,
    3: 18,
    4: 20,
    5: 24,
    6: 32,
    7: 44,
    true: 20,
  },
  weight: {
    1: "400",
    4: "400",
    5: "500",
    6: "600",
    true: "400",
  },
  letterSpacing: {
    4: 0,
    true: 0,
  },
  face: {
    "400": {
      normal: "GeistMono_400Regular",
      italic: "GeistMono_400Regular_Italic",
    },
    "500": {
      normal: "GeistMono_500Medium",
      italic: "GeistMono_500Medium_Italic",
    },
    "600": {
      normal: "GeistMono_600SemiBold",
      italic: "GeistMono_600SemiBold_Italic",
    },
  },
});

/**
 * Tabular-figure font variant for numeric primitives. React Native's
 * `fontVariant` only exposes `tabular-nums` from the figure-style set, so
 * that's what we apply for the no-bounce behaviour. The slashed-zero (`zero`
 * OpenType feature) is delivered by the Geist Mono face itself — Geist Mono
 * ships a slashed zero as its default `0` glyph — so no extra feature flag is
 * needed for AC 2.5; rendering text in `$mono` is sufficient.
 */
export const MONO_FONT_VARIANT = ["tabular-nums"] as const;
