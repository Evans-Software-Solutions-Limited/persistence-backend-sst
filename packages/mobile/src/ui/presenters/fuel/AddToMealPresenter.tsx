import { Pressable, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Btn } from "@/ui/components/foundation";
import { IconBack, IconCheck } from "@/ui/components/icons";
import {
  FuelQuickActionsPresenter,
  type FuelQuickActionsProps,
} from "./FuelQuickActionsPresenter";

/**
 * <AddToMealPresenter> — "Add to a meal" as a full page (PER-132; Brad,
 * 18 Nov): the meal name at the top, the five quick buttons (each opens its
 * drawer), then Recent · Saved meals · Recipes. Rows are ticked and added
 * together ("Add 2 items · 685 kcal"), as in canvas N2 "Copy from earlier
 * days"; Recent groups earlier days by meal, each with Add all.
 */

export type AddToMealTab = "recent" | "saved" | "recipes";

export type PickRowVM = {
  key: string;
  name: string;
  sub: string;
  kcal: number;
  selected: boolean;
};

export type PickGroupVM = {
  key: string;
  heading: string;
  rows: readonly PickRowVM[];
};

export type AddToMealProps = {
  mealName: string;
  onBack: () => void;
  quickActions: Omit<FuelQuickActionsProps, "testID">;
  tab: AddToMealTab;
  onTab: (tab: AddToMealTab) => void;
  recentGroups: readonly PickGroupVM[];
  savedRows: readonly PickRowVM[];
  recipeRows: readonly PickRowVM[];
  onToggle: (key: string) => void;
  onAddAll: (groupKey: string) => void;
  /** "Add 2 items · 685 kcal", or "Pick what to add". */
  addLabel: string;
  canAdd: boolean;
  adding: boolean;
  onAdd: () => void;
  testID?: string;
};

const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");

const TABS: { key: AddToMealTab; label: string }[] = [
  { key: "recent", label: "Recent" },
  { key: "saved", label: "Saved meals" },
  { key: "recipes", label: "Recipes" },
];

const EMPTY: Record<AddToMealTab, string> = {
  recent: "Nothing logged on earlier days yet.",
  saved: "No saved meals yet.",
  recipes: "No recipes yet.",
};

function PickRow({
  row,
  onToggle,
}: {
  row: PickRowVM;
  onToggle: (key: string) => void;
}) {
  return (
    <Pressable
      onPress={() => onToggle(row.key)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: row.selected }}
      accessibilityLabel={`${row.name}, ${fmt(row.kcal)} kcal`}
      testID={`add-row-${row.key}`}
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
          width={24}
          height={24}
          borderRadius={7}
          alignItems="center"
          justifyContent="center"
          backgroundColor={row.selected ? "$primary" : "transparent"}
          borderWidth={row.selected ? 0 : 1.5}
          borderColor="$text4"
        >
          {row.selected ? <IconCheck size={14} color="#042F39" /> : null}
        </View>
        <View flex={1} gap={2}>
          <Text
            fontFamily="$body"
            fontSize={15}
            fontWeight="500"
            color="$text"
            numberOfLines={1}
          >
            {row.name}
          </Text>
          {row.sub ? (
            <Text
              fontFamily="$body"
              fontSize={12}
              color="$text3"
              numberOfLines={1}
            >
              {row.sub}
            </Text>
          ) : null}
        </View>
        <Text fontFamily="$mono" fontSize={14} fontWeight="600" color="$text">
          {fmt(row.kcal)}
        </Text>
      </View>
    </Pressable>
  );
}

export function AddToMealPresenter({
  mealName,
  onBack,
  quickActions,
  tab,
  onTab,
  recentGroups,
  savedRows,
  recipeRows,
  onToggle,
  onAddAll,
  addLabel,
  canAdd,
  adding,
  onAdd,
  testID = "add-to-meal",
}: AddToMealProps) {
  const insets = useSafeAreaInsets();
  const rows = tab === "saved" ? savedRows : recipeRows;
  const isEmpty =
    tab === "recent" ? recentGroups.length === 0 : rows.length === 0;

  return (
    <View flex={1} paddingTop={insets.top} testID={testID}>
      <View
        flexDirection="row"
        alignItems="center"
        gap={8}
        paddingHorizontal={12}
        paddingVertical={8}
      >
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID={`${testID}-back`}
          style={{ width: 44, height: 44, justifyContent: "center" }}
        >
          <IconBack size={22} color="#F4F4F8" />
        </Pressable>
        <Text
          flex={1}
          fontFamily="$display"
          fontSize={22}
          fontWeight="800"
          color="$text"
          numberOfLines={1}
          accessibilityRole="header"
          testID={`${testID}-title`}
        >
          Add to {mealName}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 140 }}
        keyboardShouldPersistTaps="handled"
      >
        <FuelQuickActionsPresenter
          {...quickActions}
          testID={`${testID}-quick`}
        />

        <View
          flexDirection="row"
          gap={2}
          padding={3}
          marginTop={20}
          borderRadius={9999}
          backgroundColor="$surface"
          borderWidth={1}
          borderColor="$border"
          alignSelf="flex-start"
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
                  height={36}
                  paddingHorizontal={14}
                  borderRadius={9999}
                  justifyContent="center"
                  backgroundColor={on ? "$surface4" : "transparent"}
                >
                  <Text
                    fontFamily="$body"
                    fontSize={13}
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

        <View marginTop={12}>
          {isEmpty ? (
            <Text
              fontFamily="$body"
              fontSize={13}
              color="$text3"
              paddingVertical={16}
              testID={`${testID}-empty`}
            >
              {EMPTY[tab]}
            </Text>
          ) : tab === "recent" ? (
            recentGroups.map((g) => (
              <View key={g.key} marginTop={12} testID={`add-group-${g.key}`}>
                <View
                  flexDirection="row"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <Text
                    fontFamily="$display"
                    fontSize={11}
                    fontWeight="600"
                    letterSpacing={1.6}
                    textTransform="uppercase"
                    color="$text3"
                  >
                    {g.heading}
                  </Text>
                  <Pressable
                    onPress={() => onAddAll(g.key)}
                    accessibilityRole="button"
                    accessibilityLabel={`Add all from ${g.heading}`}
                    testID={`add-group-all-${g.key}`}
                  >
                    <Text
                      fontFamily="$body"
                      fontSize={12}
                      fontWeight="600"
                      color="$primary"
                    >
                      Add all
                    </Text>
                  </Pressable>
                </View>
                {g.rows.map((r) => (
                  <PickRow key={r.key} row={r} onToggle={onToggle} />
                ))}
              </View>
            ))
          ) : (
            rows.map((r) => <PickRow key={r.key} row={r} onToggle={onToggle} />)
          )}
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
          disabled={!canAdd || adding}
          onPress={onAdd}
          testID={`${testID}-add`}
        >
          {addLabel}
        </Btn>
      </View>
    </View>
  );
}
