import { Colors } from "@/ui/theme/workoutsLegacyTheme";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { styles } from "./styles";

interface QuickActionsProps {
  isAtLimit: boolean;
  onCreateWorkout: () => void;
  onBrowseExercises: () => void;
}

export function QuickActions({
  isAtLimit,
  onCreateWorkout,
  onBrowseExercises,
}: QuickActionsProps) {
  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.primaryButton, isAtLimit && styles.disabledButton]}
        onPress={onCreateWorkout}
        disabled={isAtLimit}
      >
        <Ionicons name="add" size={24} color={Colors.text.primary} />
        <Text style={styles.buttonText}>Create New Workout</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={onBrowseExercises}
      >
        <Ionicons
          name="library-outline"
          size={24}
          color={Colors.primary.DEFAULT}
        />
        <Text style={[styles.buttonText, styles.secondaryButtonText]}>
          Browse Exercises
        </Text>
      </TouchableOpacity>
    </View>
  );
}
