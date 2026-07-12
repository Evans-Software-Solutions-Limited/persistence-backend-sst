import { Pressable, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Btn, HeaderBar, Pill } from "@/ui/components/foundation";
import { ErrorState, PLogoDrawLoader, EmptyState } from "@/ui/components";
import { IconBack, IconPlus, IconClipboard } from "@/ui/components/icons";
import type { ApiError } from "@/shared/errors";

/**
 * <MealDetailPresenter> — read-only saved-meal viewer (recipes.jsx
 * `RecipeDetail`, `kind: 'meal'` branch). PR1 has no edit/delete.
 *
 * `itemsSummary` is null when the cached meal has no item detail (the
 * `GET /meals` list endpoint omits items by design — see the container);
 * a freshly-saved meal (this PR's Save-a-meal flow) has it immediately.
 *
 * Implements: specs/milestones (Fuel → Recipes PR1 brief) § <MealDetailPresenter>
 */

export type MealDetailPresenterProps = {
  found: boolean;
  isLoading: boolean;
  error?: ApiError | null;
  onRetry: () => void;
  onBack: () => void;
  name: string;
  itemsSummary: string | null;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  onLogToToday: () => void;
  isLogging: boolean;
  testID?: string;
};

export function MealDetailPresenter({
  found,
  isLoading,
  error,
  onRetry,
  onBack,
  name,
  itemsSummary,
  kcal,
  proteinG,
  carbsG,
  fatG,
  onLogToToday,
  isLogging,
  testID = "meal-detail-screen",
}: MealDetailPresenterProps) {
  const insets = useSafeAreaInsets();

  const header = (
    <HeaderBar
      title="Meal"
      eyebrow="SAVED"
      leading={
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID="meal-detail-back"
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <IconBack size={18} color="#B8B8C4" />
        </Pressable>
      }
      testID="meal-detail-header"
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
          message="Couldn't load this meal. Pull to retry."
          onRetry={onRetry}
          testID="meal-detail-error"
        />
      </View>
    );
  }

  if (!found) {
    return (
      <View flex={1} paddingTop={insets.top} testID={testID}>
        {header}
        <EmptyState
          icon={<IconClipboard size={28} color="#8A8A98" />}
          title="Meal not found"
          description="It may have been removed."
          testID="meal-detail-not-found"
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
            <Text fontSize={64}>🍱</Text>
          </View>
          <View padding={14} gap={4}>
            <Text
              fontFamily="$display"
              fontWeight="700"
              fontSize={20}
              color="$text"
              testID="meal-detail-name"
            >
              {name}
            </Text>
            {itemsSummary ? (
              <Text fontFamily="$body" fontSize={12} color="$text3">
                {itemsSummary}
              </Text>
            ) : null}
            <View flexDirection="row" gap={8} marginTop={8}>
              <Pill tone="gold" size="xs">
                {kcal} KCAL
              </Pill>
              <Pill tone="primary" size="xs">
                P {proteinG}G
              </Pill>
              <Pill tone="gold" size="xs">
                C {carbsG}G
              </Pill>
              <Pill tone="ember" size="xs">
                F {fatG}G
              </Pill>
            </View>
          </View>
        </View>

        <Btn
          full
          variant="filled"
          tone="primary"
          size="lg"
          icon={<IconPlus size={15} />}
          onPress={onLogToToday}
          disabled={isLogging}
          testID="meal-detail-log"
        >
          Log to today
        </Btn>
      </ScrollView>
    </View>
  );
}
