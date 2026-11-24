import type { ReactNode } from "react";
import { Pressable, ScrollView, TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet, Btn } from "@/ui/components/foundation";
import {
  IconBarcode,
  IconCalendar,
  IconCamera,
  IconCheck,
  IconChevronD,
  IconPlus,
  IconSearch,
} from "@/ui/components/icons";
import { BackBtn, Chip, Eyebrow, SheetTitle } from "./PlanChrome";

/**
 * <PlanAddFoodPresenter> — canvas N30 "Add to a meal" in plan mode
 * (PER-133): the meal name (tap to switch meal), "Search for a food", All ·
 * My Meals · My Foods · Recipes, the Barcode scan · Add photo · Quick log
 * tiles, "Adding to your <plan> plan, not today's log", then History rows
 * with + toggles. "Add N items to <meal>", or "Tap + to add, or tap a food
 * for its amount".
 *
 * Barcode scan and Add photo log straight to today in this app, so in plan
 * mode they show but are switched off.
 *
 * Pure: the container owns search, picks and the draft.
 */

export type PlanAddTab = "all" | "meals" | "foods" | "recipes";

export type PlanAddRowVM = {
  key: string;
  name: string;
  /** "My meal · 520 kcal", "1 pot · 344 kcal". */
  sub: string;
  picked: boolean;
};

export type PlanAddFoodProps = {
  onBack: () => void;
  mealName: string;
  planName: string;
  onOpenMealPicker: () => void;
  mealPickerVisible: boolean;
  meals: readonly { id: string; name: string }[];
  onSelectMeal: (id: string) => void;
  onCloseMealPicker: () => void;
  query: string;
  onQuery: (q: string) => void;
  tab: PlanAddTab;
  onTab: (tab: PlanAddTab) => void;
  onQuickLog: () => void;
  /** "History", or "Results" while searching. */
  sectionTitle: string;
  rows: readonly PlanAddRowVM[];
  /** Shown when `rows` is empty. */
  emptyText: string;
  onToggle: (key: string) => void;
  onRow: (key: string) => void;
  ctaLabel: string;
  canAdd: boolean;
  onAdd: () => void;
  testID?: string;
};

const TABS: { key: PlanAddTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "meals", label: "My Meals" },
  { key: "foods", label: "My Foods" },
  { key: "recipes", label: "Recipes" },
];

function Tile({
  label,
  icon,
  onPress,
  disabled = false,
  testID,
}: {
  label: string;
  icon: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      testID={testID}
      style={{ flex: 1, opacity: disabled ? 0.4 : 1 }}
    >
      <View
        height={76}
        borderRadius={16}
        backgroundColor="$surface"
        borderWidth={1}
        borderColor="$border"
        alignItems="center"
        justifyContent="center"
        gap={8}
      >
        {icon}
        <Text
          fontFamily="$body"
          fontSize={12.5}
          fontWeight="600"
          color="$text2"
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

export function PlanAddFoodPresenter({
  onBack,
  mealName,
  planName,
  onOpenMealPicker,
  mealPickerVisible,
  meals,
  onSelectMeal,
  onCloseMealPicker,
  query,
  onQuery,
  tab,
  onTab,
  onQuickLog,
  sectionTitle,
  rows,
  emptyText,
  onToggle,
  onRow,
  ctaLabel,
  canAdd,
  onAdd,
  testID = "plan-add",
}: PlanAddFoodProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID={testID}
    >
      <View
        height={52}
        paddingHorizontal={16}
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
      >
        <BackBtn onPress={onBack} testID={`${testID}-back`} />
        <Pressable
          onPress={onOpenMealPicker}
          accessibilityRole="button"
          accessibilityLabel={`${mealName}. Change meal`}
          testID={`${testID}-title`}
        >
          <View flexDirection="row" alignItems="center" gap={4} minHeight={44}>
            <Text
              fontFamily="$body"
              fontSize={19}
              fontWeight="700"
              color="$text"
            >
              {mealName}
            </Text>
            <IconChevronD size={16} color="#8A8A98" />
          </View>
        </Pressable>
        <View width={44} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 150 }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          height={48}
          borderRadius={9999}
          flexDirection="row"
          alignItems="center"
          gap={10}
          paddingHorizontal={16}
          backgroundColor="$surface"
          borderWidth={1}
          borderColor="rgba(255,255,255,0.08)"
        >
          <IconSearch size={16} color="#8A8A98" />
          <TextInput
            value={query}
            onChangeText={onQuery}
            placeholder="Search for a food"
            placeholderTextColor="#5C5C68"
            returnKeyType="search"
            accessibilityLabel="Search for a food"
            testID={`${testID}-search`}
            style={{ flex: 1, color: "#F4F4F8", fontSize: 15, height: 46 }}
          />
        </View>

        <View
          flexDirection="row"
          gap={22}
          marginTop={14}
          borderBottomWidth={1}
          borderColor="rgba(255,255,255,0.08)"
          accessibilityRole="tablist"
        >
          {TABS.map((t) => {
            const on = t.key === tab;
            return (
              <Pressable
                key={t.key}
                onPress={() => onTab(t.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                testID={`${testID}-tab-${t.key}`}
              >
                <View
                  paddingVertical={10}
                  borderBottomWidth={2}
                  borderColor={on ? "$text" : "transparent"}
                  marginBottom={-1}
                >
                  <Text
                    fontFamily="$body"
                    fontSize={15}
                    fontWeight="600"
                    color={on ? "$text" : "$text3"}
                  >
                    {t.label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View flexDirection="row" gap={8} marginTop={14}>
          <Tile
            label="Barcode scan"
            icon={<IconBarcode size={20} color="#22D3EE" />}
            disabled
            testID={`${testID}-scan`}
          />
          <Tile
            label="Add photo"
            icon={<IconCamera size={20} color="#22D3EE" />}
            disabled
            testID={`${testID}-photo`}
          />
          <Tile
            label="Quick log"
            icon={<IconPlus size={20} color="#22D3EE" />}
            onPress={onQuickLog}
            testID={`${testID}-quick`}
          />
        </View>

        <View
          marginTop={14}
          paddingVertical={10}
          paddingHorizontal={12}
          borderRadius={12}
          backgroundColor="rgba(34,211,238,0.06)"
          flexDirection="row"
          alignItems="center"
          gap={6}
        >
          <IconCalendar size={14} color="#22D3EE" />
          <Text
            flex={1}
            fontFamily="$body"
            fontSize={12.5}
            fontWeight="500"
            color="$primary"
            testID={`${testID}-note`}
          >
            {`Adding to your ${planName} plan, not today's log`}
          </Text>
        </View>

        <Eyebrow marginTop={16}>{sectionTitle}</Eyebrow>
        {rows.length === 0 ? (
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$text3"
            paddingVertical={16}
            testID={`${testID}-empty`}
          >
            {emptyText}
          </Text>
        ) : (
          rows.map((r) => (
            <View
              key={r.key}
              flexDirection="row"
              alignItems="center"
              gap={12}
              paddingVertical={10}
              borderBottomWidth={1}
              borderColor="$border"
            >
              <Pressable
                style={{ flex: 1 }}
                onPress={() => onRow(r.key)}
                accessibilityRole="button"
                accessibilityLabel={`${r.name}: pick an amount`}
                testID={`${testID}-row-${r.key}`}
              >
                <View gap={2}>
                  <Text
                    fontFamily="$body"
                    fontSize={15}
                    fontWeight="500"
                    color="$text"
                    numberOfLines={1}
                  >
                    {r.name}
                  </Text>
                  <Text fontFamily="$body" fontSize={12} color="$text3">
                    {r.sub}
                  </Text>
                </View>
              </Pressable>
              <Pressable
                onPress={() => onToggle(r.key)}
                accessibilityRole="button"
                accessibilityLabel={`${r.picked ? "Remove" : "Add"} ${r.name}`}
                accessibilityState={{ selected: r.picked }}
                hitSlop={6}
                testID={`${testID}-toggle-${r.key}`}
              >
                <View
                  width={32}
                  height={32}
                  borderRadius={10}
                  backgroundColor={r.picked ? "$primary" : "$surface2"}
                  borderWidth={1}
                  borderColor={r.picked ? "$primary" : "rgba(255,255,255,0.08)"}
                  alignItems="center"
                  justifyContent="center"
                >
                  {r.picked ? (
                    <IconCheck size={16} color="#042F39" />
                  ) : (
                    <IconPlus size={16} color="#22D3EE" />
                  )}
                </View>
              </Pressable>
            </View>
          ))
        )}
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
          disabled={!canAdd}
          onPress={onAdd}
          testID={`${testID}-cta`}
        >
          {ctaLabel}
        </Btn>
      </View>

      <BottomSheet
        visible={mealPickerVisible}
        onClose={onCloseMealPicker}
        height="content"
        testID={`${testID}-meals`}
      >
        <SheetTitle>Meal</SheetTitle>
        <View flexDirection="row" flexWrap="wrap" gap={8} marginTop={14}>
          {meals.map((m) => (
            <Chip
              key={m.id}
              label={m.name}
              height={36}
              selected={m.name === mealName}
              onPress={() => onSelectMeal(m.id)}
              testID={`${testID}-meal-${m.id}`}
            />
          ))}
        </View>
      </BottomSheet>
    </View>
  );
}
