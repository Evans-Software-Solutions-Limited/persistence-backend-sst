import { Text, View } from "@tamagui/core";
import { useCallback } from "react";
import {
  FlatList,
  type ListRenderItemInfo,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Exercise } from "@/domain/models/exercise";
import { Column, EmptyState, ErrorState, Skeleton } from "@/ui/components";
import {
  ExerciseFilterBar,
  type QuickFilterId,
} from "@/ui/components/ExerciseFilterBar";
import { SearchBar } from "@/ui/components/composite/SearchBar";
import { ExerciseCard } from "@/ui/components/exercises/ExerciseCard";
import { NEUTRAL_HEX, toneHex } from "@/ui/components/foundation/tones";

/**
 * Pure presenter for the Train > Exercises segment — the headerless body
 * under <TrainHubContainer> (the hub owns the eyebrow/title + the Create
 * action + the Segmented switcher).
 *
 * Layout source: ~/Downloads/handoff/design-source/prototype-hubs.jsx:95–146
 * (`TrainExercisesContent`): <SearchBar> + a leading filter <IconBtn> +
 * horizontal <FilterChip> rail + a list of library <ExerciseCard>s. The
 * skeleton / stale / empty / error affordances are preserved offline UX (the
 * static prototype mock doesn't depict them).
 */

export type ExerciseListPresenterProps = {
  exercises: Exercise[];
  searchInput: string;
  selectedQuickFilters: QuickFilterId[];
  hasAdvancedFilters: boolean;
  /** True iff any filter (quick, advanced, or search) is currently set. */
  hasAnyFilter: boolean;
  lastSyncedAt: string | null;
  isStale: boolean;
  isRefreshing: boolean;
  showSkeleton: boolean;
  loadError: string | null;
  onSearchChange: (text: string) => void;
  onToggleQuickFilter: (id: QuickFilterId) => void;
  onOpenFilterModal: () => void;
  onClearFilters: () => void;
  onRefresh: () => void;
  onSelectExercise: (id: string) => void;
  onCreateExercise: () => void;
  /** Long-press → destructive-delete Alert (AC 7.17). Optional. */
  onLongPressExercise?: (id: string) => void;
  /** Injectable clock for deterministic "Updated X ago" rendering in tests. */
  now?: () => number;
};

function describeSyncAge(
  lastSyncedAt: string | null,
  now: () => number,
): string {
  if (lastSyncedAt === null) return "Not synced yet";
  const diffMs = now() - Date.parse(lastSyncedAt);
  if (Number.isNaN(diffMs) || diffMs < 0) return "Not synced yet";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Updated ${days}d ago`;
}

function keyExtractor(exercise: Exercise): string {
  return exercise.id;
}

function Separator() {
  return <View height={8} />;
}

export function ExerciseListPresenter({
  exercises,
  searchInput,
  selectedQuickFilters,
  hasAdvancedFilters,
  hasAnyFilter,
  lastSyncedAt,
  isStale,
  isRefreshing,
  showSkeleton,
  loadError,
  onSearchChange,
  onToggleQuickFilter,
  onOpenFilterModal,
  onClearFilters,
  onRefresh,
  onSelectExercise,
  onCreateExercise,
  onLongPressExercise,
  now = Date.now,
}: ExerciseListPresenterProps) {
  const insets = useSafeAreaInsets();

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Exercise>) => (
      <ExerciseCard
        exercise={item}
        onPress={onSelectExercise}
        onLongPress={onLongPressExercise}
        testID={`exercise-card-${item.id}`}
      />
    ),
    [onSelectExercise, onLongPressExercise],
  );

  const renderListEmpty = useCallback(() => {
    if (showSkeleton) {
      return (
        <Column gap="sm" testID="exercise-list-skeleton">
          <Skeleton variant="rect" height={96} />
          <Skeleton variant="rect" height={96} />
          <Skeleton variant="rect" height={96} />
          <Skeleton variant="rect" height={96} />
        </Column>
      );
    }
    if (loadError !== null) {
      return (
        <ErrorState
          title="Couldn't load"
          message={loadError}
          onRetry={onRefresh}
          testID="exercise-list-error"
        />
      );
    }
    if (hasAnyFilter) {
      return (
        <EmptyState
          title="Nothing matches"
          description="Try a broader search or clear your filters."
          action={{ label: "Clear filters", onPress: onClearFilters }}
          testID="exercise-list-empty-filtered"
        />
      );
    }
    return (
      <EmptyState
        title="Your library is empty"
        description="Pull down to refresh, or create an exercise."
        action={{ label: "Create exercise", onPress: onCreateExercise }}
        testID="exercise-list-empty"
      />
    );
  }, [
    showSkeleton,
    loadError,
    hasAnyFilter,
    onRefresh,
    onClearFilters,
    onCreateExercise,
  ]);

  return (
    <View flex={1} backgroundColor="$bg" testID="exercise-list-screen">
      <View paddingHorizontal={16} paddingBottom={12}>
        <SearchBar
          testID="exercise-search"
          placeholder="Search exercises"
          value={searchInput}
          onChangeText={onSearchChange}
        />
      </View>

      <View paddingBottom={12}>
        <ExerciseFilterBar
          selectedQuickFilters={selectedQuickFilters}
          hasAdvancedFilters={hasAdvancedFilters}
          onToggleQuickFilter={onToggleQuickFilter}
          onOpenFilterModal={onOpenFilterModal}
          testID="exercise-filter-bar"
        />
      </View>

      {/* Inline stale strip — never obstructs content. */}
      {isStale && !showSkeleton && loadError === null && (
        <View
          paddingHorizontal={16}
          paddingBottom={8}
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
        >
          <View flexDirection="row" alignItems="center" gap={8}>
            <View
              width={6}
              height={6}
              borderRadius={9999}
              backgroundColor={toneHex("gold").base}
            />
            <Text
              fontFamily="$body"
              fontSize={12}
              color="$text3"
              testID="exercise-list-stale-banner"
            >
              {describeSyncAge(lastSyncedAt, now)}
            </Text>
          </View>
          <Text fontFamily="$body" fontSize={12} color="$text3">
            Pull to refresh
          </Text>
        </View>
      )}

      <View flex={1}>
        <FlatList
          data={exercises}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={NEUTRAL_HEX.text3}
              testID="exercise-list-refresh-control"
            />
          }
          ListEmptyComponent={renderListEmpty}
          ItemSeparatorComponent={Separator}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: 48 + insets.bottom,
            flexGrow: 1,
          }}
          showsVerticalScrollIndicator={false}
          testID="exercise-list"
        />
      </View>
    </View>
  );
}
