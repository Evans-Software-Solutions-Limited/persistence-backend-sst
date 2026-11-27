import { useCallback } from "react";
import { router, type Href } from "expo-router";
import type { UserMeal } from "@/domain/models/userMeals";
import { isSyntheticUserMealId } from "@/domain/services/userMeals.service";
import { useFuelSheets } from "@/state/fuel-sheets";
import { openMealprint } from "./openMealprint";
import { useMealprintGate } from "./useMealprintGate";
import { useMealprintPreferences } from "./useMealprintPreferences";
import { useNutritionAiGate } from "./useNutritionAiGate";
import { useOnlineStatus } from "./useOnlineStatus";

export type MealQuickActions = {
  aiLocked: boolean;
  snapOffline: boolean;
  /** Free and Premium: Suggest opens the locked page. */
  suggestLocked: boolean;
  onScan: () => void;
  onSnap: () => void;
  onSearch: () => void;
  onQuickLog: () => void;
  onSuggest: () => void;
};

/**
 * The five quick buttons (PER-132) for one meal: each opens its drawer aimed
 * at that meal. Shared by Log (aimed at the meal for the time of day) and Add
 * to a meal (aimed at the page's meal).
 *
 * Suggest = Mealprint One meal, preset to the meal. Gate first: Free and
 * Premium get the locked page (N26); first-time users get the preferences
 * wizard, as the Mealprint card did.
 */
export function useMealQuickActions(
  meal: Pick<UserMeal, "id" | "logSlot"> | null,
): MealQuickActions {
  const aiGate = useNutritionAiGate();
  const mealprintGate = useMealprintGate();
  const preferences = useMealprintPreferences();
  const online = useOnlineStatus();
  const openScan = useFuelSheets((s) => s.openScan);
  const openSnap = useFuelSheets((s) => s.openSnap);
  const openQuickAdd = useFuelSheets((s) => s.openQuickAdd);
  const openQuickLog = useFuelSheets((s) => s.openQuickLog);

  const slot = meal?.logSlot ?? "breakfast";
  const userMealId = meal && !isSyntheticUserMealId(meal.id) ? meal.id : null;

  const onSnap = useCallback(() => {
    // AI calls are online-only and never queue.
    if (!online) return;
    if (aiGate.allowed) openSnap(slot, userMealId);
    else aiGate.gateProps.onUpgrade();
  }, [online, aiGate, openSnap, slot, userMealId]);

  const needsSetup =
    preferences.data === null || preferences.data.isDefault === true;
  const onSuggest = useCallback(() => {
    if (!mealprintGate.isResolved) return;
    // PER-134: the Mealprint page shows the locked page (N26) itself.
    if (mealprintGate.allowed && needsSetup) {
      router.push("/(app)/fuel/preferences?mode=wizard" as Href);
      return;
    }
    openMealprint("meal", { slot, userMealId });
  }, [
    mealprintGate.isResolved,
    mealprintGate.allowed,
    needsSetup,
    slot,
    userMealId,
  ]);

  return {
    aiLocked: !aiGate.allowed,
    snapOffline: !online,
    suggestLocked: mealprintGate.isResolved && !mealprintGate.allowed,
    onScan: () => openScan(slot, userMealId),
    onSnap,
    onSearch: () => openQuickAdd(slot, userMealId),
    onQuickLog: () => openQuickLog(slot, userMealId),
    onSuggest,
  };
}
