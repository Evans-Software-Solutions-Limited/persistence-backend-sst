import { create } from "zustand";

/**
 * useAssignGoalSheet — the coach assign/edit-a-client's-goal sheet (M8 Coach
 * Phase 5). Opened from Client Detail's QuickActionsRow "Goals" action (create
 * mode) and the GoalCard edit pencil (edit mode), with the client fixed.
 *
 *  - create mode (`editGoal === null`): `POST /trainers/me/clients/:id/goals`.
 *  - edit mode (`editGoal` set): `PUT …/goals/:goalId`. The server 403s
 *    `not_assigner` unless the caller is the goal's assigner; the sheet only
 *    offers edit when `assignedByCoach`, and surfaces the 403 gracefully if the
 *    server disagrees.
 *
 * Root-mounted (feedback_sheets_mount_at_root).
 */
export type AssignGoalEditTarget = {
  goalId: string;
  title: string;
  targetDate: string | null;
};

export interface AssignGoalSheetState {
  open: boolean;
  clientId: string | null;
  /** Non-null in edit mode (drives PUT); null in create mode (drives POST). */
  editGoal: AssignGoalEditTarget | null;
  onSaved: (() => void) | null;
  openForCreate: (clientId: string, onSaved?: () => void) => void;
  openForEdit: (
    clientId: string,
    editGoal: AssignGoalEditTarget,
    onSaved?: () => void,
  ) => void;
  closeSheet: () => void;
}

export const useAssignGoalSheet = create<AssignGoalSheetState>((set) => ({
  open: false,
  clientId: null,
  editGoal: null,
  onSaved: null,
  openForCreate: (clientId, onSaved) =>
    set({ open: true, clientId, editGoal: null, onSaved: onSaved ?? null }),
  openForEdit: (clientId, editGoal, onSaved) =>
    set({ open: true, clientId, editGoal, onSaved: onSaved ?? null }),
  closeSheet: () =>
    set({ open: false, clientId: null, editGoal: null, onSaved: null }),
}));
