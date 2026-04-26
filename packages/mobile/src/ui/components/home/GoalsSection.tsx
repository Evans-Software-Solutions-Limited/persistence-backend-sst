import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  BorderRadius,
  Colors,
  Shadows,
  Spacing,
  Typography,
} from "@/ui/theme/homeLegacyTheme";

/**
 * Stacked goal cards with progress bar. Ported verbatim from
 * `persistence-mobile/components/home/GoalsSection/`.
 */

export interface Goal {
  readonly id: string;
  readonly title: string;
  readonly current: number;
  readonly target: number;
  readonly unit?: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
}

interface GoalsSectionProps {
  readonly goals: Goal[];
}

export function GoalsSection({ goals }: GoalsSectionProps) {
  if (goals.length === 0) {
    return null;
  }

  return (
    <View style={styles.container} testID="goals-section">
      <Text style={styles.sectionTitle}>Goals</Text>
      {goals.map((goal) => {
        const percentage =
          goal.target > 0
            ? Math.min((goal.current / goal.target) * 100, 100)
            : 0;
        const isComplete = goal.current >= goal.target;

        return (
          <View
            key={goal.id}
            style={styles.goalCard}
            testID={`goal-card-${goal.id}`}
          >
            <View style={styles.goalHeader}>
              <Ionicons
                name={goal.icon}
                size={20}
                color={Colors.primary.DEFAULT}
              />
              <Text style={styles.goalTitle}>{goal.title}</Text>
            </View>
            <View style={styles.progressContainer}>
              <View style={styles.progressBar}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${percentage}%`,
                      backgroundColor: isComplete
                        ? Colors.success.DEFAULT
                        : Colors.primary.DEFAULT,
                    },
                  ]}
                />
              </View>
              <Text style={styles.progressText}>
                {goal.current.toLocaleString()} / {goal.target.toLocaleString()}{" "}
                {goal.unit || ""}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  sectionTitle: {
    ...Typography.h3,
    marginBottom: Spacing.md,
  },
  goalCard: {
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    ...Shadows.small,
  },
  goalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  goalTitle: {
    ...Typography.body1,
    color: Colors.text.primary,
  },
  progressContainer: {
    gap: Spacing.xs,
  },
  progressBar: {
    height: 8,
    backgroundColor: Colors.surface.secondary,
    borderRadius: BorderRadius.full,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: BorderRadius.full,
  },
  progressText: {
    ...Typography.body2,
    color: Colors.text.secondary,
  },
});
