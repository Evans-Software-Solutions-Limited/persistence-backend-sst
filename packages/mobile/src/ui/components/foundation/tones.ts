// Shared tone → token mapping for the foundation primitives.
//
// The prototype JSX addresses colours as CSS vars like `var(--primary)`,
// `var(--primary-dim)`, `var(--trainer)`. Our Tamagui token surface names the
// coach accent `accentTrainer` (not `trainer`), so primitives can't naively
// interpolate `$${tone}`. This module is the single source of truth that maps
// a semantic tone to its concrete token references for each treatment
// (solid / dim / glow / ink / depth / bright).
//
// Implements the tone palettes referenced across 01-design-system/design.md
// § Foundation primitives (Card accent, Btn variant×tone, Pill, IconBtn, …).

/** Full 6-tone palette shared by Btn, Card accent, IconBtn, etc. */
export type Tone =
  | "primary"
  | "gold"
  | "trainer"
  | "ember"
  | "success"
  | "error";

/** Pill / IconBtn add a `neutral` (and IconBtn a `ghost`) option. */
export type PillTone = Tone | "neutral";

type ToneTokens = {
  /** Solid fill / foreground accent. */
  base: string;
  /** Loud highlight variant (falls back to base where no Bright token). */
  bright: string;
  /** Pressed / depth shade (falls back to base where no 7 token). */
  depth: string;
  /** Soft fill background (10-12% alpha). */
  dim: string;
  /** Outer glow (20-22% alpha). */
  glow: string;
  /** Readable ink colour on a solid fill of `base`. */
  ink: string;
};

/**
 * Tone → concrete token reference map. Values are Tamagui token strings
 * (`$primary`, `$accentTrainerDim`, …) resolvable in any style prop.
 *
 * Note `trainer` maps to the `$accentTrainer*` family (coach-mode accent).
 * `ember` / `success` / `error` reuse `base`/`$text`/`$bg` for the depth/ink
 * slots the handoff palette doesn't define a dedicated token for.
 */
export const TONE_TOKENS: Record<Tone, ToneTokens> = {
  primary: {
    base: "$primary",
    bright: "$primaryBright",
    depth: "$primary7",
    dim: "$primaryDim",
    glow: "$primaryGlow",
    ink: "$primaryInk",
  },
  gold: {
    base: "$gold",
    bright: "$goldBright",
    depth: "$gold7",
    dim: "$goldDim",
    glow: "$goldGlow",
    ink: "$goldInk",
  },
  trainer: {
    base: "$accentTrainer",
    bright: "$accentTrainerBright",
    depth: "$accentTrainer7",
    dim: "$accentTrainerDim",
    glow: "$accentTrainerGlow",
    ink: "$accentTrainerInk",
  },
  ember: {
    base: "$ember",
    bright: "$ember",
    depth: "$ember",
    dim: "$emberDim",
    glow: "$emberGlow",
    ink: "$bg",
  },
  success: {
    base: "$success",
    bright: "$success",
    depth: "$success",
    dim: "$successDim",
    glow: "$successDim",
    ink: "$bg",
  },
  error: {
    base: "$error",
    bright: "$error",
    depth: "$error",
    dim: "$errorDim",
    glow: "$errorDim",
    ink: "$bg",
  },
};

/** Resolve a tone to its token bundle. */
export function toneTokens(tone: Tone): ToneTokens {
  return TONE_TOKENS[tone];
}

/**
 * Tone → **concrete** colour values (hex / rgba), for non-Tamagui consumers
 * that can't resolve `$token` strings: react-native-svg (lucide icon `color`),
 * `@gorhom/bottom-sheet` style props, `ActivityIndicator`, `LinearGradient`,
 * RN `StyleSheet`. Mirrors the handoff palette in `theme/tokens.ts` verbatim.
 *
 * Use `toneHex(tone)` when passing a tone colour into one of those consumers;
 * use `toneTokens(tone)` (token strings) for Tamagui style props.
 */
export const TONE_HEX: Record<
  Tone,
  { base: string; ink: string; dim: string; glow: string }
> = {
  primary: {
    base: "#22D3EE",
    ink: "#042F39",
    dim: "rgba(34,211,238,0.10)",
    glow: "rgba(34,211,238,0.22)",
  },
  gold: {
    base: "#F5C518",
    ink: "#2A1F00",
    dim: "rgba(245,197,24,0.10)",
    glow: "rgba(245,197,24,0.20)",
  },
  trainer: {
    base: "#A78BFA",
    ink: "#1E1B4B",
    dim: "rgba(167,139,250,0.10)",
    glow: "rgba(167,139,250,0.22)",
  },
  ember: {
    base: "#FB923C",
    ink: "#0A0B12",
    dim: "rgba(251,146,60,0.10)",
    glow: "rgba(251,146,60,0.20)",
  },
  success: {
    base: "#34D399",
    ink: "#0A0B12",
    dim: "rgba(52,211,153,0.12)",
    glow: "rgba(52,211,153,0.12)",
  },
  error: {
    base: "#F87171",
    ink: "#0A0B12",
    dim: "rgba(248,113,113,0.12)",
    glow: "rgba(248,113,113,0.12)",
  },
};

/** Resolve a tone to its concrete colour values for non-Tamagui consumers. */
export function toneHex(tone: Tone): {
  base: string;
  ink: string;
  dim: string;
  glow: string;
} {
  return TONE_HEX[tone];
}

/** Concrete neutral/text colours for non-Tamagui consumers (icons, RN style). */
export const NEUTRAL_HEX = {
  text2: "#C2C2CE",
  text3: "#8A8A98",
  primary: "#22D3EE",
} as const;
