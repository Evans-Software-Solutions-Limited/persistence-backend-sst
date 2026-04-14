import { styled, View } from "@tamagui/core";

export const Divider = styled(View, {
  backgroundColor: "$borderColor",

  variants: {
    orientation: {
      horizontal: {
        height: 1,
        width: "100%",
      },
      vertical: {
        width: 1,
        height: "100%",
      },
    },
    spacing: {
      sm: { marginVertical: "$sm" },
      md: { marginVertical: "$md" },
      base: { marginVertical: "$base" },
      lg: { marginVertical: "$lg" },
      xl: { marginVertical: "$xl" },
    },
  } as const,

  defaultVariants: {
    orientation: "horizontal",
  },
});
