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
}

export function BodyWeightTile({
  currentValue,
  unit = "kg",
  history,
}: BodyWeightTileProps) {
  const displayValue =
    currentValue === null ? "—" : `${currentValue.toFixed(1)} ${unit}`;

  return (
    <View style={styles.container} testID="tile-body-weight">
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
});
