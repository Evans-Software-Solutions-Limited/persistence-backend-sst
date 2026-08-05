/**
 * <PlanTodayPresenter> — the plan Today/adherence view (spec-26 Phase 2,
 * STORY-005 AC 5.3). A pushed route (not a sheet — mirrors
 * `MealprintPreferencesScreen`'s reasoning: this is a place you go and stay,
 * not a transient flow), ported from `AMPlanToday` (`res4_application_javascript.txt`).
 *
 * Shows day totals vs target (from the LOGGED meals only — see
 * `computePlanAdherence`), then every plan meal with its logged/planned
 * state and a per-meal Log/Swap action.
 */

import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card, HeaderBar, IconBtn, Pill } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import {
  IconCheck,
  IconChevronL,
  IconMedal,
  IconPlus,
  IconSwap,
  IconTrash,
} from "@/ui/components/icons";
import type { MealPlan, PlanMeal, PlanTarget } from "@/domain/models/mealprint";

const GOLD = toneHex("gold");
const SUCCESS = toneHex("success");

export type PlanTodayProps = {
  readonly loading: boolean;
  readonly plan: MealPlan | null;
  readonly loggedTotals: PlanTarget;
  readonly loggedCount: number;
  readonly totalCount: number;
  readonly onBack: () => void;
  readonly onLogMeal: (meal: PlanMeal) => void;
  readonly loggingMealId: string | null;
  readonly onSwapMeal: (meal: PlanMeal) => void;
  readonly swappingMealId: string | null;
  readonly onDeletePlan: () => void;
  readonly deleting: boolean;
  readonly testID?: string;
};

const round = (value: number) => Math.round(value);

export function PlanTodayPresenter({
  loading,
  plan,
  loggedTotals,
  loggedCount,
  totalCount,
  onBack,
  onLogMeal,
  loggingMealId,
  onSwapMeal,
  swappingMealId,
  onDeletePlan,
  deleting,
  testID = "plan-today-screen",
}: PlanTodayProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID={testID}
    >
      <HeaderBar
        title="Today's plan"
        leading={
          <IconBtn
            icon={<IconChevronL size={18} />}
            tone="ghost"
            onPress={onBack}
            testID="plan-today-back"
            accessibilityLabel="Back"
          />
        }
        trailing={
          plan ? (
            <IconBtn
              icon={<IconTrash size={16} />}
              tone="ghost"
              onPress={onDeletePlan}
              disabled={deleting}
              testID="plan-today-delete"
              accessibilityLabel="Delete this plan"
            />
          ) : undefined
        }
      />

      {loading && plan === null ? (
        <View flex={1} alignItems="center" justifyContent="center">
          <Text fontFamily="$body" fontSize={13} color="$text3">
            Loading your plan…
          </Text>
        </View>
      ) : plan === null ? (
        <View
          flex={1}
          alignItems="center"
          justifyContent="center"
          padding={24}
          gap={10}
          testID="plan-today-empty"
        >
          <IconMedal size={28} color={GOLD.base} />
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={16}
            color="$text"
            textAlign="center"
          >
            No plan for today
          </Text>
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$text3"
            textAlign="center"
          >
            Head back to Fuel and tap &quot;Plan my day&quot; to build one.
          </Text>
        </View>
      ) : (
        <View flex={1} padding={16} gap={16}>
          <Card
            pad={16}
            radius={16}
            accent="gold"
            testID="plan-today-adherence"
          >
            <View
              flexDirection="row"
              alignItems="center"
              justifyContent="space-between"
              marginBottom={10}
            >
              <Text
                fontFamily="$display"
                fontSize={10.5}
                fontWeight="600"
                letterSpacing={1.5}
                textTransform="uppercase"
                color="$text3"
              >
                Plan adherence · {loggedCount}/{totalCount} meals
              </Text>
              <Text
                fontFamily="$mono"
                fontWeight="600"
                fontSize={16}
                color="$gold"
              >
                {round(loggedTotals.kcal).toLocaleString("en-US")}
                <Text fontFamily="$mono" fontSize={12} color="$text3">
                  {" "}
                  / {round(plan.targetKcal).toLocaleString("en-US")} kcal
                </Text>
              </Text>
            </View>
            <View
              height={6}
              borderRadius={3}
              backgroundColor="$surface3"
              overflow="hidden"
            >
              <View
                height={6}
                borderRadius={3}
                width={`${
                  plan.targetKcal > 0
                    ? Math.min(
                        100,
                        Math.round((loggedTotals.kcal / plan.targetKcal) * 100),
                      )
                    : 0
                }%`}
                backgroundColor="$gold"
              />
            </View>
          </Card>

          <Text
            fontFamily="$display"
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.5}
            textTransform="uppercase"
            color="$text3"
            paddingLeft={2}
          >
            Meals · planned vs logged
          </Text>

          {plan.meals
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((meal) => {
              const logged = meal.state === "logged";
              return (
                <Card
                  key={meal.id}
                  pad={13}
                  radius={13}
                  testID={`plan-today-meal-${meal.id}`}
                >
                  <View flexDirection="row" alignItems="center" gap={12}>
                    <View
                      width={34}
                      height={34}
                      borderRadius={9}
                      alignItems="center"
                      justifyContent="center"
                      backgroundColor={logged ? SUCCESS.dim : GOLD.dim}
                    >
                      {logged ? (
                        <IconCheck
                          size={16}
                          strokeWidth={2.5}
                          color={SUCCESS.base}
                        />
                      ) : (
                        <IconPlus size={15} color={GOLD.base} />
                      )}
                    </View>
                    <View flex={1} minWidth={0}>
                      <Text
                        fontFamily="$body"
                        fontSize={13.5}
                        fontWeight="500"
                        color="$text"
                        numberOfLines={1}
                      >
                        {meal.label}
                      </Text>
                      <Text fontFamily="$body" fontSize={11} color="$text3">
                        {meal.logSlot} · {round(meal.kcal)} kcal
                      </Text>
                    </View>
                    {logged ? (
                      <Pill tone="success" size="xs">
                        LOGGED
                      </Pill>
                    ) : (
                      <View flexDirection="row" gap={6}>
                        <Pressable
                          onPress={() => onSwapMeal(meal)}
                          disabled={swappingMealId === meal.id}
                          testID={`plan-today-swap-${meal.id}`}
                          accessibilityRole="button"
                          accessibilityLabel={`Swap ${meal.label}`}
                        >
                          <View
                            height={30}
                            paddingHorizontal={10}
                            borderRadius={9}
                            flexDirection="row"
                            alignItems="center"
                            gap={5}
                            backgroundColor="$surface3"
                            borderWidth={1}
                            borderColor="$border2"
                          >
                            <IconSwap size={12} color="#A0A0AC" />
                            <Text
                              fontFamily="$display"
                              fontWeight="600"
                              fontSize={11.5}
                              color="$text2"
                            >
                              {swappingMealId === meal.id ? "…" : "Swap"}
                            </Text>
                          </View>
                        </Pressable>
                        <Pressable
                          onPress={() => onLogMeal(meal)}
                          disabled={loggingMealId === meal.id}
                          testID={`plan-today-log-${meal.id}`}
                          accessibilityRole="button"
                          accessibilityLabel={`Log ${meal.label}`}
                        >
                          <View
                            height={30}
                            paddingHorizontal={12}
                            borderRadius={9}
                            flexDirection="row"
                            alignItems="center"
                            gap={5}
                            backgroundColor="$goldDim"
                            borderWidth={1}
                            borderColor="$gold"
                          >
                            <IconPlus
                              size={11}
                              strokeWidth={2.5}
                              color={GOLD.base}
                            />
                            <Text
                              fontFamily="$display"
                              fontWeight="600"
                              fontSize={11.5}
                              color="$gold"
                            >
                              {loggingMealId === meal.id ? "Logging…" : "Log"}
                            </Text>
                          </View>
                        </Pressable>
                      </View>
                    )}
                  </View>
                </Card>
              );
            })}
        </View>
      )}
    </View>
  );
}
