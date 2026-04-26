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
 * Body-fat MyProgress tile. Ported verbatim from
 * `persistence-mobile/components/home/BodyFatTile/`.
 */

interface BodyFatTileProps {
  readonly currentValue: number | null;
  readonly history: { date: Date; value: number }[];
}

export function BodyFatTile({ currentValue, history }: BodyFatTileProps) {
  const displayValue =
    currentValue === null ? "—" : `${currentValue.toFixed(1)}%`;

  return (
    <View style={styles.container} testID="tile-body-fat">
      <Text style={styles.title}>Body Fat</Text>
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
