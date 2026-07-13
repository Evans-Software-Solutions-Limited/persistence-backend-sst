import { useState } from "react";
import { TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View } from "@tamagui/core";
import { Btn, Card, HeaderBar, IconBtn } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import {
  IconBack,
  IconCheck,
  IconMinus,
  IconPlus,
} from "@/ui/components/icons";
import { KG_PER_LB } from "@/shared/utils";

/**
 * <LogClientWeightPresenter> — coach logs a weight (+ optional body fat) for
 * one of their clients (10-trainer-features, weight-sync flow). Mirrors the
 * self <WeighInSheet> inputs (mono weight value + kg/lb toggle + stepper,
 * optional body-fat row) on a full screen with a trainer-tone accent. The
 * logged measurement is written for the client and (on the client's next app
 * open) synced into their HealthKit.
 */

const MIN_KG = 1;
const MAX_KG = 999;
const clampKg = (kg: number) => Math.min(MAX_KG, Math.max(MIN_KG, kg));

type Unit = "kg" | "lb";

export type LogClientWeightSaveInput = {
  weightKg: number;
  /** 0..100, or null when the coach left the optional field blank. */
  bodyFatPercentage: number | null;
};

export type LogClientWeightProps = {
  clientName?: string | null;
  saving: boolean;
  success: boolean;
  error?: string | null;
  onSave: (input: LogClientWeightSaveInput) => void;
  onBack: () => void;
};

export function LogClientWeightPresenter({
  clientName,
  saving,
  success,
  error,
  onSave,
  onBack,
}: LogClientWeightProps) {
  const insets = useSafeAreaInsets();
  const fmt = (v: number) => v.toFixed(1);
  const toDisplay = (kgValue: number, u: Unit) =>
    u === "kg" ? kgValue : kgValue / KG_PER_LB;

  const [unit, setUnit] = useState<Unit>("kg");
  const [kg, setKg] = useState<number>(80);
  // Raw text backing the weight TextInput, tracked separately from the
  // canonical numeric `kg` — see WeighInSheetPresenter's identical field for
  // the full rationale. Deriving `value` straight from `fmt(kg)` means
  // deleting all the digits makes `parseFloat("")` NaN, the handler bails,
  // and the controlled input snaps back to the last valid number — the
  // field can never be cleared to type a new value.
  const [weightText, setWeightText] = useState<string>(() => fmt(80));
  const [bodyFat, setBodyFat] = useState<number | null>(null);

  const display = toDisplay(kg, unit);
  const step = unit === "kg" ? 0.1 : 0.2;
  const trainerHex = toneHex("trainer").base;

  const adjust = (dir: number) => {
    const next = display + dir * step;
    const nextKg =
      unit === "kg" ? +next.toFixed(2) : +(next * KG_PER_LB).toFixed(3);
    const clamped = clampKg(nextKg);
    setKg(clamped);
    setWeightText(fmt(toDisplay(clamped, unit)));
  };
  const onChangeUnit = (nextUnit: Unit) => {
    setUnit(nextUnit);
    setWeightText(fmt(toDisplay(kg, nextUnit)));
  };
  const onType = (text: string) => {
    setWeightText(text);
    const v = parseFloat(text);
    if (Number.isNaN(v)) return;
    setKg(unit === "kg" ? v : +(v * KG_PER_LB).toFixed(3));
  };
  const onTypeBodyFat = (text: string) => {
    if (text.trim() === "") {
      setBodyFat(null);
      return;
    }
    const v = parseFloat(text);
    if (Number.isNaN(v)) return;
    // Clamp to a sane 0..100 range — mirrors WeighInSheetPresenter.
    setBodyFat(Math.min(100, Math.max(0, v)));
  };

  return (
    <View flex={1} paddingTop={insets.top}>
      <HeaderBar
        eyebrow="COACHING"
        title="Log weight"
        leading={
          <IconBtn
            icon={<IconBack size={20} />}
            tone="neutral"
            onPress={onBack}
            accessibilityLabel="Back"
          />
        }
      />
      <View padding={20} gap={16}>
        {clientName ? (
          <Text fontSize={13} color="$text3">
            Logging for {clientName}
          </Text>
        ) : null}

        <Card pad={20} radius={18} accent="trainer">
          <Text
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.5}
            color="$accentTrainer"
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
              <IconMinus size={18} color={trainerHex} />
            </View>
            <View
              flexDirection="row"
              alignItems="baseline"
              gap={6}
              minWidth={168}
              justifyContent="center"
            >
              <TextInput
                value={weightText}
                onChangeText={onType}
                inputMode="decimal"
                accessibilityLabel="Weight value"
                testID="log-client-weight-input"
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
              <IconPlus size={18} color={trainerHex} />
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
                  backgroundColor={on ? "$accentTrainer" : "transparent"}
                  onPress={() => onChangeUnit(u)}
                  accessibilityLabel={`Use ${u}`}
                >
                  <Text
                    fontWeight="700"
                    fontSize={12}
                    color={on ? "$bg" : "$text3"}
                  >
                    {u.toUpperCase()}
                  </Text>
                </View>
              );
            })}
          </View>
        </Card>

        {/* Body fat — optional, mirrors the self weigh-in sheet's row. The
            backend route already accepts bodyFatPercentage. */}
        <Card pad={16} radius={16}>
          <View
            flexDirection="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <Text
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
                testID="log-client-bodyfat-input"
                style={{
                  minWidth: 56,
                  textAlign: "right",
                  color: "#F4F4F8",
                  fontFamily: "Geist Mono",
                  fontWeight: "600",
                  fontSize: 22,
                  letterSpacing: -0.5,
                  padding: 0,
                }}
              />
              <Text fontFamily="$mono" color="$text3" fontSize={14}>
                %
              </Text>
            </View>
          </View>
        </Card>

        {error ? (
          <Text fontSize={13} color="$error" testID="log-client-weight-error">
            {error}
          </Text>
        ) : null}

        <Btn
          full
          variant="filled"
          tone="trainer"
          size="lg"
          disabled={saving || success}
          icon={<IconCheck size={16} color={toneHex("trainer").ink} />}
          onPress={() =>
            onSave({ weightKg: clampKg(kg), bodyFatPercentage: bodyFat })
          }
          testID="log-client-weight-save"
        >
          {success ? "Logged ✓" : `Log ${fmt(display)} ${unit}`}
        </Btn>
      </View>
    </View>
  );
}
