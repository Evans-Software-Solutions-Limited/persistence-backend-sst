import { create } from "zustand";

/**
 * Plan tab state (PER-133): which plan the tab shows, and its two root-mounted
 * sheets — N7 "Your plans" (switch plans) and C6 "New meal plan from <coach>".
 * The sheets are gorhom bottom sheets, so they mount at the app root like the
 * other Fuel sheets and read this store.
 */
export type PlanSheet = "switch" | "coachPlan" | null;

export interface PlanSheetsState {
  /** The plan the Plan tab shows; null = the default pick. */
  selectedPlanId: string | null;
  sheet: PlanSheet;
  /** The coach plan the C6 sheet shows. */
  coachPlanId: string | null;
  /** Coach plans whose C6 sheet already opened by itself this session. */
  autoShown: readonly string[];
  select: (planId: string | null) => void;
  openSwitch: () => void;
  openCoachPlan: (planId: string, auto?: boolean) => void;
  close: () => void;
}

export const usePlanSheets = create<PlanSheetsState>((set) => ({
  selectedPlanId: null,
  sheet: null,
  coachPlanId: null,
  autoShown: [],
  select: (planId) => set({ selectedPlanId: planId }),
  openSwitch: () => set({ sheet: "switch" }),
  openCoachPlan: (planId, auto = false) =>
    set((s) => ({
      sheet: "coachPlan",
      coachPlanId: planId,
      autoShown:
        auto && !s.autoShown.includes(planId)
          ? [...s.autoShown, planId]
          : s.autoShown,
    })),
  close: () => set({ sheet: null }),
}));
