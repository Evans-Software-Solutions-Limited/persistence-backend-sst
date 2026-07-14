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
  AiFoodItem,
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

/**
 * Biological-sex input for the Mifflin-St Jeor BMR. `male`/`female` are the
 * equation's two coefficient sets; `other` (a user who declines the binary)
 * uses the midpoint constant so the calculator works for everyone — see
 * {@link bmrMifflinStJeor}. NULL (never set) is handled by the caller, which
 * prompts the user rather than guessing.
 */
export type Sex = "male" | "female" | "other";

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
  // Mifflin-St Jeor sex constant: male +5, female -161. `other` uses the
  // midpoint (-78) — a documented neutral baseline so users who decline the
  // binary still get a usable target rather than being blocked or defaulted to
  // one sex. (-78 = (5 + -161) / 2.)
  const sexConstant = sex === "female" ? -161 : sex === "other" ? -78 : 5;
  return base + sexConstant;
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

// ── Macro-editor preset resolution ─────────────────────────────────────────
//
// Prototype parity (`fuel-targets.jsx`'s `MacroEditor`): 5 chips —
// Recommended/High protein/Balanced/Low carb/Custom. "Recommended" is
// dynamic (tracks the goal slider via {@link recommendedSplit}); the other 3
// are fixed ratios. Revised 2026-07-01: an earlier pass replaced this with a
// goal-slider-shaped 4-preset set (Maintain/Cut/Bulk/Custom) per a read of
// `design.md § Risks` — on review that reading conflated two independent
// prototype controls: the goal slider (cut↔bulk, calorie deficit/surplus,
// labelled via {@link goalLabel}) and the macro-balance chips (protein/carb/
// fat RATIO, independent of the goal slider). `design.md § Risks`'s "no
// auto-rebalance" directive is about slider-DRAG behaviour within Custom
// mode, not preset naming/count — it still applies: dragging a slider in
// Custom mode only moves that one macro, no proportional rebalancing of the
// others, and the sum-≠-100% warning chip still gates Save. Restored to the
// prototype's 5-chip set per explicit user correction.

export type MacroPresetMode =
  | "recommended"
  | "high_protein"
  | "balanced"
  | "low_carb"
  | "custom";

type FixedMacroPreset = {
  id: Exclude<MacroPresetMode, "custom" | "recommended">;
  label: string;
  split: MacroSplit;
};

/** The 3 fixed preset shortcuts (prototype parity). Goal-independent — they
 * set a macro RATIO, not a calorie target (that's the separate goal slider).
 * "Recommended" isn't listed here since its split is dynamic — see
 * {@link presetSplit}. */
export const MACRO_PRESETS: readonly FixedMacroPreset[] = [
  {
    id: "high_protein",
    label: "High protein",
    split: { proteinPct: 40, carbsPct: 30, fatPct: 30 },
  },
  {
    id: "balanced",
    label: "Balanced",
    split: { proteinPct: 30, carbsPct: 40, fatPct: 30 },
  },
  {
    id: "low_carb",
    label: "Low carb",
    split: { proteinPct: 35, carbsPct: 20, fatPct: 45 },
  },
];

/**
 * Resolve a non-'custom' macro mode's percentage split. "Recommended"
 * depends on the current goal-slider value (prototype parity); the other 3
 * fixed presets ignore `goal` entirely.
 */
export function presetSplit(
  mode: Exclude<MacroPresetMode, "custom">,
  goal: number,
): MacroSplit {
  if (mode === "recommended") return recommendedSplit(goal);
  return (
    MACRO_PRESETS.find((p) => p.id === mode)?.split ?? recommendedSplit(goal)
  );
}

/**
 * True when the three percentages sum to exactly 100. The 3 fixed presets
 * always do (by construction); only 'custom' mode's independently-dragged
 * sliders can drift — this is the single source of truth for the "sum ≠
 * 100%" warning chip (design.md § Risks) and for gating Save.
 */
export function macroSplitSumsTo100(split: MacroSplit): boolean {
  return split.proteinPct + split.carbsPct + split.fatPct === 100;
}

// ── Fuel Targets editor: single derived-preview computation ────────────────

export type FuelTargetsPreview = {
  bmr: number | null;
  tdee: number | null;
  /** Goal-adjusted daily kcal, rounded to the nearest 10. Null when the
   * profile is incomplete (missing sex/age/height/weight). */
  kcal: number | null;
  goalLabel: GoalLabel;
  macroSplit: MacroSplit;
  macroGrams: { proteinG: number; carbsG: number; fatG: number } | null;
};

/**
 * The Targets editor's entire live-preview computation, as one pure
 * function of its inputs — the container calls this on every slider/chip
 * change (via `useMemo`) rather than re-deriving bmr/tdee/kcal/macros
 * piecemeal, so the whole preview is independently unit-testable without
 * mounting React.
 */
export function computeFuelTargetsPreview(
  profile: TdeeProfile,
  activityId: ActivityLevel["id"],
  goal: number,
  macroMode: MacroPresetMode,
  customSplit: MacroSplit,
): FuelTargetsPreview {
  const bmr = bmrMifflinStJeor(profile);
  const tdeeValue = tdee(bmr, activityMultiplier(activityId));
  const kcal = goalAdjustedKcal(tdeeValue, goal);
  const macroSplit =
    macroMode === "custom" ? customSplit : presetSplit(macroMode, goal);
  const macroGrams = kcal === null ? null : macrosFromKcal(kcal, macroSplit);
  return {
    bmr,
    tdee: tdeeValue,
    kcal,
    goalLabel: goalLabel(goal),
    macroSplit,
    macroGrams,
  };
}

// ── Fuel Targets editor: manual calorie mode ────────────────────────────────

/**
 * How the daily-kcal target is sourced in the Targets editor: derived from
 * the TDEE calculator ("calculated") or typed directly by the user
 * ("manual"). Manual mode exists for users who already know their number
 * (from a coach, another app, or preference) and for profiles too incomplete
 * for Mifflin-St Jeor — the macro split applies identically in both modes.
 */
export type CalorieMode = "calculated" | "manual";

/** Sanity bounds for a manually-entered daily kcal target. */
export const MANUAL_KCAL_MIN = 500;
export const MANUAL_KCAL_MAX = 10000;

export function manualKcalInRange(kcal: number | null): kcal is number {
  return kcal !== null && kcal >= MANUAL_KCAL_MIN && kcal <= MANUAL_KCAL_MAX;
}

/**
 * Manual-mode counterpart to `computeFuelTargetsPreview`: the user's typed
 * kcal replaces the TDEE-derived number (bmr/tdee stay null — nothing was
 * calculated), while the macro split works exactly as in calculated mode.
 * An out-of-range/absent kcal yields `kcal: null`, which the presenter
 * already treats as "can't save" — same contract as an incomplete profile.
 */
export function computeManualFuelTargetsPreview(
  manualKcal: number | null,
  goal: number,
  macroMode: MacroPresetMode,
  customSplit: MacroSplit,
): FuelTargetsPreview {
  const kcal = manualKcalInRange(manualKcal) ? Math.round(manualKcal) : null;
  const macroSplit =
    macroMode === "custom" ? customSplit : presetSplit(macroMode, goal);
  const macroGrams = kcal === null ? null : macrosFromKcal(kcal, macroSplit);
  return {
    bmr: null,
    tdee: null,
    kcal,
    goalLabel: goalLabel(goal),
    macroSplit,
    macroGrams,
  };
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
  entry: Pick<NutritionEntry, "foodId" | "recipeId" | "mealId" | "customName">,
  lookups: EntryNameLookups,
): string {
  if (entry.foodId) return lookups.food(entry.foodId) ?? "Logged food";
  if (entry.recipeId) return lookups.recipe(entry.recipeId) ?? "Recipe";
  if (entry.mealId) return lookups.meal(entry.mealId) ?? "Meal";
  // One-off / AI entry: the persisted label (e.g. the AI's item name) beats the
  // generic "Quick entry" fallback.
  const custom = entry.customName?.trim();
  return custom && custom.length > 0 ? custom : "Quick entry";
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
 *   serving → value × (realServing / servingSize)
 *   grams   → grams / servingSize
 *   cups    → (cups × 245) / servingSize
 * where `realServing` = `servingQuantity` (the pack serving OFF reports, e.g.
 * 220 g) when present, else `servingSize` itself. So for an OFF food (macros
 * per-100 g, servingQuantity 220) one "Serving" is 220 g = 2.2 × the per-100 g
 * macros — not a flat 100 g. When `servingQuantity` is null (custom foods, or a
 * pre-`serving_quantity` seeded row) the serving falls back to `servingSize`,
 * i.e. the pre-existing behaviour (value servings directly).
 * When `servingSize` is missing/0 (permitted by the model; common in raw OFF
 * data) grams/cups fall back to a **100 g basis** — i.e. the macros are treated
 * as per-100 g (OFF's default reference) rather than per-1 g, which would
 * otherwise over-count by ~100×.
 */
export function portionToServings(
  food: Pick<Food, "servingSize" | "servingQuantity">,
  mode: PortionMode,
  value: number,
): number {
  const size = food.servingSize > 0 ? food.servingSize : 100;
  if (mode === "serving") {
    const realServing =
      food.servingQuantity && food.servingQuantity > 0
        ? food.servingQuantity
        : size;
    return (value * realServing) / size;
  }
  const grams = mode === "cups" ? value * GRAMS_PER_CUP : value;
  return grams / size;
}

// ── AI estimate item rescaling (Snap / free-text draft card) ────────────────

/**
 * Rescale an AI-recognised item's kcal/macros when the user edits its serving
 * grams in the confirm draft card (specs/13-nutrition-tracking/design.md
 * § Revised 2026-07-03 › Mobile flow: "serving edits recompute totals").
 * Linear scale by the grams ratio — the model's own numbers are the only
 * source of truth (no automated foods-table grounding, eval-locked), so
 * there's no per-gram reference to re-derive from; we simply scale the whole
 * item proportionally. Guards a zero/absent original gram figure (→ item
 * unchanged except the new gram figure, avoiding a divide-by-zero blowup).
 */
export function rescaleAiFoodItem(
  item: AiFoodItem,
  newGrams: number,
): AiFoodItem {
  if (item.estimatedGrams <= 0 || newGrams < 0) {
    return { ...item, estimatedGrams: Math.max(0, newGrams) };
  }
  const ratio = newGrams / item.estimatedGrams;
  return {
    ...item,
    estimatedGrams: newGrams,
    quantity: +(item.quantity * ratio).toFixed(2),
    kcal: Math.round(item.kcal * ratio),
    proteinG: Math.round(item.proteinG * ratio),
    carbsG: Math.round(item.carbsG * ratio),
    fatG: Math.round(item.fatG * ratio),
  };
}

/** Sum kcal across the KEPT (`on: true`) items in an AI draft-card list. */
export function sumKeptAiItemsKcal(
  items: readonly { kcal: number; on: boolean }[],
): number {
  return items.filter((i) => i.on).reduce((sum, i) => sum + i.kcal, 0);
}

// ── Recipes & Meals library (M9 PR1 — no-AI slice) ──────────────────────────

/**
 * The meal slot a fresh "Log to today" action should default to, keyed off
 * the local wall-clock hour (prototype parity — recipes.jsx has no slot
 * picker on the detail screen's Log button, so it needs a sensible implicit
 * default). Boundaries: breakfast < 11:00, lunch < 15:00, snack < 17:00,
 * else dinner.
 */
export function defaultMealSlot(date: Date): MealSlot {
  const hour = date.getHours();
  if (hour < 11) return "breakfast";
  if (hour < 15) return "lunch";
  if (hour < 17) return "snack";
  return "dinner";
}

// ── Recipes AI (PR3) — create-form live macro total ─────────────────────────

/** A create-recipe form ingredient row, as far as the macro total cares. */
export type RecipeDraftIngredientRow = {
  foodId: string | null;
  /** Absolute amount in the row's own unit (grams, ml, …); null = unset. */
  quantity: number | null;
};

/**
 * Client-side live macro total for the create-recipe form (`recipe-create`
 * route): sum of each LINKED row's food macros × quantity/servingSize.
 * Unlinked rows (no `foodId`) and rows with a null/non-positive quantity
 * contribute 0 — the presenter renders a "no macros — link a food" hint for
 * those rather than silently omitting them from the total.
 *
 * This REPLACES the prototype's fictional "auto-estimate macros" AI toggle:
 * there's no such backend capability — a recipe's macros are always derived
 * from its linked foods, exactly like `createRecipeCommand`'s optimistic
 * totals and the server's own materialisation on `POST /recipes`. Pure; no
 * rounding until the final sum (avoids compounding per-row rounding error).
 */
export function computeRecipeDraftMacros(
  rows: readonly RecipeDraftIngredientRow[],
  getFood: (foodId: string) => Food | null | undefined,
): MacroSum {
  const raw = rows.reduce<MacroSum>(
    (acc, row) => {
      if (!row.foodId || row.quantity === null || row.quantity <= 0) {
        return acc;
      }
      const food = getFood(row.foodId);
      if (!food) return acc;
      const size = food.servingSize > 0 ? food.servingSize : 100;
      const factor = row.quantity / size;
      return {
        kcal: acc.kcal + food.kcal * factor,
        proteinG: acc.proteinG + food.proteinG * factor,
        carbsG: acc.carbsG + food.carbsG * factor,
        fatG: acc.fatG + food.fatG * factor,
      };
    },
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
  return {
    kcal: Math.round(raw.kcal),
    proteinG: Math.round(raw.proteinG),
    carbsG: Math.round(raw.carbsG),
    fatG: Math.round(raw.fatG),
  };
}
