import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { colorPalette } from "@/ui/theme/tokens";
import { P_LOGO_PATHS } from "./brand/pLogoPaths";

const AnimatedPath = Animated.createAnimatedComponent(Path);

// The 4 shapes of the custom P logo, shared with the static `PLogoMark`.
const [P1, P2, P3, P4] = P_LOGO_PATHS;

// Rough stroke lengths — tweak visually if needed
const PATH_LENGTH_1 = 2600;
const PATH_LENGTH_2 = 1200;
const PATH_LENGTH_3 = 1000;
const PATH_LENGTH_4 = 700;
const STROKE_WIDTH = 5;

type PLogoDrawLoaderProps = {
  size?: number;
  color?: string;
  testID?: string;
  /** Outer breathing room. Set to 0 when the loader sits inside a button/row. */
  containerPadding?: number;
  accessibilityLabel?: string;
  /** Disable when an enclosing progress region already describes the state. */
  accessible?: boolean;
};

export function PLogoDrawLoader({
  size = 220,
  color = colorPalette.primary500,
  testID = "logo-loader",
  containerPadding = 20,
  accessibilityLabel = "Loading",
  accessible = true,
}: PLogoDrawLoaderProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, {
        duration: 2000,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      false, // restart from 0 each time
    );
  }, [progress]);

  const p1StrokeProps = useAnimatedProps(() => {
    const local = interpolate(
      progress.value,
      [0, 0.4],
      [0, 1],
      Extrapolation.CLAMP,
    );
    return { strokeDashoffset: (1 - local) * PATH_LENGTH_1 };
  });

  const p2StrokeProps = useAnimatedProps(() => {
    const local = interpolate(
      progress.value,
      [0.25, 0.65],
      [0, 1],
      Extrapolation.CLAMP,
    );
    return { strokeDashoffset: (1 - local) * PATH_LENGTH_2 };
  });

  const p3StrokeProps = useAnimatedProps(() => {
    const local = interpolate(
      progress.value,
      [0.45, 0.85],
      [0, 1],
      Extrapolation.CLAMP,
    );
    return { strokeDashoffset: (1 - local) * PATH_LENGTH_3 };
  });

  const p4StrokeProps = useAnimatedProps(() => {
    const local = interpolate(
      progress.value,
      [0.6, 1],
      [0, 1],
      Extrapolation.CLAMP,
    );
    return { strokeDashoffset: (1 - local) * PATH_LENGTH_4 };
  });

  const resolvedSize = Number.isFinite(size) && size > 0 ? size : 1;
  const resolvedPadding =
    Number.isFinite(containerPadding) && containerPadding > 0
      ? containerPadding
      : 0;
  const containerSize = resolvedSize + resolvedPadding * 2;
  // Keep the drawn P legible at compact button/row sizes. SVG strokes are in
  // view-box units, so a fixed value becomes sub-pixel below ~64 display px.
  const strokeWidth = Math.max(STROKE_WIDTH, 1024 / resolvedSize);

  return (
    <View
      style={[
        styles.container,
        { width: containerSize, height: containerSize },
      ]}
      testID={testID}
      accessible={accessible}
      accessibilityRole={accessible ? "progressbar" : undefined}
      accessibilityLabel={accessible ? accessibilityLabel : undefined}
      accessibilityElementsHidden={!accessible}
      importantForAccessibility={accessible ? "yes" : "no-hide-descendants"}
    >
      <Svg width={resolvedSize} height={resolvedSize} viewBox="0 0 1024 1024">
        <AnimatedPath
          d={P1.d}
          transform={P1.transform}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={PATH_LENGTH_1}
          animatedProps={p1StrokeProps}
        />
        <AnimatedPath
          d={P2.d}
          transform={P2.transform}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={PATH_LENGTH_2}
          animatedProps={p2StrokeProps}
        />
        <AnimatedPath
          d={P3.d}
          transform={P3.transform}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={PATH_LENGTH_3}
          animatedProps={p3StrokeProps}
        />
        <AnimatedPath
          d={P4.d}
          transform={P4.transform}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={PATH_LENGTH_4}
          animatedProps={p4StrokeProps}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: "center",
    alignItems: "center",
  },
});
