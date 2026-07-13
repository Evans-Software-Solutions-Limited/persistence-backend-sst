import { Text, View } from "@tamagui/core";
import { useEffect, useState } from "react";
import { TextInput, type TextStyle } from "react-native";

/**
 * <RepRange> — the workout creator/editor's per-exercise rep range: a
 * centred "REP RANGE" eyebrow above two separate min/max numeric fields
 * (`[min] – [max]`) inside a `$surface3` box. Ports ~/Downloads/handoff/
 * design-source/screens/workout-creator.jsx `RepRange`.
 *
 * Each field keeps its own text buffer (synced from the `min`/`max` prop
 * whenever it changes) so it can go momentarily empty without snapping back
 * to "0" — see `Stepper` for the full rationale. `onMinBlur`/`onMaxBlur` are
 * additions beyond the visual spec's literal prop list, needed to preserve
 * `ExerciseConfigCard`'s commit-on-blur behaviour.
 */

export type RepRangeProps = {
  min: number;
  max: number;
  onMin: (text: string) => void;
  onMax: (text: string) => void;
  onMinBlur?: (text: string) => void;
  onMaxBlur?: (text: string) => void;
  minTestID?: string;
  maxTestID?: string;
};

export function RepRange({
  min,
  max,
  onMin,
  onMax,
  onMinBlur,
  onMaxBlur,
  minTestID,
  maxTestID,
}: RepRangeProps) {
  const [minBuffer, setMinBuffer] = useState(String(min));
  const [maxBuffer, setMaxBuffer] = useState(String(max));
  useEffect(() => setMinBuffer(String(min)), [min]);
  useEffect(() => setMaxBuffer(String(max)), [max]);

  return (
    <View flex={1.4}>
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
        Rep range
      </Text>
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="center"
        gap={4}
        backgroundColor="$surface3"
        borderColor="$border"
        borderWidth={1}
        borderRadius={10}
        paddingVertical={5}
        paddingHorizontal={8}
      >
        <TextInput
          value={minBuffer}
          onChangeText={(text) => {
            setMinBuffer(text);
            onMin(text);
          }}
          onBlur={() => onMinBlur?.(minBuffer)}
          inputMode="numeric"
          testID={minTestID}
          accessibilityLabel="Min reps"
          style={repInputStyle}
        />
        <Text fontFamily="$mono" fontSize={13} color="$text4">
          –
        </Text>
        <TextInput
          value={maxBuffer}
          onChangeText={(text) => {
            setMaxBuffer(text);
            onMax(text);
          }}
          onBlur={() => onMaxBlur?.(maxBuffer)}
          inputMode="numeric"
          testID={maxTestID}
          accessibilityLabel="Max reps"
          style={repInputStyle}
        />
      </View>
    </View>
  );
}

const repInputStyle: TextStyle = {
  flex: 1,
  minWidth: 0,
  backgroundColor: "transparent",
  textAlign: "center",
  color: "#F4F4F8",
  fontFamily: "Geist Mono",
  fontSize: 14,
  fontWeight: "600",
  padding: 0,
};
