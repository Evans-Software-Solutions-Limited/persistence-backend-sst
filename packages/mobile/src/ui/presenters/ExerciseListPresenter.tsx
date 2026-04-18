import { View, Text as TamaguiText } from "@tamagui/core";
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  type ListRenderItemInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn } from "react-native-reanimated";
import type {
  EquipmentType,
  Exercise,
  ExerciseCategory,
  ExerciseDifficulty,
  MuscleGroup,
} from "@/domain/models/exercise";
import {
  Button,
  Column,
  EmptyState,
  ErrorState,
  ExerciseCard,
  ExerciseFilterBar,
  Input,
  MuscleGroupPicker,
  Row,
  Skeleton,
  Text,
} from "@/ui/components";
import { useStaggeredEntry } from "@/ui/hooks/useStaggeredEntry";

export type ExerciseListPresenterProps = {
  exercises: Exercise[];
  searchInput: string;
  muscleGroups: MuscleGroup[];
  equipment: EquipmentType[];
  category: ExerciseCategory | null;
  difficulty: ExerciseDifficulty | null;
  lastSyncedAt: string | null;
  isStale: boolean;
  isRefreshing: boolean;
  /** True when initial cache read has no rows and a refresh is in-flight. */
  showSkeleton: boolean;
  /** Non-null when the most recent refresh failed and there is no cached data to show. */
  loadError: string | null;
  onSearchChange: (text: string) => void;
  onToggleMuscleGroup: (group: MuscleGroup) => void;
  onToggleEquipment: (equipment: EquipmentType) => void;
  onSelectCategory: (category: ExerciseCategory | null) => void;
  onSelectDifficulty: (difficulty: ExerciseDifficulty | null) => void;
  onClearFilters: () => void;
  onRefresh: () => void;
  onSelectExercise: (id: string) => void;
  onCreateExercise: () => void;
  /**
   * Clock for deterministic "last synced X ago" rendering in tests.
   * Defaults to Date.now.
   */
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
  muscleGroups,
  equipment,
  category,
  difficulty,
  lastSyncedAt,
  isStale,
  isRefreshing,
  showSkeleton,
  loadError,
  onSearchChange,
  onToggleMuscleGroup,
  onToggleEquipment,
  onSelectCategory,
  onSelectDifficulty,
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
  const muscleStyle = useStaggeredEntry(3);
  const listStyle = useStaggeredEntry(4);

  const hasActiveFilters =
    muscleGroups.length > 0 ||
    equipment.length > 0 ||
    category !== null ||
    difficulty !== null;

  const countLabel =
    exercises.length === 1 ? "1 exercise" : `${exercises.length} exercises`;

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
          title="Couldn't load exercises"
          message={loadError}
          onRetry={onRefresh}
          testID="exercise-list-error"
        />
      );
    }
    if (hasActiveFilters || searchInput.length > 0) {
      return (
        <EmptyState
          title="No matches"
          description="Try different filters or a broader search."
          action={{ label: "Clear filters", onPress: onClearFilters }}
          testID="exercise-list-empty-filtered"
        />
      );
    }
    return (
      <EmptyState
        title="No exercises yet"
        description="Pull down to refresh or create your own custom exercise."
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
      <Animated.View style={headerStyle}>
        <Row
          gap="sm"
          justify="between"
          paddingHorizontal="$base"
          paddingTop="$base"
          paddingBottom="$sm"
        >
          <Column gap="xs">
            <TamaguiText
              fontFamily="$heading"
              fontSize={28}
              lineHeight={34}
              fontWeight="700"
              color="$color"
              testID="exercise-list-title"
            >
              Exercises
            </TamaguiText>
            <Text variant="caption" muted testID="exercise-list-count">
              {countLabel}
            </Text>
          </Column>
          <Button
            label="New"
            onPress={onCreateExercise}
            variant="secondary"
            size="sm"
            testID="create-exercise-button"
          />
        </Row>
      </Animated.View>

      <Animated.View style={searchStyle}>
        <View paddingHorizontal="$base" paddingBottom="$sm">
          <Input
            placeholder="Search exercises"
            value={searchInput}
            onChangeText={onSearchChange}
            autoCapitalize="none"
            autoCorrect={false}
            testID="exercise-search"
          />
        </View>
      </Animated.View>

      {isStale && exercises.length > 0 && (
        <Animated.View entering={FadeIn.duration(200)}>
          <View
            marginHorizontal="$base"
            marginBottom="$sm"
            paddingHorizontal="$base"
            paddingVertical="$sm"
            borderRadius="$md"
            backgroundColor="rgba(245, 158, 11, 0.08)"
            borderWidth={1}
            borderColor="rgba(245, 158, 11, 0.2)"
          >
            <Row gap="sm" justify="between">
              <Text
                variant="caption"
                color="$warning"
                testID="exercise-list-stale-banner"
              >
                {describeSyncAge(lastSyncedAt, now)} · pull down to refresh
              </Text>
            </Row>
          </View>
        </Animated.View>
      )}

      <Animated.View style={filterStyle}>
        <View paddingHorizontal="$base" paddingBottom="$sm">
          <ExerciseFilterBar
            category={category}
            difficulty={difficulty}
            equipment={equipment}
            hasActiveFilters={hasActiveFilters}
            onSelectCategory={onSelectCategory}
            onSelectDifficulty={onSelectDifficulty}
            onToggleEquipment={onToggleEquipment}
            onClearFilters={onClearFilters}
            testID="exercise-filter-bar"
          />
        </View>
      </Animated.View>

      <Animated.View style={muscleStyle}>
        <View paddingHorizontal="$base" paddingBottom="$sm">
          <MuscleGroupPicker
            selected={muscleGroups}
            onToggle={onToggleMuscleGroup}
            testID="muscle-group-picker"
          />
        </View>
      </Animated.View>

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
            padding: 16,
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
});
