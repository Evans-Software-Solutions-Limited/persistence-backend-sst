import type { Food, Meal, Recipe } from "@/domain/models/nutrition";

/** Shared fixtures for the PER-133 plan tests. */
export const FOOD: Food = {
  id: "f1",
  name: "Protein bar",
  brand: null,
  barcode: null,
  kcal: 198,
  proteinG: 20,
  carbsG: 20,
  fatG: 7,
  servingSize: 1,
  servingUnit: "bar",
  servingQuantity: null,
  source: "user",
  createdBy: null,
};
export const RECIPE: Recipe = {
  id: "r1",
  userId: "u",
  name: "Chicken, rice and greens bowl",
  photoUrl: null,
  servings: 2,
  instructions: null,
  source: "manual",
  sourceUrl: null,
  totalKcal: 1224,
  totalProteinG: 108,
  totalCarbsG: 148,
  totalFatG: 22,
  ingredients: [],
};
export const MEAL: Meal = {
  id: "m1",
  userId: "u",
  name: "Scrambled eggs on sourdough",
  photoUrl: null,
  totalKcal: 520,
  totalProteinG: 36,
  totalCarbsG: 48,
  totalFatG: 20,
  items: [],
};
