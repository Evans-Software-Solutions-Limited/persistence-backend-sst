import { styled, View, Text as TamaguiText } from "@tamagui/core";
import { Image } from "expo-image";

const AvatarFrame = styled(View, {
  borderRadius: "$full",
  overflow: "hidden",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "$primary",

  variants: {
    size: {
      sm: { width: 32, height: 32 },
      md: { width: 44, height: 44 },
      lg: { width: 64, height: 64 },
    },
  } as const,

  defaultVariants: {
    size: "md",
  },
});

const InitialsText = styled(TamaguiText, {
  fontFamily: "$body",
  fontWeight: "600",
  color: "$colorInverse",

  variants: {
    size: {
      sm: { fontSize: 12 },
      md: { fontSize: 16 },
      lg: { fontSize: 24 },
    },
  } as const,

  defaultVariants: {
    size: "md",
  },
});

type AvatarSize = "sm" | "md" | "lg";

type AvatarProps = {
  source?: string;
  fallback: string;
  size?: AvatarSize;
  testID?: string;
};

const imageSizes: Record<AvatarSize, number> = {
  sm: 32,
  md: 44,
  lg: 64,
};

/**
 * @deprecated Legacy avatar (image/initials). New screen work should use the
 * design-system primitive `@/ui/components/foundation/Avatar` (gradient
 * initials, status dot, COACH badge, pressable + a11y, 44pt hitSlop). Retired
 * in M11 Polish (12-production-readiness).
 */
export function Avatar({ source, fallback, size = "md", testID }: AvatarProps) {
  return (
    <AvatarFrame
      size={size}
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel={fallback}
    >
      {source ? (
        <Image
          source={{ uri: source }}
          style={{
            width: imageSizes[size],
            height: imageSizes[size],
          }}
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
          testID={testID ? `${testID}-image` : undefined}
        />
      ) : (
        <InitialsText size={size}>{fallback}</InitialsText>
      )}
    </AvatarFrame>
  );
}
