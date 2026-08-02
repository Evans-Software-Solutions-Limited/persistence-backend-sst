import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { EquipmentPickerGroup } from "@/domain/services/loadout.service";
import { color, radius, space } from "@/ui/theme/tokens";

/**
 * <EquipmentChipGrid> — the grouped, multi-select equipment picker (AC-2.2).
 *
 * Shared by the flow's manual step and the Train → Gyms editor. One component
 * because "which chips exist and how they group" is a contract with the API
 * (`ReferenceEntry.category` → `groupEquipmentForPicker`), and two copies of it
 * would let a seeded category render in one place and not the other.
 *
 * ⚠ **Groups are never hardcoded here.** They arrive already grouped, including
 * the explicit "Other" bucket that keeps an uncategorised row selectable rather
 * than silently unreachable.
 */

export type EquipmentChipGridProps = {
  readonly groups: readonly EquipmentPickerGroup[];
  readonly selectedIds: ReadonlySet<string>;
  readonly onToggle: (equipmentTypeId: string) => void;
  /** Prefixes every chip's testID so two grids on one screen stay distinguishable. */
  readonly testIDPrefix?: string;
};

export function EquipmentChipGrid({
  groups,
  selectedIds,
  onToggle,
  testIDPrefix = "loadout-equip",
}: EquipmentChipGridProps) {
  return (
    <>
      {groups.map((group) => (
        <View key={group.category} style={styles.group}>
          <Text style={styles.groupLabel}>{group.label.toUpperCase()}</Text>
          <View style={styles.chips}>
            {group.items.map((item) => {
              const on = selectedIds.has(item.id);
              const label = item.displayName ?? item.name;
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.chip, on && styles.chipOn]}
                  onPress={() => onToggle(item.id)}
                  testID={`${testIDPrefix}-${item.id}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={label}
                >
                  {on ? (
                    <Ionicons
                      name="checkmark"
                      size={13}
                      color={color.$primary}
                    />
                  ) : null}
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.$sm },
  groupLabel: {
    fontSize: 10.5,
    letterSpacing: 1,
    fontWeight: "700",
    color: color.$text3,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.$sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.$xs,
    paddingVertical: space.$sm,
    paddingHorizontal: space.$md,
    borderRadius: radius.$pill,
    borderWidth: 1.5,
    borderColor: color.$border,
    backgroundColor: color.$surface2,
  },
  chipOn: { borderColor: color.$primary, backgroundColor: color.$primaryDim },
  chipText: { fontSize: 12.5, fontWeight: "600", color: color.$text2 },
  chipTextOn: { color: color.$primary },
});
