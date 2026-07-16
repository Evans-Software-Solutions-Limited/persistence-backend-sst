import type { ReactNode } from "react";
import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { useReducedMotionGate } from "@/ui/hooks/useReducedMotionGate";

/**
 * <Ring> + <MultiRing> — Apple-style activity rings.
 * Ports ~/Downloads/handoff/design-source/ui.jsx:31-80.
 * Implements 01-design-system/design.md § Foundation primitives #7 +
 * STORY-003 AC 3.5.
 *
 * The fill animates via Reanimated 3 `useAnimatedProps` on `strokeDasharray`
 * (800ms cubic-bezier 0.2,0.7,0.2,1). When reduce-motion is enabled the fill
 * jumps to its final state. Colours are concrete strings (SVG stroke doesn't
 * resolve Tamagui tokens); defaults are the resolved $primary / $surface3.
 */

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const FILL_DEFAULT = "#22D3EE"; // $primary
const TRACK_DEFAULT = "#232735"; // $surface3
const MULTI_TRACK_DEFAULT = "rgba(255,255,255,0.08)";
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export type RingProps = {
  /** 0..1. Clamped. */
  pct: number;
  /** Diameter. Default 80. */
  size?: number;
  /** Stroke width. Default 9. */
  stroke?: number;
  /** Fill colour. Default resolved $primary. */
  color?: string;
  /** Track colour. Default resolved $surface3. */
  track?: string;
  /** Adds a drop-shadow glow on the fill. */
  glow?: boolean;
  /** Centre overlay (e.g. a <Stat> or % label). */
  children?: ReactNode;
  testID?: string;
  accessibilityLabel?: string;
};

/**
 * Animated single ring. One concentric circle pair (track + fill). Internal
 * to <Ring> and reused by <MultiRing> per ring.
 */
function AnimatedRingCircle({
  pct,
  size,
  stroke,
  color,
  track,
  radius,
}: {
  pct: number;
  size: number;
  stroke: number;
  color: string;
  track: string;
  radius: number;
}) {
  const circumference = 2 * Math.PI * radius;
  const target = clamp01(pct);
  const gate = useReducedMotionGate();
  const reduceMotion = gate.reduced;
  const progress = useSharedValue(reduceMotion ? target : 0);

  useEffect(() => {
    if (reduceMotion) {
      progress.value = target;
      return;
    }
    progress.value = withTiming(target, {
      duration: gate.ringFillMs,
      easing: Easing.bezier(0.2, 0.7, 0.2, 1),
    });
  }, [target, reduceMotion, gate.ringFillMs, progress]);

  const animatedProps = useAnimatedProps(() => {
    const dash = circumference * progress.value;
    return { strokeDasharray: `${dash} ${circumference - dash}` };
  });

  const center = size / 2;

  return (
    <>
      <Circle
        cx={center}
        cy={center}
        r={radius}
        stroke={track}
        strokeWidth={stroke}
        fill="none"
      />
      <AnimatedCircle
        cx={center}
        cy={center}
        r={radius}
        stroke={color}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        animatedProps={animatedProps}
        // initial dash so first paint isn't a full ring before the worklet runs
        strokeDasharray={`0 ${circumference}`}
      />
    </>
  );
}

export function Ring({
  pct,
  size = 80,
  stroke = 9,
  color = FILL_DEFAULT,
  track = TRACK_DEFAULT,
  glow = false,
  children,
  testID,
  accessibilityLabel,
}: RingProps) {
  const radius = (size - stroke) / 2;

  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{
        now: Math.round(clamp01(pct) * 100),
        min: 0,
        max: 100,
      }}
      style={[
        { width: size, height: size },
        glow
          ? {
              shadowColor: color,
              shadowOpacity: 0.6,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 0 },
              elevation: 6,
            }
          : null,
      ]}
    >
      <Svg
        width={size}
        height={size}
        style={{ transform: [{ rotate: "-90deg" }] }}
      >
        <AnimatedRingCircle
          pct={pct}
          size={size}
          stroke={stroke}
          color={color}
          track={track}
          radius={radius}
        />
      </Svg>
      {children !== undefined ? (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {children}
        </View>
      ) : null}
    </View>
  );
}

export type MultiRingSpec = {
  pct: number;
  color: string;
  track?: string;
};

export type MultiRingProps = {
  /** Diameter. Default 110. */
  size?: number;
  /** Stroke width. Default 11. */
  stroke?: number;
  /** Outer-first ring list. */
  rings: MultiRingSpec[];
  /** Glow on every ring. Default true. */
  glow?: boolean;
  /** Centre overlay. */
  children?: ReactNode;
  testID?: string;
  accessibilityLabel?: string;
};

/**
 * <MultiRing> — concentric activity rings (Apple-style), outer-first.
 * Each ring's radius steps inward by stroke + 3 (matches the prototype).
 */
export function MultiRing({
  size = 110,
  stroke = 11,
  rings,
  glow = true,
  children,
  testID,
  accessibilityLabel,
}: MultiRingProps) {
  const center = size / 2;

  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      style={[
        { width: size, height: size },
        glow && rings[0]
          ? {
              shadowColor: rings[0].color,
              shadowOpacity: 0.5,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 0 },
              elevation: 6,
            }
          : null,
      ]}
    >
      <Svg
        width={size}
        height={size}
        style={{ transform: [{ rotate: "-90deg" }] }}
      >
        {rings.map((ring, i) => {
          const radius = (size - stroke) / 2 - i * (stroke + 3);
          if (radius <= 0) return null;
          return (
            <AnimatedRingCircle
              key={i}
              pct={ring.pct}
              size={size}
              stroke={stroke}
              color={ring.color}
              track={ring.track ?? MULTI_TRACK_DEFAULT}
              radius={radius}
            />
          );
        })}
        {/* keep `center` referenced for parity with the prototype geometry */}
        <Circle cx={center} cy={center} r={0} stroke="transparent" />
      </Svg>
      {children !== undefined ? (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {children}
        </View>
      ) : null}
    </View>
  );
}
