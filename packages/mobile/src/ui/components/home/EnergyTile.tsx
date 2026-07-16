import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { color } from "@/ui/theme/tokens";

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
        <Ionicons name="flame" size={16} color={color.$warning} />
        <Text style={styles.label}>Active:</Text>
        <Text style={styles.value}>
          {Math.round(activeEnergy).toLocaleString()} kcal
        </Text>
      </View>
      <View style={styles.energyRow}>
        <Ionicons name="battery-charging" size={16} color={color.$primary} />
        <Text style={styles.label}>Basal:</Text>
        <Text style={styles.value}>
          {Math.round(basalEnergy).toLocaleString()} kcal
        </Text>
      </View>
      <View style={styles.energyRow}>
        <Ionicons name="person" size={16} color={color.$success} />
        <Text style={styles.label}>Stand:</Text>
        <Text style={styles.value}>{Math.round(standTime)}h</Text>
      </View>
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
  title: {
    fontSize: 14,
    fontWeight: "400" as const,
    lineHeight: 20,
    color: color.$text2,
    marginBottom: 8,
  },
  energyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 4,
  },
  label: {
    fontSize: 14,
    fontWeight: "400" as const,
    lineHeight: 20,
    color: color.$text2,
    flex: 1,
  },
  value: {
    fontSize: 16,
    lineHeight: 24,
    color: color.$text,
    fontWeight: "600",
  },
});
