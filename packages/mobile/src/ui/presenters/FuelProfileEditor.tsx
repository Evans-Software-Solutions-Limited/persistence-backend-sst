import { TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { Btn, Card } from "@/ui/components/foundation";
import { color } from "@/ui/theme/tokens";
import type { FuelProfileEditorState } from "@/ui/hooks/useFuelProfileEditor";
import type { HeightUnit, WeightUnit } from "@/shared/utils";

export type FuelProfileEditorProps = {
  state: FuelProfileEditorState;
  heightUnit: HeightUnit;
  weightUnit: WeightUnit;
  onChange: (value: string, inches?: boolean) => void;
  onSave: () => void;
  onCancel: () => void;
};

/** An in-place form keeps the calculator and onboarding drafts mounted. */
export function FuelProfileEditor({
  state,
  heightUnit,
  weightUnit,
  onChange,
  onSave,
  onCancel,
}: FuelProfileEditorProps) {
  const imperialHeight = state.field === "height" && heightUnit === "ftin";
  const label =
    state.field === "age"
      ? "Date of birth (YYYY-MM-DD)"
      : state.field === "gender"
        ? "Sex for calculation"
        : state.field === "height"
          ? `Height (${imperialHeight ? "feet" : "cm"})`
          : `Weight (${weightUnit})`;
  const inputStyle = {
    flex: 1,
    borderWidth: 1,
    borderColor: color.$border2,
    borderRadius: 10,
    padding: 12,
    color: color.$text,
    fontSize: 16,
    backgroundColor: color.$bg,
  };
  return (
    <Card pad={14} radius={12} testID="fuel-profile-editor">
      <View gap={12}>
        <Text fontFamily="$body" fontWeight="600" color="$text">
          {label}
        </Text>
        {state.field === "gender" ? (
          <View flexDirection="row" flexWrap="wrap" gap={8}>
            {(["male", "female", "other"] as const).map((sex) => (
              <Btn
                key={sex}
                size="sm"
                variant={state.value === sex ? "filled" : "outline"}
                onPress={() => onChange(sex)}
                testID={`fuel-profile-gender-${sex}`}
              >
                {sex === "male"
                  ? "Male"
                  : sex === "female"
                    ? "Female"
                    : "Other"}
              </Btn>
            ))}
          </View>
        ) : (
          <View flexDirection="row" gap={8}>
            <TextInput
              autoFocus
              value={state.value}
              onChangeText={onChange}
              accessibilityLabel={label}
              placeholder={state.field === "age" ? "YYYY-MM-DD" : "0"}
              placeholderTextColor={color.$text3}
              keyboardType={
                state.field === "age"
                  ? "numbers-and-punctuation"
                  : "decimal-pad"
              }
              style={inputStyle}
              testID="fuel-profile-value"
            />
            {imperialHeight ? (
              <TextInput
                value={state.inches}
                onChangeText={(value) => onChange(value, true)}
                accessibilityLabel="Height (inches)"
                placeholder="Inches"
                placeholderTextColor={color.$text3}
                keyboardType="decimal-pad"
                style={inputStyle}
                testID="fuel-profile-inches"
              />
            ) : null}
          </View>
        )}
        <Text fontFamily="$body" fontSize={12} color="$text3">
          {state.field === "weight"
            ? "Saves today's weigh-in to your progress and updates this calculation."
            : "Saves to your profile and updates this calculation."}
        </Text>
        {state.error ? (
          <Text
            accessibilityRole="alert"
            fontFamily="$body"
            fontSize={12}
            color="$text"
            testID="fuel-profile-error"
          >
            {state.error}
          </Text>
        ) : null}
        <View flexDirection="row" gap={8}>
          <Btn
            variant="outline"
            onPress={onCancel}
            testID="fuel-profile-cancel"
          >
            Cancel
          </Btn>
          <Btn
            variant="filled"
            tone="primary"
            onPress={onSave}
            testID="fuel-profile-save"
          >
            Save details
          </Btn>
        </View>
      </View>
    </Card>
  );
}
