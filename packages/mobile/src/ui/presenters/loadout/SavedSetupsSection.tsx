import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { WorkoutVariationSummary } from "@/domain/models/loadout";
import { hasGymEquipmentChanged } from "@/domain/services/loadout.service";
import { Pill } from "@/ui/components/foundation";
import { color, radius, space } from "@/ui/theme/tokens";

/**
 * <SavedSetupsSection> — the parent workout's variations, grouped under it
 * (T-2.8, AC-5.2, design D7 step 1's "Saved setups").
 *
 * ⚠ **The "Original · BASE" row is not decoration.** AC-5.1's whole promise is
 * that adapting never modifies the workout you built, and the only way a list of
 * variations makes that visible is by showing the original sitting alongside them
 * as a peer. Without it, three rows named after gyms read as though the workout
 * has been replaced by them.
 *
 * Renders nothing when there are no variations — an empty "Saved setups · 0"
 * header on a workout the user has never adapted is noise about a feature they
 * have not used.
 */

export type SavedSetupsSectionProps = {
  readonly variations: readonly WorkoutVariationSummary[];
  readonly onOpenVariation: (variationId: string) => void;
};

/** "3 swaps" / "1 swap" / "no swaps" — never a bare "0 swaps". */
function swapLabel(count: number): string {
  if (count <= 0) return "no swaps";
  return count === 1 ? "1 swap" : `${count} swaps`;
}

export function SavedSetupsSection({
  variations,
  onOpenVariation,
}: SavedSetupsSectionProps) {
  if (variations.length === 0) return null;

  return (
    <View style={styles.section} testID="loadout-saved-setups">
      <View style={styles.headerRow}>
        <Text style={styles.eyebrow}>SAVED SETUPS · {variations.length}</Text>
        <Text style={styles.headerNote}>variations of this workout</Text>
      </View>

      <View style={styles.baseRow}>
        <View style={styles.baseIcon}>
          <Ionicons name="barbell-outline" size={16} color={color.$text2} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>Original</Text>
          <Text style={styles.rowSub}>The workout as you built it</Text>
        </View>
        <Pill tone="neutral" size="xs">
          BASE
        </Pill>
      </View>

      {variations.map((variation) => {
        const gymUpdated = hasGymEquipmentChanged(variation);
        return (
          <TouchableOpacity
            key={variation.id}
            style={styles.variationRow}
            onPress={() => onOpenVariation(variation.id)}
            testID={`loadout-variation-${variation.id}`}
            accessibilityRole="button"
            accessibilityLabel={
              gymUpdated
                ? `${variation.name}. Gym equipment updated. Re-adapt available.`
                : variation.name
            }
          >
            <View style={styles.variationIcon}>
              <Ionicons
                name={gymUpdated ? "refresh-outline" : "location-outline"}
                size={16}
                color={color.$primary}
              />
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {/*
                  The gym name is the useful label, but it is LEFT JOINed and goes
                  null when the gym is deleted — and a variation outlives the gym it
                  was made for. Falling back to the variation's own name keeps the
                  row identifiable instead of blank.
                */}
                {variation.sourceGymName ?? variation.name}
              </Text>
              <Text
                style={[styles.rowSub, gymUpdated && styles.rowSubUpdated]}
                numberOfLines={1}
                testID={
                  gymUpdated
                    ? `loadout-variation-${variation.id}-gym-updated`
                    : undefined
                }
              >
                {gymUpdated
                  ? "Gym equipment updated · Re-adapt"
                  : swapLabel(variation.swapCount)}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={15} color={color.$text4} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // No horizontal padding: this section is composed INTO an already-padded
  // scroll body (workout detail's `scrollContent`), and padding it again would
  // inset it from every sibling card on that screen.
  section: { gap: space.$sm },
  headerRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  eyebrow: {
    fontSize: 10.5,
    letterSpacing: 1,
    fontWeight: "700",
    color: color.$text3,
  },
  headerNote: { fontSize: 10.5, color: color.$text4 },
  baseRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.$md,
    padding: space.$md,
    borderRadius: radius.$lg,
    backgroundColor: color.$surface2,
    borderWidth: 1,
    borderColor: color.$border,
  },
  baseIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.$md,
    backgroundColor: color.$surface3,
    alignItems: "center",
    justifyContent: "center",
  },
  variationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.$md,
    padding: space.$md,
    borderRadius: radius.$lg,
    backgroundColor: color.$surface,
    borderWidth: 1,
    borderColor: color.$border,
    borderLeftWidth: 3,
    borderLeftColor: color.$primary,
  },
  variationIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.$md,
    backgroundColor: color.$primaryDim,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 13.5, fontWeight: "700", color: color.$text },
  rowSub: { fontSize: 11, color: color.$text3 },
  rowSubUpdated: { color: color.$warning, fontWeight: "600" },
});
