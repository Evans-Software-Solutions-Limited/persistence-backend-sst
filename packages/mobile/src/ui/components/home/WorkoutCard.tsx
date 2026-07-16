import React from "react";
import { Pressable, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { color } from "@/ui/theme/tokens";

/**
 * Workout-carousel card. Ported verbatim from
 * `persistence-mobile/components/workouts/WorkoutCard/WorkoutCard.tsx`
 * — same JSX, same StyleSheet (inlined so this file is self-contained),
 * only the theme import swapped for the V2-backed legacy compat shim.
 *
 * Home-tab scope: Start button visible, Edit/Delete hidden (M3 wires
 * the real popover). Accepts a partial data shape so it maps from both
 * the dashboard contract and the full Workout domain model.
 */

export interface WorkoutCardWorkout {
  readonly id: string;
  readonly name: string | null;
  readonly description?: string | null;
  readonly estimated_duration_minutes?: number | null;
  readonly exercises?: readonly unknown[];
  readonly targeted_muscles?: readonly {
    readonly id?: string;
    readonly name?: string;
    readonly display_name?: string;
  }[];
  readonly is_assigned?: boolean;
  readonly assigned_by_type?: string | null;
  readonly created_by?: string | null;
}

interface WorkoutCardProps {
  readonly workout: WorkoutCardWorkout;
  readonly onPress: () => void;
  readonly onStart: () => void;
  readonly onEdit?: () => void;
  readonly onDelete?: () => void;
  readonly currentUserId?: string;
  readonly isDisabled?: boolean;
}

export function WorkoutCard({
  workout,
  onPress,
  onStart,
  onEdit,
  onDelete,
  currentUserId,
  isDisabled = false,
}: WorkoutCardProps) {
  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0
      ? `${hours}h ${remainingMinutes}m`
      : `${hours}h`;
  };

  const canManage =
    !workout.is_assigned &&
    workout.created_by === currentUserId &&
    (onEdit || onDelete);

  return (
    // `Pressable` + `unstable_pressDelay` (rather than `TouchableOpacity`)
    // because the card sits inside a horizontal `react-native-reanimated-
    // carousel`. The carousel's pan gesture has `activeOffsetX([-10, 10])`,
    // meaning it doesn't claim the touch until the user has moved 10px
    // horizontally. `TouchableOpacity.onPress` fires immediately on any
    // touch release, so a small right-swipe (< 10px) registered as a tap
    // and opened the workout instead of just panning the carousel.
    //
    // `unstable_pressDelay={120}` defers `onPress` recognition by 120ms,
    // long enough for the carousel's pan gesture to win on a swipe. A
    // genuine tap still feels instant — well under the iOS 200ms
    // "perceived-as-immediate" threshold. The press-feedback opacity dip
    // that TouchableOpacity provided automatically is intentionally NOT
    // reproduced here — a per-press style function adds an extra
    // branch-coverage burden for a barely-perceptible visual that the
    // carousel parallax already gives strong feedback on.
    <Pressable
      style={[styles.workoutCard, isDisabled && styles.workoutCardDisabled]}
      onPress={isDisabled ? undefined : onPress}
      disabled={isDisabled}
      unstable_pressDelay={120}
      testID={`workout-card-${workout.id}`}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleContainer}>
          <Text
            style={[styles.cardTitle, isDisabled && styles.cardTitleDisabled]}
            numberOfLines={1}
          >
            {workout.name ?? "Untitled workout"}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.startButton}
          onPress={isDisabled ? undefined : onStart}
          disabled={isDisabled}
          testID={`workout-card-${workout.id}-start`}
          accessibilityRole="button"
          accessibilityLabel="Start workout"
          hitSlop={8}
        >
          <Ionicons
            name="play"
            size={20}
            color={isDisabled ? color.$text3 : color.$text}
          />
        </TouchableOpacity>
      </View>

      {workout.description ? (
        <Text style={styles.cardDescription} numberOfLines={2}>
          {workout.description}
        </Text>
      ) : null}

      <View style={styles.cardMetadata}>
        <View style={styles.metadataRow}>
          {workout.is_assigned ? (
            <View
              style={[
                styles.assignedTag,
                workout.assigned_by_type === "physio" ||
                workout.assigned_by_type === "physiotherapist"
                  ? styles.physioTag
                  : styles.ptTag,
              ]}
            >
              <Text style={styles.assignedTagText}>
                Assigned by:{" "}
                {workout.assigned_by_type === "physio" ||
                workout.assigned_by_type === "physiotherapist"
                  ? "Physio"
                  : "PT"}
              </Text>
            </View>
          ) : null}
          {typeof workout.estimated_duration_minutes === "number" ? (
            <View style={styles.durationContainer}>
              <Ionicons name="time-outline" size={16} color={color.$text2} />
              <Text style={styles.metadataText}>
                {formatDuration(workout.estimated_duration_minutes)}
              </Text>
            </View>
          ) : null}
          {workout.exercises ? (
            <View style={styles.exerciseCountContainer}>
              <Ionicons name="list" size={16} color={color.$text2} />
              <Text style={styles.exerciseCountText}>
                {workout.exercises.length} exercises
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {workout.targeted_muscles && workout.targeted_muscles.length > 0 ? (
        <View style={styles.muscleGroups}>
          <View style={styles.muscleTagsContainer}>
            {workout.targeted_muscles.slice(0, 3).map((muscle, index) => (
              <View key={muscle.id || index} style={styles.muscleBadge}>
                <Text style={styles.muscleBadgeText}>
                  {muscle.display_name || muscle.name || "Unknown"}
                </Text>
              </View>
            ))}
            {workout.targeted_muscles.length > 3 ? (
              <View style={styles.muscleBadge}>
                <Text style={styles.muscleBadgeText}>
                  +{workout.targeted_muscles.length - 3}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      {canManage ? (
        <View style={styles.cardActions}>
          {onEdit ? (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={isDisabled ? undefined : onEdit}
              disabled={isDisabled}
              testID={`workout-card-${workout.id}-edit`}
            >
              <Ionicons
                name="create-outline"
                size={18}
                color={isDisabled ? color.$text3 : color.$text2}
              />
              <Text
                style={[
                  styles.actionButtonText,
                  isDisabled && styles.actionButtonTextDisabled,
                ]}
              >
                Edit
              </Text>
            </TouchableOpacity>
          ) : null}
          {onDelete ? (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={isDisabled ? undefined : onDelete}
              disabled={isDisabled}
              testID={`workout-card-${workout.id}-delete`}
            >
              <Ionicons
                name="trash-outline"
                size={18}
                color={isDisabled ? color.$text3 : color.$error}
              />
              <Text
                style={[
                  styles.actionButtonText,
                  {
                    color: isDisabled ? color.$text3 : color.$error,
                  },
                ]}
              >
                Delete
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = {
  workoutCard: {
    backgroundColor: color.$surface,
    borderRadius: 16,
    padding: 24,
    marginBottom: 8,
    // Fill the carousel slot height (200) so cards without a
    // description don't look squat next to cards with one. The
    // description block uses numberOfLines={2} which gives the
    // taller layout; this lets shorter cards stretch to match.
    height: "100%" as const,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  workoutCardDisabled: {
    opacity: 0.5,
  },
  cardHeader: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    marginBottom: 8,
  },
  cardTitleContainer: {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
  },
  cardTitle: {
    fontWeight: "600" as const,
    lineHeight: 28,
    flex: 1,
    fontSize: 18,
    color: color.$text,
  },
  cardTitleDisabled: {
    color: color.$text3,
  },
  startButton: {
    backgroundColor: color.$primary,
    borderRadius: 9999,
    width: 40,
    height: 40,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  cardDescription: {
    fontSize: 14,
    fontWeight: "400" as const,
    lineHeight: 20,
    marginBottom: 8,
    color: color.$text2,
  },
  cardMetadata: {
    flexDirection: "row" as const,
    marginBottom: 8,
  },
  metadataRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 16,
  },
  durationContainer: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
  },
  metadataText: {
    fontSize: 14,
    fontWeight: "400" as const,
    lineHeight: 20,
    marginLeft: 4,
    color: color.$text2,
  },
  muscleGroups: {
    marginBottom: 8,
  },
  muscleBadge: {
    backgroundColor: color.$surface,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginRight: 4,
  },
  muscleBadgeText: {
    fontSize: 12,
    fontWeight: "500" as const,
    color: color.$text2,
  },
  assignedTag: {
    alignSelf: "flex-start" as const,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  ptTag: {
    backgroundColor: "#3B82F6", // Blue for PT
  },
  physioTag: {
    backgroundColor: "#10B981", // Green for Physio
  },
  assignedTagText: {
    fontSize: 12,
    lineHeight: 16,
    color: color.$text,
    fontWeight: "600" as const,
  },
  exerciseCountContainer: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
  },
  exerciseCountText: {
    fontSize: 12,
    fontWeight: "400" as const,
    lineHeight: 16,
    color: color.$text2,
    marginLeft: 4,
  },
  muscleTagsContainer: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    alignItems: "center" as const,
  },
  cardActions: {
    flexDirection: "row" as const,
    justifyContent: "flex-end" as const,
    gap: 16,
  },
  actionButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: "400" as const,
    lineHeight: 20,
    marginLeft: 4,
    color: color.$text2,
  },
  actionButtonTextDisabled: {
    color: color.$text3,
  },
};
