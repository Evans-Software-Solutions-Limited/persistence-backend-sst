import { create } from "zustand";
import type { MealSlot } from "@/domain/models/nutrition";

/**
 * useFuelSheets — open-state slice for the Fuel surface's root-mounted sheets
 * (Scan barcode, Quick add, Snap AI). Mirrors the ProfileDrawer pattern: the
 * sheets are ALWAYS mounted as siblings of the tab stack and read `sheet` to
 * drive their own slide-in/out via the <BottomSheet> `visible` prop. `slot`
 * carries the meal slot an add flow targets (defaults when the row-level Add
 * opens it).
 *
 * Spec: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § Sheets (mounted at root)
 *       specs/13-nutrition-tracking/design.md § Revised 2026-07-03 › Mobile flow (SnapAISheet)
 */

export type FuelSheet = "scan" | "quickAdd" | "snap" | null;

export interface FuelSheetsState {
  sheet: FuelSheet;
  /** The meal slot a Scan / Quick-add / Snap flow logs into. */
  slot: MealSlot;
  /**
   * Monotonic counter bumped after any nutrition mutation fired from a sheet.
   * The Fuel screen container watches it to reload its cache-first aggregate
   * (the sheets and screen are separate containers over the same SQLite cache).
   */
  rev: number;
  openScan: (slot?: MealSlot) => void;
  openQuickAdd: (slot?: MealSlot) => void;
  /** M9.5 Tier B — open the AI Snap sheet (photo or, via its free-text CTA
   * handoff, the "Or describe it…" flow). Gate-checked by the caller before
   * calling this (aiGate.allowed) — the store itself doesn't re-check. */
  openSnap: (slot?: MealSlot) => void;
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
  openSnap: (slot = "breakfast") => set({ sheet: "snap", slot }),
  close: () => set({ sheet: null }),
  notifyMutated: () => set((s) => ({ rev: s.rev + 1 })),
}));
