import { styled, Text as TamaguiText } from "@tamagui/core";

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
