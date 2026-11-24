import Svg, { Circle, G } from "react-native-svg";
import { Text, View } from "@tamagui/core";
import type {
  MacroVsTarget,
  TargetComparison,
} from "@/domain/services/nutritionPlans.service";
import { color } from "@/ui/theme/tokens";
import { MACRO_HEX, ringSegments } from "../FuelLogSummaryPresenter";

/**
 * <PlanTargetSummaryPresenter> — the builder's compact ring (canvas N29/N32
 * `ringV(..., plan=true)`): the planned calories split by carbs · fat ·
 * protein and filled toward the person's own target, three macro columns
 * with "planned / target g" and a bar, then Target · Planned · To plan.
 *
 * Within 100 kcal shows the planned total "of <target>"; under shows what is
 * left "To plan" in amber; over shows "+n Over" in red. Without a target the
 * ring shows the planned kcal and the strip shows "—".
 *
 * Pure: the container works out the comparison.
 */

export type PlanTargetSummaryProps = {
  comparison: TargetComparison;
  planned: { proteinG: number; carbsG: number; fatG: number };
  macros: readonly MacroVsTarget[];
  testID?: string;
};

const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");
const SIZE = 96;
const R = 40;
const C = 2 * Math.PI * R;
const TRACK = color.$surface3;

const STATE_COLOUR = {
  on_target: "$text",
  no_target: "$text",
  to_plan: "$warning",
  over: "$error",
} as const;

export function ringCentre(c: TargetComparison): {
  value: string;
  label: string;
} {
  const t = c.targetKcal ?? 0;
  const left = c.toPlanKcal ?? 0;
  switch (c.state) {
    case "on_target":
      return { value: fmt(c.plannedKcal), label: `of ${fmt(t)}` };
    case "to_plan":
      return { value: fmt(left), label: "To plan" };
    case "over":
      return { value: `+${fmt(-left)}`, label: "Over" };
    default:
      return { value: fmt(c.plannedKcal), label: "kcal" };
  }
}

export function PlanTargetSummaryPresenter({
  comparison: c,
  planned,
  macros,
  testID = "plan-summary",
}: PlanTargetSummaryProps) {
  const t = c.targetKcal;
  const fill =
    t === null ? (c.plannedKcal > 0 ? 1 : 0) : Math.min(1, c.plannedKcal / t);
  const segments =
    c.plannedKcal > 0
      ? ringSegments(planned.carbsG, planned.fatG, planned.proteinG, fill)
      : [];
  const centre = ringCentre(c);
  const ringLabel =
    t === null
      ? `${fmt(c.plannedKcal)} kcal planned`
      : `${fmt(c.plannedKcal)} of ${fmt(t)} kcal planned`;
  const left = c.toPlanKcal ?? 0;
  const third =
    c.state === "on_target"
      ? { value: "On target", label: "Within 100", colour: "$success" }
      : c.state === "over"
        ? { value: `+${fmt(-left)}`, label: "Over", colour: "$error" }
        : c.state === "to_plan"
          ? { value: fmt(left), label: "To plan", colour: "$warning" }
          : { value: "—", label: "To plan", colour: "$text3" };

  return (
    <View testID={testID}>
      <View
        flexDirection="row"
        alignItems="center"
        gap={18}
        paddingTop={12}
        paddingBottom={8}
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
                stroke={TRACK}
                strokeWidth={9}
                fill="none"
              />
              {segments.map((s) => (
                <Circle
                  key={s.color}
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={R}
                  stroke={s.color}
                  strokeWidth={9}
                  fill="none"
                  strokeDasharray={`${s.length.toFixed(1)} ${C.toFixed(1)}`}
                  strokeDashoffset={s.offset}
                />
              ))}
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
              color={STATE_COLOUR[c.state]}
              testID={`${testID}-centre`}
            >
              {centre.value}
            </Text>
            <Text
              fontFamily="$display"
              fontSize={9.5}
              fontWeight="600"
              letterSpacing={1.4}
              textTransform="uppercase"
              color="$text3"
              testID={`${testID}-centre-label`}
            >
              {centre.label}
            </Text>
          </View>
        </View>

        <View flex={1} flexDirection="row" gap={10}>
          {macros.map((m) => {
            const hex = MACRO_HEX[m.key];
            const pct =
              m.targetG && m.targetG > 0
                ? Math.min(100, Math.round((m.plannedG / m.targetG) * 100))
                : 0;
            return (
              <View
                key={m.key}
                flex={1}
                gap={3}
                testID={`${testID}-macro-${m.key}`}
              >
                <Text
                  fontFamily="$display"
                  fontSize={10}
                  fontWeight="600"
                  letterSpacing={1.6}
                  textTransform="uppercase"
                  color={hex}
                >
                  {m.label}
                </Text>
                <Text fontFamily="$mono" fontSize={17} fontWeight="700">
                  <Text color="$text">{fmt(m.plannedG)}</Text>
                  <Text fontSize={11} fontWeight="500" color="$text3">
                    {m.targetG === null ? "g" : ` / ${fmt(m.targetG)}g`}
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
                    width={`${pct}%`}
                    backgroundColor={hex}
                  />
                </View>
              </View>
            );
          })}
        </View>
      </View>

      <View
        flexDirection="row"
        borderTopWidth={1}
        borderBottomWidth={1}
        borderColor="$border2"
        paddingVertical={10}
        testID={`${testID}-strip`}
      >
        <StripCell
          value={t === null ? "—" : fmt(t)}
          label="Target"
          colour="$text2"
          first
        />
        <StripCell value={fmt(c.plannedKcal)} label="Planned" colour="$text" />
        <StripCell
          value={third.value}
          label={third.label}
          colour={third.colour}
          testID={`${testID}-left`}
        />
      </View>
    </View>
  );
}

function StripCell({
  value,
  label,
  colour,
  first = false,
  testID,
}: {
  value: string;
  label: string;
  colour: string;
  first?: boolean;
  testID?: string;
}) {
  return (
    <View
      flex={1}
      gap={2}
      paddingLeft={first ? 0 : 12}
      borderLeftWidth={first ? 0 : 1}
      borderColor="$border"
      testID={testID}
    >
      <Text fontFamily="$mono" fontSize={16} fontWeight="700" color={colour}>
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
