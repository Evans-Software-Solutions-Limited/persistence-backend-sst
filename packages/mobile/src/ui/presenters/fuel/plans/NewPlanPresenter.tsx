import type { ReactNode } from "react";
import { Pressable, ScrollView, TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet, Btn } from "@/ui/components/foundation";
import { DateCalendarModal } from "@/ui/components/DatePickerField";
import { IconChevronR } from "@/ui/components/icons";
import { PLAN_NAME_MAX } from "@/domain/models/nutritionPlans";
import { BackBtn, Eyebrow, PlanTopBar, SheetTitle } from "./PlanChrome";

/**
 * <NewPlanPresenter> — canvas N28 "New plan" (PER-133): Name, Target (the
 * person's own target; opens the targets calculator), Meals (opens N28b),
 * then Start from: Empty meals · A day you logged · One of your plans · Let
 * Mealprint fill it (Premium+). The CTA reads "Start building", or "Continue
 * in Mealprint" for the last option.
 *
 * A plan has no days (Design D), so nothing here schedules it.
 *
 * Pure: the container owns the form state and the navigation.
 */

export type StartFrom = "empty" | "day" | "plan" | "mealprint";

export type StartOptionVM = {
  key: StartFrom;
  label: string;
  sub: string;
  selected: boolean;
  /** The Premium+ pill (Let Mealprint fill it). */
  gold: boolean;
};

export type PlanPickRowVM = { id: string; name: string; sub: string };

export type NewPlanProps = {
  onBack: () => void;
  name: string;
  onName: (name: string) => void;
  /** "2,371 kcal", or "Set a target" when the person has none. */
  targetValue: string;
  onTarget: () => void;
  /** "Breakfast, Lunch, Dinner, Snacks". */
  mealsText: string;
  onEditMeals: () => void;
  options: readonly StartOptionVM[];
  onOption: (key: StartFrom) => void;
  ctaLabel: string;
  canContinue: boolean;
  onContinue: () => void;
  /** Pick a past day (A day you logged). */
  calendarVisible: boolean;
  calendarDay: string;
  maxDay: string;
  onPickDay: (iso: string) => void;
  onCloseCalendar: () => void;
  /** Pick one of your plans. */
  planPickerVisible: boolean;
  plans: readonly PlanPickRowVM[];
  onPickPlan: (id: string) => void;
  onClosePlanPicker: () => void;
  testID?: string;
};

function Row({
  title,
  sub,
  right,
  onPress,
  accessibilityLabel,
  testID,
}: {
  title: string;
  sub: string;
  right: ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      <View
        flexDirection="row"
        alignItems="center"
        gap={12}
        paddingVertical={10}
        borderBottomWidth={1}
        borderColor="$border"
      >
        <View flex={1} gap={2}>
          <Text fontFamily="$body" fontSize={15} fontWeight="500" color="$text">
            {title}
          </Text>
          <Text fontFamily="$body" fontSize={12} color="$text3">
            {sub}
          </Text>
        </View>
        {right}
      </View>
    </Pressable>
  );
}

export function NewPlanPresenter({
  onBack,
  name,
  onName,
  targetValue,
  onTarget,
  mealsText,
  onEditMeals,
  options,
  onOption,
  ctaLabel,
  canContinue,
  onContinue,
  calendarVisible,
  calendarDay,
  maxDay,
  onPickDay,
  onCloseCalendar,
  planPickerVisible,
  plans,
  onPickPlan,
  onClosePlanPicker,
  testID = "new-plan",
}: NewPlanProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID={testID}
    >
      <PlanTopBar
        left={<BackBtn onPress={onBack} testID={`${testID}-back`} />}
        eyebrow="New plan"
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 140 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text
          fontFamily="$display"
          fontSize={30}
          lineHeight={36}
          fontWeight="800"
          letterSpacing={-0.8}
          color="$text"
          accessibilityRole="header"
        >
          New plan
        </Text>
        <Text fontFamily="$body" fontSize={14} color="$text2" marginTop={6}>
          A plan is a set of meals for a kind of day.
        </Text>

        <View marginTop={12}>
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
              Name
            </Text>
            <TextInput
              value={name}
              onChangeText={onName}
              maxLength={PLAN_NAME_MAX}
              placeholder="Name your plan"
              placeholderTextColor="#8A8A98"
              returnKeyType="done"
              accessibilityLabel="Name"
              testID={`${testID}-name`}
              style={{
                height: 40,
                minWidth: 200,
                paddingHorizontal: 14,
                borderRadius: 12,
                backgroundColor: "#1A1D29",
                borderWidth: 1,
                borderColor: "rgba(34,211,238,0.55)",
                color: "#F4F4F8",
                fontSize: 15,
                fontWeight: "600",
              }}
            />
          </View>
          <Row
            title="Target"
            sub="Opens your targets calculator"
            onPress={onTarget}
            accessibilityLabel={`Target: ${targetValue}. Opens your targets calculator`}
            testID={`${testID}-target`}
            right={
              <View flexDirection="row" alignItems="center" gap={6}>
                <Text
                  fontFamily="$mono"
                  fontSize={15}
                  fontWeight="600"
                  color="$text"
                >
                  {targetValue}
                </Text>
                <IconChevronR size={16} color="#5C5C68" />
              </View>
            }
          />
          <Row
            title="Meals"
            sub={mealsText}
            onPress={onEditMeals}
            accessibilityLabel={`Meals: ${mealsText}. Edit meals`}
            testID={`${testID}-meals`}
            right={
              <Text
                fontFamily="$body"
                fontSize={14}
                fontWeight="600"
                color="$primary"
              >
                Edit
              </Text>
            }
          />
        </View>

        <Eyebrow marginTop={22}>Start from</Eyebrow>
        <View accessibilityRole="radiogroup" accessibilityLabel="Start from">
          {options.map((o) => (
            <Pressable
              key={o.key}
              onPress={() => onOption(o.key)}
              accessibilityRole="radio"
              accessibilityState={{ checked: o.selected }}
              testID={`${testID}-from-${o.key}`}
            >
              <View
                flexDirection="row"
                alignItems="center"
                gap={12}
                paddingVertical={11}
                borderBottomWidth={1}
                borderColor="$border"
              >
                <View
                  width={22}
                  height={22}
                  borderRadius={9999}
                  borderWidth={2}
                  borderColor={o.selected ? "$primary" : "$text4"}
                  alignItems="center"
                  justifyContent="center"
                >
                  {o.selected ? (
                    <View
                      width={10}
                      height={10}
                      borderRadius={9999}
                      backgroundColor="$primary"
                    />
                  ) : null}
                </View>
                <View flex={1} gap={2}>
                  <Text
                    fontFamily="$body"
                    fontSize={15}
                    fontWeight="500"
                    color="$text"
                  >
                    {o.label}
                  </Text>
                  <Text
                    fontFamily="$body"
                    fontSize={12}
                    color="$text3"
                    testID={`${testID}-from-${o.key}-sub`}
                  >
                    {o.sub}
                  </Text>
                </View>
                {o.gold ? (
                  <View
                    height={22}
                    paddingHorizontal={8}
                    borderRadius={9999}
                    backgroundColor="$goldDim"
                    justifyContent="center"
                  >
                    <Text
                      fontFamily="$body"
                      fontSize={11}
                      fontWeight="600"
                      color="$gold"
                    >
                      Premium+
                    </Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <View
        position="absolute"
        left={20}
        right={20}
        bottom={insets.bottom + 16}
      >
        <Btn
          variant="filled"
          tone="primary"
          size="lg"
          full
          disabled={!canContinue}
          onPress={onContinue}
          testID={`${testID}-cta`}
        >
          {ctaLabel}
        </Btn>
      </View>

      <DateCalendarModal
        visible={calendarVisible}
        selectedDate={calendarDay}
        maximumDate={maxDay}
        onSelectDate={onPickDay}
        onClose={onCloseCalendar}
        label="A day you logged"
        testID={`${testID}-calendar`}
      />

      <BottomSheet
        visible={planPickerVisible}
        onClose={onClosePlanPicker}
        height="content"
        testID={`${testID}-plans`}
      >
        <View>
          <SheetTitle>Your plans</SheetTitle>
          {plans.map((p) => (
            <Row
              key={p.id}
              title={p.name}
              sub={p.sub}
              onPress={() => onPickPlan(p.id)}
              accessibilityLabel={p.name}
              testID={`${testID}-plan-${p.id}`}
              right={<IconChevronR size={16} color="#5C5C68" />}
            />
          ))}
        </View>
      </BottomSheet>
    </View>
  );
}
