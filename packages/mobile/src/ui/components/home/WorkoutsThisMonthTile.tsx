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
 * Workouts-this-month MyProgress tile. Ported verbatim from
 * `persistence-mobile/components/home/WorkoutsThisMonthTile/`.
 */

interface WorkoutsThisMonthTileProps {
  readonly current: number;
  readonly lastMonth: number;
}

export function WorkoutsThisMonthTile({
  current,
  lastMonth,
}: WorkoutsThisMonthTileProps) {
  const isPositive = current >= lastMonth;
  const iconName = isPositive ? "trending-up" : "trending-down";
  const iconColor = isPositive ? Colors.success.DEFAULT : Colors.error.DEFAULT;

  return (
    <View style={styles.container} testID="tile-workouts-month">
      <View style={styles.header}>
        <Text style={styles.title}>Workouts This Month</Text>
        <Ionicons name={iconName} size={20} color={iconColor} />
      </View>
      <Text style={styles.value}>{current}</Text>
      {lastMonth > 0 ? (
        <Text style={styles.comparison}>
          {isPositive ? "+" : ""}
          {current - lastMonth} vs last month
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    ...Shadows.small,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  title: {
    ...Typography.body2,
    color: Colors.text.secondary,
  },
  value: {
    ...Typography.h2,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
  },
  comparison: {
    ...Typography.caption,
    color: Colors.text.secondary,
  },
});
