import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { Text, View } from "@tamagui/core";
import { BottomSheet, Btn } from "@/ui/components/foundation";
import { DatePickerField } from "@/ui/components/DatePickerField";
import { localDayISO } from "@/shared/utils";
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

/** Shared quick-fill drawer preserves the calculator and onboarding drafts. */
export function FuelProfileEditor({
  state,
  heightUnit,
  weightUnit,
  onChange,
  onSave,
  onCancel,
}: FuelProfileEditorProps) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const imperialHeight = state.field === "height" && heightUnit === "ftin";
  const label =
    state.field === "age"
      ? "Date of birth"
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
    <BottomSheet
      visible
      onClose={onCancel}
      title={label}
      eyebrow="PROFILE DETAILS"
      accent="primary"
      height="peek"
      testID="fuel-profile-editor"
      footer={
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
      }
    >
      <View gap={12}>
        {state.field === "age" ? (
          <DatePickerField
            label="Date of birth"
            value={state.value}
            onChange={onChange}
            maximumDate={localDayISO(yesterday)}
            allowClear={false}
            testID="fuel-profile-dob"
          />
        ) : state.field === "gender" ? (
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
            <BottomSheetTextInput
              autoFocus
              value={state.value}
              onChangeText={onChange}
              accessibilityLabel={label}
              placeholder="0"
              placeholderTextColor={color.$text3}
              keyboardType="decimal-pad"
              style={inputStyle}
              testID="fuel-profile-value"
            />
            {imperialHeight ? (
              <BottomSheetTextInput
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
      </View>
    </BottomSheet>
  );
}
