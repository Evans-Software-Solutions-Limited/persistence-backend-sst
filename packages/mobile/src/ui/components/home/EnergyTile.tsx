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
}

export function EnergyTile({
  activeEnergy,
  basalEnergy,
  standTime,
}: EnergyTileProps) {
  return (
    <View style={styles.container} testID="tile-energy">
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
});
