import { Ionicons } from "@expo/vector-icons";
import { View, Text as TamaguiText } from "@tamagui/core";
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  TextInput,
  type ListRenderItemInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn } from "react-native-reanimated";
import type { Exercise } from "@/domain/models/exercise";
import {
  Column,
  EmptyState,
  ErrorState,
  ExerciseCard,
  ExerciseFilterBar,
  Row,
  Skeleton,
  Text,
} from "@/ui/components";
import type { QuickFilterId } from "@/ui/components/ExerciseFilterBar";
import { useStaggeredEntry } from "@/ui/hooks/useStaggeredEntry";

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
  now = Date.now,
}: ExerciseListPresenterProps) {
  const insets = useSafeAreaInsets();
  const headerStyle = useStaggeredEntry(0);
  const searchStyle = useStaggeredEntry(1);
  const filterStyle = useStaggeredEntry(2);
  const listStyle = useStaggeredEntry(3);

  const renderItem = ({ item }: ListRenderItemInfo<Exercise>) => (
    <ExerciseCard
      exercise={item}
      onPress={onSelectExercise}
      testID={`exercise-card-${item.id}`}
    />
  );

  const renderListEmpty = () => {
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
  };

  return (
    <View
      flex={1}
      backgroundColor="$background"
      testID="exercise-list-screen"
      style={{ paddingTop: insets.top }}
    >
      {/* Header: title only. No counter, no right-action button. */}
      <Animated.View style={headerStyle}>
        <View paddingHorizontal="$base" paddingTop="$base" paddingBottom="$md">
          <TamaguiText
            fontFamily="$heading"
            fontSize={28}
            lineHeight={34}
            fontWeight="700"
            color="$color"
            letterSpacing={-0.5}
            testID="exercise-list-title"
          >
            Exercises
          </TamaguiText>
        </View>
      </Animated.View>

      {/* Search bar with inline create (+) affordance. */}
      <Animated.View style={searchStyle}>
        <View paddingHorizontal="$base" paddingBottom="$md">
          <Row gap="sm">
            <View
              flex={1}
              flexDirection="row"
              alignItems="center"
              height={48}
              backgroundColor="$surfaceSecondary"
              borderRadius="$lg"
              paddingHorizontal="$base"
            >
              <Ionicons name="search-outline" size={20} color="#8E8E9A" />
              <TextInput
                value={searchInput}
                onChangeText={onSearchChange}
                placeholder="Search exercises"
                placeholderTextColor="#8E8E9A"
                autoCapitalize="none"
                autoCorrect={false}
                testID="exercise-search-input"
                style={styles.searchField}
              />
              {searchInput.length > 0 && (
                <View
                  onPress={() => onSearchChange("")}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  testID="exercise-search-clear"
                  padding="$xs"
                >
                  <Ionicons name="close-circle" size={18} color="#8E8E9A" />
                </View>
              )}
            </View>
            <View
              width={48}
              height={48}
              borderRadius="$lg"
              borderWidth={1}
              borderColor="$primary"
              backgroundColor="transparent"
              alignItems="center"
              justifyContent="center"
              onPress={onCreateExercise}
              accessibilityRole="button"
              accessibilityLabel="Create new exercise"
              testID="create-exercise-button"
              pressStyle={{
                backgroundColor: "$primary",
                opacity: 0.9,
                scale: 0.97,
              }}
            >
              <Ionicons name="add" size={22} color="#00D4FF" />
            </View>
          </Row>
        </View>
      </Animated.View>

      {/* Curated quick-filter rail. No more muscle grid on the main screen. */}
      <Animated.View style={filterStyle}>
        <View paddingBottom="$md">
          <ExerciseFilterBar
            selectedQuickFilters={selectedQuickFilters}
            hasAdvancedFilters={hasAdvancedFilters}
            onToggleQuickFilter={onToggleQuickFilter}
            onOpenFilterModal={onOpenFilterModal}
            testID="exercise-filter-bar"
          />
        </View>
      </Animated.View>

      {/* Inline stale metadata strip — never obstructs content. */}
      {isStale && !showSkeleton && loadError === null && (
        <Animated.View entering={FadeIn.duration(200)}>
          <View
            paddingHorizontal="$base"
            paddingBottom="$sm"
            flexDirection="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <Row gap="sm">
              <View
                width={6}
                height={6}
                borderRadius="$full"
                backgroundColor="$warning"
              />
              <Text variant="caption" muted testID="exercise-list-stale-banner">
                {describeSyncAge(lastSyncedAt, now)}
              </Text>
            </Row>
            <Text variant="caption" muted>
              Pull to refresh
            </Text>
          </View>
        </Animated.View>
      )}

      <Animated.View style={[listStyle, styles.flex]}>
        <FlatList
          data={exercises}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor="#00D4FF"
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
      </Animated.View>
    </View>
  );
}

function Separator() {
  return <View height={12} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  searchField: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 16,
    marginLeft: 10,
    paddingVertical: 0,
  },
});
