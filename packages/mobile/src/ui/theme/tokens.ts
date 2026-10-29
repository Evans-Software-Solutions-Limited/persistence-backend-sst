// Persistence — Tamagui token export
//
// Canonical token surface, dropped in verbatim from the May 2026 design
// package (`~/Downloads/handoff/tokens.tamagui.ts`). Implements
// `01-design-system/requirements.md` STORY-001 AC 1.1 + design.md
// § "Token reference".
//
// All colors verified WCAG AA on $bg #0A0B12. Contrast ratios noted next
// to each (mirrors the inline notes in the handoff file).
//
// Coexistence note (requirements.md "Revised 2026-05-29"): the legacy
// `colorPalette` const and the legacy numeric space/size/radius keys are
// preserved additively below so existing screens keep rendering until the
// STORY-006 codemod + STORY-007 adoption sweep retire their consumers.
// Deletion is M11 Polish (`12-production-readiness`). `createTokens` strips
// the leading `$` from keys, so the handoff `$`-prefixed keys resolve as
// standard `$base` / `$primary` / … Tamagui references.

import { createTokens } from "@tamagui/core";

// ════════════════════════════════════════════════════════════
// HANDOFF TOKEN SURFACE (verbatim — values + contrast notes)
// ════════════════════════════════════════════════════════════

// ────────────────────────────────────────────────────────────
// COLOR
// ────────────────────────────────────────────────────────────
export const color = {
  // ── Background & surfaces (warm-cool dark)
  $bg: "#0A0B12",
  $surface: "#12141D", // base card
  $surface2: "#1A1D29", // elevated card
  $surface3: "#232735", // input fields, drawer
  $surface4: "#2D3243", // modal headers
  $surface5: "#3A4055", // overlays

  // ── Text
  $text: "#F4F4F8", // 17.8:1
  $text2: "#C2C2CE", //  9.4:1 — primary secondary
  $text3: "#8A8A98", //  4.8:1 — stat labels (AA)
  $text4: "#5C5C68", // disabled
  $text5: "#383841",

  // ── Borders
  $border: "rgba(255,255,255,0.06)",
  $border2: "rgba(255,255,255,0.10)",
  $border3: "rgba(255,255,255,0.16)",

  // ── Primary (refined aqua-cyan)
  $primary: "#22D3EE", // 10.1:1 — passes AAA
  $primaryBright: "#67E8F9", // 12.5:1 — loud variant for highlights
  $primary7: "#0E7490", // pressed/depth
  $primaryGlow: "rgba(34,211,238,0.22)",
  $primaryDim: "rgba(34,211,238,0.10)",
  $primaryInk: "#042F39", // text on solid primary

  // ── Gold (achievements, PRs, milestones)
  $gold: "#F5C518", // 11.2:1
  $goldBright: "#FCD34D",
  $gold7: "#B45309",
  $goldGlow: "rgba(245,197,24,0.20)",
  $goldDim: "rgba(245,197,24,0.10)",
  $goldInk: "#2A1F00",

  // ── Trainer accent (coach mode only)
  $accentTrainer: "#A78BFA", // 7.4:1
  $accentTrainerBright: "#C4B5FD",
  $accentTrainer7: "#6D28D9",
  $accentTrainerGlow: "rgba(167,139,250,0.22)",
  $accentTrainerDim: "rgba(167,139,250,0.10)",
  $accentTrainerInk: "#1E1B4B",

  // ── Ember (energy / calorie / strain)
  $ember: "#FB923C", //  8.6:1
  $emberGlow: "rgba(251,146,60,0.20)",
  $emberDim: "rgba(251,146,60,0.10)",

  // ── Semantic
  $success: "#34D399", // 10.3:1
  $successDim: "rgba(52,211,153,0.12)",
  $warning: "#FBBF24",
  $error: "#F87171",
  $errorDim: "rgba(248,113,113,0.12)",
  $info: "#60A5FA",
} as const;

// ────────────────────────────────────────────────────────────
// SPACE — used as padding/margin/gap
// ────────────────────────────────────────────────────────────
export const space = {
  $xxs: 2,
  $xs: 4,
  $sm: 8,
  $md: 12,
  $base: 16,
  $lg: 20,
  $xl: 24,
  $2xl: 32,
  $3xl: 48,
  $4xl: 64,
} as const;

// ────────────────────────────────────────────────────────────
// SIZE — explicit dimension tokens
// ────────────────────────────────────────────────────────────
export const size = {
  ...space,
  // Touch-target floor — 44 = Apple HIG, 48 = Material
  $touchTarget: 44,
  $tabBarHeight: 72,
  $headerHeight: 54,
  $bottomPadding: 140, // standard scroll bottom-pad so tab bar doesn't cover content
} as const;

// ────────────────────────────────────────────────────────────
// RADIUS
// ────────────────────────────────────────────────────────────
export const radius = {
  $sm: 6,
  $md: 10,
  $lg: 14,
  $xl: 20,
  $2xl: 28,
  $pill: 9999,
} as const;

// ────────────────────────────────────────────────────────────
// Z-INDEX
// ────────────────────────────────────────────────────────────
export const zIndex = {
  $0: 0,
  $sticky: 10,
  $tabBar: 40,
  $modal: 90,
  $drawer: 100,
  $sheet: 120,
  $toast: 200,
} as const;

// ────────────────────────────────────────────────────────────
// FONTS — see fonts.ts for the full Geist Tamagui font definition
// ────────────────────────────────────────────────────────────
export const fonts = {
  display: {
    family: "Geist",
    weight: {
      "4": "400",
      "5": "500",
      "6": "600",
      "7": "700",
      "8": "800",
      "9": "900",
    },
    letterSpacing: {
      tight: "-0.04em",
      snug: "-0.03em",
      normal: "-0.02em",
      wide: "0",
      eyebrow: "0.16em",
    },
    size: {
      xs: 10.5,
      sm: 12,
      md: 14,
      lg: 16,
      xl: 18,
      "2xl": 22,
      "3xl": 24,
      "4xl": 32,
      "5xl": 44,
    },
  },
  body: {
    family: "Geist",
    weight: { "4": "400", "5": "500", "6": "600" },
    size: { xs: 11, sm: 12, md: 13, lg: 14, xl: 16 },
    lineHeight: { tight: 1.25, normal: 1.45, relaxed: 1.55 },
  },
  mono: {
    family: "Geist Mono",
    weight: { "4": "400", "5": "500", "6": "600" },
    size: { xs: 10, sm: 11, md: 13, lg: 16, xl: 20, "2xl": 28, "3xl": 40 },
    features: ["tnum", "zero"], // tabular figures + slashed zero, mandatory for stats
  },
} as const;

// ────────────────────────────────────────────────────────────
// SHADOW — focused; over-using shadows feels AI-templated
// ────────────────────────────────────────────────────────────
export const shadow = {
  card: "0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px rgba(0,0,0,0.4)",
  glowPrimary: "0 0 24px rgba(34,211,238,0.35)",
  glowGold: "0 0 24px rgba(245,197,24,0.30)",
  glowTrainer: "0 0 24px rgba(167,139,250,0.30)",
  sheet: "0 -20px 60px rgba(0,0,0,0.5)",
} as const;

// ════════════════════════════════════════════════════════════
// LEGACY SURFACE (preserved additively — retired in M11 Polish)
// ════════════════════════════════════════════════════════════

/**
 * Legacy numbered colour scale. Consumed as plain JavaScript by a handful
 * of in-tree files (`ErrorBoundary`, `PLogoDrawLoader`, `HomePresenter`,
 * `ActiveSessionBanner`) and by `themes.ts`. Kept until the STORY-006 codemod
 * + STORY-007 adoption sweep retire every consumer.
 *
 * @deprecated Use the semantic `$`-prefixed tokens above. Removal tracked in
 * `12-production-readiness` (M11 Polish).
 */
export const colorPalette = {
  // Primary — Electric Cyan
  primary50: "#E0F7FF",
  primary100: "#B3ECFF",
  primary200: "#80DFFF",
  primary300: "#4DD2FF",
  primary400: "#26C9FF",
  primary500: "#00D4FF",
  primary600: "#00B8DB",
  primary700: "#009AB7",
  primary800: "#007C93",
  primary900: "#0088A3",

  // Secondary — Gold (PRs, achievements)
  gold50: "#FFF8E1",
  gold100: "#FFECB3",
  gold200: "#FFE082",
  gold300: "#FFD54F",
  gold400: "#FFCA28",
  gold500: "#FFD700",
  gold600: "#FFC107",
  gold700: "#FFB300",
  gold800: "#FFA000",
  gold900: "#FF8F00",

  // Neutral — Warm-shifted darks
  neutral0: "#FFFFFF",
  neutral50: "#F5F5F7",
  neutral100: "#E8E8EC",
  neutral200: "#D1D1D8",
  neutral300: "#B3B3BD",
  neutral400: "#8E8E9A",
  neutral500: "#6B6B78",
  neutral600: "#4A4A56",
  neutral700: "#32323A",
  neutral800: "#282830",
  neutral900: "#1E1E26",
  neutral950: "#121216",
  neutral1000: "#0A0A0F",

  // Semantic
  success: "#22C55E",
  successLight: "#86EFAC",
  successDark: "#16A34A",
  warning: "#F59E0B",
  warningLight: "#FCD34D",
  warningDark: "#D97706",
  error: "#EF4444",
  errorLight: "#FCA5A5",
  errorDark: "#DC2626",
  info: "#00D4FF",
  infoLight: "#80DFFF",
  infoDark: "#0088A3",

  // Base
  white: "#FFFFFF",
  black: "#000000",
  transparent: "transparent",
} as const;

/**
 * Legacy numeric space/radius/zIndex keys (bare-keyed) that existing
 * components reference (`$base`, `$full`, `$0`, `true`, …). Merged into
 * `createTokens` below alongside the handoff scale. Retired in M11 Polish
 * once the adoption sweep removes consumers.
 *
 * NOTE (PR #83 review): the size group intentionally does NOT re-add the
 * numeric scale (`xs/sm/md/lg/xl/2xl/3xl`). The handoff `size` group already
 * provides those (via `...space`), and re-adding the legacy values here would
 * silently shadow the handoff scale (e.g. `size.sm` 8 → 32). No component
 * references those keys as a `size`-group dimension (verified), so only the
 * touch-target back-compat aliases (`true`/`0`) are kept.
 */
const legacySpace = {
  0: 0,
  true: 16,
} as const;

const legacySize = {
  0: 0,
  true: 44,
} as const;

const legacyRadius = {
  0: 0,
  full: 9999,
  true: 8,
} as const;

const legacyZIndex = {
  1: 100,
  2: 200,
  3: 300,
  4: 400,
  5: 500,
} as const;

// ════════════════════════════════════════════════════════════
// COMBINED EXPORT
// ════════════════════════════════════════════════════════════
//
// Handoff tokens are canonical; legacy keys are merged additively. The size
// group keeps ONLY the handoff scale (xs/sm/md/lg/xl/2xl/3xl from `...space`,
// plus `$touchTarget` etc.) — the legacy numeric overrides were removed so
// `size.sm` etc. match the handoff scale and don't diverge from `space.sm`
// (PR #83 review fix). Dimensions in the design system use `$touchTarget` or
// numeric props; spacing uses the `space` group.
export const tokens = createTokens({
  color: { ...color, ...colorPalette },
  space: { ...space, ...legacySpace },
  size: { ...size, ...legacySize },
  radius: { ...radius, ...legacyRadius },
  zIndex: { ...zIndex, ...legacyZIndex },
});
