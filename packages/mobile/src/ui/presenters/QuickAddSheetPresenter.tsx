import { Pressable, TextInput } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Text, View } from "@tamagui/core";
import {
  BottomSheet,
  Btn,
  Card,
  IconBtn,
  Pill,
  Stat,
} from "@/ui/components/foundation";
import { SearchBar } from "@/ui/components/composite";
import { toneHex } from "@/ui/components/foundation/tones";
import {
  IconBack,
  IconBarcode,
  IconCamera,
  IconChevronR,
  IconClipboard,
  IconEdit,
  IconLock,
  IconPlus,
  IconSearch,
  IconSparkles,
  IconSwap,
} from "@/ui/components/icons";
import type { Food, MealSlot } from "@/domain/models/nutrition";
import { scaleFoodMacros } from "@/domain/services";
import {
  AiDraftConfirmPresenter,
  type AiDraftItem,
} from "./AiDraftConfirmPresenter";
import { MealPickerPresenter } from "./MealPickerPresenter";
import { PortionStepperPresenter } from "./PortionStepperPresenter";

/**
 * <QuickAddSheetPresenter> — the per-meal Quick-add MENU (fuel-sheets.jsx
 * QuickAddSheet): "From yesterday" + saved meals + action tiles (Scan / Snap /
 * Search / Manual) + the M9.5 STORY-012 "Or describe it…" free-text AI CTA.
 * The Search tile switches the sheet to a food-search stage (the prototype
 * stubs search; we make it functional with the design-system <SearchBar>).
 * The "Or describe it…" CTA switches to a `describe` stage (a text input +
 * submit) then a `describeConfirm` stage that reuses the SAME
 * <AiDraftConfirmPresenter> the Snap sheet's confirm stage uses — the two
 * M9.5 Tier B entry points share one draft-review implementation rather than
 * duplicating it. Built from design-system components — <Card>, <Btn>,
 * <IconBtn>, <Pill>, <Stat>, <SearchBar>, <Segmented> (via <MealPicker>).
 *
 * Implements: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § <QuickAddSheet>
 *             specs/13-nutrition-tracking/design.md § Revised 2026-07-03 › Mobile flow
 *             specs/13-nutrition-tracking/tasks.md T-13.11.2
 */

const intl = (n: number) => Math.round(n).toLocaleString("en-US");

export type QuickAddYesterday = { items: string[]; kcal: number };
export type QuickAddMeal = { id: string; name: string; kcal: number };
export type QuickAddStage = "menu" | "search" | "describe" | "describeConfirm";

export type QuickAddSheetProps = {
  visible: boolean;
  onClose: () => void;
  mealLabel: string;
  stage: QuickAddStage;
  aiLocked: boolean;
  /** True when offline — Snap AND "Or describe it…" are disabled (both are
   * online-only AI calls that never queue). */
  aiOffline: boolean;
  // Menu data
  yesterday: QuickAddYesterday | null;
  savedMeals: readonly QuickAddMeal[];
  onLogYesterday: () => void;
  onLogMeal: (id: string) => void;
  onScan: () => void;
  onSnap: () => void;
  onSearch: () => void;
  onManual: () => void;
  onDescribe: () => void;
  // Search stage
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
  onBackToMenu: () => void;
  // Describe (free-text AI) stage
  describeText: string;
  onDescribeTextChange: (text: string) => void;
  isEstimatingText: boolean;
  describeError: string | null;
  onSubmitDescribe: () => void;
  // Describe confirm stage (shared <AiDraftConfirmPresenter>)
  describeItems: readonly AiDraftItem[];
  onToggleDescribeItem: (index: number) => void;
  onEditDescribeGrams: (index: number, grams: number) => void;
  describeTotalKcal: number;
  describeAdded: boolean;
  onConfirmDescribe: () => void;
  testID?: string;
};

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      fontFamily="$display"
      fontSize={10.5}
      fontWeight="600"
      letterSpacing={1.5}
      textTransform="uppercase"
      color="$text3"
      marginBottom={8}
    >
      {children}
    </Text>
  );
}

function ActionTile({
  icon,
  label,
  onPress,
  locked = false,
  disabled = false,
  accessibilityLabel,
  testID,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  locked?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID: string;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={
        accessibilityLabel ?? (locked ? `${label} (locked)` : label)
      }
      style={({ pressed }) => ({
        flex: 1,
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      <View
        backgroundColor="$surface2"
        borderColor="$border"
        borderWidth={1}
        borderRadius={12}
        padding={14}
        gap={10}
        position="relative"
      >
        <View
          width={36}
          height={36}
          borderRadius={10}
          alignItems="center"
          justifyContent="center"
          backgroundColor={locked ? "$goldDim" : "$primaryDim"}
        >
          {icon}
        </View>
        <Text fontFamily="$body" fontSize={12.5} fontWeight="500" color="$text">
          {label}
        </Text>
        {locked ? (
          <View position="absolute" top={8} right={8} testID={`${testID}-ai`}>
            <Pill tone={disabled ? "neutral" : "gold"} size="xs">
              {disabled ? <IconLock size={9} /> : "AI"}
            </Pill>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function MenuStage(props: QuickAddSheetProps) {
  const {
    aiLocked,
    aiOffline,
    yesterday,
    savedMeals,
    onLogYesterday,
    onLogMeal,
    onScan,
    onSnap,
    onSearch,
    onManual,
    onDescribe,
  } = props;
  const primary = toneHex("primary").base;
  const gold = toneHex("gold").base;
  const snapLocked = aiLocked || aiOffline;

  return (
    <View gap={14}>
      {yesterday && yesterday.items.length > 0 ? (
        <View>
          <SectionLabel>From yesterday</SectionLabel>
          <Pressable
            onPress={onLogYesterday}
            testID="quick-add-yesterday"
            accessibilityRole="button"
          >
            <View
              flexDirection="row"
              alignItems="center"
              gap={12}
              backgroundColor="$surface2"
              borderColor="$border"
              borderWidth={1}
              borderRadius={14}
              padding={14}
            >
              <View
                width={38}
                height={38}
                borderRadius={10}
                alignItems="center"
                justifyContent="center"
                backgroundColor="$primaryDim"
              >
                <IconSwap size={18} color={primary} />
              </View>
              <View flex={1}>
                <Text
                  fontFamily="$display"
                  fontWeight="700"
                  fontSize={14}
                  color="$text"
                >
                  Same as yesterday
                </Text>
                <Text
                  fontFamily="$body"
                  fontSize={11.5}
                  color="$text3"
                  numberOfLines={1}
                >
                  {yesterday.items.join(" · ")}
                </Text>
              </View>
              <Stat
                value={intl(yesterday.kcal)}
                unit="kcal"
                tone="gold"
                size="md"
                align="center"
              />
            </View>
          </Pressable>
        </View>
      ) : null}

      {savedMeals.length > 0 ? (
        <View>
          <SectionLabel>Saved meals</SectionLabel>
          <Card pad={0} radius={14}>
            {savedMeals.map((m, i) => (
              <Pressable
                key={m.id}
                onPress={() => onLogMeal(m.id)}
                testID={`quick-add-meal-${m.id}`}
                accessibilityRole="button"
                accessibilityLabel={m.name}
              >
                <View
                  flexDirection="row"
                  alignItems="center"
                  gap={12}
                  paddingVertical={12}
                  paddingHorizontal={14}
                  borderTopWidth={i ? 1 : 0}
                  borderColor="$border"
                >
                  <View
                    width={32}
                    height={32}
                    borderRadius={8}
                    alignItems="center"
                    justifyContent="center"
                    backgroundColor="$goldDim"
                  >
                    <IconClipboard size={14} color={gold} />
                  </View>
                  <View flex={1}>
                    <Text
                      fontFamily="$display"
                      fontWeight="700"
                      fontSize={14}
                      color="$text"
                      numberOfLines={1}
                    >
                      {m.name}
                    </Text>
                    <Text
                      fontFamily="$mono"
                      fontSize={11}
                      color="$text3"
                      fontVariant={["tabular-nums"]}
                    >
                      {intl(m.kcal)} kcal
                    </Text>
                  </View>
                  <IconChevronR size={14} color="#8A8A98" />
                </View>
              </Pressable>
            ))}
          </Card>
        </View>
      ) : null}

      <View>
        <SectionLabel>Or log something new</SectionLabel>
        <View flexDirection="row" gap={8} marginBottom={8}>
          <ActionTile
            testID="quick-add-tile-scan"
            icon={<IconBarcode size={20} color={primary} />}
            label="Scan barcode"
            onPress={onScan}
          />
          <ActionTile
            testID="quick-add-tile-snap"
            icon={<IconCamera size={20} color={snapLocked ? gold : primary} />}
            label="AI snap photo"
            onPress={onSnap}
            locked={snapLocked}
            disabled={aiOffline}
            accessibilityLabel={
              aiOffline
                ? "AI snap photo — Snap needs a connection, try Quick Add instead"
                : undefined
            }
          />
        </View>
        <View flexDirection="row" gap={8}>
          <ActionTile
            testID="quick-add-tile-search"
            icon={<IconSearch size={20} color={primary} />}
            label="Search foods"
            onPress={onSearch}
          />
          <ActionTile
            testID="quick-add-tile-manual"
            icon={<IconEdit size={18} color={primary} />}
            label="Manual entry"
            onPress={onManual}
          />
        </View>
      </View>

      {!aiLocked ? (
        <View>
          <SectionLabel>Or describe it in words</SectionLabel>
          <Pressable
            onPress={aiOffline ? undefined : onDescribe}
            disabled={aiOffline}
            testID="quick-add-describe-cta"
            accessibilityRole="button"
            accessibilityState={{ disabled: aiOffline }}
            accessibilityLabel={
              aiOffline
                ? "Or describe it… — Snap needs a connection, try Quick Add instead"
                : "Or describe it…"
            }
            style={({ pressed }) => ({
              opacity: aiOffline ? 0.5 : pressed ? 0.7 : 1,
            })}
          >
            <View
              flexDirection="row"
              alignItems="center"
              gap={12}
              backgroundColor="$surface2"
              borderColor="$goldDim"
              borderWidth={1}
              borderRadius={14}
              padding={14}
            >
              <View
                width={38}
                height={38}
                borderRadius={10}
                alignItems="center"
                justifyContent="center"
                backgroundColor="$goldDim"
              >
                <IconSparkles size={18} color={gold} />
              </View>
              <View flex={1}>
                <Text
                  fontFamily="$display"
                  fontWeight="700"
                  fontSize={14}
                  color="$text"
                >
                  Or describe it…
                </Text>
                <Text
                  fontFamily="$body"
                  fontSize={11.5}
                  color="$text3"
                  numberOfLines={1}
                >
                  &ldquo;Two eggs, toast, and a coffee&rdquo; — AI estimates the
                  macros
                </Text>
              </View>
            </View>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

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

function SearchStage(props: QuickAddSheetProps) {
  const {
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
    onBackToMenu,
  } = props;

  if (selected) {
    const macro = scaleFoodMacros(selected, servings);
    return (
      <View gap={16} testID="quick-add-detail">
        <View flexDirection="row" alignItems="center" gap={10}>
          <IconBtn
            icon={<IconBack size={18} />}
            tone="neutral"
            onPress={onClearSelection}
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
              {selected.name}
            </Text>
            {selected.source === "openfoodfacts" ? (
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
          <PortionStepperPresenter
            testID="quick-add-servings"
            value={servings}
            unit={servings === 1 ? "serving" : "servings"}
            onDec={() =>
              onServingsChange(Math.max(0.5, +(servings - 0.5).toFixed(1)))
            }
            onInc={() => onServingsChange(+(servings + 0.5).toFixed(1))}
          />
          <View flexDirection="row" gap={6} marginTop={14}>
            <Pill tone="neutral" size="xs">{`${intl(macro.kcal)} kcal`}</Pill>
            <Pill tone="neutral" size="xs">{`P ${intl(macro.proteinG)}g`}</Pill>
            <Pill tone="neutral" size="xs">{`C ${intl(macro.carbsG)}g`}</Pill>
            <Pill tone="neutral" size="xs">{`F ${intl(macro.fatG)}g`}</Pill>
          </View>
        </Card>

        <MealPickerPresenter
          value={slot}
          onChange={onSlotChange}
          testID="quick-add-meal-picker"
        />

        <Btn
          variant="filled"
          tone="primary"
          size="lg"
          full
          onPress={onAdd}
          testID="quick-add-confirm"
        >
          Add
        </Btn>
      </View>
    );
  }

  return (
    <View gap={12}>
      <View flexDirection="row" alignItems="center" gap={10}>
        <IconBtn
          icon={<IconBack size={18} />}
          tone="neutral"
          onPress={onBackToMenu}
          testID="quick-add-search-back"
          accessibilityLabel="Back"
        />
        <View flex={1}>
          <SearchBar
            placeholder="Search foods…"
            value={query}
            onChangeText={onQueryChange}
            testID="quick-add-search"
          />
        </View>
      </View>
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
        <View height={340}>
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
  );
}

function DescribeStage(props: QuickAddSheetProps) {
  const {
    describeText,
    onDescribeTextChange,
    isEstimatingText,
    describeError,
    onSubmitDescribe,
    onBackToMenu,
  } = props;
  const canSubmit =
    describeText.trim().length > 0 &&
    describeText.length <= 1000 &&
    !isEstimatingText;

  return (
    <View gap={16} testID="quick-add-describe">
      <View flexDirection="row" alignItems="center" gap={10}>
        <IconBtn
          icon={<IconBack size={18} />}
          tone="neutral"
          onPress={onBackToMenu}
          testID="quick-add-describe-back"
          accessibilityLabel="Back"
        />
        <Text
          fontFamily="$display"
          fontWeight="700"
          fontSize={16}
          color="$text"
        >
          Describe your meal
        </Text>
      </View>
      <TextInput
        value={describeText}
        onChangeText={onDescribeTextChange}
        placeholder="e.g. Two eggs, a slice of toast, and a black coffee"
        placeholderTextColor="#8A8A98"
        multiline
        editable={!isEstimatingText}
        maxLength={1000}
        testID="quick-add-describe-input"
        accessibilityLabel="Describe your meal"
        style={{
          minHeight: 90,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: "#232735",
          backgroundColor: "#181B26",
          padding: 14,
          color: "#F4F4F8",
          fontFamily: "Geist",
          fontSize: 15,
          textAlignVertical: "top",
        }}
      />
      <Text
        fontFamily="$body"
        fontSize={11}
        color="$text3"
        testID="quick-add-describe-count"
      >
        {describeText.length}/1000
      </Text>
      {describeError ? (
        <Text
          fontFamily="$body"
          fontSize={13}
          color="$gold"
          testID="quick-add-describe-error"
        >
          {describeError}
        </Text>
      ) : null}
      <Btn
        variant="filled"
        tone="gold"
        size="lg"
        full
        icon={<IconSparkles size={16} />}
        onPress={onSubmitDescribe}
        disabled={!canSubmit}
        testID="quick-add-describe-submit"
      >
        {isEstimatingText ? "Estimating…" : "Estimate with AI"}
      </Btn>
    </View>
  );
}

function DescribeConfirmStage(props: QuickAddSheetProps) {
  const {
    describeItems,
    onToggleDescribeItem,
    onEditDescribeGrams,
    describeTotalKcal,
    slot,
    onSlotChange,
    describeAdded,
    onConfirmDescribe,
  } = props;
  return (
    <AiDraftConfirmPresenter
      items={describeItems}
      onToggleItem={onToggleDescribeItem}
      onEditGrams={onEditDescribeGrams}
      totalKcal={describeTotalKcal}
      slot={slot}
      onSlotChange={onSlotChange}
      onConfirm={onConfirmDescribe}
      added={describeAdded}
      testID="quick-add-describe-confirm"
    />
  );
}

export function QuickAddSheetPresenter(props: QuickAddSheetProps) {
  const {
    visible,
    onClose,
    mealLabel,
    stage,
    testID = "quick-add-sheet",
  } = props;
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={`Add to ${mealLabel}`}
      eyebrow="QUICK ADD"
      accent="primary"
      height="tall"
      testID={testID}
    >
      {stage === "search" ? (
        <SearchStage {...props} />
      ) : stage === "describe" ? (
        <DescribeStage {...props} />
      ) : stage === "describeConfirm" ? (
        <DescribeConfirmStage {...props} />
      ) : (
        <MenuStage {...props} />
      )}
    </BottomSheet>
  );
}
