import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { ExerciseReorderHandle } from "@/ui/components/workouts/ExerciseReorderHandle";
import { color } from "@/ui/theme/tokens";

type CompactReorderRowProps = {
  exerciseNames: readonly string[];
  position: number;
  total: number;
  onMove?: (direction: -1 | 1) => void;
  DragHandle: (props: { children: ReactNode }) => ReactNode;
};

export const COMPACT_REORDER_ROW_HEIGHT = 72;

/**
 * Fixed-size row used before and during drag. Supersets are deliberately
 * capped at two lines, so neither exercise count nor visible set count can
 * produce a draggable item taller than the viewport.
 */
export function CompactReorderRow({
  exerciseNames,
  position,
  total,
  onMove,
  DragHandle,
}: CompactReorderRowProps) {
  const isSuperset = exerciseNames.length > 1;
  const label = isSuperset
    ? `Superset: ${exerciseNames.join(", ")}`
    : (exerciseNames[0] ?? "Exercise");

  return (
    <View
      style={[styles.card, isSuperset && styles.supersetCard]}
      testID="compact-reorder-row"
    >
      <ExerciseReorderHandle
        label={label}
        position={position}
        total={total}
        onMove={onMove}
        DragHandle={DragHandle}
      />

      <View style={styles.content}>
        <Text style={[styles.eyebrow, isSuperset && styles.supersetBadge]}>
          {isSuperset
            ? `SUPERSET · ${exerciseNames.length} EXERCISES`
            : "EXERCISE"}
        </Text>
        <Text
          numberOfLines={isSuperset ? 2 : 1}
          style={styles.exerciseNames}
          testID="compact-reorder-row-names"
        >
          {exerciseNames.join(isSuperset ? " + " : "")}
        </Text>
      </View>

      <Text style={styles.position}>
        {position}/{total}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    height: COMPACT_REORDER_ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.$border2,
    backgroundColor: color.$surface2,
  },
  supersetCard: {
    borderLeftWidth: 4,
    borderLeftColor: color.$primary,
  },
  content: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 6,
    gap: 2,
  },
  eyebrow: {
    color: color.$primary,
    fontFamily: "Geist Mono",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  supersetBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 5,
    backgroundColor: color.$primaryDim,
    lineHeight: 14,
  },
  exerciseNames: {
    color: color.$text,
    fontFamily: "Geist",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 18,
  },
  position: {
    marginLeft: 8,
    color: color.$text3,
    fontFamily: "Geist Mono",
    fontSize: 10,
    fontWeight: "600",
  },
});
