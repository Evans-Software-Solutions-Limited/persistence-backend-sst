import { useCallback, useEffect, useState } from "react";
import * as Haptics from "expo-haptics";
import { useFuelSheets } from "@/state/fuel-sheets";
import { useSearchFoods } from "@/ui/hooks/useSearchFoods";
import { useLogEntry } from "@/ui/hooks/useLogEntry";
import { localDayISO } from "@/shared/utils";
import type { Food, MealSlot } from "@/domain/models/nutrition";
import { QuickAddSheetPresenter } from "@/ui/presenters/QuickAddSheetPresenter";

/**
 * <QuickAddSheetContainer> — root-mounted Quick-add sheet. Wires the debounced
 * food search + optimistic log into <QuickAddSheetPresenter>; on Add it logs the
 * selected food into the active slot, fires a confirm haptic, signals the Fuel
 * screen to re-read, and closes.
 *
 * Implements: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § <QuickAddSheet>
 */
export function QuickAddSheetContainer() {
  const sheet = useFuelSheets((s) => s.sheet);
  const slotFromStore = useFuelSheets((s) => s.slot);
  const close = useFuelSheets((s) => s.close);
  const notifyMutated = useFuelSheets((s) => s.notifyMutated);

  const visible = sheet === "quickAdd";

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Food | null>(null);
  const [servings, setServings] = useState(1);
  const [slot, setSlot] = useState<MealSlot>(slotFromStore);

  const search = useSearchFoods(query);
  const logEntry = useLogEntry();

  // Reset local state each time the sheet (re)opens for a slot.
  useEffect(() => {
    if (visible) {
      setQuery("");
      setSelected(null);
      setServings(1);
      setSlot(slotFromStore);
    }
  }, [visible, slotFromStore]);

  const onAdd = useCallback(async () => {
    if (!selected) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await logEntry.mutate({
      foodId: selected.id,
      mealSlot: slot,
      servings,
      loggedAt: new Date(`${localDayISO()}T12:00:00`).toISOString(),
    });
    notifyMutated();
    close();
  }, [selected, slot, servings, logEntry, notifyMutated, close]);

  return (
    <QuickAddSheetPresenter
      visible={visible}
      onClose={close}
      query={query}
      onQueryChange={setQuery}
      results={search.results}
      isSearching={search.isSearching}
      selected={selected}
      onSelect={setSelected}
      onClearSelection={() => setSelected(null)}
      servings={servings}
      onServingsChange={setServings}
      slot={slot}
      onSlotChange={setSlot}
      onAdd={() => void onAdd()}
    />
  );
}
