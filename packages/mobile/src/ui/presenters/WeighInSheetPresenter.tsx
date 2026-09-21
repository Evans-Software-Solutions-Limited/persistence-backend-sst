import { useEffect, useRef, useState } from "react";
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
import { IconMinus, IconPlus, IconCheck } from "@/ui/components/icons";
import { KG_PER_LB, localDayISO } from "@/shared/utils";
import { DatePickerField } from "@/ui/components/DatePickerField";
import { computePath } from "./charts";

/**
 * <WeighInSheetPresenter> — body-weight log sheet (06-progress-goals,
 * STORY-005; weigh-in-sheet.jsx). Mono weight input + unit formats + day
 * chips + a live body-trend sparkline preview. Holds local form state; `onSave`
 * hands the canonical-kg value + day to the container (which mutates offline-
 * first via useLogMeasurement).
 *
 * NB vs design.md AC 5.2: the prototype omits the optional body-fat + notes
 * fields — followed the prototype; those are a flagged follow-up.
 */

const W = 320;
const H = 64;
const PRIMARY = toneHex("primary").base;

// Match logMeasurementCommand's canonical kg bounds. Typed invalid values stay
// editable but cannot be submitted; steppers clamp at the same upper limit.
const MIN_KG = 1;
const MAX_KG = 999;

const clampKg = (kg: number) => Math.min(MAX_KG, Math.max(MIN_KG, kg));

export type WeighInUnit = "kg" | "lb";
type WeightFormat = WeighInUnit | "st+lb";

const weightParts = (kg: number, format: WeightFormat): [string, string] => {
  const pounds = kg / KG_PER_LB;
  if (format === "st+lb") {
    const total = Math.round(pounds * 10) / 10;
    return [String(Math.floor(total / 14)), (total % 14).toFixed(1)];
  }
  return [(format === "kg" ? kg : pounds).toFixed(1), ""];
};

const parseWeight = (
  first: string,
  second: string,
  format: WeightFormat,
): number | null => {
  const decimal = /^(?:\d+(?:\.\d*)?|\.\d+)$/;
  const primary = first.trim().replace(",", ".");
  const secondary = second.trim().replace(",", ".");
  if (!decimal.test(primary)) return null;
  const value = Number(primary);
  let pounds = value;
  if (format === "st+lb") {
    if (!Number.isInteger(value) || !decimal.test(secondary)) return null;
    const remainder = Number(secondary);
    if (remainder >= 14) return null;
    pounds = value * 14 + remainder;
  }
  const kg = format === "kg" ? value : pounds * KG_PER_LB;
  return Number.isFinite(kg) && kg > 0 && kg <= MAX_KG ? kg : null;
};

export type WeighInSaveInput = {
  /** Omitted when the body-fat history launched a body-fat-only log. */
  weightKg?: number;
  /** Body-fat %, 0..100. Null when the user left it blank. */
  bodyFatPercentage: number | null;
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
  /** Seed the weight input (e.g. latest Apple Health / cached reading). */
  defaultWeightKg?: number;
  /** Seed the body-fat input (latest Apple Health / cached reading). */
  defaultBodyFat?: number | null;
  saving?: boolean;
  /** Injected for deterministic tests; defaults to now. */
  today?: Date;
  testID?: string;
  /** Metric that launched the shared sheet; changes title/focus copy only. */
  context?: "weight" | "bodyFat";
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
  defaultUnit,
  history = [],
  defaultWeightKg,
  defaultBodyFat = null,
  saving = false,
  today = new Date(),
  testID = "weigh-in-sheet",
  context = "weight",
}: WeighInSheetProps) {
  const fmt = (v: number) => v.toFixed(1);
  const toDisplay = (kgValue: number, u: WeighInUnit) =>
    u === "kg" ? kgValue : kgValue / KG_PER_LB;

  const [unit, setUnit] = useState<WeightFormat>(defaultUnit ?? "kg");
  const [kg, setKg] = useState<number>(
    defaultWeightKg ?? history[history.length - 1] ?? 80,
  );
  // Preserve raw text while editing; invalid or empty input cannot submit the
  // previous canonical value. Unit switches retain canonical precision.
  const [weightText, setWeightText] = useState<string>(() =>
    fmt(
      toDisplay(
        defaultWeightKg ?? history[history.length - 1] ?? 80,
        defaultUnit ?? "kg",
      ),
    ),
  );
  const [remainderText, setRemainderText] = useState("");
  // Validity follows edits, not rounded display conversions at the kg bounds.
  const [validWeight, setValidWeight] = useState(
    () => Number.isFinite(kg) && kg > 0 && kg <= MAX_KG,
  );
  const [bodyFat, setBodyFat] = useState<number | null>(defaultBodyFat);
  const [dayOffset, setDayOffset] = useState<number>(0);
  const todayISO = localDayISO(today);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // The sheet stays mounted (visibility is a prop). Reset the chosen day AND
  // the per-field "user has edited" sentinels on each open. The sentinels gate
  // the async prefill below: the HealthKit reads resolve AFTER the open, so a
  // late value may seed a field the user hasn't touched, but must never
  // overwrite one they have.
  const editedWeight = useRef(false);
  const editedBodyFat = useRef(false);
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      setDayOffset(0);
      setSelectedDay(null);
      editedWeight.current = false;
      editedBodyFat.current = false;
    }
    wasVisible.current = visible;
  }, [visible]);

  // …and seed weight/body-fat from the prefill, PLUS the unit toggle from
  // the caller's preferred-units default — combined into one effect so
  // there's no cross-effect ordering hazard (a separate unit-seed effect
  // that also writes `weightText` could run before or after this one in the
  // same commit and clobber the other's formatting with a stale closure).
  //
  // Both prefill values and `defaultUnit` resolve async, after this sheet's
  // already-mounted-at-root first render (see feedback_sheets_mount_at_root)
  // — `defaultUnit` starts `undefined` until the profile fetch lands. The
  // unit seed is one-shot (ref-guarded) so a manual toggle afterward is
  // never overwritten by a later-resolving `defaultUnit`; the weight/body-fat
  // prefill re-applies on every arrival but only to an untouched field.
  const unitHydratedRef = useRef(false);
  useEffect(() => {
    if (!visible) return;
    const shouldSeedUnit =
      defaultUnit !== undefined && !unitHydratedRef.current;
    if (shouldSeedUnit) unitHydratedRef.current = true;
    const resolvedUnit = shouldSeedUnit ? defaultUnit : unit;
    if (shouldSeedUnit) setUnit(defaultUnit);
    if (!editedWeight.current) {
      const prefillKg = defaultWeightKg ?? history[history.length - 1] ?? 80;
      setKg(prefillKg);
      setValidWeight(
        Number.isFinite(prefillKg) && prefillKg > 0 && prefillKg <= MAX_KG,
      );
      const parts = weightParts(prefillKg, resolvedUnit);
      setWeightText(parts[0]);
      setRemainderText(parts[1]);
    } else if (shouldSeedUnit) {
      const parts = weightParts(kg, resolvedUnit);
      setWeightText(parts[0]);
      setRemainderText(parts[1]);
    }
    if (!editedBodyFat.current) setBodyFat(defaultBodyFat);
    // `unit`/`kg` deliberately omitted — a mid-session unit toggle reformats
    // via its own handler below, not by re-running this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, defaultUnit, defaultWeightKg, defaultBodyFat, history]);

  const onTypeBodyFat = (text: string) => {
    editedBodyFat.current = true;
    if (text.trim() === "") {
      setBodyFat(null);
      return;
    }
    const v = parseFloat(text);
    if (Number.isNaN(v)) return;
    // Clamp to a sane 0..100 range so a fat-finger entry can't poison the
    // optimistic cache or the HealthKit write.
    setBodyFat(Math.min(100, Math.max(0, v)));
  };

  const payloadUnit: WeighInUnit = unit === "kg" ? "kg" : "lb";
  const display = toDisplay(kg, payloadUnit);
  const composite = unit === "st+lb";
  const primaryLabel = composite ? "st" : unit;
  const secondaryLabel = "lb";
  const roundedParts = weightParts(kg, unit);
  const roundedKg = parseWeight(roundedParts[0], roundedParts[1], unit);
  const canSaveWeight = validWeight && roundedKg !== null;
  const displayLabel = composite
    ? `${roundedParts[0]} st ${roundedParts[1]} lb`
    : `${roundedParts[0]} ${unit}`;
  const setParts = (value: number, format: WeightFormat) => {
    const parts = weightParts(value, format);
    setWeightText(parts[0]);
    setRemainderText(parts[1]);
  };
  const adjust = (dir: number) => {
    if (!validWeight) return;
    editedWeight.current = true;
    unitHydratedRef.current = true;
    const stepKg = unit === "kg" ? 0.1 : 0.2 * KG_PER_LB;
    const nextKg = clampKg(kg + dir * stepKg);
    setKg(nextKg);
    setParts(nextKg, unit);
  };
  const onChangeUnit = (nextUnit: WeightFormat) => {
    unitHydratedRef.current = true;
    editedWeight.current = true;
    setUnit(nextUnit);
    if (validWeight) setParts(kg, nextUnit);
    else {
      setWeightText("");
      setRemainderText("");
    }
  };
  const onType = (text: string, secondary = false) => {
    editedWeight.current = true;
    unitHydratedRef.current = true;
    if (secondary) setRemainderText(text);
    else setWeightText(text);
    const nextKg = parseWeight(
      secondary ? weightText : text,
      secondary ? text : remainderText,
      unit,
    );
    setValidWeight(nextKg !== null);
    if (nextKg !== null) setKg(nextKg);
  };

  const day = selectedDay ?? addDaysISO(todayISO, dayOffset);
  const displayOffset = Math.round(
    (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${todayISO}T00:00:00Z`)) /
      86400000,
  );
  const dateLabel =
    displayOffset === 0
      ? "Today"
      : displayOffset === -1
        ? "Yesterday"
        : displayOffset >= -3
          ? `${-displayOffset}d ago`
          : new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            });

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
      title={context === "bodyFat" ? "Log body fat" : "Log weight"}
      eyebrow="LOG"
      accent="primary"
      height="tall"
      testID={testID}
    >
      <View padding={16} paddingBottom={28} gap={16}>
        {/* A body-fat history log must not invent a weight when no reading is
            available. Weight remains part of the normal combined weigh-in. */}
        {context === "weight" && (
          <Card pad={20} radius={18} accent="primary">
            <Text
              fontFamily="$body"
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
              gap={8}
            >
              <View
                width={44}
                height={44}
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
                flex={1}
                minWidth={0}
                justifyContent="center"
              >
                <TextInput
                  value={weightText}
                  onChangeText={(text) => onType(text)}
                  onBlur={() => {
                    if (validWeight) setParts(kg, unit);
                  }}
                  inputMode="decimal"
                  accessibilityLabel="Weight value"
                  testID="weigh-in-input"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    textAlign: "center",
                    color: "#F4F4F8",
                    fontFamily: "Geist",
                    fontWeight: "600",
                    fontSize: composite ? 28 : 40,
                    letterSpacing: -0.5,
                    padding: 0,
                  }}
                />
                <Text fontFamily="$body" color="$text3" fontSize={16}>
                  {primaryLabel}
                </Text>
                {composite && (
                  <>
                    <TextInput
                      value={remainderText}
                      onChangeText={(text) => onType(text, true)}
                      onBlur={() => {
                        if (validWeight) setParts(kg, unit);
                      }}
                      inputMode="decimal"
                      accessibilityLabel={`Weight ${secondaryLabel}`}
                      testID="weigh-in-remainder-input"
                      style={{
                        flex: 1,
                        minWidth: 0,
                        textAlign: "center",
                        color: "#F4F4F8",
                        fontFamily: "Geist",
                        fontWeight: "600",
                        fontSize: 28,
                        padding: 0,
                      }}
                    />
                    <Text fontFamily="$body" color="$text3" fontSize={16}>
                      {secondaryLabel}
                    </Text>
                  </>
                )}
              </View>
              <View
                width={44}
                height={44}
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
              width="100%"
              backgroundColor="$surface3"
              borderRadius={999}
              padding={3}
            >
              {(["kg", "lb", "st+lb"] as const).map((u) => {
                const on = unit === u;
                return (
                  <View
                    key={u}
                    flex={1}
                    paddingVertical={6}
                    borderRadius={999}
                    alignItems="center"
                    backgroundColor={on ? "$primary" : "transparent"}
                    onPress={() => onChangeUnit(u)}
                    accessibilityLabel={`Use ${u}`}
                  >
                    <Text
                      fontFamily="$body"
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
            {!validWeight && (
              <Text
                fontFamily="$body"
                color="$ember"
                fontSize={12}
                marginTop={12}
                accessibilityRole="alert"
              >
                Enter a valid weight
                {unit === "st+lb" ? " with pounds below 14" : ""}.
              </Text>
            )}
          </Card>
        )}

        {/* Body fat — optional. Not in the weight-only prototype; added per
            product (read/write to Apple Health both weight + body fat). */}
        <Card pad={16} radius={16}>
          <View
            flexDirection="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <Text
              fontFamily="$body"
              fontSize={10.5}
              fontWeight="600"
              letterSpacing={1.5}
              color="$text3"
            >
              BODY FAT
            </Text>
            <View flexDirection="row" alignItems="baseline" gap={4}>
              <TextInput
                value={bodyFat === null ? "" : String(bodyFat)}
                onChangeText={onTypeBodyFat}
                inputMode="decimal"
                placeholder="—"
                placeholderTextColor="#8A8A98"
                accessibilityLabel="Body fat percentage"
                testID="weigh-in-bodyfat-input"
                style={{
                  minWidth: 56,
                  width: 56,
                  textAlign: "right",
                  color: "#F4F4F8",
                  fontFamily: "Geist",
                  fontWeight: "600",
                  fontSize: 22,
                  letterSpacing: -0.5,
                  padding: 0,
                }}
              />
              <Text fontFamily="$body" color="$text3" fontSize={14}>
                %
              </Text>
            </View>
          </View>
        </Card>

        {/* Date chips */}
        <View>
          <Text
            fontFamily="$body"
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.5}
            color="$text3"
            marginBottom={8}
          >
            DATE
          </Text>
          <View flexDirection="row" alignItems="center" gap={6}>
            {visible ? (
              <DatePickerField
                variant="icon"
                label="Log date"
                value={day}
                maximumDate={todayISO}
                allowClear={false}
                disabled={saving}
                onChange={(selected) => {
                  const offset =
                    (Date.parse(`${selected}T00:00:00Z`) -
                      Date.parse(`${todayISO}T00:00:00Z`)) /
                    86400000;
                  if (Number.isInteger(offset) && offset <= 0)
                    setSelectedDay(selected);
                }}
                testID="weigh-in-date"
              />
            ) : null}
            <View flexDirection="row" gap={4} flex={1} minWidth={0}>
              {[0, -1, -2, -3].map((off) => {
                const on = day === addDaysISO(todayISO, off);
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
                    paddingHorizontal={4}
                    minHeight={44}
                    flex={off === -1 ? 1.5 : 1}
                    minWidth={0}
                    alignItems="center"
                    justifyContent="center"
                    borderRadius={10}
                    borderWidth={1}
                    backgroundColor={on ? "$primaryDim" : "$surface2"}
                    borderColor={on ? toneHex("primary").base : "$border"}
                    onPress={() => {
                      setSelectedDay(null);
                      setDayOffset(off);
                    }}
                    accessibilityLabel={lbl}
                  >
                    <Text
                      fontFamily="$body"
                      fontWeight="600"
                      fontSize={12}
                      numberOfLines={1}
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
        {context === "weight" && series.length > 1 && (
          <Card pad={14} radius={14}>
            <View
              flexDirection="row"
              justifyContent="space-between"
              marginBottom={8}
            >
              <View>
                <Text
                  fontFamily="$body"
                  fontSize={10.5}
                  fontWeight="600"
                  letterSpacing={1.5}
                  color="$text3"
                >
                  TREND · LAST {series.length}
                </Text>
                <Text
                  fontFamily="$body"
                  fontSize={19}
                  color="$text"
                  marginTop={4}
                >
                  {fmt(display)} {payloadUnit}
                </Text>
              </View>
              <Text
                fontFamily="$body"
                fontSize={13}
                fontWeight="600"
                color={down ? "$success" : "$ember"}
              >
                {down ? "▼" : "▲"} {Math.abs(deltaDisplay).toFixed(1)}{" "}
                {payloadUnit}
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
          testID="weigh-in-save"
          full
          variant="filled"
          tone="primary"
          size="lg"
          disabled={
            saving || (context === "bodyFat" ? bodyFat == null : !canSaveWeight)
          }
          icon={<IconCheck size={16} color={toneHex("primary").ink} />}
          onPress={() => {
            if (saving || (context === "weight" && !canSaveWeight)) return;
            if (context === "weight") setParts(kg, unit);
            onSave({
              weightKg: context === "weight" ? roundedKg! : undefined,
              bodyFatPercentage: bodyFat,
              day,
              unit: payloadUnit,
            });
          }}
        >
          {saving
            ? "Logged ✓"
            : context === "bodyFat"
              ? bodyFat == null
                ? "Enter body fat to log"
                : `Log ${bodyFat}% · ${dateLabel}`
              : canSaveWeight
                ? `Log ${displayLabel} · ${dateLabel}`
                : "Enter weight to log"}
        </Btn>
      </View>
    </BottomSheet>
  );
}
