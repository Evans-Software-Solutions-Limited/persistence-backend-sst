import { useEffect, useRef, useState } from "react";
import { Text, View } from "@tamagui/core";
import { BottomSheet, Card, Btn } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconMinus, IconPlus, IconCheck } from "@/ui/components/icons";

/**
 * <SleepLogSheetPresenter> — sleep quick-log sheet (specs/20-sleep-quicklog
 * STORY-001; Decision D1: duration input — hours + minutes, NOT bedtime/wake
 * pickers). Mirrors <WeighInSheetPresenter>'s stepper pattern: +/- steppers
 * seed from a HealthKit prefill when available, Save hands the canonical
 * duration to the container (which synthesises the sleepStart/sleepEnd window
 * and mutates via useLogSleep).
 */

const MAX_HOURS = 16;
const MINUTE_STEP = 5;

export type SleepSaveInput = {
  durationMinutes: number;
};

export type SleepLogSheetProps = {
  visible: boolean;
  onClose: () => void;
  onSave: (input: SleepSaveInput) => void;
  /** Seed hours/minutes from HealthKit's last-night reading, when available. */
  defaultDurationMinutes?: number;
  saving?: boolean;
  testID?: string;
};

function clampHours(h: number): number {
  return Math.min(MAX_HOURS, Math.max(0, h));
}

function clampMinutes(m: number): number {
  const wrapped = ((m % 60) + 60) % 60;
  return Math.round(wrapped / MINUTE_STEP) * MINUTE_STEP;
}

export function SleepLogSheetPresenter({
  visible,
  onClose,
  onSave,
  defaultDurationMinutes,
  saving = false,
  testID = "sleep-log-sheet",
}: SleepLogSheetProps) {
  const defaultTotal = defaultDurationMinutes ?? 8 * 60;
  const [hours, setHours] = useState<number>(Math.floor(defaultTotal / 60));
  const [minutes, setMinutes] = useState<number>(
    clampMinutes(defaultTotal % 60),
  );

  // The sheet stays mounted (visibility is a prop); reset the "edited" gate
  // on each open so a late-resolving HealthKit prefill can seed the fields,
  // but never clobbers a value the user has already changed this session —
  // mirrors WeighInSheetPresenter's `editedWeight` ref.
  const edited = useRef(false);
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      edited.current = false;
    }
    wasVisible.current = visible;
  }, [visible]);

  useEffect(() => {
    if (!visible || edited.current || defaultDurationMinutes == null) return;
    setHours(Math.floor(defaultDurationMinutes / 60));
    setMinutes(clampMinutes(defaultDurationMinutes % 60));
  }, [visible, defaultDurationMinutes]);

  const adjustHours = (dir: number) => {
    edited.current = true;
    setHours((h) => clampHours(h + dir));
  };
  const adjustMinutes = (dir: number) => {
    edited.current = true;
    setMinutes((m) => clampMinutes(m + dir * MINUTE_STEP));
  };

  const durationMinutes = hours * 60 + minutes;
  const canSave = durationMinutes > 0;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Log sleep"
      eyebrow="LOG"
      accent="success"
      height="peek"
      testID={testID}
    >
      <View padding={16} paddingBottom={28} gap={16}>
        <Card pad={20} radius={18} accent="success">
          <Text
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.5}
            color="$success"
            textAlign="center"
            marginBottom={12}
          >
            LAST NIGHT
          </Text>
          <View
            flexDirection="row"
            alignItems="center"
            justifyContent="center"
            gap={20}
          >
            <View alignItems="center" gap={6}>
              <View flexDirection="row" alignItems="center" gap={10}>
                <View
                  width={38}
                  height={38}
                  borderRadius={12}
                  backgroundColor="$surface3"
                  alignItems="center"
                  justifyContent="center"
                  onPress={() => adjustHours(-1)}
                  accessibilityLabel="Decrease hours"
                >
                  <IconMinus size={16} color={toneHex("success").base} />
                </View>
                <Text
                  fontFamily="$mono"
                  fontWeight="600"
                  fontSize={40}
                  color="$text"
                  testID="sleep-hours-value"
                  minWidth={56}
                  textAlign="center"
                >
                  {hours}
                </Text>
                <View
                  width={38}
                  height={38}
                  borderRadius={12}
                  backgroundColor="$surface3"
                  alignItems="center"
                  justifyContent="center"
                  onPress={() => adjustHours(1)}
                  accessibilityLabel="Increase hours"
                >
                  <IconPlus size={16} color={toneHex("success").base} />
                </View>
              </View>
              <Text fontFamily="$mono" color="$text3" fontSize={12}>
                hours
              </Text>
            </View>

            <View alignItems="center" gap={6}>
              <View flexDirection="row" alignItems="center" gap={10}>
                <View
                  width={38}
                  height={38}
                  borderRadius={12}
                  backgroundColor="$surface3"
                  alignItems="center"
                  justifyContent="center"
                  onPress={() => adjustMinutes(-1)}
                  accessibilityLabel="Decrease minutes"
                >
                  <IconMinus size={16} color={toneHex("success").base} />
                </View>
                <Text
                  fontFamily="$mono"
                  fontWeight="600"
                  fontSize={40}
                  color="$text"
                  testID="sleep-minutes-value"
                  minWidth={56}
                  textAlign="center"
                >
                  {minutes}
                </Text>
                <View
                  width={38}
                  height={38}
                  borderRadius={12}
                  backgroundColor="$surface3"
                  alignItems="center"
                  justifyContent="center"
                  onPress={() => adjustMinutes(1)}
                  accessibilityLabel="Increase minutes"
                >
                  <IconPlus size={16} color={toneHex("success").base} />
                </View>
              </View>
              <Text fontFamily="$mono" color="$text3" fontSize={12}>
                mins
              </Text>
            </View>
          </View>
        </Card>

        <Btn
          full
          variant="filled"
          tone="success"
          size="lg"
          disabled={saving || !canSave}
          icon={<IconCheck size={16} color={toneHex("success").ink} />}
          onPress={() => onSave({ durationMinutes })}
        >
          {saving ? "Logged ✓" : `Log ${hours}h ${minutes}m`}
        </Btn>
      </View>
    </BottomSheet>
  );
}
