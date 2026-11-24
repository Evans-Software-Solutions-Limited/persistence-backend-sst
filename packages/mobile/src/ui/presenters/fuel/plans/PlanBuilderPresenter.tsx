import { Pressable, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import { Copy, Utensils } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Btn } from "@/ui/components/foundation";
import { IconMore, IconPlus, IconSearch } from "@/ui/components/icons";
import { BackBtn, Chip, PlanTopBar, RoundIconBtn, TopLink } from "./PlanChrome";
import {
  PlanTargetSummaryPresenter,
  type PlanTargetSummaryProps,
} from "./PlanTargetSummaryPresenter";

/**
 * <PlanBuilderPresenter> — canvas N29 "Build · empty", N32 "Build · filled"
 * and N34 "Edit a plan" (PER-133). The plan's name, "Mine · target …", the
 * compact ring against the person's own target, then each meal with its
 * foods. An empty meal shows "Nothing yet" with Add food / From a past day.
 *
 * New: "New plan" with Save in the top bar and "Save plan" at the foot
 * ("Add something to save" while empty). Edit: "Edit plan" with ⋯ (N34
 * options) and "Save changes".
 *
 * Pure: every value is a prop.
 */

export type PlanItemRowVM = {
  id: string;
  name: string;
  /** "Recipe · 1 portion", "1 bar". */
  sub: string;
  kcal: string;
};

export type PlanMealVM = {
  id: string;
  name: string;
  /** "520 kcal", or "" when empty. */
  kcalText: string;
  items: readonly PlanItemRowVM[];
};

export type PlanBuilderProps = {
  mode: "new" | "edit";
  onBack: () => void;
  /** ⋯ Plan options (edit only). */
  onOptions: () => void;
  name: string;
  subtitle: string;
  summary: PlanTargetSummaryProps;
  meals: readonly PlanMealVM[];
  onAddToMeal: (mealId: string) => void;
  onFromPastDay: (mealId: string) => void;
  onItem: (mealId: string, itemId: string) => void;
  onAddMeal: () => void;
  /** A one-line note (a past day that isn't on the phone). */
  notice: string | null;
  ctaLabel: string;
  canSave: boolean;
  saving: boolean;
  onSave: () => void;
  testID?: string;
};

export function PlanBuilderPresenter({
  mode,
  onBack,
  onOptions,
  name,
  subtitle,
  summary,
  meals,
  onAddToMeal,
  onFromPastDay,
  onItem,
  onAddMeal,
  notice,
  ctaLabel,
  canSave,
  saving,
  onSave,
  testID = "plan-builder",
}: PlanBuilderProps) {
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
        eyebrow={mode === "new" ? "New plan" : "Edit plan"}
        right={
          mode === "new" ? (
            <TopLink
              label="Save"
              onPress={onSave}
              disabled={!canSave || saving}
              testID={`${testID}-top-save`}
            />
          ) : (
            <RoundIconBtn
              label="Plan options"
              onPress={onOptions}
              testID={`${testID}-options`}
            >
              <IconMore size={20} color="#F4F4F8" />
            </RoundIconBtn>
          )
        }
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 150 }}
      >
        <Text
          fontFamily="$display"
          fontSize={24}
          lineHeight={30}
          fontWeight="800"
          letterSpacing={-0.5}
          color="$text"
          accessibilityRole="header"
          testID={`${testID}-name`}
        >
          {name}
        </Text>
        <Text
          fontFamily="$body"
          fontSize={12}
          color="$text3"
          testID={`${testID}-subtitle`}
        >
          {subtitle}
        </Text>

        <PlanTargetSummaryPresenter {...summary} />

        {notice ? (
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$warning"
            marginTop={12}
            testID={`${testID}-notice`}
          >
            {notice}
          </Text>
        ) : null}

        {meals.map((m) => (
          <View key={m.id} testID={`${testID}-meal-${m.id}`}>
            <View
              flexDirection="row"
              alignItems="center"
              gap={10}
              marginTop={18}
            >
              <Text
                flex={1}
                fontFamily="$body"
                fontSize={17}
                fontWeight="700"
                color="$text"
                numberOfLines={1}
              >
                {m.name}
              </Text>
              {m.kcalText ? (
                <Text
                  fontFamily="$mono"
                  fontSize={13}
                  fontWeight="600"
                  color="$text2"
                >
                  {m.kcalText}
                </Text>
              ) : null}
              <Pressable
                onPress={() => onAddToMeal(m.id)}
                accessibilityRole="button"
                accessibilityLabel={`Add to ${m.name}`}
                hitSlop={6}
                testID={`${testID}-add-${m.id}`}
              >
                <View
                  width={32}
                  height={32}
                  borderRadius={10}
                  backgroundColor="$surface2"
                  borderWidth={1}
                  borderColor="rgba(255,255,255,0.08)"
                  alignItems="center"
                  justifyContent="center"
                >
                  <IconPlus size={16} color="#22D3EE" />
                </View>
              </Pressable>
            </View>

            {m.items.map((x) => (
              <Pressable
                key={x.id}
                onPress={() => onItem(m.id, x.id)}
                accessibilityRole="button"
                accessibilityLabel={`${x.name}: change amount or remove`}
                testID={`${testID}-item-${x.id}`}
              >
                <View
                  flexDirection="row"
                  alignItems="center"
                  gap={12}
                  paddingVertical={10}
                  borderBottomWidth={1}
                  borderColor="$border"
                >
                  <View
                    width={40}
                    height={40}
                    borderRadius={14}
                    backgroundColor="$surface4"
                    alignItems="center"
                    justifyContent="center"
                  >
                    <Utensils size={16} color="#5C5C68" />
                  </View>
                  <View flex={1} gap={2}>
                    <Text
                      fontFamily="$body"
                      fontSize={15}
                      fontWeight="500"
                      color="$text"
                      numberOfLines={1}
                    >
                      {x.name}
                    </Text>
                    <Text fontFamily="$body" fontSize={12} color="$text3">
                      {x.sub}
                    </Text>
                  </View>
                  <Text
                    fontFamily="$mono"
                    fontSize={14}
                    fontWeight="600"
                    color="$text"
                  >
                    {x.kcal}
                  </Text>
                </View>
              </Pressable>
            ))}

            {m.items.length === 0 ? (
              <View
                marginTop={8}
                paddingVertical={10}
                paddingHorizontal={12}
                borderRadius={12}
                borderWidth={1}
                borderStyle="dashed"
                borderColor="$border3"
                flexDirection="row"
                alignItems="center"
                justifyContent="space-between"
                gap={12}
                testID={`${testID}-empty-${m.id}`}
              >
                <Text
                  fontFamily="$body"
                  fontSize={13}
                  fontWeight="500"
                  color="$text3"
                >
                  Nothing yet
                </Text>
                <View flexDirection="row" gap={6}>
                  <Chip
                    label="Add food"
                    height={34}
                    icon={<IconSearch size={14} color="#C2C2CE" />}
                    onPress={() => onAddToMeal(m.id)}
                    accessibilityLabel={`Add food to ${m.name}`}
                    testID={`${testID}-addfood-${m.id}`}
                  />
                  <Chip
                    label="From a past day"
                    height={34}
                    icon={<Copy size={14} color="#C2C2CE" />}
                    onPress={() => onFromPastDay(m.id)}
                    accessibilityLabel={`${m.name} from a past day`}
                    testID={`${testID}-pastday-${m.id}`}
                  />
                </View>
              </View>
            ) : null}
          </View>
        ))}

        <View marginTop={16} alignSelf="flex-start">
          <Chip
            label="Add a meal"
            height={40}
            icon={<IconPlus size={14} color="#C2C2CE" />}
            onPress={onAddMeal}
            testID={`${testID}-add-meal`}
          />
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
          disabled={!canSave || saving}
          onPress={onSave}
          testID={`${testID}-cta`}
        >
          {ctaLabel}
        </Btn>
      </View>
    </View>
  );
}
