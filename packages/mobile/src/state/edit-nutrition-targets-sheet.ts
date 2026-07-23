import { create } from "zustand";

import type { CalorieHitModule } from "@/domain/models/clientDetail";
import type { VolumeUnit } from "@/shared/utils";

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
 *
 * `volumeUnit` — device-QA follow-up: the water target field displays/accepts
 * the CLIENT's preferred volume unit (default litres; imperial clients see
 * cups), not the coach's own. Sourced from `preferredVolumeUnit(detail.client.
 * preferredUnits)` by the caller (Client Detail doesn't know the client's unit
 * until the aggregate resolves, so this always defaults to "l" until the
 * caller supplies it). The STORED/wire value stays `water_cups` — this only
 * changes what the sheet displays/parses at the edges.
 */
export type EditNutritionTargetsInitial = {
  dailyKcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  waterCups: number | null;
  /** Client body stats for the optional TDEE calculator (from the Client
   *  Detail header). Prefill the calculator's age/height so the coach only
   *  needs to add the client's sex + weight — sex/weight aren't on the client
   *  header. Absent/null → the calculator starts those fields blank. */
  ageYears?: number | null;
  heightCm?: number | null;
};

export interface EditNutritionTargetsSheetState {
  open: boolean;
  clientId: string | null;
  initial: EditNutritionTargetsInitial | null;
  onSaved: (() => void) | null;
  /** The client's preferred volume display unit for the water field. Defaults
   *  to "l" until a caller supplies the client's actual preference. */
  volumeUnit: VolumeUnit;
  openSheet: (
    clientId: string,
    initial: EditNutritionTargetsInitial | null,
    onSaved?: () => void,
    volumeUnit?: VolumeUnit,
  ) => void;
  closeSheet: () => void;
}

/**
 * Convenience adapter — build the initial from a CalorieHitModule (module d).
 * Optionally carries the client's body stats (age/height from the Client
 * Detail header) so the coach's optional TDEE calculator opens pre-filled.
 * Returns an initial when either the calorie target or the body stats are
 * present, so the sheet can prefill the calculator even before a target exists.
 */
export function initialFromCalorieHit(
  calorieHit: CalorieHitModule | null,
  clientStats?: { ageYears: number | null; heightCm: number | null } | null,
): EditNutritionTargetsInitial | null {
  if (!calorieHit && !clientStats) return null;
  return {
    dailyKcal: calorieHit?.targetKcal ?? null,
    proteinG: null,
    carbsG: null,
    fatG: null,
    waterCups: null,
    // Only carry the body stats when the caller supplies them, so the
    // calorie-only call keeps its original shape.
    ...(clientStats
      ? { ageYears: clientStats.ageYears, heightCm: clientStats.heightCm }
      : {}),
  };
}

export const useEditNutritionTargetsSheet =
  create<EditNutritionTargetsSheetState>((set) => ({
    open: false,
    clientId: null,
    initial: null,
    onSaved: null,
    volumeUnit: "l",
    openSheet: (clientId, initial, onSaved, volumeUnit) =>
      set({
        open: true,
        clientId,
        initial: initial ?? null,
        onSaved: onSaved ?? null,
        volumeUnit: volumeUnit ?? "l",
      }),
    closeSheet: () =>
      set({
        open: false,
        clientId: null,
        initial: null,
        onSaved: null,
        volumeUnit: "l",
      }),
  }));
