import { Ionicons } from "@expo/vector-icons";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { SavedGym } from "@/domain/models/loadout";
import type { EquipmentPickerGroup } from "@/domain/services/loadout.service";
import { EquipmentChipGrid } from "./EquipmentChipGrid";
import { color, radius, space } from "@/ui/theme/tokens";

/**
 * <SavedGymsPresenter> — the Profile · Account gym list (T-2.9, AC-7.1/7.2).
 *
 * A "light list" per AC-7.2, but with rename AND kit editing rather than just
 * delete: a gym whose equipment cannot be corrected has to be deleted and
 * rebuilt from scratch the first time the gym adds a rack, which is the opposite
 * of the reuse the whole `saved_gyms` table exists for.
 *
 * ⚠ **Deleting a gym does NOT delete the variations built from it** (AC-7.3) —
 * `source_gym_id` goes null and each variation keeps the kit summary it was
 * saved with. The confirm copy says so, because "delete" next to a name the user
 * can see on three saved workouts reads like it will take those with it.
 *
 * ⚠ **A 409 on rename is a rename prompt, not a failure.** Names are unique per
 * user on `lower(btrim(name))`, and the container turns
 * `SAVED_GYM_NAME_TAKEN` into `error` on the row being edited so the field stays
 * open with the typed value intact.
 */

export type SavedGymEditState = {
  readonly gymId: string;
  readonly name: string;
  readonly selectedIds: ReadonlySet<string>;
  /** Field-level message — a duplicate name, or a failed save. */
  readonly error: string | null;
  readonly isSaving: boolean;
};

export type SavedGymsPresenterProps = {
  readonly gyms: readonly SavedGym[];
  readonly isLoading: boolean;
  readonly loadError: string | null;
  readonly groups: readonly EquipmentPickerGroup[];
  /** Resolves a gym's ids to names for the collapsed row's summary. */
  readonly equipmentNameById: ReadonlyMap<string, string>;
  readonly editing: SavedGymEditState | null;
  /** The gym awaiting delete confirmation. */
  readonly pendingDeleteId: string | null;
  readonly onBack: () => void;
  readonly onStartEdit: (gym: SavedGym) => void;
  readonly onCancelEdit: () => void;
  readonly onEditName: (name: string) => void;
  readonly onToggleEquipment: (equipmentTypeId: string) => void;
  readonly onSaveEdit: () => void;
  readonly onRequestDelete: (gymId: string) => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: (gymId: string) => void;
};

/**
 * The collapsed row's kit summary. Names, not a count, because "5 items" tells
 * the user nothing about whether this is the right gym; capped at three so a
 * commercial gym with 24 items does not push the row to six lines.
 */
export function summariseKit(
  equipmentTypeIds: readonly string[],
  equipmentNameById: ReadonlyMap<string, string>,
): string {
  const names = equipmentTypeIds
    .map((id) => equipmentNameById.get(id))
    .filter((name): name is string => Boolean(name));
  if (names.length === 0) {
    // Either an empty gym or a reference cache that has not loaded. Both read
    // better as a count than as an empty line.
    return equipmentTypeIds.length === 1
      ? "1 item"
      : `${equipmentTypeIds.length} items`;
  }
  const shown = names.slice(0, 3).join(" · ");
  return names.length > 3 ? `${shown} +${names.length - 3} more` : shown;
}

export function SavedGymsPresenter({
  gyms,
  isLoading,
  loadError,
  groups,
  equipmentNameById,
  editing,
  pendingDeleteId,
  onBack,
  onStartEdit,
  onCancelEdit,
  onEditName,
  onToggleEquipment,
  onSaveEdit,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: SavedGymsPresenterProps) {
  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="saved-gyms">
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.iconButton}
          testID="saved-gyms-back"
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
        >
          <Ionicons name="arrow-back" size={22} color={color.$text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Saved gyms</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.intro}>
          Equipment setups you can reuse whenever you adapt a workout.
        </Text>

        {isLoading && gyms.length === 0 ? (
          <Text style={styles.muted} testID="saved-gyms-loading">
            Loading your gyms…
          </Text>
        ) : null}

        {loadError !== null ? (
          <Text style={styles.error} testID="saved-gyms-error">
            {loadError}
          </Text>
        ) : null}

        {!isLoading && loadError === null && gyms.length === 0 ? (
          <Text style={styles.muted} testID="saved-gyms-empty">
            You haven&apos;t saved a gym yet. Next time you adapt a workout,
            tick &quot;Save&quot; when you pick your equipment.
          </Text>
        ) : null}

        {gyms.map((gym) => {
          const isEditing = editing?.gymId === gym.id;
          const isDeleting = pendingDeleteId === gym.id;

          if (isDeleting) {
            return (
              <View
                key={gym.id}
                style={styles.card}
                testID={`saved-gym-${gym.id}-confirm-delete`}
              >
                <Text style={styles.confirmTitle}>Delete {gym.name}?</Text>
                <Text style={styles.confirmBody}>
                  Workout variations you saved with this gym are kept — they
                  just stop being linked to it.
                </Text>
                <View style={styles.confirmRow}>
                  <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={onCancelDelete}
                    testID={`saved-gym-${gym.id}-delete-cancel`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.secondaryButtonText}>Keep it</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.destructiveButton}
                    onPress={() => onConfirmDelete(gym.id)}
                    testID={`saved-gym-${gym.id}-delete-confirm`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.destructiveButtonText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }

          if (isEditing && editing) {
            return (
              <View
                key={gym.id}
                style={styles.card}
                testID={`saved-gym-${gym.id}-editor`}
              >
                <TextInput
                  style={styles.nameInput}
                  value={editing.name}
                  onChangeText={onEditName}
                  placeholder="Gym name"
                  placeholderTextColor={color.$text4}
                  testID={`saved-gym-${gym.id}-name`}
                  accessibilityLabel="Gym name"
                />
                {editing.error !== null ? (
                  <Text
                    style={styles.error}
                    testID={`saved-gym-${gym.id}-edit-error`}
                  >
                    {editing.error}
                  </Text>
                ) : null}

                <EquipmentChipGrid
                  groups={groups}
                  selectedIds={editing.selectedIds}
                  onToggle={onToggleEquipment}
                  testIDPrefix={`saved-gym-${gym.id}-equip`}
                />

                <View style={styles.confirmRow}>
                  <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={onCancelEdit}
                    testID={`saved-gym-${gym.id}-cancel`}
                    accessibilityRole="button"
                  >
                    <Text style={styles.secondaryButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.primaryButton,
                      (editing.isSaving || editing.selectedIds.size === 0) &&
                        styles.buttonDisabled,
                    ]}
                    onPress={onSaveEdit}
                    // A gym with no equipment is not a gym — it would make every
                    // loadable row unresolved on any workout adapted against it.
                    disabled={
                      editing.isSaving || editing.selectedIds.size === 0
                    }
                    testID={`saved-gym-${gym.id}-save`}
                    accessibilityRole="button"
                    accessibilityState={{
                      disabled:
                        editing.isSaving || editing.selectedIds.size === 0,
                    }}
                  >
                    <Text style={styles.primaryButtonText}>
                      {editing.isSaving ? "Saving…" : "Save changes"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }

          return (
            <View
              key={gym.id}
              style={styles.row}
              testID={`saved-gym-${gym.id}`}
            >
              <View style={styles.rowIcon}>
                <Ionicons
                  name="location-outline"
                  size={16}
                  color={color.$primary}
                />
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {gym.name}
                </Text>
                <Text style={styles.rowKit} numberOfLines={1}>
                  {summariseKit(gym.equipmentTypeIds, equipmentNameById)}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => onStartEdit(gym)}
                testID={`saved-gym-${gym.id}-edit`}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${gym.name}`}
                hitSlop={8}
              >
                <Ionicons
                  name="create-outline"
                  size={19}
                  color={color.$text2}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onRequestDelete(gym.id)}
                testID={`saved-gym-${gym.id}-delete`}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${gym.name}`}
                hitSlop={8}
              >
                <Ionicons name="trash-outline" size={18} color={color.$text3} />
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.$bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.$base,
    paddingVertical: space.$md,
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
    color: color.$text,
    textAlign: "center",
  },
  content: {
    paddingHorizontal: space.$base,
    paddingBottom: space.$3xl,
    gap: space.$md,
  },
  intro: { fontSize: 13, color: color.$text3, lineHeight: 19 },
  muted: { fontSize: 13, color: color.$text3, lineHeight: 19 },
  error: { fontSize: 12.5, color: color.$error, lineHeight: 18 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.$md,
    padding: space.$md,
    borderRadius: radius.$lg,
    backgroundColor: color.$surface2,
    borderWidth: 1,
    borderColor: color.$border,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.$md,
    backgroundColor: color.$primaryDim,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: { flex: 1, gap: 2 },
  rowName: { fontSize: 14, fontWeight: "700", color: color.$text },
  rowKit: { fontSize: 11.5, color: color.$text3 },
  card: {
    gap: space.$md,
    padding: space.$base,
    borderRadius: radius.$lg,
    backgroundColor: color.$surface2,
    borderWidth: 1,
    borderColor: color.$border2,
  },
  nameInput: {
    height: 44,
    borderRadius: radius.$md,
    paddingHorizontal: space.$md,
    backgroundColor: color.$surface3,
    color: color.$text,
    fontSize: 14,
  },
  confirmTitle: { fontSize: 15, fontWeight: "700", color: color.$text },
  confirmBody: { fontSize: 12.5, color: color.$text2, lineHeight: 18 },
  confirmRow: { flexDirection: "row", gap: space.$sm },
  secondaryButton: {
    flex: 1,
    height: 44,
    borderRadius: radius.$md,
    borderWidth: 1,
    borderColor: color.$border2,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: { fontSize: 14, fontWeight: "600", color: color.$text2 },
  primaryButton: {
    flex: 1,
    height: 44,
    borderRadius: radius.$md,
    backgroundColor: color.$primary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: color.$primaryInk,
  },
  destructiveButton: {
    flex: 1,
    height: 44,
    borderRadius: radius.$md,
    backgroundColor: color.$errorDim,
    alignItems: "center",
    justifyContent: "center",
  },
  destructiveButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: color.$error,
  },
  buttonDisabled: { opacity: 0.5 },
});
