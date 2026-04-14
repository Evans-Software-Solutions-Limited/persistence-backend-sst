import { styled, View } from "@tamagui/core";

export const Spacer = styled(View, {
  variants: {
    flex: {
      true: { flex: 1 },
    },
    size: {
      xs: { width: "$xs", height: "$xs" },
      sm: { width: "$sm", height: "$sm" },
      md: { width: "$md", height: "$md" },
      base: { width: "$base", height: "$base" },
      lg: { width: "$lg", height: "$lg" },
      xl: { width: "$xl", height: "$xl" },
      "2xl": { width: "$2xl", height: "$2xl" },
    },
  } as const,

  defaultVariants: {
    flex: true,
  },
});
