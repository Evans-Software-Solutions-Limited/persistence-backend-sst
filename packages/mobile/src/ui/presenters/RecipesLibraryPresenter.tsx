import { RefreshControl, ScrollView, Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  HeaderBar,
  IconBtn,
  Pill,
  Segmented,
} from "@/ui/components/foundation";
import { SearchBar } from "@/ui/components/composite/SearchBar";
import { ErrorState, PLogoDrawLoader, EmptyState } from "@/ui/components";
import {
  IconBack,
  IconBook,
  IconChevronR,
  IconClipboard,
  IconPlus,
} from "@/ui/components/icons";
import type { ApiError } from "@/shared/errors";

/**
 * <RecipesLibraryPresenter> — Fuel → Recipes library (recipes.jsx
 * `RecipesScreen`). Segmented Meals | Recipes, a client-side name filter, and
 * the two lists. Pure presentational; <RecipesLibraryContainer> wires the
 * cache-first recipe/meal reads + the tab/query state.
 *
 * No-AI slice (PR1): tapping "+" opens Save-a-meal directly — the 4-option
 * add menu (create-recipe / import-URL / snap-photo) is PR2/PR3.
 *
 * Implements: specs/milestones (Fuel → Recipes PR1 brief) § <RecipesLibraryPresenter>
 */

export type LibraryTab = "Meals" | "Recipes";

export type MealRowVM = {
  id: string;
  name: string;
  kcal: number;
  /** Best-effort item-name summary ("Oats + yogurt"); null when the cached
   * meal has no item detail (the list endpoint omits items — see the
   * container). */
  itemsSummary: string | null;
};

export type RecipeRowVM = {
  id: string;
  name: string;
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  /** e.g. "2 servings · My recipe". */
  secondaryLine: string;
};

export type RecipesLibraryPresenterProps = {
  tab: LibraryTab;
  onTabChange: (tab: LibraryTab) => void;
  query: string;
  onQueryChange: (query: string) => void;
  meals: readonly MealRowVM[];
  recipes: readonly RecipeRowVM[];
  hasData: boolean;
  isLoading: boolean;
  isRefreshing: boolean;
  error?: ApiError | null;
  onRefresh: () => void;
  onSelectMeal: (id: string) => void;
  onSelectRecipe: (id: string) => void;
  onAdd: () => void;
  onBack: () => void;
  testID?: string;
};

function BackToFuel({ onBack }: { onBack: () => void }) {
  return (
    <Pressable
      onPress={onBack}
      accessibilityRole="button"
      accessibilityLabel="Back to Fuel"
      testID="recipes-library-back"
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <View flexDirection="row" alignItems="center" gap={4}>
        <IconBack size={18} color="#B8B8C4" />
        <Text fontFamily="$body" fontSize={13.5} color="$text2">
          Fuel
        </Text>
      </View>
    </Pressable>
  );
}

function MealRow({
  meal,
  onPress,
}: {
  meal: MealRowVM;
  onPress: (id: string) => void;
}) {
  return (
    <Pressable
      onPress={() => onPress(meal.id)}
      testID={`recipes-library-meal-${meal.id}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <View
        flexDirection="row"
        alignItems="center"
        gap={12}
        borderWidth={1}
        borderColor="$border"
        backgroundColor="$surface2"
        borderRadius={14}
        padding={14}
      >
        <View
          width={44}
          height={44}
          borderRadius={10}
          backgroundColor="$goldDim"
          alignItems="center"
          justifyContent="center"
        >
          <IconClipboard size={20} color="#F5C518" />
        </View>
        <View flex={1} gap={2}>
          <Text
            fontFamily="$display"
            fontWeight="600"
            fontSize={14}
            color="$text"
            numberOfLines={1}
          >
            {meal.name}
          </Text>
          {meal.itemsSummary ? (
            <Text
              fontFamily="$body"
              fontSize={11.5}
              color="$text3"
              numberOfLines={1}
            >
              {meal.itemsSummary}
            </Text>
          ) : null}
          <View flexDirection="row" gap={6} marginTop={4}>
            <Pill tone="gold" size="xs">
              {meal.kcal} KCAL
            </Pill>
          </View>
        </View>
        <IconChevronR size={14} color="#8A8A98" />
      </View>
    </Pressable>
  );
}

function RecipeRow({
  recipe,
  onPress,
}: {
  recipe: RecipeRowVM;
  onPress: (id: string) => void;
}) {
  return (
    <Pressable
      onPress={() => onPress(recipe.id)}
      testID={`recipes-library-recipe-${recipe.id}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <View
        flexDirection="row"
        alignItems="center"
        gap={12}
        borderWidth={1}
        borderColor="$border"
        backgroundColor="$surface2"
        borderRadius={14}
        padding={14}
      >
        <View
          width={50}
          height={50}
          borderRadius={12}
          backgroundColor="$surface3"
          alignItems="center"
          justifyContent="center"
        >
          <Text fontSize={26}>🥘</Text>
        </View>
        <View flex={1} gap={2}>
          <Text
            fontFamily="$display"
            fontWeight="600"
            fontSize={14}
            color="$text"
            numberOfLines={1}
          >
            {recipe.name}
          </Text>
          {recipe.proteinG !== null ||
          recipe.carbsG !== null ||
          recipe.fatG !== null ? (
            <View flexDirection="row" gap={5} marginTop={2}>
              {recipe.proteinG !== null ? (
                <Pill tone="primary" size="xs">
                  P {recipe.proteinG}g
                </Pill>
              ) : null}
              {recipe.carbsG !== null ? (
                <Pill tone="gold" size="xs">
                  C {recipe.carbsG}g
                </Pill>
              ) : null}
              {recipe.fatG !== null ? (
                <Pill tone="ember" size="xs">
                  F {recipe.fatG}g
                </Pill>
              ) : null}
            </View>
          ) : null}
          <Text
            fontFamily="$body"
            fontSize={11}
            color="$text3"
            marginTop={4}
            numberOfLines={1}
          >
            {recipe.secondaryLine}
          </Text>
        </View>
        <View alignItems="flex-end" gap={6}>
          <Text fontFamily="$mono" fontWeight="600" fontSize={18} color="$gold">
            {recipe.kcal ?? "—"}
          </Text>
          <IconChevronR size={12} color="#8A8A98" />
        </View>
      </View>
    </Pressable>
  );
}

export function RecipesLibraryPresenter({
  tab,
  onTabChange,
  query,
  onQueryChange,
  meals,
  recipes,
  hasData,
  isLoading,
  isRefreshing,
  error,
  onRefresh,
  onSelectMeal,
  onSelectRecipe,
  onAdd,
  onBack,
  testID = "recipes-library-screen",
}: RecipesLibraryPresenterProps) {
  const insets = useSafeAreaInsets();

  const header = (
    <HeaderBar
      title="Library"
      leading={<BackToFuel onBack={onBack} />}
      trailing={
        <IconBtn
          icon={<IconPlus size={18} />}
          tone="primary"
          onPress={onAdd}
          testID="recipes-library-add"
          accessibilityLabel="Add to your library"
        />
      }
      testID="recipes-library-header"
    />
  );

  if (isLoading && !hasData) {
    return (
      <View flex={1} paddingTop={insets.top} testID={testID}>
        {header}
        <View flex={1} alignItems="center" justifyContent="center">
          <PLogoDrawLoader />
        </View>
      </View>
    );
  }

  if (error && !hasData) {
    return (
      <View flex={1} paddingTop={insets.top} testID={testID}>
        {header}
        <ErrorState
          message="Couldn't load your library. Pull to retry."
          onRetry={onRefresh}
          testID="recipes-library-error"
        />
      </View>
    );
  }

  const rows = tab === "Meals" ? meals : recipes;
  const emptyTitle =
    query.length > 0
      ? "Nothing matches"
      : tab === "Meals"
        ? "No saved meals yet"
        : "No recipes yet";
  const emptyDescription =
    query.length > 0
      ? "Try a different search."
      : tab === "Meals"
        ? "Save a meal combination you've logged to reuse it later."
        : "Recipes you save will show up here.";

  return (
    <View flex={1} paddingTop={insets.top} testID={testID}>
      {header}
      <View paddingHorizontal={16} paddingBottom={12}>
        <Segmented
          testID="recipes-library-tabs"
          options={["Meals", "Recipes"]}
          value={tab}
          onChange={(v) => onTabChange(v as LibraryTab)}
        />
      </View>
      <View paddingHorizontal={16} paddingBottom={12}>
        <SearchBar
          testID="recipes-library-search"
          placeholder={`Search ${tab.toLowerCase()}`}
          value={query}
          onChangeText={onQueryChange}
        />
      </View>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: 140,
          flexGrow: 1,
        }}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor="#22D3EE"
          />
        }
      >
        {rows.length === 0 ? (
          <EmptyState
            icon={
              tab === "Meals" ? (
                <IconClipboard size={28} color="#8A8A98" />
              ) : (
                <IconBook size={28} color="#8A8A98" />
              )
            }
            title={emptyTitle}
            description={emptyDescription}
            testID="recipes-library-empty"
          />
        ) : (
          <View gap={8}>
            {tab === "Meals"
              ? meals.map((m) => (
                  <MealRow key={m.id} meal={m} onPress={onSelectMeal} />
                ))
              : recipes.map((r) => (
                  <RecipeRow key={r.id} recipe={r} onPress={onSelectRecipe} />
                ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
