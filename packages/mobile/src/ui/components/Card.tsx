import { styled, View } from "@tamagui/core";

/**
 * @deprecated Legacy card. New screen work should use the design-system
 * primitive `@/ui/components/foundation/Card` (surface tiers, accent borders,
 * glow rings, pressable + a11y). This shim is retired in M11 Polish
 * (12-production-readiness) once no screen imports it.
 */
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
