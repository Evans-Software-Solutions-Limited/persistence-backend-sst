import { color } from "@/ui/theme/tokens";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { Image } from "expo-image";
import { styles } from "./styles";

interface AddExerciseListItemProps {
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
      testID={`exercise-row-${exercise.id}`}
    >
      {/* Exercise Image */}
      <View style={styles.exerciseImageContainer}>
        {exercise.thumbnail_url ? (
          <Image
            source={{ uri: exercise.thumbnail_url }}
            style={styles.exerciseImage}
            contentFit="cover"
            transition={200}
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={styles.exerciseImagePlaceholder}>
            <Ionicons name="fitness" size={24} color={color.$text2} />
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
          accessibilityRole="button"
          accessibilityLabel="Exercise details"
        >
          <Ionicons
            name="information-circle-outline"
            size={24}
            color={color.$primary}
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
            <Ionicons name="checkmark" size={16} color={color.$text} />
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}
