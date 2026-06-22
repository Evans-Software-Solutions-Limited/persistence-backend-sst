import { Text, View } from "@tamagui/core";
import Svg, { Circle } from "react-native-svg";

/**
 * <DonutMini> — small segmented donut for the Coach You client-health summary.
 * Ports the prototype's `DonutMini` (design-source/screens/coach.jsx:162-191).
 *
 * No donut primitive exists (`Ring` is a single animated arc), so this is a
 * static multi-segment donut: each segment is a circle with a
 * strokeDasharray/strokeDashoffset slice, drawn clockwise from 12 o'clock
 * (the Svg is rotated -90deg, matching the prototype). Centre overlays the
 * total + a "CLIENTS" eyebrow.
 *
 * Colours are concrete hex (react-native-svg can't resolve Tamagui tokens),
 * matching the prototype's success / gold / ember palette.
 */

export type DonutSegment = {
  /** Concrete colour (success / gold / ember hex). */
  color: string;
  count: number;
};

export type DonutMiniProps = {
  total: number;
  segments: DonutSegment[];
  size?: number;
  stroke?: number;
  testID?: string;
};

const TRACK_COLOR = "#232735"; // $surface3

/**
 * Compute each segment's `[dash, gap, offset]` for a circle of circumference
 * `c`. Exported pure for unit testing the segment math.
 *
 * `frac = count / total`; `dash = c * frac`; the running `offset` advances by
 * each prior segment's dash (negated for SVG's clockwise convention after the
 * -90deg rotation). When `total <= 0` every segment is zero-length (avoids a
 * divide-by-zero rendering a full ring on an empty practice).
 */
export function computeDonutSegments(
  total: number,
  segments: DonutSegment[],
  circumference: number,
): { dash: number; gap: number; offset: number }[] {
  let offset = 0;
  return segments.map((s) => {
    const frac = total > 0 ? s.count / total : 0;
    const dash = circumference * frac;
    const node = { dash, gap: circumference - dash, offset: -offset };
    offset += dash;
    return node;
  });
}

export function DonutMini({
  total,
  segments,
  size = 86,
  stroke = 12,
  testID,
}: DonutMiniProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const center = size / 2;
  const computed = computeDonutSegments(total, segments, c);

  return (
    <View testID={testID} width={size} height={size} position="relative">
      <Svg
        width={size}
        height={size}
        style={{ transform: [{ rotate: "-90deg" }] }}
      >
        <Circle
          cx={center}
          cy={center}
          r={r}
          stroke={TRACK_COLOR}
          strokeWidth={stroke}
          fill="none"
        />
        {segments.map((s, i) => {
          const { dash, gap, offset } = computed[i];
          if (dash <= 0) return null;
          return (
            <Circle
              key={i}
              cx={center}
              cy={center}
              r={r}
              stroke={s.color}
              strokeWidth={stroke}
              fill="none"
              strokeDasharray={`${dash} ${gap}`}
              strokeDashoffset={offset}
            />
          );
        })}
      </Svg>
      <View
        position="absolute"
        top={0}
        left={0}
        right={0}
        bottom={0}
        alignItems="center"
        justifyContent="center"
      >
        <Text
          fontFamily="$mono"
          fontWeight="700"
          fontSize={20}
          color="$text"
          letterSpacing={-0.5}
        >
          {total}
        </Text>
        <Text
          fontFamily="$display"
          fontWeight="600"
          fontSize={8}
          letterSpacing={1.2}
          textTransform="uppercase"
          color="$text3"
        >
          Clients
        </Text>
      </View>
    </View>
  );
}
