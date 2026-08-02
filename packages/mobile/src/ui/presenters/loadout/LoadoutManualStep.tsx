import { Ionicons } from "@expo/vector-icons";
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import type { EquipmentPickerGroup } from "@/domain/services/loadout.service";
import { itemLabel } from "@/shared/utils";
import { Pill } from "@/ui/components/foundation";
import { EquipmentChipGrid } from "./EquipmentChipGrid";
import { LoadoutScaffold } from "./LoadoutScaffold";
import { color, radius, space } from "@/ui/theme/tokens";

/**
 * <LoadoutManualStep> — the grouped equipment checklist plus name + save toggle
 * (T-2.4, AC-2.2, design D7 step 4).
 *
 * ⚠ **The groups come from the API, never from a constant here.** `groups` is
 * built by `groupEquipmentForPicker` off each `ReferenceEntry.category`, so
 * seeding a new equipment type needs no app release, and an uncategorised row
 * still lands in "Other" and stays selectable rather than vanishing. A hardcoded
 * client list is how a real piece of equipment becomes silently unreachable —
 * the same failure T-E.10 already demonstrated on the seeder side.
 *
 * ⚠ **The CTA counts SELECTED items, not available ones**, and is disabled at
 * zero. An adaptation against an empty kit is not a useful answer: every loadable
 * row would go unresolved and the review step would be a list of holes.
 */

export type LoadoutManualStepProps = {
  readonly groups: readonly EquipmentPickerGroup[];
  readonly selectedIds: ReadonlySet<string>;
  readonly onToggle: (equipmentTypeId: string) => void;
  readonly name: string;
  readonly onNameChange: (name: string) => void;
  readonly saveAsGym: boolean;
  readonly onToggleSave: () => void;
  /** True while the equipment reference list is being (re)fetched and we have nothing. */
  readonly isLoading: boolean;
  readonly onBack: () => void;
  readonly onAdapt: () => void;
};

export function LoadoutManualStep({
  groups,
  selectedIds,
  onToggle,
  name,
  onNameChange,
  saveAsGym,
  onToggleSave,
  isLoading,
  onBack,
  onAdapt,
}: LoadoutManualStepProps) {
  const count = selectedIds.size;
  const canAdapt = count > 0;

  return (
    <LoadoutScaffold
      title="Pick equipment"
      eyebrow="LOADOUT"
      onBack={onBack}
      testID="loadout-manual"
      trailing={
        <Pill tone={canAdapt ? "primary" : "neutral"} size="sm">
          {`${count} SELECTED`}
        </Pill>
      }
      footer={
        <View style={styles.footer}>
          <View style={styles.nameRow}>
            <TextInput
              style={styles.nameInput}
              value={name}
              onChangeText={onNameChange}
              placeholder="Name this gym (e.g. Hotel gym)"
              placeholderTextColor={color.$text4}
              testID="loadout-manual-name"
              accessibilityLabel="Name this gym"
              returnKeyType="done"
            />
            <TouchableOpacity
              style={[styles.saveToggle, saveAsGym && styles.saveToggleOn]}
              onPress={onToggleSave}
              testID="loadout-manual-save-toggle"
              accessibilityRole="switch"
              accessibilityLabel="Save this gym for next time"
              accessibilityState={{ checked: saveAsGym }}
            >
              <Ionicons
                name={saveAsGym ? "bookmark" : "bookmark-outline"}
                size={15}
                color={saveAsGym ? color.$primary : color.$text3}
              />
              <Text style={[styles.saveText, saveAsGym && styles.saveTextOn]}>
                Save
              </Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[styles.cta, !canAdapt && styles.ctaDisabled]}
            onPress={onAdapt}
            disabled={!canAdapt}
            testID="loadout-manual-adapt"
            accessibilityRole="button"
            accessibilityState={{ disabled: !canAdapt }}
          >
            <Text style={[styles.ctaText, !canAdapt && styles.ctaTextDisabled]}>
              {canAdapt
                ? `Adapt to ${itemLabel(count)}`
                : "Pick your kit to continue"}
            </Text>
          </TouchableOpacity>
        </View>
      }
    >
      {isLoading && groups.length === 0 ? (
        <Text style={styles.loading} testID="loadout-manual-loading">
          Loading the equipment list…
        </Text>
      ) : null}

      {!isLoading && groups.length === 0 ? (
        <Text style={styles.loading} testID="loadout-manual-empty">
          We couldn&apos;t load the equipment list. Check your connection and
          try again.
        </Text>
      ) : null}

      <EquipmentChipGrid
        groups={groups}
        selectedIds={selectedIds}
        onToggle={onToggle}
      />
    </LoadoutScaffold>
  );
}

const styles = StyleSheet.create({
  loading: { fontSize: 13, color: color.$text3, lineHeight: 19 },
  footer: { flex: 1, gap: space.$sm },
  nameRow: { flexDirection: "row", alignItems: "center", gap: space.$sm },
  nameInput: {
    flex: 1,
    height: 44,
    borderRadius: radius.$md,
    paddingHorizontal: space.$md,
    backgroundColor: color.$surface2,
    borderWidth: 1,
    borderColor: color.$border,
    color: color.$text,
    fontSize: 13.5,
  },
  saveToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.$xs,
    height: 44,
    paddingHorizontal: space.$md,
    borderRadius: radius.$md,
    borderWidth: 1,
    borderColor: color.$border2,
    backgroundColor: color.$surface2,
  },
  saveToggleOn: {
    borderColor: color.$primary,
    backgroundColor: color.$primaryDim,
  },
  saveText: { fontSize: 12, fontWeight: "700", color: color.$text3 },
  saveTextOn: { color: color.$primary },
  cta: {
    height: 52,
    borderRadius: radius.$lg,
    backgroundColor: color.$primary,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaDisabled: { backgroundColor: color.$surface3 },
  ctaText: { fontSize: 15, fontWeight: "700", color: color.$primaryInk },
  ctaTextDisabled: { color: color.$text4 },
});
