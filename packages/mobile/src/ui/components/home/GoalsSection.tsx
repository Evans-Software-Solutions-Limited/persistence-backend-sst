import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { color } from "@/ui/theme/tokens";

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
              <Ionicons name={goal.icon} size={20} color={color.$primary} />
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
                        ? color.$success
                        : color.$primary,
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
    fontSize: 20,
    fontWeight: "600" as const,
    lineHeight: 28,
    color: color.$text,
    marginBottom: 16,
  },
  goalCard: {
    backgroundColor: color.$surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  goalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  goalTitle: {
    fontSize: 16,
    fontWeight: "400" as const,
    lineHeight: 24,
    color: color.$text,
  },
  progressContainer: {
    gap: 4,
  },
  progressBar: {
    height: 8,
    backgroundColor: color.$surface2,
    borderRadius: 9999,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 9999,
  },
  progressText: {
    fontSize: 14,
    fontWeight: "400" as const,
    lineHeight: 20,
    color: color.$text2,
  },
});
