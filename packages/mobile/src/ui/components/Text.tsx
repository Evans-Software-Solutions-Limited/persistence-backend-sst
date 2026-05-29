import { styled, Text as TamaguiText } from "@tamagui/core";

// React Native's `fontVariant` figure-style control. Geist Mono ships a
// slashed zero as its default glyph, so tabular-nums is all we apply here.
const STAT_FONT_VARIANT: ["tabular-nums"] = ["tabular-nums"];

export const Text = styled(TamaguiText, {
  color: "$color",
  fontFamily: "$body",

  variants: {
    variant: {
      h1: {
        fontSize: 32,
        lineHeight: 40,
        fontWeight: "700",
        letterSpacing: -0.5,
        fontFamily: "$heading",
      },
      h2: {
        fontSize: 24,
        lineHeight: 32,
        fontWeight: "700",
        letterSpacing: -0.4,
        fontFamily: "$heading",
      },
      h3: {
        fontSize: 20,
        lineHeight: 28,
        fontWeight: "600",
        letterSpacing: -0.3,
        fontFamily: "$heading",
      },
      h4: {
        fontSize: 18,
        lineHeight: 24,
        fontWeight: "600",
        letterSpacing: -0.2,
        fontFamily: "$heading",
      },
      body: {
        fontSize: 16,
        lineHeight: 24,
        fontWeight: "400",
      },
      bodySmall: {
        fontSize: 14,
        lineHeight: 20,
        fontWeight: "400",
      },
      caption: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "400",
      },
      label: {
        fontSize: 14,
        lineHeight: 20,
        fontWeight: "500",
      },
      // ── Numeric stat variants (01-design-system STORY-002 AC 2.3) ──
      // ALWAYS render in Geist Mono with tabular figures + slashed zero so
      // numbers don't visually bounce on update and zeros are unambiguous.
      // Sizes mirror the <Stat> primitive: md 20 / lg 28 / xl 40.
      "stat-md": {
        fontFamily: "$mono",
        fontSize: 20,
        lineHeight: 24,
        fontWeight: "600",
        fontVariant: STAT_FONT_VARIANT,
      },
      "stat-lg": {
        fontFamily: "$mono",
        fontSize: 28,
        lineHeight: 32,
        fontWeight: "600",
        fontVariant: STAT_FONT_VARIANT,
      },
      "stat-xl": {
        fontFamily: "$mono",
        fontSize: 40,
        lineHeight: 44,
        fontWeight: "700",
        fontVariant: STAT_FONT_VARIANT,
      },
    },
    secondary: {
      true: { color: "$colorSecondary" },
    },
    muted: {
      true: { color: "$colorMuted" },
    },
    align: {
      left: { textAlign: "left" },
      center: { textAlign: "center" },
      right: { textAlign: "right" },
    },
  } as const,

  defaultVariants: {
    variant: "body",
  },
});
