/**
 * ExerciseProgress — sets-completed / total-target indicator on the
 * SessionExerciseCard header. (M3, Story-002.)
 */

import React from "react";
import { Text, View } from "react-native";
import { styles } from "./styles";

export type ExerciseProgressProps = {
  setsCompleted: number;
  totalSets: number;
};

export function ExerciseProgress(props: ExerciseProgressProps) {
  const allDone = props.totalSets > 0 && props.setsCompleted >= props.totalSets;
  return (
    <View
      style={[styles.pill, allDone && styles.pillDone]}
      testID="exercise-progress"
    >
      <Text style={[styles.text, allDone && styles.textDone]}>
        {props.setsCompleted} / {props.totalSets}
      </Text>
    </View>
  );
}
