import { Text, View } from "@tamagui/core";
import { Segmented } from "@/ui/components/foundation";
import { MEAL_SLOTS } from "@/domain/services";
import type { MealSlot } from "@/domain/models/nutrition";

/**
 * <MealPickerPresenter> — the reusable "ADD TO MEAL" slot picker shared by the
 * Scan + Quick-add sheets (fuel-sheets.jsx MealPicker). Built on the design-
 * system <Segmented> (4 options) rather than bespoke chips.
 *
 * Implements: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § Sheets
 */

const OPTIONS = MEAL_SLOTS.map((m) => ({ value: m.slot, label: m.label }));

export type MealPickerProps = {
  value: MealSlot;
  onChange: (slot: MealSlot) => void;
  testID?: string;
};

export function MealPickerPresenter({
  value,
  onChange,
  testID = "meal-picker",
}: MealPickerProps) {
  return (
    <View gap={6}>
      <Text
        fontFamily="$display"
        fontSize={10.5}
        fontWeight="600"
        letterSpacing={1.5}
        textTransform="uppercase"
        color="$text3"
        paddingLeft={2}
      >
        Add to meal
      </Text>
      <Segmented
        testID={testID}
        options={OPTIONS}
        value={value}
        onChange={(v) => onChange(v as MealSlot)}
      />
    </View>
  );
}
