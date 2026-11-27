import { MEAL_PLAN_LIMITS } from "@persistence/form-limits";
import type { NutritionPlan, PlanAssignmentStatus } from "./nutritionPlans";

/**
 * Coach meal plans on a client (PER-135, canvas C1 / C3.2, Design D).
 *
 * The coach's library is the coach's own plans: the same `NutritionPlan`
 * rows the phone already caches and queues (PER-133), so library edits are
 * offline-safe with a revision. Sending a plan to a client, changing its
 * note, removing it and sharing a recipe need a connection.
 *
 * Mirrors `GET /trainers/me/clients/:clientId/meal-plans` (PER-118).
 */

export type CoachPlanAssignment = {
  id: string;
  planId: string;
  note: string | null;
  status: PlanAssignmentStatus;
  seenRevision: number;
  sentAt: string;
  addedAt: string | null;
  updatedAt: string;
  plan: NutritionPlan;
  updatedSinceSeen: boolean;
  /** Distinct days with food logged from this plan. */
  usedDays: number;
  /** Plan meals (entries) logged from this plan in the last 7 days. */
  loggedThisWeek: number;
};

/** The client's own calorie and macro target; a plan has none of its own. */
export type CoachClientTarget = {
  dailyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  setByUserId: string | null;
};

export type CoachClientMealPlans = {
  assignments: CoachPlanAssignment[];
  target: CoachClientTarget | null;
  asOf: string;
};

/** `GET /trainers/me/clients/:clientId/adherence?window=7d` → `calories` (PER-114). */
export type CoachCalorieAdherence = {
  daysOnTarget: number;
  daysCounted: number;
  daysNotLogged: number;
};

/** `POST /trainers/me/clients/:clientId/recipes/:recipeId/share`. */
export type CoachRecipeShare = {
  recipeId: string;
  created: boolean;
};

/** A coach's note on a sent plan, trimmed (the server trims to this). */
export const COACH_PLAN_NOTE_MAX = MEAL_PLAN_LIMITS.noteMax;
