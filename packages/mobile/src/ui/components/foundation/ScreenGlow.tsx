import { StyleSheet } from "react-native";
import { Defs, Ellipse, RadialGradient, Stop, Svg } from "react-native-svg";
import { color } from "@/ui/theme/tokens";

/**
 * <ScreenGlow> — the one screen background: a faint cyan glow at the top of
 * every phone, over `bg`. Canvas: `radial-gradient(90% 40% at 50% 12%,
 * primary 9%, transparent 70%)` ("Persistence — UX passes", 23 Oct 2026).
 * Absolute, behind the content, never interactive.
 */
export function ScreenGlow() {
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      width="100%"
      height="100%"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="screen-glow"
    >
      <Defs>
        <RadialGradient id="screen-glow" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color.$primary} stopOpacity={0.09} />
          <Stop offset="0.7" stopColor={color.$bg} stopOpacity={0} />
          <Stop offset="1" stopColor={color.$bg} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Ellipse cx="50%" cy="12%" rx="90%" ry="40%" fill="url(#screen-glow)" />
    </Svg>
  );
}
