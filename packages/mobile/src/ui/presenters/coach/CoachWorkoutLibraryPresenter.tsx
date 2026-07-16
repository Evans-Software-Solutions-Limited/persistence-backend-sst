import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";
import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";
import type { Workout } from "@/domain/models/workout";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/**
 * Coach Workout library (pure presenter). Lists every workout the coach has
 * authored — UNFILTERED (unlike their personal My Workouts, which hides
 * client-authored workouts). A "Create workout" CTA opens the creator in
 * coach context; tapping a row edits it (also coach context). Workouts hidden
 * from the coach's personal library get a quiet marker so the state is legible.
 *
 * Spec: specs/milestones/WORKOUT-AUTHORING-V2/design.md § 11
 */

interface CoachWorkoutLibraryPresenterProps {
  readonly workouts: readonly Workout[];
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly error: string | null;
  readonly onBack: () => void;
  readonly onCreate: () => void;
  readonly onOpen: (workoutId: string) => void;
  readonly onRefresh: () => void;
}

export function CoachWorkoutLibraryPresenter({
  workouts,
  isLoading,
  isRefreshing,
  error,
  onBack,
  onCreate,
  onOpen,
  onRefresh,
}: CoachWorkoutLibraryPresenterProps) {
  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.iconButton}
          testID="coach-library-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={Colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Workout library
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {isLoading && workouts.length === 0 ? (
        <View style={styles.centre} testID="coach-library-loading">
          <PLogoDrawLoader />
          <Text style={styles.centreText}>Loading your workouts…</Text>
        </View>
      ) : error && workouts.length === 0 ? (
        <View style={styles.centre} testID="coach-library-error">
          <Ionicons
            name="alert-circle-outline"
            size={48}
            color={Colors.error.DEFAULT}
          />
          <Text style={styles.errorTitle}>Couldn&apos;t load workouts</Text>
          <Text style={styles.centreText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={onRefresh}
            testID="coach-library-retry"
          >
            <Text style={styles.retryButtonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
          }
        >
          <TouchableOpacity
            style={styles.createButton}
            onPress={onCreate}
            testID="coach-library-create"
          >
            <Ionicons name="add" size={20} color={Colors.primary.DEFAULT} />
            <Text style={styles.createButtonText}>Create workout</Text>
          </TouchableOpacity>

          {workouts.length === 0 ? (
            <View style={styles.emptyBlock} testID="coach-library-empty">
              <Ionicons
                name="barbell-outline"
                size={44}
                color={Colors.text.tertiary}
              />
              <Text style={styles.emptyTitle}>No workouts yet</Text>
              <Text style={styles.emptyMessage}>
                Build a workout to assign to your clients or keep for yourself.
              </Text>
            </View>
          ) : (
            <View style={styles.list}>
              {workouts.map((w) => (
                <TouchableOpacity
                  key={w.id}
                  style={styles.row}
                  onPress={() => onOpen(w.id)}
                  testID={`coach-library-row-${w.id}`}
                  activeOpacity={0.85}
                >
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {w.name}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {w.exercises.length} exercise
                      {w.exercises.length === 1 ? "" : "s"}
                      {w.showInOwnerLibrary ? "" : " · Hidden from my workouts"}
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={20}
                    color={Colors.text.tertiary}
                  />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface.border,
  },
  iconButton: {
    padding: Spacing.sm,
    minWidth: 40,
  },
  headerTitle: {
    ...Typography.body1,
    fontWeight: "600",
    flex: 1,
    textAlign: "center",
    color: Colors.text.primary,
  },
  headerSpacer: {
    width: 40,
  },
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  centreText: {
    ...Typography.body2,
    marginTop: Spacing.md,
    textAlign: "center",
    color: Colors.text.secondary,
  },
  errorTitle: {
    ...Typography.h3,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  retryButton: {
    marginTop: Spacing.md,
    backgroundColor: Colors.primary.DEFAULT,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  retryButtonText: {
    ...Typography.body2,
    color: Colors.text.primary,
    fontWeight: "600",
  },
  scrollContent: {
    padding: Spacing.md,
    gap: Spacing.md,
  },
  createButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: Colors.primary.DEFAULT,
    backgroundColor: Colors.primary.DEFAULT + "14",
    borderRadius: BorderRadius.md,
    paddingVertical: 14,
  },
  createButtonText: {
    ...Typography.body1,
    color: Colors.primary.DEFAULT,
    fontWeight: "600",
  },
  list: {
    gap: Spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.surface.border,
    padding: Spacing.md,
  },
  rowInfo: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    ...Typography.body1,
    fontWeight: "600",
    color: Colors.text.primary,
  },
  rowMeta: {
    ...Typography.body2,
    fontSize: 12,
    color: Colors.text.tertiary,
    marginTop: 2,
  },
  emptyBlock: {
    alignItems: "center",
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  emptyTitle: {
    ...Typography.h3,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  emptyMessage: {
    ...Typography.body2,
    textAlign: "center",
    color: Colors.text.secondary,
  },
});
