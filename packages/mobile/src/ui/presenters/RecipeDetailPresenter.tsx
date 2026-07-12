import { Pressable, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Btn, HeaderBar, Pill } from "@/ui/components/foundation";
import { ErrorState, PLogoDrawLoader, EmptyState } from "@/ui/components";
import { IconBack, IconPlus, IconBook } from "@/ui/components/icons";
import type { ApiError } from "@/shared/errors";

/**
 * <RecipeDetailPresenter> — read-only recipe viewer (recipes.jsx
 * `RecipeDetail`, `kind: 'recipe'` branch). PR1 has no edit/delete —
 * detail screens are read-only until PR2.
 *
 * Implements: specs/milestones (Fuel → Recipes PR1 brief) § <RecipeDetailPresenter>
 */

export type RecipeIngredientVM = {
  id: string;
  /** "Chicken breast · 300 g" — pre-formatted (name · quantity+unit), or the
   * food/custom-name fallback when a linked food isn't cached. */
  label: string;
};

export type RecipeDetailPresenterProps = {
  found: boolean;
  isLoading: boolean;
  error?: ApiError | null;
  onRetry: () => void;
  onBack: () => void;
  name: string;
  emoji: string;
  secondaryLine: string;
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  ingredients: readonly RecipeIngredientVM[];
  instructions: string | null;
  onLogToToday: () => void;
  isLogging: boolean;
  testID?: string;
};

export function RecipeDetailPresenter({
  found,
  isLoading,
  error,
  onRetry,
  onBack,
  name,
  emoji,
  secondaryLine,
  kcal,
  proteinG,
  carbsG,
  fatG,
  ingredients,
  instructions,
  onLogToToday,
  isLogging,
  testID = "recipe-detail-screen",
}: RecipeDetailPresenterProps) {
  const insets = useSafeAreaInsets();

  const header = (
    <HeaderBar
      title="Recipe"
      eyebrow="RECIPE"
      leading={
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID="recipe-detail-back"
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <IconBack size={18} color="#B8B8C4" />
        </Pressable>
      }
      testID="recipe-detail-header"
    />
  );

  if (isLoading && !found) {
    return (
      <View flex={1} paddingTop={insets.top} testID={testID}>
        {header}
        <View flex={1} alignItems="center" justifyContent="center">
          <PLogoDrawLoader />
        </View>
      </View>
    );
  }

  if (error && !found) {
    return (
      <View flex={1} paddingTop={insets.top} testID={testID}>
        {header}
        <ErrorState
          message="Couldn't load this recipe. Pull to retry."
          onRetry={onRetry}
          testID="recipe-detail-error"
        />
      </View>
    );
  }

  if (!found) {
    return (
      <View flex={1} paddingTop={insets.top} testID={testID}>
        {header}
        <EmptyState
          icon={<IconBook size={28} color="#8A8A98" />}
          title="Recipe not found"
          description="It may have been removed."
          testID="recipe-detail-not-found"
        />
      </View>
    );
  }

  return (
    <View flex={1} paddingTop={insets.top} testID={testID}>
      {header}
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: 140,
          gap: 14,
        }}
      >
        <View
          borderWidth={1}
          borderColor="$border"
          backgroundColor="$surface2"
          borderRadius={16}
          overflow="hidden"
        >
          <View
            aspectRatio={16 / 9}
            backgroundColor="$surface3"
            alignItems="center"
            justifyContent="center"
          >
            <Text fontSize={64}>{emoji}</Text>
          </View>
          <View padding={14} gap={4}>
            <Text
              fontFamily="$display"
              fontWeight="700"
              fontSize={20}
              color="$text"
              testID="recipe-detail-name"
            >
              {name}
            </Text>
            <Text fontFamily="$body" fontSize={12} color="$text3">
              {secondaryLine}
            </Text>
            <View flexDirection="row" gap={8} marginTop={8}>
              <Pill tone="gold" size="xs">
                {kcal ?? "—"} KCAL
              </Pill>
              {proteinG !== null ? (
                <Pill tone="primary" size="xs">
                  P {proteinG}G
                </Pill>
              ) : null}
              {carbsG !== null ? (
                <Pill tone="gold" size="xs">
                  C {carbsG}G
                </Pill>
              ) : null}
              {fatG !== null ? (
                <Pill tone="ember" size="xs">
                  F {fatG}G
                </Pill>
              ) : null}
            </View>
          </View>
        </View>

        <View gap={8}>
          <Text
            fontFamily="$display"
            fontWeight="600"
            fontSize={10.5}
            letterSpacing={1.5}
            textTransform="uppercase"
            color="$text3"
          >
            Ingredients
          </Text>
          {ingredients.length === 0 ? (
            <Text fontFamily="$body" fontSize={12.5} color="$text3">
              No ingredients listed.
            </Text>
          ) : (
            <View
              borderWidth={1}
              borderColor="$border"
              backgroundColor="$surface2"
              borderRadius={12}
              overflow="hidden"
            >
              {ingredients.map((ing, i) => (
                <View
                  key={ing.id}
                  padding={14}
                  borderTopWidth={i === 0 ? 0 : 1}
                  borderTopColor="$border"
                  testID={`recipe-detail-ingredient-${ing.id}`}
                >
                  <Text fontFamily="$body" fontSize={12.5} color="$text2">
                    {ing.label}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {instructions ? (
          <View gap={8}>
            <Text
              fontFamily="$display"
              fontWeight="600"
              fontSize={10.5}
              letterSpacing={1.5}
              textTransform="uppercase"
              color="$text3"
            >
              Instructions
            </Text>
            <View
              borderWidth={1}
              borderColor="$border"
              backgroundColor="$surface2"
              borderRadius={12}
              padding={14}
            >
              <Text
                fontFamily="$body"
                fontSize={13}
                lineHeight={20}
                color="$text2"
                testID="recipe-detail-instructions"
              >
                {instructions}
              </Text>
            </View>
          </View>
        ) : null}

        <Btn
          full
          variant="filled"
          tone="gold"
          size="lg"
          icon={<IconPlus size={15} />}
          onPress={onLogToToday}
          disabled={isLogging}
          testID="recipe-detail-log"
        >
          Log to today
        </Btn>
      </ScrollView>
    </View>
  );
}
