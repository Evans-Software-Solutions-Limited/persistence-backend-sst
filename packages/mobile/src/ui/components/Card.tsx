import { styled, View } from "@tamagui/core";

export const Card = styled(View, {
  backgroundColor: "$surface",
  borderRadius: "$lg",
  padding: "$base",

  variants: {
    elevated: {
      true: {
        shadowColor: "$shadowColor",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 4,
      },
    },
    outlined: {
      true: {
        borderWidth: 1,
        borderColor: "$borderColor",
      },
    },
    pressable: {
      true: {
        pressStyle: { opacity: 0.85, scale: 0.99 },
      },
    },
  } as const,
});
