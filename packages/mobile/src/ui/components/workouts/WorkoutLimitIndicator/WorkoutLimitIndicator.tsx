import { Colors } from "@/ui/theme/workoutsLegacyTheme";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { styles } from "./styles";

interface WorkoutLimitIndicatorProps {
  userWorkoutLimit: number | undefined;
  isLoadingUserRole: boolean;
  onUpgrade: () => void;
}

export function WorkoutLimitIndicator({
  userWorkoutLimit,
  isLoadingUserRole,
  onUpgrade,
}: WorkoutLimitIndicatorProps) {
  return (
    <View style={styles.container}>
      <View style={styles.limitCard}>
        <Ionicons name="lock-closed" size={24} color={Colors.text.primary} />
        <View style={styles.limitContent}>
          <Text style={styles.limitTitle}>Workout Limit Reached</Text>
          <Text style={styles.limitMessage}>
            {isLoadingUserRole
              ? "Loading workout limit..."
              : `You've used all ${userWorkoutLimit} free workout templates. Upgrade to create more!`}
          </Text>
          <TouchableOpacity style={styles.upgradeButton} onPress={onUpgrade}>
            <Text style={styles.upgradeButtonText}>Upgrade Now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
