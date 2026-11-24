/**
 * List meal plans (PER-133, Design D, canvas N2 / N5 / N23).
 *
 * A plan is a named list of meals with foods. It has no dates, no weekdays and
 * no target of its own: screens compare its totals with the person's own
 * target (Target · Planned · To plan).
 *
 * Mirrors the merged `GET /nutrition/meal-plans` wire shape (PER-118):
 * `{ data: { mine, fromCoaches, deletedIds, asOf } }`. Reads embed what a
 * client needs (names, per-serving macros, ingredients) so a plan from a
 * coach renders and logs offline without the coach's own rows.
 */
import type { MealSlot } from "./nutrition";

export type PlanMacros = {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

/**
 * What to send to log an item: the body of one `/nutrition/entries/batch`
 * entry, minus slot, time and key. The owner logs by reference; a client
 * logs a one-off with the item's macros (they can't reference the coach's
 * private rows).
 */
export type PlanLogEntryHint =
  | { foodId: string; servings: number }
  | { recipeId: string; servings: number }
  | { mealId: string; servings: number }
  | ({ customName: string; servings: number } & PlanMacros);

export type PlanItemKind = "food" | "recipe" | "meal" | "custom";

export type PlanItem = PlanMacros & {
  /** Server uuid, or `local-…` for an item added on the phone. */
  id: string;
  kind: PlanItemKind;
  foodId: string | null;
  recipeId: string | null;
  mealId: string | null;
  name: string;
  servings: number;
  sortOrder: number;
  food: {
    name: string;
    brand: string | null;
    servingSize: number;
    servingUnit: string;
    perServing: PlanMacros;
  } | null;
  recipe: {
    name: string;
    photoUrl: string | null;
    servings: number;
    instructions: string | null;
    perServing: PlanMacros;
    ingredients: { name: string; quantity: number; unit: string }[];
    sharedByUserId: string | null;
  } | null;
  meal: {
    name: string;
    photoUrl: string | null;
    perServing: PlanMacros;
  } | null;
  custom: ({ name: string } & PlanMacros) | null;
  logEntry: PlanLogEntryHint;
};

export type PlanMeal = {
  id: string;
  name: string;
  logSlot: MealSlot;
  sortOrder: number;
  totals: PlanMacros;
  items: PlanItem[];
};

export type NutritionPlan = {
  /** Server uuid, or `local-…` for a plan created offline. */
  id: string;
  ownerId: string;
  name: string;
  notes: string | null;
  source: string;
  sourcePlanId: string | null;
  revision: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  totals: PlanMacros;
  meals: PlanMeal[];
};

export type PlanAssignmentStatus = "sent" | "added" | "dismissed" | "removed";

export type PlanCoach = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

export type PlanFromCoach = {
  plan: NutritionPlan;
  coach: PlanCoach;
  assignmentId: string;
  note: string | null;
  status: PlanAssignmentStatus;
  sentAt: string;
  addedAt: string | null;
  /** The coach edited the plan since the person last opened it. */
  updatedSinceSeen: boolean;
};

/** `GET /nutrition/meal-plans?since=` → `data`. */
export type NutritionPlansResponse = {
  mine: NutritionPlan[];
  fromCoaches: PlanFromCoach[];
  deletedIds: string[];
  asOf: string;
};

/** The phone's copy of the person's plans (one row per user). */
export type NutritionPlansCache = {
  mine: NutritionPlan[];
  fromCoaches: PlanFromCoach[];
  /** The last full or delta read's `asOf`; null until read once. */
  asOf: string | null;
  /**
   * Plans whose queued edit lost a revision race (409): the server's copy
   * was kept. The Plan screen says so once, then forgets.
   */
  conflictPlanIds: string[];
  /**
   * `local-…` → server id for plans created or duplicated on this phone that
   * have synced. A screen opened before the sync still holds the local id;
   * every lookup and write follows this (Inspector Brad, #554).
   */
  aliases?: Record<string, string>;
  /**
   * The last read's `deletedIds`: a plan the server says is gone stays out of
   * `mine` even while an edit for it is queued (that edit then fails with a
   * 404). Inspector Brad, #554.
   */
  serverDeletedIds?: string[];
  /**
   * Revisions this phone's own writes produced, per plan. A draft opened
   * before its own earlier edit synced may be rebased past these, but never
   * past a revision made on another device (Inspector Brad, #554).
   */
  ownRevisions?: Record<string, number[]>;
};

/** One body for `POST` / `PUT /nutrition/meal-plans`. */
export type PlanItemInput = {
  foodId?: string;
  recipeId?: string;
  mealId?: string;
  custom?: { name: string } & PlanMacros;
  servings: number;
  sortOrder: number;
};

export type PlanMealInput = {
  name: string;
  logSlot: MealSlot;
  sortOrder: number;
  items: PlanItemInput[];
};

export type PlanInput = {
  name: string;
  notes?: string | null;
  meals: PlanMealInput[];
};

/** Shopping list across every added plan (`GET /nutrition/shopping-list`). */
export type PlansShoppingItem = { id: string; name: string; quantity: string };
export type PlansShoppingAisle = { aisle: string; items: PlansShoppingItem[] };
export type PlansShoppingPlanRef = {
  nutritionPlanId: string | null;
  mealPlanId: string | null;
  addedAt: string;
};
export type PlansShoppingList = {
  aisles: PlansShoppingAisle[];
  totalItems: number;
  plans: PlansShoppingPlanRef[];
  asOf: string;
};

/** The phone's copy of the shopping list, with ticks that never leave it. */
export type PlansShoppingCache = {
  list: PlansShoppingList | null;
  /** Item ids ticked on this phone (N23: ticks stay on the phone). */
  ticked: string[];
};

/** The server's caps (`MAX_PLAN_MEALS`, `MAX_ITEMS_PER_MEAL`). */
export const PLAN_MEALS_MAX = 20;
export const PLAN_ITEMS_PER_MEAL_MAX = 50;
export const PLAN_ITEM_SERVINGS_MAX = 100;
export const PLAN_NAME_MAX = 200;
export const PLAN_MEAL_NAME_MAX = 40;

export function emptyPlansCache(): NutritionPlansCache {
  return { mine: [], fromCoaches: [], asOf: null, conflictPlanIds: [] };
}
