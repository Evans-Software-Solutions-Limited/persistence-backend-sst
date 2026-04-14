import { styled, View, useTheme as useTamaguiTheme } from "@tamagui/core";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect } from "react";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

const SkeletonFrame = styled(View, {
  overflow: "hidden",
  backgroundColor: "$surfaceSecondary",

  variants: {
    variant: {
      text: {
        width: "100%",
        height: 16,
        borderRadius: "$sm",
      },
      circle: {
        width: 44,
        height: 44,
        borderRadius: "$full",
      },
      rect: {
        width: "100%",
        height: 100,
        borderRadius: "$md",
      },
    },
  } as const,

  defaultVariants: {
    variant: "rect",
  },
});

type SkeletonProps = {
  variant?: "text" | "circle" | "rect";
  width?: number | string;
  height?: number;
  testID?: string;
};

export function Skeleton({
  variant = "rect",
  width,
  height,
  testID,
}: SkeletonProps) {
  const theme = useTamaguiTheme();
  const translateX = useSharedValue(-1);

  useEffect(() => {
    translateX.value = withRepeat(withTiming(1, { duration: 1200 }), -1, false);
  }, [translateX]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value * 200 }],
  }));

  const surfaceColor = theme.surfaceSecondary?.val ?? "#282830";
  const shimmerColor = theme.surfaceTertiary?.val ?? "#32323A";

  return (
    <SkeletonFrame
      variant={variant}
      testID={testID}
      accessibilityLabel="Loading"
      {...(width !== undefined && { width })}
      {...(height !== undefined && { height })}
    >
      <Animated.View
        style={[
          {
            position: "absolute",
            top: 0,
            bottom: 0,
            left: -200,
            right: -200,
          },
          animatedStyle,
        ]}
      >
        <LinearGradient
          colors={[surfaceColor, shimmerColor, surfaceColor]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </SkeletonFrame>
  );
}
