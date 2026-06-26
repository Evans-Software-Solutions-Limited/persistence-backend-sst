/**
 * Pure nutrition (Fuel) domain service — M9.
 *
 * No framework imports, no I/O, fully unit-testable without mocks. Covers:
 *  - consumed / remaining aggregation (Fuel ring + macro lines);
 *  - macro scaling for optimistic offline entry creation;
 *  - the Mifflin-St Jeor TDEE calculator powering the Targets editor
 *    (ported 1:1 from the design-source prototype `fuel-targets.jsx`);
 *  - the daily goal-hit band detector for the immediate in-app reward.
 *
 * Spec: specs/13-nutrition-tracking/design.md § Streak engine integration
 *       specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § Domain service
 */
import type {
  Consumed,
  Food,
  FuelToday,
  MealSlot,
  NutritionEntry,
  NutritionTarget,
  Recipe,
} from "@/domain/models/nutrition";

export type MacroSum = {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

/** Sum the macros of a day's logged entries (water tracked separately). */
export function computeConsumed(entries: readonly NutritionEntry[]): MacroSum {
  return entries.reduce<MacroSum>(
    (acc, e) => ({
      kcal: acc.kcal + e.kcal,
      proteinG: acc.proteinG + e.proteinG,
      carbsG: acc.carbsG + e.carbsG,
      fatG: acc.fatG + e.fatG,
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
}

/** Remaining kcal for the day — 0 when no target is set (mirrors the backend). */
export function computeRemaining(
  target: NutritionTarget | null,
  consumed: Pick<Consumed, "kcal">,
): number {
  if (!target) return 0;
  return target.dailyKcal - consumed.kcal;
}

/** Group entries into the four meal slots (stable, all slots present). */
export function groupBySlot(
  entries: readonly NutritionEntry[],
): Record<MealSlot, NutritionEntry[]> {
  const bySlot: Record<MealSlot, NutritionEntry[]> = {
    breakfast: [],
    lunch: [],
    snack: [],
    dinner: [],
  };
  for (const e of entries) bySlot[e.mealSlot].push(e);
  return bySlot;
}

/**
 * Per-serving food macros × servings. Used for optimistic entry creation
 * offline (the server re-derives the authoritative value on flush). Rounds to
 * whole numbers to match the screen's display + the server's integer-ish math.
 */
export function scaleFoodMacros(food: Food, servings: number): MacroSum {
  return {
    kcal: Math.round(food.kcal * servings),
    proteinG: Math.round(food.proteinG * servings),
    carbsG: Math.round(food.carbsG * servings),
    fatG: Math.round(food.fatG * servings),
  };
}

/**
 * Recipe macros scaled to `servings`. Recipe `total_*` are the totals for the
 * recipe's own `servings`, so one logged serving = total / recipe.servings.
 * Guards a zero/absent recipe yield (→ 0 macros rather than NaN).
 */
export function scaleRecipeMacros(recipe: Recipe, servings: number): MacroSum {
  const per = recipe.servings > 0 ? servings / recipe.servings : 0;
  return {
    kcal: Math.round((recipe.totalKcal ?? 0) * per),
    proteinG: Math.round((recipe.totalProteinG ?? 0) * per),
    carbsG: Math.round((recipe.totalCarbsG ?? 0) * per),
    fatG: Math.round((recipe.totalFatG ?? 0) * per),
  };
}

/** Flatten a day aggregate's slot buckets back into one entry list. */
export function flattenFuelEntries(fuel: FuelToday): NutritionEntry[] {
  return [
    ...fuel.entriesBySlot.breakfast,
    ...fuel.entriesBySlot.lunch,
    ...fuel.entriesBySlot.snack,
    ...fuel.entriesBySlot.dinner,
  ];
}

/**
 * Recompute a day aggregate from a (mutated) flat entry list — the client-side
 * recompute that lets an optimistic log/edit/delete update the Fuel ring with
 * no round-trip (FRONTEND_BRIEF § SQLite cache). Preserves date, targets, and
 * water (entries don't carry water); recomputes macros, remaining, and slots.
 */
export function recomputeFuelToday(
  fuel: FuelToday,
  entries: readonly NutritionEntry[],
): FuelToday {
  const macro = computeConsumed(entries);
  return {
    ...fuel,
    consumed: { ...macro, waterCups: fuel.consumed.waterCups },
    remainingKcal: computeRemaining(fuel.targets, macro),
    entriesBySlot: groupBySlot(entries),
  };
}

/** Apply an optimistic water set to a day aggregate (absolute cups, LWW). */
export function setFuelWater(fuel: FuelToday, cups: number): FuelToday {
  return {
    ...fuel,
    consumed: { ...fuel.consumed, waterCups: Math.max(0, Math.trunc(cups)) },
  };
}

/** Apply an optimistic target change to a day aggregate (recomputes remaining). */
export function setFuelTargets(
  fuel: FuelToday,
  target: NutritionTarget,
): FuelToday {
  return {
    ...fuel,
    targets: target,
    remainingKcal: computeRemaining(target, fuel.consumed),
  };
}

// ── TDEE calculator (ported 1:1 from `fuel-targets.jsx`) ─────────────────────

export type Sex = "male" | "female";

export type TdeeProfile = {
  sex: Sex | null;
  /** Years. */
  age: number | null;
  heightCm: number | null;
  weightKg: number | null;
};

export type ActivityLevel = {
  id: "sedentary" | "light" | "moderate" | "very" | "athlete";
  label: string;
  /** TDEE multiplier applied to BMR. */
  mult: number;
  sub: string;
};

/** The five activity levels + multipliers from the prototype. */
export const ACTIVITY_LEVELS: readonly ActivityLevel[] = [
  { id: "sedentary", label: "Sedentary", mult: 1.2, sub: "Desk job" },
  { id: "light", label: "Light", mult: 1.375, sub: "1–3 / wk" },
  { id: "moderate", label: "Moderate", mult: 1.55, sub: "3–5 / wk" },
  { id: "very", label: "Very", mult: 1.725, sub: "6+ / wk" },
  { id: "athlete", label: "Athlete", mult: 1.9, sub: "Daily +" },
];

export const DEFAULT_ACTIVITY_ID: ActivityLevel["id"] = "moderate";

export function activityMultiplier(id: ActivityLevel["id"]): number {
  return ACTIVITY_LEVELS.find((a) => a.id === id)?.mult ?? 1.55;
}

/**
 * Mifflin-St Jeor BMR. Returns null when any input is missing/non-finite so
 * the Targets editor can prompt the user to complete their profile rather than
 * render a NaN target.
 */
export function bmrMifflinStJeor(profile: TdeeProfile): number | null {
  const { sex, age, heightCm, weightKg } = profile;
  if (
    sex === null ||
    age === null ||
    heightCm === null ||
    weightKg === null ||
    !Number.isFinite(age) ||
    !Number.isFinite(heightCm) ||
    !Number.isFinite(weightKg)
  ) {
    return null;
  }
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === "female" ? base - 161 : base + 5;
}

/** TDEE = BMR × activity multiplier. Null-propagating. */
export function tdee(bmr: number | null, multiplier: number): number | null {
  if (bmr === null) return null;
  return bmr * multiplier;
}

/**
 * Goal-slider → kcal delta fraction. `goal` ∈ [-1, 1] (cut ↔ bulk). Surplus
 * side scales gentler than the deficit side, exactly as the prototype.
 */
export function goalDelta(goal: number): number {
  return goal >= 0 ? goal * 0.2 : goal * 0.25;
}

/** Goal-adjusted daily kcal, rounded to the nearest 10 (prototype parity). */
export function goalAdjustedKcal(
  tdeeValue: number | null,
  goal: number,
): number | null {
  if (tdeeValue === null) return null;
  return Math.round((tdeeValue * (1 + goalDelta(goal))) / 10) * 10;
}

export type MacroSplit = {
  /** [protein%, carbs%, fat%] — sums to ~100. */
  proteinPct: number;
  carbsPct: number;
  fatPct: number;
};

/** Recommended P/C/F split for a goal-slider value (prototype parity). */
export function recommendedSplit(goal: number): MacroSplit {
  if (goal <= -0.5) return { proteinPct: 40, carbsPct: 35, fatPct: 25 };
  if (goal < 0) return { proteinPct: 35, carbsPct: 40, fatPct: 25 };
  if (goal < 0.5) return { proteinPct: 30, carbsPct: 45, fatPct: 25 };
  return { proteinPct: 25, carbsPct: 50, fatPct: 25 };
}

/**
 * Convert a kcal target + macro split into gram targets. Protein/carbs at
 * 4 kcal/g, fat at 9 kcal/g (prototype parity, rounded).
 */
export function macrosFromKcal(
  kcal: number,
  split: MacroSplit,
): { proteinG: number; carbsG: number; fatG: number } {
  return {
    proteinG: Math.round((kcal * (split.proteinPct / 100)) / 4),
    carbsG: Math.round((kcal * (split.carbsPct / 100)) / 4),
    fatG: Math.round((kcal * (split.fatPct / 100)) / 9),
  };
}

export type GoalTone = "ember" | "primary" | "success" | "gold";
export type GoalLabel = { name: string; sub: string; tone: GoalTone };

/** Human label + tone for a goal-slider value (prototype parity). */
export function goalLabel(goal: number): GoalLabel {
  if (goal <= -0.75)
    return { name: "Aggressive cut", sub: "~1 kg/wk loss", tone: "ember" };
  if (goal <= -0.25)
    return { name: "Cut", sub: "~0.5 kg/wk loss", tone: "primary" };
  if (goal < 0.25)
    return { name: "Maintain", sub: "Hold weight", tone: "success" };
  if (goal <= 0.75)
    return { name: "Lean bulk", sub: "~0.25 kg/wk gain", tone: "gold" };
  return { name: "Aggressive bulk", sub: "~0.5 kg/wk gain", tone: "gold" };
}

// ── Daily goal-hit detection (immediate in-app reward) ───────────────────────

/** True when `value` is within ±`tol` (fraction) of `target` (target > 0). */
export function withinBand(value: number, target: number, tol = 0.1): boolean {
  if (target <= 0) return false;
  const lo = target * (1 - tol);
  const hi = target * (1 + tol);
  return value >= lo && value <= hi;
}

export type GoalHit = {
  kcal: boolean;
  protein: boolean;
  carbs: boolean;
  fat: boolean;
  /** All four within band — the strongest celebration trigger. */
  all: boolean;
};

/**
 * Per-metric goal-hit verdict for the day. Powers the optimistic celebration
 * the moment a just-logged entry brings the total into the target band — the
 * durable streak is still the cron's job (FRONTEND_BRIEF § Immediate reward).
 */
export function detectDailyGoalHit(
  consumed: Pick<Consumed, "kcal" | "proteinG" | "carbsG" | "fatG">,
  target: NutritionTarget | null,
  tol = 0.1,
): GoalHit {
  if (!target) {
    return {
      kcal: false,
      protein: false,
      carbs: false,
      fat: false,
      all: false,
    };
  }
  const kcal = withinBand(consumed.kcal, target.dailyKcal, tol);
  const protein = withinBand(consumed.proteinG, target.proteinG, tol);
  const carbs = withinBand(consumed.carbsG, target.carbsG, tol);
  const fat = withinBand(consumed.fatG, target.fatG, tol);
  return { kcal, protein, carbs, fat, all: kcal && protein && carbs && fat };
}

// ── Fuel-screen view-model helpers (pure) ────────────────────────────────────

/** The four meal slots, in render order, with display labels. */
export const MEAL_SLOTS: readonly { slot: MealSlot; label: string }[] = [
  { slot: "breakfast", label: "Breakfast" },
  { slot: "lunch", label: "Lunch" },
  { slot: "snack", label: "Snack" },
  { slot: "dinner", label: "Dinner" },
];

/**
 * Hero-ring fill fraction: CONSUMED toward target (0..1, clamped). The ring
 * fills as the user eats toward their goal; the centre shows REMAINING. No
 * target (or non-positive) → 0 so the ring renders empty rather than NaN.
 */
export function heroRingPct(
  target: NutritionTarget | null,
  consumed: Pick<Consumed, "kcal">,
): number {
  if (!target || target.dailyKcal <= 0) return 0;
  return Math.min(1, Math.max(0, consumed.kcal / target.dailyKcal));
}

/** Per-macro fill fraction (consumed/target, clamped 0..1). */
export function macroPct(value: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(1, Math.max(0, value / target));
}

/**
 * Name lookups the container builds from the local caches (foods/recipes/meals)
 * so the meal-log rows render a label — the backend `/nutrition/today` aggregate
 * returns bare entries with no denormalised name (see FRONTEND_BRIEF contract
 * note). Each resolver returns `undefined` on a miss.
 */
export type EntryNameLookups = {
  food: (id: string) => string | undefined;
  recipe: (id: string) => string | undefined;
  meal: (id: string) => string | undefined;
};

/**
 * Resolve a human label for a logged entry from the local name caches, with a
 * graceful fallback chain: referenced item name → typed fallback when the ref
 * isn't cached → "Quick entry" for a macro-only one-off. Pure.
 */
export function entryDisplayLabel(
  entry: Pick<NutritionEntry, "foodId" | "recipeId" | "mealId">,
  lookups: EntryNameLookups,
): string {
  if (entry.foodId) return lookups.food(entry.foodId) ?? "Logged food";
  if (entry.recipeId) return lookups.recipe(entry.recipeId) ?? "Recipe";
  if (entry.mealId) return lookups.meal(entry.mealId) ?? "Meal";
  return "Quick entry";
}

// ── Portion picker (Scan/Quick-add sheets, fuel-sheets.jsx PortionStepper) ───

/** Portion entry mode in the Scan sheet (fuel-sheets.jsx ScanSheet). */
export type PortionMode = "serving" | "grams" | "cups";

/** 1 cup ≈ 245 g (the prototype's cup→gram reference). */
export const GRAMS_PER_CUP = 245;

/**
 * Convert a portion (mode + value) into a multiple of the food's serving — the
 * value `scaleFoodMacros` / the logged `servings` expects. A food's per-serving
 * macros cover `food.servingSize` grams, so:
 *   serving → value (servings directly)
 *   grams   → grams / servingSize
 *   cups    → (cups × 245) / servingSize
 * Guards a zero/absent serving size (→ the raw value) so macros never go NaN.
 */
export function portionToServings(
  food: Pick<Food, "servingSize">,
  mode: PortionMode,
  value: number,
): number {
  if (mode === "serving") return value;
  const size = food.servingSize > 0 ? food.servingSize : 1;
  const grams = mode === "cups" ? value * GRAMS_PER_CUP : value;
  return grams / size;
}
