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
 * Energy (active / basal / stand-time) MyProgress tile. Ported verbatim
 * from `persistence-mobile/components/home/EnergyTile/`.
 */

interface EnergyTileProps {
  readonly activeEnergy: number; // kcal
  readonly basalEnergy: number; // kcal
  readonly standTime: number; // hours
  /**
   * True when the value comes from the simulator-mock adapter rather
   * than a live HealthKit / Health Connect read. Renders a small chip
   * so reviewers don't mistake the deterministic 312 fixture for a
   * real reading. Cosmetic only; doesn't change tile behaviour.
   */
  readonly isMock?: boolean;
}

export function EnergyTile({
  activeEnergy,
  basalEnergy,
  standTime,
  isMock = false,
}: EnergyTileProps) {
  return (
    <View style={styles.container} testID="tile-energy">
      {isMock && (
        <View style={styles.mockChip} testID="energy-tile-mock-chip">
          <Text style={styles.mockChipText}>MOCK</Text>
        </View>
      )}
      <Text style={styles.title}>Energy</Text>
      <View style={styles.energyRow}>
        <Ionicons name="flame" size={16} color={Colors.warning.DEFAULT} />
        <Text style={styles.label}>Active:</Text>
        <Text style={styles.value}>
          {Math.round(activeEnergy).toLocaleString()} kcal
        </Text>
      </View>
      <View style={styles.energyRow}>
        <Ionicons
          name="battery-charging"
          size={16}
          color={Colors.primary.DEFAULT}
        />
        <Text style={styles.label}>Basal:</Text>
        <Text style={styles.value}>
          {Math.round(basalEnergy).toLocaleString()} kcal
        </Text>
      </View>
      <View style={styles.energyRow}>
        <Ionicons name="person" size={16} color={Colors.success.DEFAULT} />
        <Text style={styles.label}>Stand:</Text>
        <Text style={styles.value}>{Math.round(standTime)}h</Text>
      </View>
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
  title: {
    ...Typography.body2,
    color: Colors.text.secondary,
    marginBottom: Spacing.sm,
  },
  energyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  label: {
    ...Typography.body2,
    color: Colors.text.secondary,
    flex: 1,
  },
  value: {
    ...Typography.body1,
    color: Colors.text.primary,
    fontWeight: "600",
  },
  mockChip: {
    position: "absolute",
    top: Spacing.sm,
    right: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: Colors.surface.tertiary,
  },
  mockChipText: {
    ...Typography.caption,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: Colors.text.tertiary,
  },
});
