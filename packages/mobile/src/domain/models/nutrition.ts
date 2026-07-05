/**
 * Nutrition (Fuel) domain models — M9.
 *
 * Pure types, no framework imports. These mirror the merged backend wire
 * shapes EXACTLY (camelCase; macros are `number` — the backend parses the
 * Drizzle `numeric` columns to numbers at its repository boundary, see
 * BACKEND_BRIEF § numeric note). The SST adapter passes payloads through
 * without field mapping.
 *
 * Spec: specs/13-nutrition-tracking/design.md
 *       specs/milestones/M9-nutrition/{FRONTEND_BRIEF,BACKEND_BRIEF}.md
 */

export type MealSlot = "breakfast" | "lunch" | "snack" | "dinner";

/** A food in the library (OFF-seeded, OFF-resolved, or the user's own custom). */
export type Food = {
  id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  /** Per-serving macros (kcal/protein/carbs/fat for one `servingSize`). */
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  servingSize: number;
  servingUnit: string;
  /** `openfoodfacts` | `user` | `usda` | … — drives ODbL attribution on the FE. */
  source: string;
  createdBy: string | null;
};

/** A single logged food/recipe/meal/one-off entry in a meal slot. */
export type NutritionEntry = {
  id: string;
  userId: string;
  foodId: string | null;
  recipeId: string | null;
  mealId: string | null;
  mealSlot: MealSlot;
  servings: number;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** ISO timestamp. */
  loggedAt: string;
  loggedByUserId: string | null;
  aiEstimated: boolean;
  aiConfidence: number | null;
};

/** The user's daily kcal/macro/water target (one row per user). */
export type NutritionTarget = {
  userId: string;
  dailyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  waterCups: number;
  preset: string | null;
  /** Non-null when a trainer set the target on the user's behalf (M8). */
  setByUserId: string | null;
  /** Trainer display name when `setByUserId` is non-null (cross-cuts § 1.5). */
  setByName: string | null;
  updatedAt: string | null;
};

/** Water progress for a day — `PATCH /nutrition/water/today` + `GET` shape. */
export type WaterToday = {
  cups: number;
  goal: number;
};

export type RecipeIngredient = {
  id: string;
  foodId: string | null;
  customName: string | null;
  quantity: number;
  unit: string;
  sortOrder: number;
};

export type Recipe = {
  id: string;
  userId: string;
  name: string;
  photoUrl: string | null;
  servings: number;
  instructions: string | null;
  source: string;
  sourceUrl: string | null;
  /** Server-materialised from the ingredients' linked foods; null until set. */
  totalKcal: number | null;
  totalProteinG: number | null;
  totalCarbsG: number | null;
  totalFatG: number | null;
  /** Populated on detail reads; the list endpoint omits ingredients. */
  ingredients: RecipeIngredient[];
};

export type MealItem = {
  id: string;
  foodId: string | null;
  recipeId: string | null;
  servings: number;
  sortOrder: number;
};

export type Meal = {
  id: string;
  userId: string;
  name: string;
  photoUrl: string | null;
  totalKcal: number;
  totalProteinG: number;
  totalCarbsG: number;
  totalFatG: number;
  items: MealItem[];
};

/** Per-day macro sum the Fuel ring + macro lines render. */
export type Consumed = {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  waterCups: number;
};

export type EntriesBySlot = Record<MealSlot, NutritionEntry[]>;

/**
 * `GET /nutrition/today` aggregate — everything the Fuel screen needs in one
 * round-trip. Cached whole in `cached_fuel_today` keyed by `(userId, date)`.
 */
export type FuelToday = {
  /** YYYY-MM-DD (user-local). */
  date: string;
  targets: NutritionTarget | null;
  consumed: Consumed;
  remainingKcal: number;
  entriesBySlot: EntriesBySlot;
};

/**
 * Deterministic Schema.org pre-fill returned by `POST /recipes/import`
 * (Tier-A scrape — no AI, Conflict C3). Ingredients are free-text lines the
 * user maps to foods in the manual-create form.
 */
export type ImportedRecipe = {
  name: string;
  servings: number | null;
  instructions: string | null;
  ingredients: string[];
  sourceUrl: string;
};

// -- Write inputs (mirror the backend `t.Object` request bodies) --

export type LogEntryInput = {
  foodId?: string;
  recipeId?: string;
  mealId?: string;
  mealSlot: MealSlot;
  servings: number;
  /** Omitted for food/recipe/meal refs (server re-derives); required one-off. */
  kcal?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  /** ISO timestamp. */
  loggedAt: string;
};

export type EditEntryInput = {
  mealSlot?: MealSlot;
  servings?: number;
  kcal?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
};

export type SetTargetsInput = {
  dailyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  waterCups: number;
  preset?: string;
};

export type CreateFoodInput = {
  name: string;
  brand?: string;
  barcode?: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  servingSize: number;
  servingUnit: string;
};

export type RecipeIngredientInput = {
  foodId?: string;
  customName?: string;
  quantity: number;
  unit: string;
  sortOrder: number;
};

export type CreateRecipeInput = {
  name: string;
  photoUrl?: string;
  servings: number;
  instructions?: string;
  ingredients: RecipeIngredientInput[];
};

export type MealItemInput = {
  foodId?: string;
  recipeId?: string;
  servings: number;
  sortOrder: number;
};

export type CreateMealInput = {
  name: string;
  photoUrl?: string;
  items: MealItemInput[];
};

/**
 * Result of an offline-aware barcode resolve. `cache-miss-offline` is the
 * typed signal the scan sheet renders as "not in cache — connect to fetch".
 */
export type ResolveBarcodeResult =
  | { status: "found"; food: Food }
  | { status: "not-found" }
  | { status: "cache-miss-offline" }
  | { status: "service-unavailable" };

// -- M9.5 Tier B: AI photo / free-text food estimation --
//
// Mirrors the backend `AiEstimate`/`AiFoodItem` shapes EXACTLY (camelCase;
// `application/nutrition/services/aiEstimation.ts`). Online-only — these
// never enter the sync queue (design.md § Revised 2026-07-03 › Mobile flow).

/** A single recognised food item from an AI photo/text estimate. */
export type AiFoodItem = {
  name: string;
  quantity: number;
  unit: string;
  estimatedGrams: number;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** 0..1 — confidence < 0.7 renders default-unticked in the draft card. */
  confidence: number;
};

/** `POST /nutrition/ai/estimate` and `/nutrition/ai/estimate-text` response. */
export type AiEstimate = {
  foods: AiFoodItem[];
  overallConfidence: number;
  notes: string | null;
};

/** `POST /nutrition/ai/estimate` request body. */
export type EstimateFromPhotoInput = {
  imageBase64: string;
  mediaType: "image/jpeg" | "image/png";
  mealType?: MealSlot;
};

/** `POST /nutrition/ai/estimate-text` request body. */
export type EstimateFromTextInput = {
  description: string;
};
