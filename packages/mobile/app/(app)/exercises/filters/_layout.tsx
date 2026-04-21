import { Stack, useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { Pressable, StyleSheet } from "react-native";
import { View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Row, Text } from "../../../../src/ui/components";
import { getExercisesQuery } from "../../../../src/application/queries/exercises.query";
import { useAdapters } from "../../../../src/ui/hooks/useAdapters";
import { useExerciseFilters } from "../../../../src/ui/hooks/useExerciseFilters";
import {
  ExerciseFiltersPendingProvider,
  useExerciseFiltersPending,
} from "../../../../src/ui/hooks/useExerciseFiltersPending";
import { colorPalette } from "../../../../src/ui/theme";

/**
 * Hierarchical filter modal shell (ported 1:1 from legacy).
 *
 * Layout:
 *   - Outer Stack (this file) — title + close + per-screen header labels.
 *   - Pending-state provider wraps the Stack so every axis screen reads
 *     the same draft.
 *   - Sticky Apply / Clear bar at the bottom sits OUTSIDE the Stack so
 *     it survives navigation between index / axis screens.
 *
 * The user flows:
 *   Section list → tap axis → detail screen (editing pending state) →
 *   back → section list shows updated count → Apply commits + dismisses.
 */
export default function FiltersLayout() {
  return (
    <ExerciseFiltersPendingProvider>
      <FiltersLayoutInner />
    </ExerciseFiltersPendingProvider>
  );
}

function FiltersLayoutInner() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { storage } = useAdapters();
  const applied = useExerciseFilters();
  const pending = useExerciseFiltersPending();

  const onClose = useCallback(() => {
    router.back();
  }, [router]);

  const onApply = useCallback(() => {
    applied.applyAdvanced({
      muscleGroups: pending.muscleGroups,
      equipment: pending.equipment,
      difficulties: pending.difficulties,
    });
    // For the created-by axis we write back through the quick-filter toggle
    // API on the outer context, keeping a single source of truth on that
    // axis. If the committed createdBy differs from pending, flip it.
    const currentCreatedBy =
      applied.quickFilters.find((q) => q === "mine" || q === "system") ?? null;
    if (currentCreatedBy !== pending.createdBy) {
      // Clear whichever is currently selected first (toggle deselects).
      if (currentCreatedBy) applied.toggleQuickFilter(currentCreatedBy);
      if (pending.createdBy) applied.toggleQuickFilter(pending.createdBy);
    }
    router.back();
  }, [applied, pending, router]);

  // Live match count for the Apply button. Uses the same merge helper as the
  // committed memo so the modal's count matches what the user will see on
  // return (no drift between the displayed number and the actual filter set).
  const matchCount = useMemo(() => {
    const previewed = applied.previewFiltersWithAdvanced({
      muscleGroups: pending.muscleGroups,
      equipment: pending.equipment,
      difficulties: pending.difficulties,
    });
    // Override createdBy with pending (not the committed quick-filter) so the
    // count reflects the draft.
    const effective = pending.createdBy
      ? { ...previewed, createdBy: pending.createdBy }
      : (() => {
          // Strip committed createdBy if pending has cleared it.
          const copy = { ...previewed };
          delete copy.createdBy;
          return copy;
        })();
    return getExercisesQuery(storage, effective).exercises.length;
  }, [applied, pending, storage]);

  return (
    <View flex={1} backgroundColor="$background">
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colorPalette.neutral1000 },
          headerTintColor: colorPalette.neutral0,
          headerTitleStyle: { fontWeight: "600" },
          contentStyle: { backgroundColor: colorPalette.neutral1000 },
          // React Navigation's header area uses its own Pressable wrapper;
          // using Tamagui's `<View onPress>` inside it double-wraps and
          // produces a ripple/flash on press. A plain Pressable with an
          // explicit pressed-state opacity matches the iOS-native header
          // feel the legacy app had.
          headerLeft: () => (
            <Pressable
              onPress={onClose}
              hitSlop={headerHitSlop}
              style={({ pressed }) => [
                headerButtonStyles.button,
                pressed && headerButtonStyles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Close filters"
              testID="filters-close"
            >
              <Text variant="bodySmall" color="$colorSecondary">
                Close
              </Text>
            </Pressable>
          ),
          headerRight: () => {
            const anySelected =
              pending.selectionCounts.muscleGroups +
                pending.selectionCounts.equipment +
                pending.selectionCounts.difficulties +
                pending.selectionCounts.createdBy >
              0;
            return (
              <Pressable
                onPress={anySelected ? pending.clearAll : undefined}
                disabled={!anySelected}
                hitSlop={headerHitSlop}
                style={({ pressed }) => [
                  headerButtonStyles.button,
                  pressed && anySelected && headerButtonStyles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Clear all filters"
                accessibilityState={{ disabled: !anySelected }}
                testID="filters-clear"
              >
                <Text
                  variant="bodySmall"
                  color={anySelected ? "$primary" : "$colorDisabled"}
                  fontWeight="600"
                >
                  Clear
                </Text>
              </Pressable>
            );
          },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Filters" }} />
        <Stack.Screen name="muscles" options={{ title: "Muscle Groups" }} />
        <Stack.Screen name="equipment" options={{ title: "Equipment" }} />
        <Stack.Screen name="difficulty" options={{ title: "Difficulty" }} />
        <Stack.Screen name="created-by" options={{ title: "Created By" }} />
      </Stack>

      {/* Sticky apply bar — lives outside the Stack so it persists across
          axis navigation (AC 7.12). Legacy parity: single Apply button in
          the sticky bar; Clear lives in the header (top-right). */}
      <Row
        gap="sm"
        paddingHorizontal="$base"
        paddingTop="$md"
        paddingBottom={Math.max(insets.bottom, 16)}
        borderTopWidth={1}
        borderTopColor="$borderColor"
        backgroundColor="$background"
        testID="filters-apply-bar"
      >
        <View flex={1}>
          <Button
            label={buildApplyLabel(matchCount)}
            onPress={onApply}
            variant="primary"
            fullWidth
            testID="filters-apply-button"
          />
        </View>
      </Row>
    </View>
  );
}

function buildApplyLabel(count: number): string {
  if (count === 1) return "Show 1 exercise";
  return `Show ${count} exercises`;
}

const headerHitSlop = { top: 12, bottom: 12, left: 12, right: 12 };

const headerButtonStyles = StyleSheet.create({
  button: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    // Align text vertically inside React Navigation's header height.
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.5,
  },
});
