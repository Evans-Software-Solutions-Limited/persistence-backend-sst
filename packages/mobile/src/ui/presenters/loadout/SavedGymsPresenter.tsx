import { Ionicons } from "@expo/vector-icons";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import type { SavedGym } from "@/domain/models/loadout";
import type { EquipmentPickerGroup } from "@/domain/services/loadout.service";
import { EquipmentChipGrid } from "./EquipmentChipGrid";
import { color, radius, space } from "@/ui/theme/tokens";

/**
 * <SavedGymsPresenter> — the Train hub's `Gyms` segment (T-2.9, AC-7.1/7.2/7.2a).
 *
 * Rename AND kit editing rather than just delete: a gym whose equipment cannot
 * be corrected has to be deleted and rebuilt from scratch the first time the gym
 * adds a rack, which is the opposite of the reuse the whole `saved_gyms` table
 * exists for.
 *
 * ⚠ **Hub BODY content, not a Stack screen** (AC-7.2, revised 2026-08-02). It
 * renders no `SafeAreaView` and no back header: `TrainHubContainer` owns the
 * chrome and has already applied `insets.top`. The `SafeAreaView` this used to
 * carry was correct only while it was a pushed screen — outside the Loadout
 * route there is no `SafeAreaProvider`, and a native `SafeAreaView` measuring
 * its own window inside a hub body would double the inset.
 *
 * ⚠ **Creation lives here** (AC-7.2a). Until this segment existed a gym could
 * only be born as a by-product of adapting a workout, and the empty state said
 * so. That is a coherent instruction for a footnote under Profile and a dead end
 * for a hub tab on a new account, so `editing.gymId === null` is the new-gym
 * draft and reuses the identical editor card.
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
  /** `null` is the NEW-gym draft; a string edits that existing gym. */
  readonly gymId: string | null;
  readonly name: string;
  readonly selectedIds: ReadonlySet<string>;
  /** Field-level message — a duplicate name, or a failed save. */
  readonly error: string | null;
  readonly isSaving: boolean;
};

export type SavedGymsPresenterProps = {
  readonly gyms: readonly SavedGym[];
  readonly isLoading: boolean;
  /**
   * True while the equipment reference list is (re)fetching and we have none.
   * ⚠ Without this the CREATE card is a silent dead end: `EquipmentChipGrid`
   * renders nothing for empty `groups`, and the save button is disabled at zero
   * selected — so a first run that cannot load the catalogue offers a name field,
   * no chips, and a permanently greyed "Create gym" with nothing explaining why.
   * Unreachable before creation existed (an existing gym always arrives with its
   * kit pre-selected). Mirrors `LoadoutManualStep`.
   */
  readonly equipmentLoading: boolean;
  readonly loadError: string | null;
  readonly groups: readonly EquipmentPickerGroup[];
  /** Resolves a gym's ids to names for the collapsed row's summary. */
  readonly equipmentNameById: ReadonlyMap<string, string>;
  readonly editing: SavedGymEditState | null;
  /** The gym awaiting delete confirmation. */
  readonly pendingDeleteId: string | null;
  readonly onStartCreate: () => void;
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

/**
 * The editor card. ONE component for both the new-gym draft and an existing
 * gym's edit, because they differ only in their labels and testIDs — and the
 * rule that makes the save button meaningful ("a gym with no equipment is not a
 * gym") has to hold identically on both paths or creation opens a hole that
 * rename already closes.
 */
function GymEditorCard({
  editing,
  groups,
  equipmentLoading,
  prefix,
  saveLabel,
  onEditName,
  onToggleEquipment,
  onSaveEdit,
  onCancelEdit,
}: {
  readonly editing: SavedGymEditState;
  readonly groups: readonly EquipmentPickerGroup[];
  readonly equipmentLoading: boolean;
  readonly prefix: string;
  readonly saveLabel: string;
  readonly onEditName: (name: string) => void;
  readonly onToggleEquipment: (equipmentTypeId: string) => void;
  readonly onSaveEdit: () => void;
  readonly onCancelEdit: () => void;
}) {
  const blocked = editing.isSaving || editing.selectedIds.size === 0;
  return (
    <View style={styles.card} testID={`${prefix}-editor`}>
      <TextInput
        style={styles.nameInput}
        value={editing.name}
        onChangeText={onEditName}
        placeholder="Gym name"
        placeholderTextColor={color.$text4}
        testID={`${prefix}-name`}
        accessibilityLabel="Gym name"
      />
      {editing.error !== null ? (
        <Text style={styles.error} testID={`${prefix}-edit-error`}>
          {editing.error}
        </Text>
      ) : null}

      {equipmentLoading && groups.length === 0 ? (
        <Text style={styles.muted} testID={`${prefix}-equip-loading`}>
          Loading the equipment list…
        </Text>
      ) : null}

      {!equipmentLoading && groups.length === 0 ? (
        <Text style={styles.muted} testID={`${prefix}-equip-empty`}>
          We couldn&apos;t load the equipment list. Check your connection and
          try again.
        </Text>
      ) : null}

      <EquipmentChipGrid
        groups={groups}
        selectedIds={editing.selectedIds}
        onToggle={onToggleEquipment}
        testIDPrefix={`${prefix}-equip`}
      />

      <View style={styles.confirmRow}>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={onCancelEdit}
          testID={`${prefix}-cancel`}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryButton, blocked && styles.buttonDisabled]}
          onPress={onSaveEdit}
          // A gym with no equipment is not a gym — it would make every loadable
          // row unresolved on any workout adapted against it.
          disabled={blocked}
          testID={`${prefix}-save`}
          accessibilityRole="button"
          accessibilityState={{ disabled: blocked }}
        >
          <Text style={styles.primaryButtonText}>
            {editing.isSaving ? "Saving…" : saveLabel}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function SavedGymsPresenter({
  gyms,
  isLoading,
  loadError,
  groups,
  equipmentLoading,
  equipmentNameById,
  editing,
  pendingDeleteId,
  onStartCreate,
  onStartEdit,
  onCancelEdit,
  onEditName,
  onToggleEquipment,
  onSaveEdit,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: SavedGymsPresenterProps) {
  // Narrowing, not just a boolean: the create card takes `editing` non-null.
  const isCreating = editing !== null && editing.gymId === null;
  return (
    <View style={styles.root} testID="saved-gyms">
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.intro}>
          Equipment setups you can reuse whenever you adapt a workout.
        </Text>

        {isCreating ? (
          <GymEditorCard
            editing={editing}
            groups={groups}
            equipmentLoading={equipmentLoading}
            prefix="saved-gym-new"
            saveLabel="Create gym"
            onEditName={onEditName}
            onToggleEquipment={onToggleEquipment}
            onSaveEdit={onSaveEdit}
            onCancelEdit={onCancelEdit}
          />
        ) : editing !== null ? null : (
          // ⚠ Hidden while ANY editor is open, not just the draft. Left visible
          // during an existing gym's in-flight save, tapping it swapped `editing`
          // for a fresh draft that the settling `onSaveEdit` then wrote into —
          // either wiping what the user had typed or captioning the new card with
          // the OTHER gym's 409.
          <TouchableOpacity
            style={styles.createButton}
            onPress={onStartCreate}
            testID="saved-gyms-create"
            accessibilityRole="button"
          >
            <Ionicons name="add" size={17} color={color.$primaryInk} />
            <Text style={styles.createButtonText}>New gym</Text>
          </TouchableOpacity>
        )}

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
            No gyms yet. Add the kit you have at each place you train and
            Loadout can re-map any workout to it in one tap.
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
              <GymEditorCard
                key={gym.id}
                editing={editing}
                groups={groups}
                equipmentLoading={equipmentLoading}
                prefix={`saved-gym-${gym.id}`}
                saveLabel="Save changes"
                onEditName={onEditName}
                onToggleEquipment={onToggleEquipment}
                onSaveEdit={onSaveEdit}
                onCancelEdit={onCancelEdit}
              />
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.$bg },
  createButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.$xs,
    height: 46,
    borderRadius: radius.$lg,
    backgroundColor: color.$primary,
  },
  createButtonText: {
    fontSize: 14.5,
    fontWeight: "700",
    color: color.$primaryInk,
  },
  content: {
    paddingHorizontal: space.$base,
    // 140 like the sibling Train hub bodies (WorkoutsListPresenter,
    // TrainOverviewPresenter): `ActiveWorkoutOverlay` floats the minimised
    // workout bar absolutely at `tabBarHeight + 12`, so $3xl left the last gym
    // row — or an editor's Save button — underneath it mid-session.
    paddingBottom: 140,
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
