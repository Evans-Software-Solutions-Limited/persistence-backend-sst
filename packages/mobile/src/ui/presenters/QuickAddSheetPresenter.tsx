import { Pressable, TextInput } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Text, View } from "@tamagui/core";
import { BottomSheet, Btn, Card, IconBtn } from "@/ui/components/foundation";
import { IconBack, IconMinus, IconPlus } from "@/ui/components/icons";
import type { Food, MealSlot } from "@/domain/models/nutrition";
import { MEAL_SLOTS, scaleFoodMacros } from "@/domain/services";

/**
 * <QuickAddSheetPresenter> — search foods/recents → pick → serving + meal-slot
 * → Add (fuel-sheets.jsx QuickAddSheet). No Tier-B "describe it" CTA in M9.
 *
 * The presenter is render-driven off props; the container owns the search query
 * (debounced hook), the selected food, servings, and slot. Two stages: search
 * list → selected food detail.
 *
 * Implements: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § <QuickAddSheet>
 */

const intl = (n: number) => Math.round(n).toLocaleString("en-US");

export type QuickAddSheetProps = {
  visible: boolean;
  onClose: () => void;
  query: string;
  onQueryChange: (q: string) => void;
  results: readonly Food[];
  isSearching: boolean;
  selected: Food | null;
  onSelect: (food: Food) => void;
  onClearSelection: () => void;
  servings: number;
  onServingsChange: (n: number) => void;
  slot: MealSlot;
  onSlotChange: (slot: MealSlot) => void;
  onAdd: () => void;
  testID?: string;
};

function FoodRow({
  food,
  onSelect,
}: {
  food: Food;
  onSelect: (f: Food) => void;
}) {
  return (
    <Pressable
      testID={`quick-add-result-${food.id}`}
      onPress={() => onSelect(food)}
      accessibilityRole="button"
      accessibilityLabel={food.name}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        paddingVertical={12}
        borderBottomWidth={1}
        borderColor="$border"
      >
        <View flex={1} paddingRight={10}>
          <Text
            fontFamily="$body"
            fontSize={14}
            color="$text"
            numberOfLines={1}
          >
            {food.name}
          </Text>
          <Text fontFamily="$mono" fontSize={11} color="$text3">
            {food.brand ? `${food.brand} · ` : ""}
            {intl(food.kcal)} kcal / {food.servingSize}
            {food.servingUnit}
          </Text>
        </View>
        <IconBtn
          size={28}
          tone="primary"
          icon={<IconPlus size={16} strokeWidth={2.2} />}
          onPress={() => onSelect(food)}
          accessibilityLabel={`Select ${food.name}`}
        />
      </View>
    </Pressable>
  );
}

function SelectedDetail({
  food,
  servings,
  onServingsChange,
  slot,
  onSlotChange,
  onAdd,
  onBack,
}: {
  food: Food;
  servings: number;
  onServingsChange: (n: number) => void;
  slot: MealSlot;
  onSlotChange: (slot: MealSlot) => void;
  onAdd: () => void;
  onBack: () => void;
}) {
  const macro = scaleFoodMacros(food, servings);
  return (
    <View gap={16} testID="quick-add-detail">
      <View flexDirection="row" alignItems="center" gap={10}>
        <IconBtn
          icon={<IconBack size={18} />}
          tone="neutral"
          onPress={onBack}
          testID="quick-add-back"
          accessibilityLabel="Back to search"
        />
        <View flex={1}>
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={16}
            color="$text"
            numberOfLines={1}
          >
            {food.name}
          </Text>
          {food.source === "openfoodfacts" ? (
            <Text
              fontFamily="$body"
              fontSize={10.5}
              color="$text3"
              testID="quick-add-off-credit"
            >
              Data: Open Food Facts
            </Text>
          ) : null}
        </View>
      </View>

      <Card pad={16} radius={14}>
        <View
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
        >
          <Text
            fontFamily="$display"
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.5}
            textTransform="uppercase"
            color="$text3"
          >
            Servings
          </Text>
          <View flexDirection="row" alignItems="center" gap={12}>
            <IconBtn
              icon={<IconMinus size={16} strokeWidth={2.5} />}
              tone="neutral"
              onPress={() => onServingsChange(Math.max(0.5, servings - 0.5))}
              testID="quick-add-servings-minus"
              accessibilityLabel="Fewer servings"
            />
            <Text
              fontFamily="$mono"
              fontSize={20}
              fontWeight="600"
              color="$text"
              fontVariant={["tabular-nums"]}
              testID="quick-add-servings"
            >
              {servings}
            </Text>
            <IconBtn
              icon={<IconPlus size={16} strokeWidth={2.5} />}
              tone="primary"
              onPress={() => onServingsChange(servings + 0.5)}
              testID="quick-add-servings-plus"
              accessibilityLabel="More servings"
            />
          </View>
        </View>
        <View flexDirection="row" gap={14} marginTop={14}>
          <Text fontFamily="$mono" fontSize={13} color="$text">
            {intl(macro.kcal)} kcal
          </Text>
          <Text fontFamily="$mono" fontSize={13} color="$text2">
            P {intl(macro.proteinG)}
          </Text>
          <Text fontFamily="$mono" fontSize={13} color="$text2">
            C {intl(macro.carbsG)}
          </Text>
          <Text fontFamily="$mono" fontSize={13} color="$text2">
            F {intl(macro.fatG)}
          </Text>
        </View>
      </Card>

      <View>
        <Text
          fontFamily="$display"
          fontSize={10.5}
          fontWeight="600"
          letterSpacing={1.5}
          textTransform="uppercase"
          color="$text3"
          marginBottom={8}
        >
          Meal
        </Text>
        <View flexDirection="row" gap={8} flexWrap="wrap">
          {MEAL_SLOTS.map((m) => {
            const active = slot === m.slot;
            return (
              <Pressable
                key={m.slot}
                testID={`quick-add-slot-${m.slot}`}
                onPress={() => onSlotChange(m.slot)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={m.label}
              >
                <View
                  paddingVertical={6}
                  paddingHorizontal={14}
                  borderRadius={9999}
                  borderWidth={1}
                  backgroundColor={active ? "$primaryDim" : "$surface3"}
                  borderColor={active ? "$primary" : "$border2"}
                >
                  <Text
                    fontFamily="$display"
                    fontWeight="600"
                    fontSize={12}
                    color={active ? "$primary" : "$text2"}
                  >
                    {m.label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Btn
        variant="filled"
        tone="primary"
        size="lg"
        full
        onPress={onAdd}
        testID="quick-add-confirm"
        icon={<IconPlus size={16} strokeWidth={2.5} />}
      >
        Add to {MEAL_SLOTS.find((m) => m.slot === slot)?.label}
      </Btn>
    </View>
  );
}

export function QuickAddSheetPresenter({
  visible,
  onClose,
  query,
  onQueryChange,
  results,
  isSearching,
  selected,
  onSelect,
  onClearSelection,
  servings,
  onServingsChange,
  slot,
  onSlotChange,
  onAdd,
  testID = "quick-add-sheet",
}: QuickAddSheetProps) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Quick add"
      eyebrow="LOG FOOD"
      accent="primary"
      height="tall"
      testID={testID}
    >
      {selected ? (
        <SelectedDetail
          food={selected}
          servings={servings}
          onServingsChange={onServingsChange}
          slot={slot}
          onSlotChange={onSlotChange}
          onAdd={onAdd}
          onBack={onClearSelection}
        />
      ) : (
        <View gap={12}>
          <TextInput
            testID="quick-add-search"
            value={query}
            onChangeText={onQueryChange}
            placeholder="Search foods…"
            placeholderTextColor="#8A8A98"
            autoCorrect={false}
            style={{
              fontFamily: "Geist",
              fontSize: 16,
              color: "#F4F4F8",
              backgroundColor: "#232735",
              borderRadius: 12,
              paddingHorizontal: 14,
              paddingVertical: 12,
            }}
          />
          {query.trim().length < 2 ? (
            <Text
              fontFamily="$body"
              fontSize={13}
              color="$text3"
              testID="quick-add-hint"
            >
              Type at least 2 characters to search.
            </Text>
          ) : isSearching && results.length === 0 ? (
            <Text
              fontFamily="$body"
              fontSize={13}
              color="$text3"
              testID="quick-add-searching"
            >
              Searching…
            </Text>
          ) : results.length === 0 ? (
            <Text
              fontFamily="$body"
              fontSize={13}
              color="$text3"
              testID="quick-add-empty"
            >
              No foods found. Try a different search.
            </Text>
          ) : (
            <View height={360}>
              <FlashList
                testID="quick-add-results"
                data={results}
                keyExtractor={(f) => f.id}
                renderItem={({ item }) => (
                  <FoodRow food={item} onSelect={onSelect} />
                )}
              />
            </View>
          )}
        </View>
      )}
    </BottomSheet>
  );
}
