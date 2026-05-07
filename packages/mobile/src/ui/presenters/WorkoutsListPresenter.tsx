import React from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ApiError } from "@/shared/errors";
import { ErrorState } from "@/ui/components/ErrorState";
import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";
import { QuickActions } from "@/ui/components/workouts/QuickActions";
import { WorkoutCard } from "@/ui/components/workouts/WorkoutCard";
import { WorkoutLimitIndicator } from "@/ui/components/workouts/WorkoutLimitIndicator";
import { WorkoutSection } from "@/ui/components/workouts/WorkoutSection";
import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";

/**
 * Pure presenter for the Workouts tab. Layout + StyleSheet ported from
 * `persistence-mobile/app/(tabs)/workouts.tsx`. The container owns all
 * state + side effects; this presenter is render-only.
 */

// Card-shaped object the verbatim WorkoutCard expects (legacy snake_case).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WorkoutCardView = any;

export interface WorkoutsListPresenterProps {
  isInitialLoading: boolean;
  error: ApiError | null;
  isRefreshing: boolean;
  searchQuery: string;
  myAndAssignedCount: number;
  mineCount: number;
  assignedCount: number;
  defaultCount: number;
  filteredMyWorkouts: WorkoutCardView[];
  filteredExampleWorkouts: WorkoutCardView[];
  userWorkoutLimit: number | undefined;
  isAtLimit: boolean;
  currentUserId?: string;
  deletingWorkoutIds: Set<string>;
  onCreateWorkout: () => void;
  onBrowseExercises: () => void;
  onUpgrade: () => void;
  onSearchChange: (q: string) => void;
  onWorkoutPress: (w: WorkoutCardView) => void;
  onEditWorkout: (w: WorkoutCardView) => void;
  onDeleteWorkout: (w: WorkoutCardView) => void;
  onStartWorkout: (workoutId: string) => void;
  onRetry: () => void;
  onRefresh: () => void;
}

export function WorkoutsListPresenter({
  isInitialLoading,
  error,
  isRefreshing,
  searchQuery,
  myAndAssignedCount,
  mineCount,
  assignedCount,
  defaultCount,
  filteredMyWorkouts,
  filteredExampleWorkouts,
  userWorkoutLimit,
  isAtLimit,
  currentUserId,
  deletingWorkoutIds,
  onCreateWorkout,
  onBrowseExercises,
  onUpgrade,
  onSearchChange,
  onWorkoutPress,
  onEditWorkout,
  onDeleteWorkout,
  onStartWorkout,
  onRetry,
  onRefresh,
}: WorkoutsListPresenterProps) {
  // Blocking error state ONLY when the underlying cache is empty +
  // refresh failed. We check unfiltered counts, not the search-
  // filtered arrays — otherwise a user who's offline AND searching
  // for a term with no matches would see a "Failed to load workouts"
  // wall instead of their cached list with an empty search result.
  // Cached-offline must always render the user's own data.
  const cachedHasAnyWorkout = myAndAssignedCount > 0 || defaultCount > 0;
  if (error && !cachedHasAnyWorkout && !isInitialLoading) {
    return (
      <ErrorState
        title="Failed to load workouts"
        message={error.message}
        onRetry={onRetry}
      />
    );
  }

  if (isInitialLoading) {
    return (
      <View style={styles.loadingContainer}>
        <PLogoDrawLoader />
        <Text style={styles.loadingText}>Loading workouts...</Text>
      </View>
    );
  }

  const renderList = (workouts: WorkoutCardView[]) =>
    workouts.map((w) => (
      <WorkoutCard
        key={w.id}
        workout={w}
        currentUserId={currentUserId}
        isDisabled={deletingWorkoutIds.has(w.id)}
        onPress={() => onWorkoutPress(w)}
        onStart={() => onStartWorkout(w.id)}
        onEdit={() => onEditWorkout(w)}
        onDelete={() => onDeleteWorkout(w)}
      />
    ));

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={Colors.text.secondary}
          />
        }
      >
        <View style={styles.header}>
          <View style={styles.searchBar}>
            <Ionicons
              name="search"
              size={18}
              color={Colors.text.secondary}
              style={styles.searchIcon}
            />
            <TextInput
              value={searchQuery}
              onChangeText={onSearchChange}
              placeholder="Search workouts..."
              placeholderTextColor={Colors.text.tertiary}
              style={styles.searchInput}
              testID="workouts-search-input"
            />
          </View>
        </View>

        {!searchQuery && (
          <QuickActions
            isAtLimit={isAtLimit}
            onCreateWorkout={onCreateWorkout}
            onBrowseExercises={onBrowseExercises}
          />
        )}

        {isAtLimit && (
          <WorkoutLimitIndicator
            userWorkoutLimit={userWorkoutLimit}
            isLoadingUserRole={false}
            onUpgrade={onUpgrade}
          />
        )}

        {searchQuery ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              Search Results (
              {filteredMyWorkouts.length + filteredExampleWorkouts.length})
            </Text>
            {filteredMyWorkouts.length + filteredExampleWorkouts.length ===
            0 ? (
              <View style={styles.emptyContainer}>
                <Ionicons
                  name="search-outline"
                  size={48}
                  color={Colors.text.tertiary}
                />
                <Text style={styles.emptyTitle}>No workouts found</Text>
                <Text style={styles.emptyMessage}>
                  Try adjusting your search terms
                </Text>
              </View>
            ) : (
              <>
                {renderList(filteredMyWorkouts)}
                {renderList(filteredExampleWorkouts)}
              </>
            )}
          </View>
        ) : (
          <>
            <WorkoutSection
              title="My Workouts"
              subtitle={`${myAndAssignedCount} workouts (${mineCount} created, ${assignedCount} assigned)`}
              isLoading={false}
              isEmpty={filteredMyWorkouts.length === 0}
              emptyTitle="No workouts yet"
              emptyMessage="Create your first workout template to get started"
              emptyIcon="fitness-outline"
            >
              {renderList(filteredMyWorkouts)}
            </WorkoutSection>

            <WorkoutSection
              title="Example Workouts"
              subtitle={`${defaultCount} ready-to-use templates`}
              isLoading={false}
              isEmpty={filteredExampleWorkouts.length === 0}
              emptyTitle="No example workouts available"
              emptyMessage="Example workouts will appear here when available"
              emptyIcon="fitness-outline"
            >
              {renderList(filteredExampleWorkouts)}
            </WorkoutSection>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.lg,
  },
  header: {
    marginBottom: Spacing.lg,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface.secondary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  searchIcon: {
    marginRight: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    color: Colors.text.primary,
    fontSize: 16,
  },
  section: {
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    ...Typography.h3,
    marginBottom: Spacing.md,
  },
  emptyContainer: {
    alignItems: "center" as const,
    paddingVertical: Spacing.xl,
  },
  emptyTitle: {
    ...Typography.h3,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  emptyMessage: {
    ...Typography.body2,
    textAlign: "center" as const,
    color: Colors.text.secondary,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingVertical: Spacing.xl,
    backgroundColor: Colors.background.primary,
  },
  loadingText: {
    ...Typography.body2,
    marginTop: Spacing.md,
    color: Colors.text.secondary,
  },
});
