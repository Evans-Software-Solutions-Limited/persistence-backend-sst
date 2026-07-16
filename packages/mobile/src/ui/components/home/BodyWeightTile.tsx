import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { color } from "@/ui/theme/tokens";
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
            color={color.$primary}
          />
        </View>
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
  title: {
    fontSize: 14,
    fontWeight: "400" as const,
    lineHeight: 20,
    color: color.$text2,
    marginBottom: 4,
  },
  value: {
    fontSize: 20,
    fontWeight: "600" as const,
    lineHeight: 28,
    color: color.$text,
    marginBottom: 8,
  },
  graphContainer: {
    marginTop: 4,
  },
});
