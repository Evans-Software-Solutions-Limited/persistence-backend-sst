import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { color } from "@/ui/theme/tokens";

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
  const iconColor = isPositive ? color.$success : color.$error;

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
    backgroundColor: color.$surface,
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: "400" as const,
    lineHeight: 20,
    color: color.$text2,
  },
  value: {
    fontSize: 24,
    fontWeight: "600" as const,
    lineHeight: 32,
    color: color.$text,
    marginBottom: 4,
  },
  comparison: {
    fontSize: 12,
    fontWeight: "400" as const,
    lineHeight: 16,
    color: color.$text2,
  },
});
