import { create } from "zustand";

/**
 * useGoalSheet — the athlete's own add/edit-goal sheet (M16 — Athlete Training
 * page). Root-mounted (feedback_sheets_mount_at_root), opened from the Train
 * overview's Goals section:
 *
 *  - create mode (`editGoal === null`): pick a goal type from the `GET
 *    /goal-types` catalog + an optional target date → `POST /goals`. The picker
 *    excludes `takenGoalTypeIds` — the athlete already has a goal of that type
 *    (the `user_goals` UNIQUE(user, goal_type) would 409 otherwise).
 *  - edit mode (`editGoal` set): the goal type is immutable; only the target
 *    date is editable → `PATCH /goals/:id`.
 *
 * This is the SELF sheet only — coach-assigned goals are view-only, so the Goals
 * section never opens this for them (distinct from the coach `useAssignGoalSheet`).
 */

export type GoalSheetEditTarget = {
  goalId: string;
  goalTypeName: string | null;
  targetDate: string | null;
};

export interface GoalSheetState {
  open: boolean;
  /** Non-null in edit mode (drives PATCH); null in create mode (drives POST). */
  editGoal: GoalSheetEditTarget | null;
  /** Goal-type ids the athlete already owns — filtered out of the create picker. */
  takenGoalTypeIds: string[];
  /** Called after a successful create/edit so the container re-reads the cache. */
  onChanged: (() => void) | null;
  openForCreate: (takenGoalTypeIds: string[], onChanged?: () => void) => void;
  openForEdit: (editGoal: GoalSheetEditTarget, onChanged?: () => void) => void;
  closeSheet: () => void;
}

export const useGoalSheet = create<GoalSheetState>((set) => ({
  open: false,
  editGoal: null,
  takenGoalTypeIds: [],
  onChanged: null,
  openForCreate: (takenGoalTypeIds, onChanged) =>
    set({
      open: true,
      editGoal: null,
      takenGoalTypeIds,
      onChanged: onChanged ?? null,
    }),
  openForEdit: (editGoal, onChanged) =>
    set({
      open: true,
      editGoal,
      takenGoalTypeIds: [],
      onChanged: onChanged ?? null,
    }),
  closeSheet: () =>
    set({ open: false, editGoal: null, takenGoalTypeIds: [], onChanged: null }),
}));
