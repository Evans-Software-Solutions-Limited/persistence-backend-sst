import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";
import React from "react";
import { Text, View } from "react-native";
import { AddExerciseListItem } from "./AddExerciseListItem";
import { styles } from "./styles";

interface AddExerciseListProps {
  readonly exercises: any[]; // Using any to match the original
  readonly selectedExerciseIds: string[];
  readonly onToggleExercise: (id: string) => void;
  readonly onExerciseInfo: (id: string) => void;
  readonly isLoading: boolean;
  readonly existingExerciseIds: string[];
}

export function AddExerciseList({
  exercises,
  selectedExerciseIds,
  onToggleExercise,
  onExerciseInfo,
  isLoading,
  existingExerciseIds,
}: AddExerciseListProps) {
  if (isLoading) {
    return (
      <View style={[styles.contentContainer, styles.loadingContainer]}>
        <PLogoDrawLoader />
      </View>
    );
  }

  if (exercises.length === 0) {
    return (
      <View style={styles.contentContainer}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No exercises found</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.contentContainer}>
      {exercises.map((exercise) => (
        <AddExerciseListItem
          key={exercise.id}
          exercise={exercise}
          isSelected={selectedExerciseIds.includes(exercise.id)}
          onToggle={() => onToggleExercise(exercise.id)}
          onInfo={() => onExerciseInfo(exercise.id)}
          isDisabled={existingExerciseIds.includes(exercise.id)}
        />
      ))}
    </View>
  );
}
