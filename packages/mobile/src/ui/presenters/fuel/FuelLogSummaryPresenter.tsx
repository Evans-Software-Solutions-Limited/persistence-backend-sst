import { Pressable } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { Text, View } from "@tamagui/core";
import { toneHex } from "@/ui/components/foundation/tones";
import { color } from "@/ui/theme/tokens";

/**
 * <FuelLogSummaryPresenter> — canvas N1 "compact rings" (PER-132, signed off
 * 18 Nov). A 96pt ring split by where the eaten calories came from (carbs ·
 * fat · protein, the canvas order), filled toward the target, with Left (or
 * Over) in the centre; three macro columns with "eaten / target g" and a bar;
 * then the Eaten · Target · Left strip.
 *
 * Pure: every number is a prop.
 */

/** Canvas macro colours (PER-66): protein green, carbs cyan, fat ember. */
export const MACRO_HEX = {
  protein: toneHex("success").base,
  carbs: toneHex("primary").base,
  fat: toneHex("ember").base,
} as const;

const OVER_HEX = toneHex("error").base;
const TRACK_HEX = color.$surface3;

export type MacroColumnVM = {
  label: "Protein" | "Carbs" | "Fat";
  eatenG: number;
  targetG: number;
  color: string;
};

export type FuelLogSummaryProps = {
  eatenKcal: number;
  targetKcal: number;
  eatenProteinG: number;
  eatenCarbsG: number;
  eatenFatG: number;
  macros: readonly MacroColumnVM[];
  /** No target set: the strip shows "—" and the target cell opens Targets. */
  noTarget: boolean;
  onOpenTargets: () => void;
  testID?: string;
};

const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");
const SIZE = 96;
const R = 40;
const C = 2 * Math.PI * R;
const R_OVER = 46;
const C_OVER = 2 * Math.PI * R_OVER;

/** The ring's coloured arcs: each macro's share of eaten kcal × fill. */
export function ringSegments(
  carbsG: number,
  fatG: number,
  proteinG: number,
  fill: number,
): { color: string; length: number; offset: number }[] {
  const kc = carbsG * 4;
  const kf = fatG * 9;
  const kp = proteinG * 4;
  const total = kc + kf + kp || 1;
  let start = 0;
  return (
    [
      [kc, MACRO_HEX.carbs],
      [kf, MACRO_HEX.fat],
      [kp, MACRO_HEX.protein],
    ] as const
  )
    .filter(([k]) => k > 0)
    .map(([k, color]) => {
      const span = (k / total) * fill * C;
      const seg = { color, length: Math.max(0, span - 1.5), offset: -start };
      start += span;
      return seg;
    });
}

export function FuelLogSummaryPresenter({
  eatenKcal,
  targetKcal,
  eatenProteinG,
  eatenCarbsG,
  eatenFatG,
  macros,
  noTarget,
  onOpenTargets,
  testID = "fuel-log-summary",
}: FuelLogSummaryProps) {
  const target = noTarget ? 0 : targetKcal;
  const over = target > 0 && eatenKcal > target;
  const fill = target > 0 ? Math.min(1, eatenKcal / target) : 0;
  const left = target - eatenKcal;
  const overFrac = over ? Math.min(1, (eatenKcal - target) / target) : 0;
  const segments = ringSegments(eatenCarbsG, eatenFatG, eatenProteinG, fill);
  const centre = noTarget ? "—" : over ? fmt(eatenKcal - target) : fmt(left);
  const centreLabel = over ? "Over" : "Left";
  const ringLabel = noTarget
    ? `${fmt(eatenKcal)} kcal eaten. No target set.`
    : `${fmt(eatenKcal)} of ${fmt(target)} kcal eaten. ${over ? `${fmt(eatenKcal - target)} over` : `${fmt(left)} left`}.`;

  return (
    <View testID={testID}>
      <View
        flexDirection="row"
        alignItems="center"
        gap={18}
        paddingTop={18}
        paddingBottom={14}
      >
        <View
          width={SIZE}
          height={SIZE}
          accessible
          accessibilityRole="image"
          accessibilityLabel={ringLabel}
          testID={`${testID}-ring`}
        >
          <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
            <G rotation={-90} origin={`${SIZE / 2}, ${SIZE / 2}`}>
              <Circle
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={R}
                stroke={TRACK_HEX}
                strokeWidth={8}
                fill="none"
              />
              {segments.map((s) => (
                <Circle
                  key={s.color}
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={R}
                  stroke={s.color}
                  strokeWidth={8}
                  fill="none"
                  strokeDasharray={`${s.length.toFixed(1)} ${C.toFixed(1)}`}
                  strokeDashoffset={s.offset}
                />
              ))}
              {over ? (
                <Circle
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={R_OVER}
                  stroke={OVER_HEX}
                  strokeWidth={3}
                  fill="none"
                  strokeDasharray={`${(overFrac * C_OVER).toFixed(1)} ${C_OVER.toFixed(1)}`}
                  testID={`${testID}-over`}
                />
              ) : null}
            </G>
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
              fontSize={20}
              fontWeight="700"
              color={over ? "$error" : "$text"}
              testID={`${testID}-centre`}
            >
              {centre}
            </Text>
            <Text
              fontFamily="$display"
              fontSize={9.5}
              fontWeight="600"
              letterSpacing={1.4}
              textTransform="uppercase"
              color="$text3"
            >
              {centreLabel}
            </Text>
          </View>
        </View>

        <View flex={1} flexDirection="row" gap={10}>
          {macros.map((m) => (
            <View
              key={m.label}
              flex={1}
              gap={3}
              testID={`fuel-macro-${m.label.toLowerCase()}`}
            >
              <Text
                fontFamily="$display"
                fontSize={10}
                fontWeight="600"
                letterSpacing={1.6}
                textTransform="uppercase"
                color={m.color}
              >
                {m.label}
              </Text>
              <Text fontFamily="$mono" fontSize={17} fontWeight="700">
                <Text color="$text">{fmt(m.eatenG)}</Text>
                <Text fontSize={11} fontWeight="500" color="$text3">
                  {noTarget ? " g" : ` / ${fmt(m.targetG)}g`}
                </Text>
              </Text>
              <View
                height={4}
                borderRadius={9999}
                backgroundColor="$surface3"
                overflow="hidden"
                marginTop={3}
              >
                <View
                  height="100%"
                  borderRadius={9999}
                  width={`${m.targetG > 0 ? Math.min(100, Math.round((m.eatenG / m.targetG) * 100)) : 0}%`}
                  backgroundColor={
                    m.targetG > 0 && m.eatenG > m.targetG ? OVER_HEX : m.color
                  }
                />
              </View>
            </View>
          ))}
        </View>
      </View>

      <View
        flexDirection="row"
        borderTopWidth={1}
        borderBottomWidth={1}
        borderColor="$border"
        paddingVertical={10}
        accessibilityLabel="Calories eaten, target and left"
        testID={`${testID}-strip`}
      >
        <StripCell value={fmt(eatenKcal)} label="Eaten" first />
        <Pressable
          style={{ flex: 1 }}
          onPress={onOpenTargets}
          accessibilityRole="button"
          accessibilityLabel={
            noTarget ? "Set a target" : `Target ${fmt(target)} kcal`
          }
          testID={`${testID}-target`}
        >
          <StripCell
            value={noTarget ? "—" : fmt(target)}
            label="Target"
            color="$text2"
          />
        </Pressable>
        <StripCell
          value={
            noTarget ? "—" : over ? `+${fmt(eatenKcal - target)}` : fmt(left)
          }
          label={over ? "Over" : "Left"}
          color={over ? "$error" : "$primary"}
        />
      </View>
    </View>
  );
}

function StripCell({
  value,
  label,
  color = "$text",
  first = false,
}: {
  value: string;
  label: string;
  color?: string;
  first?: boolean;
}) {
  return (
    <View
      flex={1}
      gap={2}
      paddingLeft={first ? 0 : 12}
      borderLeftWidth={first ? 0 : 1}
      borderColor="$border"
    >
      <Text fontFamily="$mono" fontSize={16} fontWeight="700" color={color}>
        {value}
      </Text>
      <Text
        fontFamily="$display"
        fontSize={10}
        fontWeight="600"
        letterSpacing={1.6}
        textTransform="uppercase"
        color="$text3"
      >
        {label}
      </Text>
    </View>
  );
}
