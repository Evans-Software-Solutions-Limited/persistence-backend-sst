import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";
import {
  BorderRadius,
  Colors,
  Shadows,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";
import type { Workout, WorkoutExercise } from "@/domain/models/workout";
import type { ApiError } from "@/shared/errors";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/**
 * Pure presenter for the workout-detail SCREEN (was a popover overlay
 * pre-PR41). Now a full-screen pageSheet modal route at
 * `/(app)/workouts/[id]` so it's deep-linkable and visually
 * consistent with the create/edit modals.
 *
 * Visual layout ported from the prior `WorkoutPopover` — same
 * description block, metadata row, exercise list, Start CTA. Extra
 * additions for the screen form factor:
 *   - Sticky safe-area header with a back button (returns to the
 *     route below — workouts tab list, or home tab if deep-linked).
 *   - Exercise rows are now `TouchableOpacity` — tapping an exercise
 *     pushes `/(app)/exercises/[id]` so the user gets the full
 *     exercise detail without losing the workout context underneath
 *     (back returns to the workout).
 *
 * Spec: specs/04-workout-management/requirements.md STORY-007
 *       ACs 7.1, 7.2, 7.4
 */

interface WorkoutDetailPresenterProps {
  readonly workout: Workout | null;
  readonly isLoading: boolean;
  readonly error: ApiError | null;
  readonly onClose: () => void;
  readonly onStartWorkout: (workoutId: string) => void;
  readonly onExercisePress: (exerciseId: string) => void;
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function WorkoutDetailPresenter({
  workout,
  isLoading,
  error,
  onClose,
  onStartWorkout,
  onExercisePress,
}: WorkoutDetailPresenterProps) {
  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      {/* Sticky header — same shape as creator/editor for consistency. */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onClose}
          style={styles.backButton}
          testID="workout-detail-back"
        >
          <Ionicons name="arrow-back" size={24} color={Colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {workout?.name ?? "Workout"}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {isLoading && !workout ? (
        <View style={styles.loadingContainer} testID="workout-detail-loading">
          <PLogoDrawLoader />
          <Text style={styles.loadingText}>Loading workout details...</Text>
        </View>
      ) : error && !workout ? (
        <View style={styles.errorContainer} testID="workout-detail-error">
          <Ionicons
            name="alert-circle-outline"
            size={48}
            color={Colors.error.DEFAULT}
          />
          <Text style={styles.errorTitle}>Failed to load workout</Text>
          <Text style={styles.errorMessage}>{error.message}</Text>
        </View>
      ) : workout ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.section}>
            {workout.description && (
              <Text style={styles.description}>{workout.description}</Text>
            )}
            <View style={styles.metadata}>
              <View style={styles.metadataItem}>
                <Ionicons
                  name="time-outline"
                  size={16}
                  color={Colors.text.secondary}
                />
                <Text style={styles.metadataText}>
                  {formatDuration(workout.estimatedDurationMinutes)}
                </Text>
              </View>
              <View style={styles.metadataItem}>
                <Ionicons
                  name="list-outline"
                  size={16}
                  color={Colors.text.secondary}
                />
                <Text style={styles.metadataText}>
                  {workout.exercises.length} exercises
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.section}>
            {workout.exercises.map((we: WorkoutExercise) => (
              <TouchableOpacity
                key={we.id}
                style={styles.exerciseItem}
                onPress={() => onExercisePress(we.exerciseId)}
                testID={`workout-detail-exercise-${we.exerciseId}`}
                activeOpacity={0.85}
              >
                <View style={styles.exerciseThumbnail}>
                  {we.exercise?.thumbnailUrl ? (
                    <Image
                      source={{ uri: we.exercise.thumbnailUrl }}
                      style={styles.exerciseImage}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={styles.exerciseImagePlaceholder}>
                      <Ionicons
                        name="fitness"
                        size={24}
                        color={Colors.text.tertiary}
                      />
                    </View>
                  )}
                </View>
                <View style={styles.exerciseInfo}>
                  {we.supersetGroup !== null && (
                    <View style={styles.supersetBadge}>
                      <Text style={styles.supersetBadgeText}>
                        Superset {we.supersetGroup}
                      </Text>
                    </View>
                  )}
                  <Text style={styles.exerciseName}>
                    {we.exercise?.name ?? "Exercise"}
                  </Text>
                  <Text style={styles.exerciseDetails}>
                    {we.targetSets ?? 0} sets × {we.targetRepsMin}–
                    {we.targetRepsMax} reps
                  </Text>
                  {we.exercise && (
                    <Text style={styles.exerciseCategory}>
                      {we.exercise.category} • {we.exercise.difficultyLevel}
                    </Text>
                  )}
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color={Colors.text.tertiary}
                />
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.startButton}
              onPress={() => onStartWorkout(workout.id)}
              testID="workout-detail-start"
            >
              <Ionicons name="play" size={20} color={Colors.text.primary} />
              <Text style={styles.startButtonText}>Start Workout</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      ) : null}
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
  backButton: {
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
  scrollContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  loadingContainer: {
    alignItems: "center",
    paddingVertical: Spacing.xl,
  },
  loadingText: {
    ...Typography.body2,
    marginTop: Spacing.md,
    color: Colors.text.secondary,
  },
  errorContainer: {
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  errorTitle: {
    ...Typography.h3,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  errorMessage: {
    ...Typography.body2,
    textAlign: "center",
    color: Colors.text.secondary,
  },
  section: {
    marginBottom: Spacing.lg,
  },
  description: {
    ...Typography.body1,
    marginBottom: Spacing.md,
    color: Colors.text.secondary,
  },
  metadata: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: Spacing.md,
  },
  metadataItem: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  metadataText: {
    ...Typography.body2,
    marginLeft: Spacing.xs,
    color: Colors.text.secondary,
  },
  exerciseItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface.secondary,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  exerciseThumbnail: {
    width: 60,
    height: 60,
    borderRadius: BorderRadius.sm,
    marginRight: Spacing.md,
    overflow: "hidden",
  },
  exerciseImage: {
    width: "100%",
    height: "100%",
  },
  exerciseImagePlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: Colors.background.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  exerciseInfo: {
    flex: 1,
  },
  exerciseName: {
    ...Typography.body1,
    fontWeight: "600",
    color: Colors.text.primary,
    marginBottom: 2,
  },
  exerciseDetails: {
    ...Typography.body2,
    color: Colors.text.secondary,
    marginBottom: Spacing.xs,
  },
  exerciseCategory: {
    ...Typography.caption,
    color: Colors.text.tertiary,
  },
  supersetBadge: {
    alignSelf: "flex-start",
    backgroundColor: Colors.primary.dark,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.xs,
  },
  supersetBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: Colors.text.primary,
  },
  footer: {
    marginTop: Spacing.md,
  },
  startButton: {
    backgroundColor: Colors.primary.DEFAULT,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    ...Shadows.electric,
  },
  startButtonText: {
    ...Typography.button,
    color: Colors.text.primary,
    marginLeft: Spacing.sm,
  },
});
