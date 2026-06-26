import { create } from "zustand";
import type { MealSlot } from "@/domain/models/nutrition";

/**
 * useFuelSheets — open-state slice for the Fuel surface's root-mounted sheets
 * (Scan barcode, Quick add). Mirrors the ProfileDrawer pattern: the sheets are
 * ALWAYS mounted as siblings of the tab stack and read `sheet` to drive their
 * own slide-in/out via the <BottomSheet> `visible` prop. `slot` carries the meal
 * slot an add flow targets (defaults when the row-level Add opens it).
 *
 * Spec: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § Sheets (mounted at root)
 */

export type FuelSheet = "scan" | "quickAdd" | null;

export interface FuelSheetsState {
  sheet: FuelSheet;
  /** The meal slot a Scan / Quick-add flow logs into. */
  slot: MealSlot;
  /**
   * Monotonic counter bumped after any nutrition mutation fired from a sheet.
   * The Fuel screen container watches it to reload its cache-first aggregate
   * (the sheets and screen are separate containers over the same SQLite cache).
   */
  rev: number;
  openScan: (slot?: MealSlot) => void;
  openQuickAdd: (slot?: MealSlot) => void;
  close: () => void;
  /** Signal the Fuel screen to re-read the cache after a sheet mutation. */
  notifyMutated: () => void;
}

export const useFuelSheets = create<FuelSheetsState>((set) => ({
  sheet: null,
  slot: "breakfast",
  rev: 0,
  openScan: (slot = "breakfast") => set({ sheet: "scan", slot }),
  openQuickAdd: (slot = "breakfast") => set({ sheet: "quickAdd", slot }),
  close: () => set({ sheet: null }),
  notifyMutated: () => set((s) => ({ rev: s.rev + 1 })),
}));
