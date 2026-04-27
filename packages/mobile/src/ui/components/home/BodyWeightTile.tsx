import React from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  BorderRadius,
  Colors,
  Shadows,
  Spacing,
  Typography,
} from "@/ui/theme/homeLegacyTheme";
import { SimpleLineGraph } from "./SimpleLineGraph";

/**
 * Body-weight MyProgress tile. Ported verbatim from
 * `persistence-mobile/components/home/BodyWeightTile/`.
 */

interface BodyWeightTileProps {
  readonly currentValue: number | null;
  readonly unit?: "kg" | "lbs";
  readonly history: { date: Date; value: number }[];
  /**
   * True when the value comes from the simulator-mock adapter rather
   * than a live HealthKit / Health Connect read. Renders a small chip
   * so reviewers don't mistake the deterministic 74.5 kg fixture for
   * a real reading. Cosmetic only; doesn't change tile behaviour.
   */
  readonly isMock?: boolean;
}

export function BodyWeightTile({
  currentValue,
  unit = "kg",
  history,
  isMock = false,
}: BodyWeightTileProps) {
  const displayValue =
    currentValue === null ? "—" : `${currentValue.toFixed(1)} ${unit}`;

  return (
    <View style={styles.container} testID="tile-body-weight">
      {isMock && (
        <View style={styles.mockChip} testID="body-weight-tile-mock-chip">
          <Text style={styles.mockChipText}>MOCK</Text>
        </View>
      )}
      <Text style={styles.title}>Body Weight</Text>
      <Text style={styles.value}>{displayValue}</Text>
      {history.length > 0 ? (
        <View style={styles.graphContainer}>
          <SimpleLineGraph
            data={history.map((h) => h.value)}
            width={150}
            height={60}
            color={Colors.primary.DEFAULT}
          />
        </View>
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
  title: {
    ...Typography.body2,
    color: Colors.text.secondary,
    marginBottom: Spacing.xs,
  },
  value: {
    ...Typography.h3,
    color: Colors.text.primary,
    marginBottom: Spacing.sm,
  },
  graphContainer: {
    marginTop: Spacing.xs,
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
