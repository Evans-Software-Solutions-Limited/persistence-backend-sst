import { TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { BottomSheet, Btn } from "@/ui/components/foundation";
import { MACRO_HEX } from "../FuelLogSummaryPresenter";

/**
 * <PlanQuickItemSheetPresenter> — Quick log in plan mode (PER-133, N30): the
 * same name / calories / macros form as N2e, but it adds a one-off item to
 * the plan instead of logging ("Add 450 kcal to Breakfast"). The Log sheet's
 * own presenter says "Log … to …", which would be wrong here.
 *
 * Pure.
 */

export type PlanQuickField = "name" | "kcal" | "protein" | "carbs" | "fat";

export type PlanQuickItemSheetProps = {
  visible: boolean;
  onClose: () => void;
  values: Record<PlanQuickField, string>;
  onChange: (field: PlanQuickField, value: string) => void;
  mealName: string;
  /** Kcal shown on the button, "" until typed. */
  kcalLabel: string;
  warning: string | null;
  canAdd: boolean;
  onAdd: () => void;
  testID?: string;
};

const ROWS: { field: PlanQuickField; label: string; unit: string }[] = [
  { field: "name", label: "Name", unit: "" },
  { field: "kcal", label: "Calories", unit: "kcal" },
  { field: "protein", label: "Protein", unit: "g" },
  { field: "carbs", label: "Carbs", unit: "g" },
  { field: "fat", label: "Fat", unit: "g" },
];

const LABEL_COLOUR: Partial<Record<PlanQuickField, string>> = {
  protein: MACRO_HEX.protein,
  carbs: MACRO_HEX.carbs,
  fat: MACRO_HEX.fat,
};

export function PlanQuickItemSheetPresenter({
  visible,
  onClose,
  values,
  onChange,
  mealName,
  kcalLabel,
  warning,
  canAdd,
  onAdd,
  testID = "plan-quick",
}: PlanQuickItemSheetProps) {
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
          disabled={!canAdd}
          onPress={onAdd}
          testID={`${testID}-add`}
        >
          {kcalLabel
            ? `Add ${kcalLabel} kcal to ${mealName}`
            : `Add to ${mealName}`}
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
