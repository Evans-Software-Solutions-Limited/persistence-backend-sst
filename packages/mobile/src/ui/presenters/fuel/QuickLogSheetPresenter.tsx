import { Pressable, TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { BottomSheet, Btn } from "@/ui/components/foundation";
import { MACRO_HEX } from "./FuelLogSummaryPresenter";

/**
 * <QuickLogSheetPresenter> — canvas N2e "Quick log" (PER-132): the empty form
 * for name, calories and macros. Calories are required; the name and macros
 * are optional. When the macros add up to a different total, it says so and
 * logs the calories typed. Pick a meal with the chips.
 *
 * Not built here: the canvas's "Or tap the camera to read a label" (N2d), whose
 * text-recognition approach is still undecided.
 */

export type QuickLogField = "name" | "kcal" | "protein" | "carbs" | "fat";

export type QuickLogMealChip = { key: string; label: string };

export type QuickLogSheetProps = {
  visible: boolean;
  onClose: () => void;
  values: Record<QuickLogField, string>;
  onChange: (field: QuickLogField, value: string) => void;
  meals: readonly QuickLogMealChip[];
  selectedMealKey: string;
  onSelectMeal: (key: string) => void;
  /** "Your macros add up to 640 kcal. We'll log the 450 you typed." or null. */
  warning: string | null;
  /** Kcal shown on the button, "" until typed. */
  kcalLabel: string;
  mealLabel: string;
  canLog: boolean;
  onLog: () => void;
  testID?: string;
};

const ROWS: { field: QuickLogField; label: string; unit: string }[] = [
  { field: "name", label: "Name", unit: "" },
  { field: "kcal", label: "Calories", unit: "kcal" },
  { field: "protein", label: "Protein", unit: "g" },
  { field: "carbs", label: "Carbs", unit: "g" },
  { field: "fat", label: "Fat", unit: "g" },
];

const LABEL_COLOUR: Partial<Record<QuickLogField, string>> = {
  protein: MACRO_HEX.protein,
  carbs: MACRO_HEX.carbs,
  fat: MACRO_HEX.fat,
};

export function QuickLogSheetPresenter({
  visible,
  onClose,
  values,
  onChange,
  meals,
  selectedMealKey,
  onSelectMeal,
  warning,
  kcalLabel,
  mealLabel,
  canLog,
  onLog,
  testID = "quick-log-sheet",
}: QuickLogSheetProps) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Quick log"
      testID={testID}
      footer={
        <Btn
          variant="filled"
          tone="primary"
          size="lg"
          full
          disabled={!canLog}
          onPress={onLog}
          testID={`${testID}-log`}
        >
          {kcalLabel
            ? `Log ${kcalLabel} kcal to ${mealLabel}`
            : `Log to ${mealLabel}`}
        </Btn>
      }
    >
      <View gap={4}>
        {ROWS.map(({ field, label, unit }) => (
          <View
            key={field}
            flexDirection="row"
            alignItems="center"
            justifyContent="space-between"
            paddingVertical={10}
            borderBottomWidth={1}
            borderColor="$border"
          >
            <Text
              fontFamily="$body"
              fontSize={15}
              fontWeight="500"
              color={LABEL_COLOUR[field] ?? "$text"}
            >
              {label}
            </Text>
            <View flexDirection="row" alignItems="center" gap={6}>
              <TextInput
                value={values[field]}
                onChangeText={(v) => onChange(field, v)}
                keyboardType={field === "name" ? "default" : "decimal-pad"}
                placeholder={field === "name" ? "Optional" : "0"}
                placeholderTextColor="#8A8A98"
                maxLength={field === "name" ? 80 : 7}
                accessibilityLabel={unit ? `${label} in ${unit}` : label}
                testID={`${testID}-${field}`}
                style={{
                  height: 40,
                  minWidth: field === "name" ? 190 : 88,
                  paddingHorizontal: 14,
                  borderRadius: 12,
                  backgroundColor: "#1A1D29",
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.08)",
                  color: "#F4F4F8",
                  fontSize: 15,
                  fontWeight: "600",
                  textAlign: field === "name" ? "left" : "right",
                }}
              />
              {unit ? (
                <Text fontFamily="$body" fontSize={13} color="$text3">
                  {unit}
                </Text>
              ) : null}
            </View>
          </View>
        ))}

        <Text
          fontFamily="$display"
          fontSize={10.5}
          fontWeight="600"
          letterSpacing={1.5}
          textTransform="uppercase"
          color="$text3"
          marginTop={14}
        >
          Meal
        </Text>
        <View flexDirection="row" flexWrap="wrap" gap={8} marginTop={6}>
          {meals.map((m) => {
            const on = m.key === selectedMealKey;
            return (
              <Pressable
                key={m.key}
                onPress={() => onSelectMeal(m.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                testID={`${testID}-meal-${m.key}`}
              >
                <View
                  height={36}
                  paddingHorizontal={12}
                  borderRadius={9999}
                  borderWidth={1}
                  borderColor={on ? "rgba(34,211,238,0.55)" : "$border"}
                  backgroundColor={on ? "rgba(34,211,238,0.10)" : "$surface"}
                  justifyContent="center"
                >
                  <Text
                    fontFamily="$body"
                    fontSize={12}
                    fontWeight="600"
                    color={on ? "$primary" : "$text2"}
                  >
                    {m.label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {warning ? (
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$gold"
            marginTop={12}
            testID={`${testID}-warning`}
          >
            {warning}
          </Text>
        ) : null}
      </View>
    </BottomSheet>
  );
}
