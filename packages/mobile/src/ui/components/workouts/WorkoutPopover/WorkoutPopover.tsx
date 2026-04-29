import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";
import { Popover } from "@/ui/components/Popover";
import { Colors } from "@/ui/theme/workoutsLegacyTheme";
import type { Workout, WorkoutExercise } from "@/domain/models/workout";
import type { ApiError } from "@/shared/errors";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Image, Text, TouchableOpacity, View } from "react-native";
import { styles } from "./styles";

/**
 * Pure presenter for the workout-detail popover. Layout + StyleSheet
 * are ported verbatim from `persistence-mobile/components/workouts/
 * WorkoutPopover/`. The legacy presenter rendered additional surfaces
 * (personal records, accessibility requirements, exercise media) that
 * the V2 backend doesn't yet return on `GET /workouts/:id` — those
 * blocks are intentionally omitted here and tagged `TODO(M4)` for the
 * progress / records milestone. Visual structure stays identical so the
 * polish pass in M11 has a faithful starting point.
 *
 * Spec: specs/04-workout-management/requirements.md STORY-007 ACs 7.1–7.4
 */
interface WorkoutPopoverProps {
  readonly visible: boolean;
  readonly workout: Workout | null;
  readonly isLoading: boolean;
  readonly error: ApiError | null;
  readonly onClose: () => void;
  readonly onStartWorkout: (workoutId: string) => void;
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function WorkoutPopover({
  visible,
  workout,
  isLoading,
  error,
  onClose,
  onStartWorkout,
}: WorkoutPopoverProps) {
  const renderHeader = () =>
    workout ? <Text style={styles.title}>{workout.name}</Text> : null;

  const renderContent = () => {
    if (isLoading) {
      return (
        <View style={styles.loadingContainer}>
          <PLogoDrawLoader />
          <Text style={styles.loadingText}>Loading workout details...</Text>
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.errorContainer}>
          <Ionicons
            name="alert-circle-outline"
            size={48}
            color={Colors.error.DEFAULT}
          />
          <Text style={styles.errorTitle}>Failed to load workout</Text>
          <Text style={styles.errorMessage}>{error.message}</Text>
        </View>
      );
    }

    if (!workout) return null;

    return (
      <>
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
            {/* TODO(M4): legacy renders user_stats.times_completed, PR records,
                and targeted-muscle aggregation here. The V2 dashboard
                payload covers `times_completed` separately; PR records
                and muscle aggregation slot into M4. */}
          </View>
        </View>

        <View style={styles.section}>
          {workout.exercises.map((we: WorkoutExercise) => (
            <View key={we.id} style={styles.exerciseItem}>
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
            </View>
          ))}
        </View>
      </>
    );
  };

  const renderFooter = () => {
    if (!workout) return null;
    return (
      <TouchableOpacity
        style={styles.startButton}
        onPress={() => onStartWorkout(workout.id)}
      >
        <Ionicons name="play" size={20} color={Colors.text.primary} />
        <Text style={styles.startButtonText}>Start Workout</Text>
      </TouchableOpacity>
    );
  };

  return (
    <Popover
      visible={visible}
      onClose={onClose}
      header={renderHeader()}
      content={renderContent()}
      footer={renderFooter()}
    />
  );
}
