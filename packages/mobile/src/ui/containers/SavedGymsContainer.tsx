import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SavedGym } from "@/domain/models/loadout";
import { isEquipmentGroupingStale } from "@/domain/models/reference-list";
import { groupEquipmentForPicker } from "@/domain/services/loadout.service";
import { useReferenceLists } from "@/ui/hooks/useReferenceLists";
import { useSavedGyms } from "@/ui/hooks/useSavedGyms";
import {
  SavedGymsPresenter,
  type SavedGymEditState,
} from "@/ui/presenters/loadout/SavedGymsPresenter";

/**
 * <SavedGymsContainer> — Profile · Account → Saved gyms (T-2.9, AC-7.1/7.2).
 *
 * ⚠ **A 409 is a field error, not a screen error.** Gym names are unique per user
 * on `lower(btrim(name))`, so renaming to a name the user already has is both
 * likely and entirely recoverable — the editor stays open with their typed value
 * so they can adjust it. Anything else becomes a generic message on the same
 * field. The branch is only possible because the adapter surfaces the handler's
 * flat `{ code, message }` body as `LoadoutApiError.loadoutCode`.
 */
export function SavedGymsContainer() {
  const gyms = useSavedGyms();
  const reference = useReferenceLists();

  const [editing, setEditing] = useState<SavedGymEditState | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  /** A delete that is in flight — its row is hidden until the list re-reads. */
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Same pre-Loadout-cache problem as the flow's picker: an equipment list cached
  // before `category` existed groups everything under "Other", for up to 24 h,
  // with nothing on screen able to explain why.
  const equipmentEntries = reference.equipment;
  const groupingRefreshedRef = useRef(false);
  useEffect(() => {
    if (groupingRefreshedRef.current) return;
    if (!isEquipmentGroupingStale(equipmentEntries)) return;
    groupingRefreshedRef.current = true;
    void reference.refresh();
  }, [equipmentEntries, reference]);

  const groups = useMemo(
    () => groupEquipmentForPicker(equipmentEntries),
    [equipmentEntries],
  );

  const equipmentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of equipmentEntries) {
      map.set(entry.id, entry.displayName ?? entry.name);
    }
    return map;
  }, [equipmentEntries]);

  const visibleGyms = useMemo(
    () => gyms.gyms.filter((gym) => gym.id !== deletingId),
    [gyms.gyms, deletingId],
  );

  const onStartEdit = useCallback((gym: SavedGym) => {
    setPendingDeleteId(null);
    setEditing({
      gymId: gym.id,
      name: gym.name,
      selectedIds: new Set(gym.equipmentTypeIds),
      error: null,
      isSaving: false,
    });
  }, []);

  const onEditName = useCallback((name: string) => {
    setEditing((previous) =>
      previous === null ? null : { ...previous, name, error: null },
    );
  }, []);

  const onToggleEquipment = useCallback((equipmentTypeId: string) => {
    setEditing((previous) => {
      if (previous === null) return null;
      const next = new Set(previous.selectedIds);
      if (next.has(equipmentTypeId)) next.delete(equipmentTypeId);
      else next.add(equipmentTypeId);
      return { ...previous, selectedIds: next, error: null };
    });
  }, []);

  const onSaveEdit = useCallback(async () => {
    if (editing === null) return;
    const trimmed = editing.name.trim();
    if (trimmed.length === 0) {
      setEditing({ ...editing, error: "Give this gym a name." });
      return;
    }
    setEditing({ ...editing, isSaving: true, error: null });
    const error = await gyms.update(editing.gymId, {
      name: trimmed,
      equipmentTypeIds: [...editing.selectedIds],
    });
    if (error === null) {
      setEditing(null);
      return;
    }
    setEditing((previous) =>
      previous === null
        ? null
        : {
            ...previous,
            isSaving: false,
            error:
              error.loadoutCode === "SAVED_GYM_NAME_TAKEN"
                ? "You already have a gym with that name."
                : "Couldn't save those changes. Check your connection and try again.",
          },
    );
  }, [editing, gyms]);

  /**
   * ⚠ The row is hidden the moment delete is confirmed, not when the server
   * answers.
   *
   * Clearing `pendingDeleteId` alone swaps the confirm card back for the ROW,
   * and `remove()` then takes two sequential round trips before the list
   * re-reads (delete, then refresh — the hook re-reads rather than splicing
   * because the server owns `updated_at`). So the row the user just deleted
   * reappears for the whole of that window: it reads as "the delete didn't
   * work", and on a slow connection they can tap its delete a second time.
   */
  const onConfirmDelete = useCallback(
    async (gymId: string) => {
      setPendingDeleteId(null);
      setDeletingId(gymId);
      try {
        await gyms.remove(gymId);
      } finally {
        // Cleared either way. On a FAILED delete the row must come back —
        // hiding it permanently would show the user a gym they still have as
        // gone, and the next refresh would resurrect it anyway.
        setDeletingId(null);
      }
    },
    [gyms],
  );

  return (
    <SavedGymsPresenter
      gyms={visibleGyms}
      isLoading={gyms.isLoading}
      loadError={
        gyms.error === null
          ? null
          : "Couldn't load your saved gyms. Check your connection and try again."
      }
      groups={groups}
      equipmentNameById={equipmentNameById}
      editing={editing}
      pendingDeleteId={pendingDeleteId}
      onBack={() => router.back()}
      onStartEdit={onStartEdit}
      onCancelEdit={() => setEditing(null)}
      onEditName={onEditName}
      onToggleEquipment={onToggleEquipment}
      onSaveEdit={() => void onSaveEdit()}
      onRequestDelete={(gymId) => {
        setEditing(null);
        setPendingDeleteId(gymId);
      }}
      onCancelDelete={() => setPendingDeleteId(null)}
      onConfirmDelete={(gymId) => void onConfirmDelete(gymId)}
    />
  );
}
