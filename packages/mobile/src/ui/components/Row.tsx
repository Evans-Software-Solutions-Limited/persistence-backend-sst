import { styled, View } from "@tamagui/core";

export const Row = styled(View, {
  flexDirection: "row",
  alignItems: "center",

  variants: {
    gap: {
      xs: { gap: "$xs" },
      sm: { gap: "$sm" },
      md: { gap: "$md" },
      base: { gap: "$base" },
      lg: { gap: "$lg" },
      xl: { gap: "$xl" },
    },
    justify: {
      start: { justifyContent: "flex-start" },
      center: { justifyContent: "center" },
      end: { justifyContent: "flex-end" },
      between: { justifyContent: "space-between" },
      around: { justifyContent: "space-around" },
    },
    wrap: {
      true: { flexWrap: "wrap" },
    },
  } as const,
});
