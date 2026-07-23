import { create } from "zustand";
import type { MealSlot } from "@/domain/models/nutrition";
import { localDayISO } from "@/shared/utils";

/**
 * useFuelSheets — open-state slice for the Fuel surface's root-mounted sheets
 * (Scan barcode, Quick add, Snap AI). Mirrors the ProfileDrawer pattern: the
 * sheets are ALWAYS mounted as siblings of the tab stack and read `sheet` to
 * drive their own slide-in/out via the <BottomSheet> `visible` prop. `slot`
 * carries the meal slot an add flow targets (defaults when the row-level Add
 * opens it).
 *
 * `date` (QA-20) is the single source of truth for "which day is a nutrition
 * log flow targeting" — <FuelContainer> keeps it in sync with its own
 * day-nav state on every render, so it's already correct by the time a sheet
 * opens OR a pushed route (Recipe/Meal detail) mounts on top of the Fuel
 * screen. A sheet-to-sheet handoff (Quick add → Scan/Snap) never touches it,
 * so the day survives the handoff unchanged.
 *
 * Spec: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § Sheets (mounted at root)
 *       specs/13-nutrition-tracking/design.md § Revised 2026-07-03 › Mobile flow (SnapAISheet)
 *       specs/milestones/GO-LIVE-FINAL/BRIEF-7-device-qa-bugs.md § QA-19/QA-20
 */

export type FuelSheet = "scan" | "quickAdd" | "snap" | null;

export interface FuelSheetsState {
  sheet: FuelSheet;
  /** The meal slot a Scan / Quick-add / Snap flow logs into. */
  slot: MealSlot;
  /** The day (YYYY-MM-DD) a log flow targets — see docblock above. Defaults
   * to today so any caller that never touches Fuel's day-nav (Home's quick
   * "Log meal", a cold app open) still logs to today. */
  date: string;
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
  /** Set the active day (QA-20). <FuelContainer> calls this on every day
   * change; Home's quick "Log meal" calls it with today() right before
   * opening Quick-add so it can never inherit a stale day left over from a
   * previous Fuel-tab session. */
  setDate: (date: string) => void;
  close: () => void;
  /** Signal the Fuel screen to re-read the cache after a sheet mutation. */
  notifyMutated: () => void;
}

export const useFuelSheets = create<FuelSheetsState>((set) => ({
  sheet: null,
  slot: "breakfast",
  date: localDayISO(),
  rev: 0,
  openScan: (slot = "breakfast") => set({ sheet: "scan", slot }),
  openQuickAdd: (slot = "breakfast") => set({ sheet: "quickAdd", slot }),
  openSnap: (slot = "breakfast") => set({ sheet: "snap", slot }),
  setDate: (date) => set({ date }),
  close: () => set({ sheet: null }),
  notifyMutated: () => set((s) => ({ rev: s.rev + 1 })),
}));
