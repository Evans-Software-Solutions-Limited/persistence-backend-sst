import { useState } from "react";
import { TextInput } from "react-native";
import Svg, {
  Path,
  Circle,
  Defs,
  LinearGradient,
  Stop,
} from "react-native-svg";
import { Text, View } from "@tamagui/core";
import { BottomSheet, Card, Btn } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import {
  IconMinus,
  IconPlus,
  IconCalendar,
  IconCheck,
} from "@/ui/components/icons";
import { computePath } from "./charts";

/**
 * <WeighInSheetPresenter> — body-weight log sheet (06-progress-goals,
 * STORY-005; weigh-in-sheet.jsx). Mono weight input + kg/lb toggle + day
 * chips + a live body-trend sparkline preview. Holds local form state; `onSave`
 * hands the canonical-kg value + day to the container (which mutates offline-
 * first via useLogMeasurement).
 *
 * NB vs design.md AC 5.2: the prototype omits the optional body-fat + notes
 * fields — followed the prototype; those are a flagged follow-up.
 */

const KG_PER_LB = 0.45359237;
const W = 320;
const H = 64;
const PRIMARY = toneHex("primary").base;

export type WeighInUnit = "kg" | "lb";

export type WeighInSaveInput = {
  weightKg: number;
  day: string; // YYYY-MM-DD
  unit: WeighInUnit;
};

export type WeighInSheetProps = {
  visible: boolean;
  onClose: () => void;
  onSave: (input: WeighInSaveInput) => void;
  defaultUnit?: WeighInUnit;
  /** Recent body-weight history in kg, oldest-first, for the sparkline. */
  history?: number[];
  saving?: boolean;
  /** Injected for deterministic tests; defaults to now. */
  today?: Date;
  testID?: string;
};

function addDaysISO(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function WeighInSheetPresenter({
  visible,
  onClose,
  onSave,
  defaultUnit = "kg",
  history = [],
  saving = false,
  today = new Date(),
  testID = "weigh-in-sheet",
}: WeighInSheetProps) {
  const [unit, setUnit] = useState<WeighInUnit>(defaultUnit);
  const [kg, setKg] = useState<number>(history[history.length - 1] ?? 80);
  const [dayOffset, setDayOffset] = useState<number>(0);

  const display = unit === "kg" ? kg : kg / KG_PER_LB;
  const step = unit === "kg" ? 0.1 : 0.2;
  const fmt = (v: number) => v.toFixed(1);

  const adjust = (dir: number) => {
    const next = display + dir * step;
    setKg(unit === "kg" ? +next.toFixed(2) : +(next * KG_PER_LB).toFixed(3));
  };
  const onType = (text: string) => {
    const v = parseFloat(text);
    if (Number.isNaN(v)) return;
    setKg(unit === "kg" ? v : +(v * KG_PER_LB).toFixed(3));
  };

  const todayISO = today.toISOString().slice(0, 10);
  const day = addDaysISO(todayISO, dayOffset);
  const dateLabel =
    dayOffset === 0
      ? "Today"
      : dayOffset === -1
        ? "Yesterday"
        : `${-dayOffset}d ago`;

  // Sparkline over history + the live value.
  const series = [...history.slice(0, -1), kg];
  const { line, area, lastPoint } = computePath(series, { w: W, h: H }, 0.15);
  const prev = history[0] ?? kg;
  const deltaKg = kg - prev;
  const deltaDisplay = unit === "kg" ? deltaKg : deltaKg / KG_PER_LB;
  const down = deltaKg <= 0;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Weigh in"
      eyebrow="LOG"
      accent="primary"
      height="tall"
      testID={testID}
    >
      <View padding={16} paddingBottom={28} gap={16}>
        {/* Weight input + unit toggle */}
        <Card pad={20} radius={18} accent="primary">
          <Text
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.5}
            color="$primary"
            textAlign="center"
            marginBottom={12}
          >
            BODY WEIGHT
          </Text>
          <View
            flexDirection="row"
            alignItems="center"
            justifyContent="center"
            gap={14}
          >
            <View
              width={46}
              height={46}
              borderRadius={14}
              backgroundColor="$surface3"
              alignItems="center"
              justifyContent="center"
              onPress={() => adjust(-1)}
              accessibilityLabel="Decrease weight"
            >
              <IconMinus size={18} color={toneHex("primary").base} />
            </View>
            <View
              flexDirection="row"
              alignItems="baseline"
              gap={6}
              minWidth={168}
              justifyContent="center"
            >
              <TextInput
                value={fmt(display)}
                onChangeText={onType}
                inputMode="decimal"
                accessibilityLabel="Weight value"
                testID="weigh-in-input"
                style={{
                  width: 132,
                  textAlign: "right",
                  color: "#F4F4F8",
                  fontFamily: "Geist Mono",
                  fontWeight: "600",
                  fontSize: 52,
                  letterSpacing: -2,
                  padding: 0,
                }}
              />
              <Text fontFamily="$mono" color="$text3" fontSize={16}>
                {unit}
              </Text>
            </View>
            <View
              width={46}
              height={46}
              borderRadius={14}
              backgroundColor="$surface3"
              alignItems="center"
              justifyContent="center"
              onPress={() => adjust(1)}
              accessibilityLabel="Increase weight"
            >
              <IconPlus size={18} color={toneHex("primary").base} />
            </View>
          </View>

          <View
            flexDirection="row"
            gap={4}
            alignSelf="center"
            marginTop={16}
            width={132}
            backgroundColor="$surface3"
            borderRadius={999}
            padding={3}
          >
            {(["kg", "lb"] as const).map((u) => {
              const on = unit === u;
              return (
                <View
                  key={u}
                  flex={1}
                  paddingVertical={6}
                  borderRadius={999}
                  alignItems="center"
                  backgroundColor={on ? "$primary" : "transparent"}
                  onPress={() => setUnit(u)}
                  accessibilityLabel={`Use ${u}`}
                >
                  <Text
                    fontWeight="700"
                    fontSize={12}
                    color={on ? "$primaryInk" : "$text3"}
                  >
                    {u.toUpperCase()}
                  </Text>
                </View>
              );
            })}
          </View>
        </Card>

        {/* Date chips */}
        <View>
          <Text
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.5}
            color="$text3"
            marginBottom={8}
          >
            DATE
          </Text>
          <View flexDirection="row" alignItems="center" gap={10}>
            <View
              width={42}
              height={42}
              borderRadius={11}
              backgroundColor="$surface3"
              alignItems="center"
              justifyContent="center"
            >
              <IconCalendar size={19} color={toneHex("primary").base} />
            </View>
            <View flexDirection="row" gap={6} flex={1}>
              {[0, -1, -2, -3].map((off) => {
                const on = dayOffset === off;
                const lbl =
                  off === 0
                    ? "Today"
                    : off === -1
                      ? "Yesterday"
                      : `${-off}d ago`;
                return (
                  <View
                    key={off}
                    paddingVertical={8}
                    paddingHorizontal={14}
                    borderRadius={10}
                    borderWidth={1}
                    backgroundColor={on ? "$primaryDim" : "$surface2"}
                    borderColor={on ? toneHex("primary").base : "$border"}
                    onPress={() => setDayOffset(off)}
                    accessibilityLabel={lbl}
                  >
                    <Text
                      fontWeight="600"
                      fontSize={12.5}
                      color={on ? "$primary" : "$text2"}
                    >
                      {lbl}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        </View>

        {/* Body-trend sparkline preview */}
        {series.length > 1 && (
          <Card pad={14} radius={14}>
            <View
              flexDirection="row"
              justifyContent="space-between"
              marginBottom={8}
            >
              <View>
                <Text
                  fontSize={10.5}
                  fontWeight="600"
                  letterSpacing={1.5}
                  color="$text3"
                >
                  TREND · LAST {series.length}
                </Text>
                <Text
                  fontFamily="$mono"
                  fontSize={19}
                  color="$text"
                  marginTop={4}
                >
                  {fmt(display)} {unit}
                </Text>
              </View>
              <Text
                fontFamily="$mono"
                fontSize={13}
                fontWeight="600"
                color={down ? "$success" : "$ember"}
              >
                {down ? "▼" : "▲"} {Math.abs(deltaDisplay).toFixed(1)} {unit}
              </Text>
            </View>
            <Svg
              width="100%"
              height={H}
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
            >
              <Defs>
                <LinearGradient id="wi-fill" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0%" stopColor={PRIMARY} stopOpacity={0.28} />
                  <Stop offset="100%" stopColor={PRIMARY} stopOpacity={0} />
                </LinearGradient>
              </Defs>
              <Path d={area} fill="url(#wi-fill)" />
              <Path d={line} fill="none" stroke={PRIMARY} strokeWidth={2} />
              <Circle
                cx={lastPoint[0]}
                cy={lastPoint[1]}
                r={3.5}
                fill={PRIMARY}
              />
            </Svg>
          </Card>
        )}

        <Btn
          full
          variant="filled"
          tone="primary"
          size="lg"
          disabled={saving}
          icon={<IconCheck size={16} color={toneHex("primary").ink} />}
          onPress={() => onSave({ weightKg: kg, day, unit })}
        >
          {saving ? "Logged ✓" : `Log ${fmt(display)} ${unit} · ${dateLabel}`}
        </Btn>
      </View>
    </BottomSheet>
  );
}
