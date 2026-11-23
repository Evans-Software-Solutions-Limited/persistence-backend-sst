/**
 * "Your meals" (PER-132, Design D N1b) — the person's own named meals, as many
 * as they like. Each maps to one of the four old slots (`logSlot`) so 1.2.0
 * phones keep showing every entry.
 *
 * Mirrors the merged `GET/PUT /nutrition/user-meals` wire shape (PER-109).
 */
import type { MealSlot } from "./nutrition";

export type UserMeal = {
  /**
   * Server uuid; `local-…` for a meal added offline (swapped once the PUT
   * syncs); `slot:<slot>` for the synthetic defaults shown before the list has
   * ever been fetched (`isSyntheticUserMealId`), which are never sent.
   */
  id: string;
  name: string;
  logSlot: MealSlot;
  sortOrder: number;
  /** Set only on the four seeded defaults. */
  defaultKey: MealSlot | null;
  /** The phone's key for a meal it created offline. */
  clientRequestId: string | null;
  archivedAt: string | null;
  updatedAt: string;
};

/** `GET/PUT /nutrition/user-meals` → `{ data: { meals, asOf } }`. */
export type UserMealsResponse = {
  meals: UserMeal[];
  asOf: string;
};

/** One row of the `PUT /nutrition/user-meals` body. */
export type UserMealPutRow = {
  id?: string;
  clientRequestId?: string;
  name: string;
  logSlot: MealSlot;
  sortOrder: number;
};

/** The longest name the server stores (Design D: 1–40). */
export const USER_MEAL_NAME_MAX = 40;
/** The server's list cap (`MAX_USER_MEALS`). */
export const USER_MEALS_MAX = 30;
