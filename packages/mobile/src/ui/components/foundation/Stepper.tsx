import { Text, View } from "@tamagui/core";
import { useEffect, useState } from "react";
import { TextInput } from "react-native";

import { IconMinus, IconPlus } from "@/ui/components/icons";

import { IconBtn } from "./IconBtn";

/**
 * <Stepper> — labeled ± numeric field: eyebrow label above a
 * `[− IconBtn] [typeable numeric input] [unit] [+ IconBtn]` row inside a
 * `$surface3` box. Ports ~/Downloads/handoff/design-source/screens/
 * workout-creator.jsx `Stepper`.
 *
 * The middle input is a real, typeable `TextInput` — the ± buttons are a
 * convenience, not the only way to set the value. `disabled` dims the whole
 * control and makes the ± buttons a no-op (via `IconBtn`'s own `disabled`,
 * which suppresses `onPress`).
 *
 * The input keeps its own text buffer (synced from `value` whenever it
 * changes) so a momentarily-empty field doesn't snap back to "0" while the
 * caller commits on blur rather than on every keystroke — this is how
 * `ExerciseConfigCard`'s commit-on-blur + empty→0 sentinel behaviour (spec
 * `04-workout-management`) is preserved through the restyle. `onBlur` is an
 * addition beyond the visual spec's literal prop list, needed for that
 * preservation — see CLUSTER6_BRIEF report.
 */

export type StepperProps = {
  label: string;
  value: number;
  unit?: string;
  disabled?: boolean;
  onDec: () => void;
  onInc: () => void;
  onType: (text: string) => void;
  /** Fires on blur with the current buffer text — commit point. */
  onBlur?: (text: string) => void;
  testID?: string;
};

export function Stepper({
  label,
  value,
  unit,
  disabled = false,
  onDec,
  onInc,
  onType,
  onBlur,
  testID,
}: StepperProps) {
  const [buffer, setBuffer] = useState(String(value));
  useEffect(() => {
    setBuffer(String(value));
  }, [value]);

  return (
    <View flex={1} opacity={disabled ? 0.55 : 1}>
      <Text
        fontFamily="$display"
        fontSize={8.5}
        fontWeight="600"
        letterSpacing={1.7}
        textTransform="uppercase"
        color="$text3"
        textAlign="center"
        marginBottom={5}
      >
        {label}
      </Text>
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        backgroundColor="$surface3"
        borderColor="$border"
        borderWidth={1}
        borderRadius={10}
        paddingVertical={5}
        paddingHorizontal={5}
      >
        <IconBtn
          icon={<IconMinus size={12} strokeWidth={2.5} />}
          tone="neutral"
          size={24}
          disabled={disabled}
          onPress={onDec}
          accessibilityLabel={`Decrease ${label.toLowerCase()}`}
          testID={testID ? `${testID}-dec` : undefined}
        />
        <View flexDirection="row" alignItems="baseline" gap={1}>
          <TextInput
            value={buffer}
            editable={!disabled}
            onChangeText={(text) => {
              setBuffer(text);
              onType(text);
            }}
            onBlur={() => onBlur?.(buffer)}
            inputMode="numeric"
            testID={testID}
            accessibilityLabel={label}
            style={{
              width: unit ? 26 : 22,
              backgroundColor: "transparent",
              textAlign: "center",
              color: "#F4F4F8",
              fontFamily: "Geist Mono",
              fontSize: 14,
              fontWeight: "600",
              padding: 0,
            }}
          />
          {unit ? (
            <Text fontFamily="$mono" fontSize={9} color="$text3">
              {unit}
            </Text>
          ) : null}
        </View>
        <IconBtn
          icon={<IconPlus size={12} strokeWidth={2.5} />}
          tone="neutral"
          size={24}
          disabled={disabled}
          onPress={onInc}
          accessibilityLabel={`Increase ${label.toLowerCase()}`}
          testID={testID ? `${testID}-inc` : undefined}
        />
      </View>
    </View>
  );
}
