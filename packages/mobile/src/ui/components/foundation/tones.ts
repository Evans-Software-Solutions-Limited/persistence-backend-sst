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
