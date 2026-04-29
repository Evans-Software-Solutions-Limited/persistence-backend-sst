import { Colors } from "@/ui/theme/workoutsLegacyTheme";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Image, Text, TouchableOpacity, View } from "react-native";
import { styles } from "./styles";

interface AddExerciseListItemProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly exercise: any; // Using any to match the original
  readonly isSelected: boolean;
  readonly onToggle: () => void;
  readonly onInfo: () => void;
  readonly isDisabled?: boolean;
}

export function AddExerciseListItem({
  exercise,
  isSelected,
  onToggle,
  onInfo,
  isDisabled = false,
}: AddExerciseListItemProps) {
  const primaryMuscles = exercise.primary_muscles
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ?.map((muscle: any) => muscle.name)
    .join(", ");

  return (
    <TouchableOpacity
      style={[
        styles.exerciseRow,
        isSelected && styles.exerciseRowSelected,
        isDisabled && styles.exerciseRowDisabled,
      ]}
      onPress={isDisabled ? undefined : onToggle}
      disabled={isDisabled}
      activeOpacity={0.95}
    >
      {/* Exercise Image */}
      <View style={styles.exerciseImageContainer}>
        {exercise.thumbnail_url ? (
          <Image
            source={{ uri: exercise.thumbnail_url }}
            style={styles.exerciseImage}
          />
        ) : (
          <View style={styles.exerciseImagePlaceholder}>
            <Ionicons name="fitness" size={24} color={Colors.text.secondary} />
          </View>
        )}
      </View>

      {/* Exercise Info */}
      <View style={styles.exerciseInfo}>
        <Text
          style={[
            styles.exerciseName,
            isDisabled && styles.exerciseNameDisabled,
          ]}
        >
          {exercise.name}
        </Text>
        <Text
          style={[
            styles.exerciseMuscle,
            isDisabled && styles.exerciseMuscleDisabled,
          ]}
        >
          {primaryMuscles}
        </Text>
      </View>

      {/* Action Buttons */}
      <View style={styles.actionButtons}>
        <TouchableOpacity
          onPress={onInfo}
          style={styles.infoButton}
          testID={`exercise-info-button-${exercise.id}`}
        >
          <Ionicons
            name="information-circle-outline"
            size={24}
            color={Colors.primary.DEFAULT}
          />
        </TouchableOpacity>
        <View
          style={[
            styles.checkbox,
            isSelected && styles.checkboxSelected,
            isDisabled && styles.checkboxDisabled,
          ]}
        >
          {isSelected && (
            <Ionicons name="checkmark" size={16} color={Colors.text.primary} />
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}
