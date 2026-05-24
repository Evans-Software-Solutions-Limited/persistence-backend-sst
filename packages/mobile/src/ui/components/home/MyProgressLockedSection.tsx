import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { FeatureGatePrompt } from "@/ui/components/subscription/FeatureGatePrompt";
import type { FeatureGatePromptProps } from "@/ui/components/subscription/FeatureGatePrompt";
import { Colors, Spacing, Typography } from "@/ui/theme/homeLegacyTheme";
import { WorkoutsThisMonthTile } from "./WorkoutsThisMonthTile";

/**
 * Free-tier variant of `MyProgressSection`. Keeps the always-visible
 * basic stat (workouts-this-month, which is a backend-derived count
 * with no HealthKit dependency) and replaces the health-tile grid
 * (Body weight / Body fat / Steps / Energy) with a single
 * `FeatureGatePrompt`. Tap-through routes to the Subscription
 * Selection screen pre-selected on the upgrade target.
 *
 * Mirrors `MyProgressSection`'s header layout (title + "View All"
 * tap target) so the swap is visually consistent — only the bottom
 * grid changes.
 *
 * Spec: specs/11-payments-subscriptions/design.md § Per-screen feature-
 *       gate integration > Wave 2 Progress / Health / Profile subset
 * Satisfies: requirements.md AC 4.6
 */
export interface MyProgressLockedSectionProps {
  readonly workoutsThisMonth: number;
  readonly workoutsLastMonth: number;
  readonly gateProps: FeatureGatePromptProps;
  readonly onViewAllPress: () => void;
}

export function MyProgressLockedSection({
  workoutsThisMonth,
  workoutsLastMonth,
  gateProps,
  onViewAllPress,
}: MyProgressLockedSectionProps) {
  return (
    <View style={styles.container} testID="my-progress-section-locked">
      <View style={styles.header}>
        <Text style={styles.sectionTitle}>My Progress</Text>
        <TouchableOpacity
          onPress={onViewAllPress}
          testID="my-progress-view-all"
        >
          <Text style={styles.viewAllText}>View All</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.grid}>
        <View style={styles.row}>
          <WorkoutsThisMonthTile
            current={workoutsThisMonth}
            lastMonth={workoutsLastMonth}
          />
          <View style={styles.placeholder} />
        </View>
        <FeatureGatePrompt {...gateProps} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    ...Typography.h3,
  },
  viewAllText: {
    ...Typography.body2,
    color: Colors.primary.DEFAULT,
  },
  grid: {
    gap: Spacing.md,
  },
  row: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  placeholder: {
    flex: 1,
  },
});
