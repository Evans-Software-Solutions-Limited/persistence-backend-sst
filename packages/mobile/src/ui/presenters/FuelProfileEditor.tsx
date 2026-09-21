import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { Text, View } from "@tamagui/core";
import { BottomSheet, Btn } from "@/ui/components/foundation";
import { DatePickerField } from "@/ui/components/DatePickerField";
import { localDayISO } from "@/shared/utils";
import { color } from "@/ui/theme/tokens";
import type { FuelProfileEditorState } from "@/ui/hooks/useFuelProfileEditor";
import type { HeightInputFormat } from "@/shared/utils/height-input";
import type { HeightUnit, WeightUnit } from "@/shared/utils";

export type FuelProfileEditorProps = {
  state: FuelProfileEditorState;
  heightUnit: HeightUnit;
  weightUnit: WeightUnit;
  onChange: (value: string, inches?: boolean) => void;
  onHeightFormatChange?: (format: HeightInputFormat) => void;
  onSave: () => void;
  onCancel: () => void;
};

/** Shared quick-fill drawer preserves the calculator and onboarding drafts. */
export function FuelProfileEditor({
  state,
  heightUnit,
  weightUnit,
  onChange,
  onHeightFormatChange,
  onSave,
  onCancel,
}: FuelProfileEditorProps) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const heightFormat = state.heightFormat ?? heightUnit;
  const splitHeight =
    state.field === "height" &&
    (heightFormat === "ftin" || heightFormat === "mcm");
  const heightLabel =
    heightFormat === "ftin"
      ? "feet"
      : heightFormat === "mcm"
        ? "metres"
        : heightFormat === "in"
          ? "inches"
          : "cm";
  const label =
    state.field === "age"
      ? "Date of birth"
      : state.field === "gender"
        ? "Sex for calculation"
        : state.field === "height"
          ? `Height (${heightLabel})`
          : `Weight (${weightUnit})`;
  const inputStyle = {
    flex: 1,
    minWidth: 0,
    width: 0,
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
        {state.field === "height" && onHeightFormatChange ? (
          <View flexDirection="row" flexWrap="wrap" gap={8}>
            {(
              [
                ["cm", "cm"],
                ["mcm", "m + cm"],
                ["in", "inches"],
                ["ftin", "ft + in"],
              ] as const
            ).map(([format, text]) => (
              <Btn
                key={format}
                size="sm"
                variant={format === heightFormat ? "filled" : "outline"}
                onPress={() => onHeightFormatChange(format)}
                testID={`fuel-height-format-${format}`}
              >
                {text}
              </Btn>
            ))}
          </View>
        ) : null}
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
          <View flexDirection="row" gap={8} alignItems="center">
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
            {state.field === "height" ? (
              <Text color="$text3">
                {heightFormat === "mcm"
                  ? "m"
                  : heightFormat === "ftin"
                    ? "ft"
                    : heightFormat === "in"
                      ? "in"
                      : "cm"}
              </Text>
            ) : null}
            {splitHeight ? (
              <>
                <BottomSheetTextInput
                  value={state.inches}
                  onChangeText={(value) => onChange(value, true)}
                  accessibilityLabel={
                    heightFormat === "mcm"
                      ? "Height (remaining centimetres)"
                      : "Height (inches)"
                  }
                  placeholder={heightFormat === "mcm" ? "cm" : "Inches"}
                  placeholderTextColor={color.$text3}
                  keyboardType="decimal-pad"
                  style={inputStyle}
                  testID="fuel-profile-inches"
                />
                <Text color="$text3">
                  {heightFormat === "mcm" ? "cm" : "in"}
                </Text>
              </>
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
