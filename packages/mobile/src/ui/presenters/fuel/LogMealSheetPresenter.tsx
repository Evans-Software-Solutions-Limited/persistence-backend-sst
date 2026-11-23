import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { toneHex } from "@/ui/components/foundation/tones";
import { BottomSheet, Btn } from "@/ui/components/foundation";
import { IconCheck, IconChevronD, IconX } from "@/ui/components/icons";

/**
 * <LogMealSheetPresenter> — canvas N14 "Log a meal" (PER-133): log a saved
 * meal or recipe with a day, a meal and a portion, then one tap. Each field
 * opens its choices in place.
 */

export type LogMealField = "day" | "meal" | "portion";

export type LogMealOption = { key: string; label: string };

export type LogMealFieldVM = {
  options: readonly LogMealOption[];
  selectedKey: string;
};

export type LogMealSheetProps = {
  visible: boolean;
  onClose: () => void;
  name: string;
  day: LogMealFieldVM;
  meal: LogMealFieldVM;
  portion: LogMealFieldVM;
  /** The field whose choices are showing, or null. */
  openField: LogMealField | null;
  onToggleField: (field: LogMealField) => void;
  onPick: (field: LogMealField, key: string) => void;
  /** "526 kcal · leaves 1,975 today." */
  note: string;
  /** "526" — the button reads "Log 526 kcal". */
  kcalLabel: string;
  canLog: boolean;
  logging: boolean;
  onLog: () => void;
  testID?: string;
};

const FIELDS: { field: LogMealField; label: string }[] = [
  { field: "day", label: "Day" },
  { field: "meal", label: "Meal" },
  { field: "portion", label: "Portion" },
];

const CYAN = "$primary";
const CYAN_HEX = toneHex("primary").base;

export function LogMealSheetPresenter({
  visible,
  onClose,
  name,
  day,
  meal,
  portion,
  openField,
  onToggleField,
  onPick,
  note,
  kcalLabel,
  canLog,
  logging,
  onLog,
  testID = "log-meal-sheet",
}: LogMealSheetProps) {
  const vms: Record<LogMealField, LogMealFieldVM> = { day, meal, portion };
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      height="tall"
      testID={testID}
      footer={
        <Btn
          variant="filled"
          tone="primary"
          size="lg"
          full
          disabled={!canLog || logging}
          onPress={onLog}
          testID={`${testID}-log`}
        >
          {`Log ${kcalLabel} kcal`}
        </Btn>
      }
    >
      <View gap={14}>
        <View
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          gap={12}
        >
          <Text
            flex={1}
            fontFamily="$display"
            fontSize={22}
            fontWeight="700"
            color="$text"
            numberOfLines={2}
            accessibilityRole="header"
            testID={`${testID}-title`}
          >
            {`Log ${name}`}
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            testID={`${testID}-close`}
          >
            <View
              width={44}
              height={44}
              borderRadius={9999}
              alignItems="center"
              justifyContent="center"
              backgroundColor="rgba(255,255,255,0.06)"
              borderWidth={1}
              borderColor="$border"
            >
              <IconX size={20} color="#F4F4F8" />
            </View>
          </Pressable>
        </View>

        <View>
          {FIELDS.map(({ field, label }) => {
            const vm = vms[field];
            const selected = vm.options.find((o) => o.key === vm.selectedKey);
            const open = openField === field;
            return (
              <View key={field}>
                <View
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
                    color="$text"
                  >
                    {label}
                  </Text>
                  <Pressable
                    onPress={() => onToggleField(field)}
                    accessibilityRole="button"
                    accessibilityLabel={`${label}, ${selected?.label ?? ""}`}
                    accessibilityState={{ expanded: open }}
                    testID={`${testID}-${field}`}
                  >
                    <View
                      flexDirection="row"
                      alignItems="center"
                      justifyContent="flex-end"
                      gap={6}
                      height={40}
                      minWidth={88}
                      paddingHorizontal={14}
                      borderRadius={12}
                      backgroundColor="$surface2"
                      borderWidth={1}
                      borderColor="$border"
                    >
                      <Text
                        fontFamily={field === "portion" ? "$mono" : "$body"}
                        fontSize={15}
                        fontWeight="600"
                        color="$text"
                      >
                        {selected?.label ?? ""}
                      </Text>
                      {field === "portion" ? null : (
                        <IconChevronD size={14} color="#8A8A98" />
                      )}
                    </View>
                  </Pressable>
                </View>
                {open ? (
                  <View
                    paddingVertical={4}
                    borderBottomWidth={1}
                    borderColor="$border"
                    testID={`${testID}-${field}-options`}
                  >
                    {vm.options.map((o) => {
                      const on = o.key === vm.selectedKey;
                      return (
                        <Pressable
                          key={o.key}
                          onPress={() => onPick(field, o.key)}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: on }}
                          testID={`${testID}-${field}-${o.key}`}
                        >
                          <View
                            flexDirection="row"
                            alignItems="center"
                            justifyContent="space-between"
                            paddingVertical={10}
                            paddingHorizontal={4}
                          >
                            <Text
                              fontFamily="$body"
                              fontSize={15}
                              color={on ? CYAN : "$text2"}
                            >
                              {o.label}
                            </Text>
                            {on ? (
                              <IconCheck size={16} color={CYAN_HEX} />
                            ) : null}
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>

        {note ? (
          <Text
            fontFamily="$body"
            fontSize={13}
            lineHeight={18}
            color="$text3"
            testID={`${testID}-note`}
          >
            {note}
          </Text>
        ) : null}
      </View>
    </BottomSheet>
  );
}
