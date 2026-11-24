import { create } from "zustand";

import type { LibrarySegment } from "@/ui/presenters/coachForms/CoachLibraryPresenter";

/**
 * PER-129 K shell: the coach Library tab's segment (Workouts · Programmes ·
 * Meals · Resources · Forms). Kept for the session so leaving the tab and
 * coming back lands where the coach was; Forms first (C10g). Not persisted:
 * nothing about it is account-specific.
 */
export type CoachLibraryTabState = {
  segment: LibrarySegment;
  setSegment: (segment: LibrarySegment) => void;
};

export const useCoachLibraryTab = create<CoachLibraryTabState>((set) => ({
  segment: "forms",
  setSegment: (segment) => set({ segment }),
}));
