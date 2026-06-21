import Svg, {
  Path,
  Circle,
  Defs,
  LinearGradient,
  Stop,
} from "react-native-svg";
import { Text, View } from "@tamagui/core";
import { Card } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { computePath } from "./charts";

/**
 * <BodyTrendPresenter> — You/Progress body trends (06-progress-goals,
 * STORY-003 AC 3.4; progress.jsx:141–194). Two cards side-by-side: weight
 * SVG sparkline (area-fill + last dot) and a body-fat bar chart.
 */

export type TrendData = {
  current: number | null;
  delta: number; // signed (down is good)
  series: number[];
};

export type BodyTrendProps = {
  weight: TrendData & { unit: "kg" | "lb" };
  bodyFat: TrendData;
  testID?: string;
};

const W = 320;
const H = 80;
const PRIMARY = toneHex("primary").base;

function TrendHeader({
  label,
  value,
  unit,
  delta,
}: {
  label: string;
  value: number | null;
  unit: string;
  delta: number;
}) {
  const down = delta <= 0;
  return (
    <>
      <Text fontSize={10.5} fontWeight="600" letterSpacing={1.5} color="$text3">
        {label}
      </Text>
      <View flexDirection="row" alignItems="baseline" gap={4} marginTop={4}>
        <Text fontFamily="$mono" fontSize={20} fontWeight="600" color="$text">
          {value != null ? value.toFixed(1) : "--"}
        </Text>
        <Text fontFamily="$mono" fontSize={11} color="$text3">
          {unit}
        </Text>
      </View>
      <Text fontSize={11} marginTop={4} color={down ? "$success" : "$ember"}>
        {down ? "▼" : "▲"} {Math.abs(delta).toFixed(1)} {unit}
      </Text>
    </>
  );
}

export function BodyTrendPresenter({
  weight,
  bodyFat,
  testID = "body-trend",
}: BodyTrendProps) {
  const { line, area, lastPoint } = computePath(
    weight.series,
    { w: W, h: H },
    0.1,
  );

  const bfMin = bodyFat.series.length ? Math.min(...bodyFat.series) : 0;
  const bfMax = bodyFat.series.length ? Math.max(...bodyFat.series) : 1;
  const bfSpan = bfMax - bfMin || 1;

  return (
    <View flexDirection="row" gap={12} testID={testID}>
      <Card pad={14} radius={14} style={{ flex: 1 }}>
        <TrendHeader
          label="WEIGHT"
          value={weight.current}
          unit={weight.unit}
          delta={weight.delta}
        />
        {weight.series.length > 1 && (
          <Svg
            width="100%"
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            style={{ marginTop: 8 }}
          >
            <Defs>
              <LinearGradient id="bt-w" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={PRIMARY} stopOpacity={0.3} />
                <Stop offset="100%" stopColor={PRIMARY} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Path d={area} fill="url(#bt-w)" />
            <Path d={line} fill="none" stroke={PRIMARY} strokeWidth={2} />
            <Circle cx={lastPoint[0]} cy={lastPoint[1]} r={3} fill={PRIMARY} />
          </Svg>
        )}
      </Card>

      <Card pad={14} radius={14} style={{ flex: 1 }}>
        <TrendHeader
          label="BODY FAT"
          value={bodyFat.current}
          unit="%"
          delta={bodyFat.delta}
        />
        <View
          flexDirection="row"
          alignItems="flex-end"
          gap={3}
          height={H}
          marginTop={8}
        >
          {bodyFat.series.map((v, i) => (
            <View
              key={i}
              flex={1}
              height={`${Math.max(6, ((v - bfMin) / bfSpan) * 100)}%`}
              backgroundColor="$primaryDim"
              borderTopWidth={2}
              borderColor={PRIMARY}
              borderRadius={1}
            />
          ))}
        </View>
      </Card>
    </View>
  );
}
