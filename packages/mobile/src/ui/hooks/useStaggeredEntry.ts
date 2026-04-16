import { useEffect } from "react";
import {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from "react-native-reanimated";

/** Stagger between sequential animation groups (ms) */
const STAGGER = 70;
/** Duration of each enter animation (ms) */
const ENTER_DURATION = 420;
/** Easing curve — fast attack, smooth deceleration */
const ENTER_EASING = Easing.out(Easing.cubic);

/**
 * Returns an animated style that fades in + slides up.
 * Use with Animated.View for staggered screen entrance animations.
 *
 * @param index — stagger group index (0-based). Higher = later entrance.
 */
export function useStaggeredEntry(index: number) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(18);

  useEffect(() => {
    const delay = index * STAGGER;
    opacity.value = withDelay(
      delay,
      withTiming(1, { duration: ENTER_DURATION, easing: ENTER_EASING }),
    );
    translateY.value = withDelay(
      delay,
      withTiming(0, { duration: ENTER_DURATION, easing: ENTER_EASING }),
    );
  }, [index, opacity, translateY]);

  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));
}
