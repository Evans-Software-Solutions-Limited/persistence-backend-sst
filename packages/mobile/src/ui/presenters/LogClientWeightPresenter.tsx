import { useState } from "react";
import { TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View } from "@tamagui/core";
import { Btn, Card, HeaderBar, IconBtn } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconBack, IconCheck, IconMinus, IconPlus } from "@/ui/components/icons";

/**
 * <LogClientWeightPresenter> — coach logs a weight for one of their clients
 * (10-trainer-features, weight-sync flow). Mirrors the self <WeighInSheet>
 * input (mono value + kg/lb toggle + stepper) trimmed to weight-only, on a
 * full screen with a trainer-tone accent. The logged weight is written for the
 * client and (on the client's next app open) synced into their HealthKit.
 */

const KG_PER_LB = 0.45359237;
const MIN_KG = 1;
const MAX_KG = 999;
const clampKg = (kg: number) => Math.min(MAX_KG, Math.max(MIN_KG, kg));

type Unit = "kg" | "lb";

export type LogClientWeightProps = {
  clientName?: string | null;
  saving: boolean;
  success: boolean;
  error?: string | null;
  onSave: (weightKg: number) => void;
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
  const [unit, setUnit] = useState<Unit>("kg");
  const [kg, setKg] = useState<number>(80);

  const display = unit === "kg" ? kg : kg / KG_PER_LB;
  const step = unit === "kg" ? 0.1 : 0.2;
  const fmt = (v: number) => v.toFixed(1);
  const trainerHex = toneHex("trainer").base;

  const adjust = (dir: number) => {
    const next = display + dir * step;
    const nextKg =
      unit === "kg" ? +next.toFixed(2) : +(next * KG_PER_LB).toFixed(3);
    setKg(clampKg(nextKg));
  };
  const onType = (text: string) => {
    const v = parseFloat(text);
    if (Number.isNaN(v)) return;
    setKg(unit === "kg" ? v : +(v * KG_PER_LB).toFixed(3));
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
                value={fmt(display)}
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
                  onPress={() => setUnit(u)}
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
          onPress={() => onSave(clampKg(kg))}
          testID="log-client-weight-save"
        >
          {success ? "Logged ✓" : `Log ${fmt(display)} ${unit}`}
        </Btn>
      </View>
    </View>
  );
}
