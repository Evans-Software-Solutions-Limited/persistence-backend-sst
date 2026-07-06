import { create } from "zustand";

import type { CalorieHitModule } from "@/domain/models/clientDetail";

/**
 * useEditNutritionTargetsSheet — the coach edit-a-client's-macros sheet
 * (M8 Coach Phase 5). Opened from Client Detail's QuickActionsRow "Macros"
 * action and the TargetsCard edit affordance, with the client fixed. Writes
 * via `PUT /trainers/me/clients/:clientId/nutrition/target`. Root-mounted
 * (feedback_sheets_mount_at_root).
 *
 * `initial` seeds the form from the aggregate's module d so the sheet opens
 * pre-filled (targetKcal only lives there — protein/carbs/fat/water start
 * blank unless the caller supplies them). `onSaved` re-fetches the aggregate.
 */
export type EditNutritionTargetsInitial = {
  dailyKcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  waterCups: number | null;
};

export interface EditNutritionTargetsSheetState {
  open: boolean;
  clientId: string | null;
  initial: EditNutritionTargetsInitial | null;
  onSaved: (() => void) | null;
  openSheet: (
    clientId: string,
    initial: EditNutritionTargetsInitial | null,
    onSaved?: () => void,
  ) => void;
  closeSheet: () => void;
}

/** Convenience adapter — build the initial from a CalorieHitModule (module d). */
export function initialFromCalorieHit(
  calorieHit: CalorieHitModule | null,
): EditNutritionTargetsInitial | null {
  if (!calorieHit) return null;
  return {
    dailyKcal: calorieHit.targetKcal,
    proteinG: null,
    carbsG: null,
    fatG: null,
    waterCups: null,
  };
}

export const useEditNutritionTargetsSheet =
  create<EditNutritionTargetsSheetState>((set) => ({
    open: false,
    clientId: null,
    initial: null,
    onSaved: null,
    openSheet: (clientId, initial, onSaved) =>
      set({
        open: true,
        clientId,
        initial: initial ?? null,
        onSaved: onSaved ?? null,
      }),
    closeSheet: () =>
      set({ open: false, clientId: null, initial: null, onSaved: null }),
  }));
