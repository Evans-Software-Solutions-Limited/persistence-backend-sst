import type { ReactNode } from "react";
import { Pressable, ScrollView, TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Btn,
  Card,
  HeaderBar,
  IconBtn,
  Pill,
} from "@/ui/components/foundation";
import {
  IconBack,
  IconPlus,
  IconSearch,
  IconSparkles,
  IconX,
} from "@/ui/components/icons";
import type { Food } from "@/domain/models/nutrition";
import type { MacroSum } from "@/domain/services";
import { color } from "@/ui/theme/tokens";

/**
 * <RecipeCreatePresenter> — the manual create-recipe form (recipes.jsx
 * `CreateRecipeManual`). The hub every creation path lands on: a direct
 * "Create a recipe" tap starts blank, while Import-from-URL / Snap-a-recipe
 * pre-fill it via `useRecipeDraft`. Pure — <RecipeCreateContainer> owns the
 * seed read/clear, food search, AI-resolve, live macro total, and save.
 *
 * OUT OF SCOPE (flagged, not built): photo upload — `Recipe.photoUrl` stays
 * null (no upload infra in this slice); tags — no model field exists.
 *
 * Implements: specs/milestones (Recipes AI PR3 brief) § D. Create-recipe form
 */

export type IngredientRowVM = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string;
  foodId: string | null;
  foodName: string | null;
};

export type RecipeCreatePresenterProps = {
  name: string;
  onNameChange: (v: string) => void;
  servings: number | null;
  onServingsChange: (v: number | null) => void;
  instructions: string;
  onInstructionsChange: (v: string) => void;

  rows: readonly IngredientRowVM[];
  onAddRow: () => void;
  onRemoveRow: (id: string) => void;
  onChangeRowName: (id: string, name: string) => void;
  onChangeRowQuantity: (id: string, quantity: number | null) => void;
  onChangeRowUnit: (id: string, unit: string) => void;

  /** The row with its inline "Find food" search box expanded (null = none). */
  activeSearchRowId: string | null;
  searchQuery: string;
  searchResults: readonly Food[];
  isSearching: boolean;
  onOpenRowSearch: (id: string) => void;
  onCloseRowSearch: () => void;
  onSearchQueryChange: (query: string) => void;
  onLinkFood: (id: string, food: Food) => void;

  /** "Create '{name}' with AI" — resolves a food when search comes up empty. */
  onCreateWithAi: (id: string) => void;
  /** The row an AI resolve is currently in flight for (null = none). */
  resolvingRowId: string | null;
  /** Per-row AI-resolve failure message (e.g. the daily-limit copy), keyed by
   * row id. */
  rowMessages: Readonly<Record<string, string>>;

  macroTotal: MacroSum;
  /** True when `macroTotal` came from an import scrape / whole-recipe AI
   * estimate (`providedTotals`) rather than the linked-ingredient sum. */
  macrosProvided: boolean;
  /** "Estimate whole recipe with AI" — a whole-recipe macro estimate for when
   * ingredients aren't (all) linked to foods. */
  onEstimateWholeRecipe: () => void;
  /** True while the whole-recipe AI estimate is in flight. */
  isEstimatingRecipe: boolean;
  /** Whole-recipe AI-estimate failure message (e.g. the daily-limit copy). */
  estimateRecipeMessage: string | null;

  canSave: boolean;
  isSaving: boolean;
  onSave: () => void;
  onBack: () => void;
  testID?: string;
};

function parseNumberInput(text: string): number | null {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <Text
      fontFamily="$display"
      fontSize={10.5}
      fontWeight="600"
      letterSpacing={1.7}
      textTransform="uppercase"
      color="$text3"
      marginBottom={6}
    >
      {children}
    </Text>
  );
}

const inputStyle = {
  width: "100%" as const,
  backgroundColor: color.$surface2,
  borderWidth: 1,
  borderColor: color.$border,
  borderRadius: 10,
  paddingHorizontal: 12,
  paddingVertical: 10,
  color: color.$text,
  fontSize: 13,
};

function IngredientRow({
  row,
  isSearchOpen,
  searchQuery,
  searchResults,
  isSearching,
  isResolving,
  message,
  onOpenSearch,
  onCloseSearch,
  onSearchQueryChange,
  onLinkFood,
  onCreateWithAi,
  onChangeName,
  onChangeQuantity,
  onChangeUnit,
  onRemove,
}: {
  row: IngredientRowVM;
  isSearchOpen: boolean;
  searchQuery: string;
  searchResults: readonly Food[];
  isSearching: boolean;
  isResolving: boolean;
  message?: string;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
  onSearchQueryChange: (q: string) => void;
  onLinkFood: (food: Food) => void;
  onCreateWithAi: () => void;
  onChangeName: (name: string) => void;
  onChangeQuantity: (q: number | null) => void;
  onChangeUnit: (unit: string) => void;
  onRemove: () => void;
}) {
  return (
    <View
      gap={8}
      paddingVertical={10}
      paddingHorizontal={12}
      borderTopWidth={1}
      borderColor="$border"
      testID={`recipe-create-row-${row.id}`}
    >
      <View flexDirection="row" gap={8} alignItems="center">
        <TextInput
          value={row.name}
          onChangeText={onChangeName}
          placeholder="Ingredient name"
          placeholderTextColor={color.$text3}
          style={{ flex: 2, color: color.$text, fontSize: 13 }}
          testID={`recipe-create-row-${row.id}-name`}
        />
        <TextInput
          value={row.quantity === null ? "" : String(row.quantity)}
          onChangeText={(t) => onChangeQuantity(parseNumberInput(t))}
          placeholder="0"
          keyboardType="decimal-pad"
          placeholderTextColor={color.$text3}
          style={{
            width: 56,
            color: color.$text2,
            fontSize: 13,
            textAlign: "right",
          }}
          testID={`recipe-create-row-${row.id}-quantity`}
        />
        <TextInput
          value={row.unit}
          onChangeText={onChangeUnit}
          placeholder="g"
          placeholderTextColor={color.$text3}
          style={{ width: 44, color: color.$text2, fontSize: 13 }}
          testID={`recipe-create-row-${row.id}-unit`}
        />
        <Pressable
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel="Remove ingredient"
          testID={`recipe-create-row-${row.id}-remove`}
          style={{ padding: 4 }}
        >
          <IconX size={13} color={color.$text3} />
        </Pressable>
      </View>

      {row.foodId ? (
        <View flexDirection="row" alignItems="center" gap={6}>
          <Pill tone="success" size="xs">
            LINKED
          </Pill>
          <Text fontFamily="$body" fontSize={11.5} color="$text2">
            {row.foodName}
          </Text>
        </View>
      ) : isSearchOpen ? (
        <View gap={8}>
          <TextInput
            value={searchQuery}
            onChangeText={onSearchQueryChange}
            placeholder="Search foods…"
            placeholderTextColor={color.$text3}
            autoFocus
            style={inputStyle}
            testID={`recipe-create-row-${row.id}-search-input`}
          />
          {isSearching ? (
            <Text fontFamily="$body" fontSize={11.5} color="$text3">
              Searching…
            </Text>
          ) : searchResults.length > 0 ? (
            <View gap={4}>
              {searchResults.map((food) => (
                <Pressable
                  key={food.id}
                  onPress={() => onLinkFood(food)}
                  accessibilityRole="button"
                  testID={`recipe-create-row-${row.id}-result-${food.id}`}
                >
                  <View
                    paddingVertical={8}
                    paddingHorizontal={10}
                    borderRadius={8}
                    backgroundColor="$surface3"
                  >
                    <Text fontFamily="$body" fontSize={12.5} color="$text">
                      {food.name}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : searchQuery.trim().length >= 2 ? (
            <View gap={8}>
              <Text fontFamily="$body" fontSize={11.5} color="$text3">
                No matches.
              </Text>
              <Btn
                variant="soft"
                tone="gold"
                size="sm"
                icon={<IconSparkles size={13} />}
                onPress={onCreateWithAi}
                disabled={isResolving}
                testID={`recipe-create-row-${row.id}-create-ai`}
              >
                {isResolving
                  ? "Creating…"
                  : `Create "${row.name || searchQuery}" with AI`}
              </Btn>
            </View>
          ) : null}
          {message ? (
            <Text
              fontFamily="$body"
              fontSize={11.5}
              color="$ember"
              testID={`recipe-create-row-${row.id}-message`}
            >
              {message}
            </Text>
          ) : null}
          <Pressable
            onPress={onCloseSearch}
            accessibilityRole="button"
            testID={`recipe-create-row-${row.id}-search-close`}
          >
            <Text fontFamily="$body" fontSize={11.5} color="$primary">
              Close
            </Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={onOpenSearch}
          accessibilityRole="button"
          accessibilityLabel="Find food"
          testID={`recipe-create-row-${row.id}-find-food`}
        >
          <View flexDirection="row" alignItems="center" gap={6}>
            <IconSearch size={12} color={color.$primary} />
            <Text
              fontFamily="$body"
              fontSize={11.5}
              color="$primary"
              fontWeight="600"
            >
              Find food
            </Text>
          </View>
        </Pressable>
      )}
    </View>
  );
}

export function RecipeCreatePresenter(props: RecipeCreatePresenterProps) {
  const {
    name,
    onNameChange,
    servings,
    onServingsChange,
    instructions,
    onInstructionsChange,
    rows,
    onAddRow,
    onRemoveRow,
    onChangeRowName,
    onChangeRowQuantity,
    onChangeRowUnit,
    activeSearchRowId,
    searchQuery,
    searchResults,
    isSearching,
    onOpenRowSearch,
    onCloseRowSearch,
    onSearchQueryChange,
    onLinkFood,
    onCreateWithAi,
    resolvingRowId,
    rowMessages,
    macroTotal,
    macrosProvided,
    onEstimateWholeRecipe,
    isEstimatingRecipe,
    estimateRecipeMessage,
    canSave,
    isSaving,
    onSave,
    onBack,
    testID = "recipe-create-screen",
  } = props;

  // Whether the pills currently show anything — not "is a food linked", since
  // a linked row with no quantity set still contributes 0 (recipe-import
  // macros fix: the "no macros" hint should track what's actually displayed).
  const hasMacros =
    macroTotal.kcal > 0 ||
    macroTotal.proteinG > 0 ||
    macroTotal.carbsG > 0 ||
    macroTotal.fatG > 0;

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: color.$bg }}
      edges={["top", "bottom"]}
      testID={testID}
    >
      <HeaderBar
        eyebrow="MANUAL"
        title="New recipe"
        leading={
          <IconBtn
            icon={<IconBack size={22} />}
            tone="ghost"
            onPress={onBack}
            accessibilityLabel="Back"
            testID="recipe-create-back"
          />
        }
        trailing={
          <Pressable
            onPress={onSave}
            disabled={!canSave || isSaving}
            testID="recipe-create-save"
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSave || isSaving }}
            style={{ opacity: !canSave || isSaving ? 0.45 : 1 }}
          >
            <View
              paddingHorizontal={14}
              paddingVertical={6}
              borderRadius={9}
              backgroundColor="$gold"
            >
              <Text
                fontFamily="$display"
                fontWeight="700"
                fontSize={12.5}
                color="$goldInk"
              >
                {isSaving ? "Saving…" : "Save"}
              </Text>
            </View>
          </Pressable>
        }
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 140, gap: 14 }}
        keyboardShouldPersistTaps="handled"
        testID="recipe-create-scroll"
      >
        <View>
          <FieldLabel>NAME</FieldLabel>
          <TextInput
            value={name}
            onChangeText={onNameChange}
            placeholder="e.g. Sunday roast chicken"
            placeholderTextColor={color.$text3}
            style={inputStyle}
            testID="recipe-create-name"
          />
        </View>

        <View>
          <FieldLabel>SERVES</FieldLabel>
          <TextInput
            value={servings === null ? "" : String(servings)}
            onChangeText={(t) => onServingsChange(parseNumberInput(t))}
            placeholder="2"
            keyboardType="number-pad"
            placeholderTextColor={color.$text3}
            style={inputStyle}
            testID="recipe-create-servings"
          />
        </View>

        <View>
          <View
            flexDirection="row"
            alignItems="center"
            justifyContent="space-between"
            marginBottom={8}
          >
            <FieldLabel>INGREDIENTS</FieldLabel>
            <Pressable
              onPress={onAddRow}
              accessibilityRole="button"
              testID="recipe-create-add-row"
            >
              <View flexDirection="row" alignItems="center" gap={4}>
                <IconPlus size={12} color={color.$primary} strokeWidth={2.5} />
                <Text
                  fontFamily="$body"
                  fontSize={12}
                  fontWeight="600"
                  color="$primary"
                >
                  Add
                </Text>
              </View>
            </Pressable>
          </View>
          <Card pad={0} radius={12}>
            {rows.map((row) => (
              <IngredientRow
                key={row.id}
                row={row}
                isSearchOpen={activeSearchRowId === row.id}
                searchQuery={searchQuery}
                searchResults={searchResults}
                isSearching={isSearching}
                isResolving={resolvingRowId === row.id}
                message={rowMessages[row.id]}
                onOpenSearch={() => onOpenRowSearch(row.id)}
                onCloseSearch={onCloseRowSearch}
                onSearchQueryChange={onSearchQueryChange}
                onLinkFood={(food) => onLinkFood(row.id, food)}
                onCreateWithAi={() => onCreateWithAi(row.id)}
                onChangeName={(v) => onChangeRowName(row.id, v)}
                onChangeQuantity={(v) => onChangeRowQuantity(row.id, v)}
                onChangeUnit={(v) => onChangeRowUnit(row.id, v)}
                onRemove={() => onRemoveRow(row.id)}
              />
            ))}
          </Card>
        </View>

        <View>
          <FieldLabel>INSTRUCTIONS</FieldLabel>
          <TextInput
            value={instructions}
            onChangeText={onInstructionsChange}
            placeholder="Step 1. …"
            placeholderTextColor={color.$text3}
            multiline
            style={{ ...inputStyle, minHeight: 80, textAlignVertical: "top" }}
            testID="recipe-create-instructions"
          />
        </View>

        {/* Live macro total — replaces the prototype's fictional "auto-estimate
            macros" AI toggle. A recipe's macros come from either its LINKED
            ingredients' foods (default), an imported page's scraped totals, or
            the whole-recipe AI estimate below — the latter two arrive via
            `macroTotal`/`macrosProvided` already resolved by the container. */}
        <Card
          pad={14}
          radius={14}
          accent="gold"
          testID="recipe-create-macro-total"
        >
          <Text
            fontFamily="$display"
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.7}
            textTransform="uppercase"
            color="$text3"
            marginBottom={8}
          >
            LIVE MACRO TOTAL
          </Text>
          <View flexDirection="row" gap={8}>
            <Pill tone="gold" size="xs">{`${macroTotal.kcal} KCAL`}</Pill>
            <Pill tone="primary" size="xs">{`P ${macroTotal.proteinG}G`}</Pill>
            <Pill tone="gold" size="xs">{`C ${macroTotal.carbsG}G`}</Pill>
            <Pill tone="ember" size="xs">{`F ${macroTotal.fatG}G`}</Pill>
          </View>
          {macrosProvided ? (
            <Text
              fontFamily="$body"
              fontSize={10.5}
              color="$text3"
              marginTop={6}
              testID="recipe-create-macro-provided-caption"
            >
              Whole-recipe estimate
            </Text>
          ) : null}
          {!hasMacros ? (
            <Text
              fontFamily="$body"
              fontSize={11.5}
              color="$text3"
              marginTop={8}
              testID="recipe-create-macro-hint"
            >
              No macros yet — link a food to each ingredient (and set a
              quantity), or estimate the whole recipe with AI.
            </Text>
          ) : null}
          <View marginTop={10} alignSelf="flex-start">
            <Btn
              variant="soft"
              tone="gold"
              size="sm"
              icon={<IconSparkles size={13} />}
              onPress={onEstimateWholeRecipe}
              disabled={isEstimatingRecipe}
              testID="recipe-create-estimate-recipe"
            >
              {isEstimatingRecipe
                ? "Estimating…"
                : "Estimate whole recipe with AI"}
            </Btn>
          </View>
          {estimateRecipeMessage ? (
            <Text
              fontFamily="$body"
              fontSize={11.5}
              color="$ember"
              marginTop={8}
              testID="recipe-create-estimate-recipe-message"
            >
              {estimateRecipeMessage}
            </Text>
          ) : null}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
