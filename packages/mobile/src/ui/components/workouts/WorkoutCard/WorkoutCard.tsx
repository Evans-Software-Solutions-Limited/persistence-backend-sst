import { Colors } from "@/ui/theme/workoutsLegacyTheme";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { styles } from "./styles";

interface WorkoutCardProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly workout: any; // Using any to match the original
  readonly onPress: () => void;
  readonly onStart: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
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

  return (
    <TouchableOpacity
      style={[styles.workoutCard, isDisabled && styles.workoutCardDisabled]}
      onPress={isDisabled ? undefined : onPress}
      disabled={isDisabled}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleContainer}>
          <Text
            style={[styles.cardTitle, isDisabled && styles.cardTitleDisabled]}
          >
            {workout.name}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.startButton}
          onPress={isDisabled ? undefined : onStart}
          disabled={isDisabled}
          testID="start-button"
        >
          <Ionicons
            name="play"
            size={20}
            color={isDisabled ? Colors.text.tertiary : Colors.text.primary}
          />
        </TouchableOpacity>
      </View>

      {workout.description && (
        <Text style={styles.cardDescription} numberOfLines={2}>
          {workout.description}
        </Text>
      )}

      <View style={styles.cardMetadata}>
        <View style={styles.metadataRow}>
          {workout.is_assigned && (
            <View
              style={[
                styles.assignedTag,
                workout.assigned_by_type === "physio"
                  ? styles.physioTag
                  : styles.ptTag,
              ]}
            >
              <Text style={styles.assignedTagText}>
                Assigned by:{" "}
                {workout.assigned_by_type === "physio" ? "Physio" : "PT"}
              </Text>
            </View>
          )}
          <View style={styles.durationContainer}>
            <Ionicons
              name="time-outline"
              size={16}
              color={Colors.text.secondary}
            />
            <Text style={styles.metadataText}>
              {formatDuration(workout.estimated_duration_minutes)}
            </Text>
          </View>
          <View style={styles.exerciseCountContainer}>
            <Ionicons name="list" size={16} color={Colors.text.secondary} />
            <Text style={styles.exerciseCountText}>
              {workout.exercises.length} exercises
            </Text>
          </View>
        </View>
      </View>

      {workout.targeted_muscles && workout.targeted_muscles.length > 0 && (
        <View style={styles.muscleGroups}>
          <View style={styles.muscleTagsContainer}>
            {workout.targeted_muscles
              .slice(0, 3)
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .map((muscle: any, index: number) => (
                <View key={muscle.id || index} style={styles.muscleBadge}>
                  <Text style={styles.muscleBadgeText}>
                    {muscle.display_name || muscle.name || "Unknown"}
                  </Text>
                </View>
              ))}
            {workout.targeted_muscles.length > 3 && (
              <View style={styles.muscleBadge}>
                <Text style={styles.muscleBadgeText}>
                  +{workout.targeted_muscles.length - 3}
                </Text>
              </View>
            )}
          </View>
        </View>
      )}

      {!workout.is_assigned && workout.created_by === currentUserId && (
        <View style={styles.cardActions}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={isDisabled ? undefined : onEdit}
            disabled={isDisabled}
          >
            <Ionicons
              name="create-outline"
              size={18}
              color={isDisabled ? Colors.text.tertiary : Colors.text.secondary}
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
          <TouchableOpacity
            style={styles.actionButton}
            onPress={isDisabled ? undefined : onDelete}
            disabled={isDisabled}
          >
            <Ionicons
              name="trash-outline"
              size={18}
              color={isDisabled ? Colors.text.tertiary : Colors.error.DEFAULT}
            />
            <Text
              style={[
                styles.actionButtonText,
                {
                  color: isDisabled
                    ? Colors.text.tertiary
                    : Colors.error.DEFAULT,
                },
              ]}
            >
              Delete
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
}
