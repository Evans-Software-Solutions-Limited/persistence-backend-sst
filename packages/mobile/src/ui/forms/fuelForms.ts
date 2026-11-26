import { Type } from "@sinclair/typebox";
import { schemaAccepts, schemaResolver, trimmed } from "@/shared/form";
import { USER_MEAL_NAME_MAX } from "@/domain/models/userMeals";
import {
  quickLogDraft,
  type QuickLogValues,
} from "@/domain/services/userMeals.service";

/**
 * Fuel forms on react-hook-form (PER-147). A meal name is 1–40 characters
 * once trimmed: the shared `USER_MEAL_LIMITS.storedNameMax`, which the server
 * enforces (400 `invalid_user_meal_name`) and `user_meals` stores. A quick
 * entry has 1–10,000 kcal and macros of 0 or more.
 */

// ─── Your meals: rename and add (N1b) ────────────────────────────────────────

export interface MealNameValues {
  name: string;
}

export const mealNameSchema = Type.Object({
  name: Type.String({
    minLength: 1,
    maxLength: USER_MEAL_NAME_MAX,
    errorMessage: "Name the meal.",
  }),
});

export const mealNameResolver = schemaResolver<MealNameValues>(mealNameSchema, {
  prepare: trimmed,
});

// ─── Quick log (N2e) and a plan's quick item ─────────────────────────────────

const macro = Type.Union([Type.Number({ minimum: 0 }), Type.Null()]);

export const quickLogSchema = Type.Object({
  name: Type.String({ maxLength: 120 }),
  kcal: Type.Number({
    exclusiveMinimum: 0,
    maximum: 10_000,
    errorMessage: "Enter the calories.",
  }),
  protein: macro,
  carbs: macro,
  fat: macro,
});

/** The typed text → numbers (comma decimals allowed), as the form checks it. */
export function prepareQuickLog(v: QuickLogValues) {
  const d = quickLogDraft(v);
  const typed = (s: string) => (s.trim() === "" ? null : d);
  return {
    name: v.name.trim(),
    kcal: d.kcal,
    protein: typed(v.protein) && d.proteinG,
    carbs: typed(v.carbs) && d.carbsG,
    fat: typed(v.fat) && d.fatG,
  };
}

export const quickLogResolver = schemaResolver<QuickLogValues>(quickLogSchema, {
  prepare: prepareQuickLog,
});

/** Log / Add is on only while the schema accepts what's typed. */
export function quickLogAccepts(v: QuickLogValues): boolean {
  return schemaAccepts(quickLogSchema, prepareQuickLog(v));
}

export const EMPTY_QUICK_LOG: QuickLogValues = {
  name: "",
  kcal: "",
  protein: "",
  carbs: "",
  fat: "",
};
