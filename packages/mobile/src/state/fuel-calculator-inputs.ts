import AsyncStorage from "@react-native-async-storage/async-storage";
import type { NutritionTarget } from "@/domain/models/nutrition";
import {
  ACTIVITY_LEVELS,
  type ActivityLevel,
  type CalorieMode,
  type MacroPresetMode,
  type MacroSplit,
} from "@/domain/services/nutrition.service";

/**
 * The Fuel Targets calculator's own inputs (PER-97). `nutrition_targets` keeps
 * only the RESULT (kcal, grams, water, preset), so without this the editor
 * reopened on default activity / goal / split every time. Sex, age, height and
 * weight already come from the profile and the latest weigh-in.
 *
 * Saved per account on this device when the athlete saves their targets, and
 * read back when the editor opens. Best effort: a missing or corrupt record
 * means the editor falls back to the saved target's preset, then defaults.
 */
export type FuelCalculatorInputs = {
  activityId: ActivityLevel["id"];
  /** Cut ↔ bulk slider position, in [-1, 1]. */
  goal: number;
  calorieMode: CalorieMode;
  manualKcalText: string;
  macroMode: MacroPresetMode;
  customSplit: MacroSplit;
};

const PREFIX = "persistence.fuel.calculator.v1";
const key = (userId: string) => `${PREFIX}:${userId}`;

const MACRO_MODES: readonly MacroPresetMode[] = [
  "recommended",
  "high_protein",
  "balanced",
  "low_carb",
  "custom",
];

const isPct = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100;

export function isMacroPresetMode(value: unknown): value is MacroPresetMode {
  return MACRO_MODES.includes(value as MacroPresetMode);
}

/** Validate a stored record; undefined when any field is unusable. */
export function readFuelCalculatorInputs(
  value: unknown,
): FuelCalculatorInputs | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Partial<FuelCalculatorInputs>;
  const split = v.customSplit;
  if (
    !ACTIVITY_LEVELS.some((a) => a.id === v.activityId) ||
    typeof v.goal !== "number" ||
    !Number.isFinite(v.goal) ||
    Math.abs(v.goal) > 1 ||
    (v.calorieMode !== "calculated" && v.calorieMode !== "manual") ||
    typeof v.manualKcalText !== "string" ||
    !isMacroPresetMode(v.macroMode) ||
    typeof split !== "object" ||
    split === null ||
    !isPct(split.proteinPct) ||
    !isPct(split.carbsPct) ||
    !isPct(split.fatPct)
  )
    return undefined;
  return {
    activityId: v.activityId as ActivityLevel["id"],
    goal: v.goal,
    calorieMode: v.calorieMode,
    manualKcalText: v.manualKcalText,
    macroMode: v.macroMode,
    customSplit: {
      proteinPct: split.proteinPct,
      carbsPct: split.carbsPct,
      fatPct: split.fatPct,
    },
  };
}

/**
 * The macro split a saved target implies, for when no device record exists:
 * its preset, and for "custom" the percentages back-derived from its grams
 * (4/4/9 kcal per gram, fat taking the rounding remainder so they sum to 100).
 * Null when the target is absent or its preset/grams can't be read.
 */
export function macroInputsFromTarget(
  target: Pick<
    NutritionTarget,
    "dailyKcal" | "proteinG" | "carbsG" | "fatG" | "preset"
  > | null,
): { macroMode: MacroPresetMode; customSplit?: MacroSplit } | null {
  if (!target || !isMacroPresetMode(target.preset)) return null;
  if (target.preset !== "custom") return { macroMode: target.preset };
  if (!(target.dailyKcal > 0)) return null;
  const proteinPct = Math.round(
    ((target.proteinG * 4) / target.dailyKcal) * 100,
  );
  const carbsPct = Math.round(((target.carbsG * 4) / target.dailyKcal) * 100);
  const fatPct = 100 - proteinPct - carbsPct;
  if (!isPct(proteinPct) || !isPct(carbsPct) || !isPct(fatPct)) return null;
  return { macroMode: "custom", customSplit: { proteinPct, carbsPct, fatPct } };
}

export async function loadFuelCalculatorInputs(
  userId: string,
): Promise<FuelCalculatorInputs | undefined> {
  try {
    const raw = await AsyncStorage.getItem(key(userId));
    return readFuelCalculatorInputs(raw ? JSON.parse(raw) : null);
  } catch {
    return undefined;
  }
}

export async function saveFuelCalculatorInputs(
  userId: string,
  inputs: FuelCalculatorInputs,
): Promise<void> {
  try {
    await AsyncStorage.setItem(key(userId), JSON.stringify(inputs));
  } catch {
    // Best effort: the targets themselves are already saved.
  }
}
