import { styled, View } from "@tamagui/core";

export const Column = styled(View, {
  flexDirection: "column",

  variants: {
    gap: {
      xs: { gap: "$xs" },
      sm: { gap: "$sm" },
      md: { gap: "$md" },
      base: { gap: "$base" },
      lg: { gap: "$lg" },
      xl: { gap: "$xl" },
    },
    centered: {
      true: {
        alignItems: "center",
        justifyContent: "center",
      },
    },
  } as const,
});
