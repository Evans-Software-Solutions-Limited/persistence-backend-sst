import type { HabitConfigRepository } from "../../repositories/habitConfigRepository";
import type { HabitConfigView } from "../../repositories/habitConfigRepository";
import type { NutritionTargetRepository } from "../../repositories/nutritionTargetRepository";
import {
  HABIT_CATEGORIES,
  HABIT_CATEGORY_ORDER,
  resolveCalorieHabitTarget,
  type HabitCategory,
} from "../habitCategories";

export interface CategoryEntry {
  category: HabitCategory;
  enabled: boolean;
  goalId: string | null;
  assignedByCoach: boolean;
  assignedByName: string | null;
  locked: boolean;
  targetValue: number;
  unit: string;
  period: string;
  completionRule: string;
  daysPerWeek: number | null;
  tolerancePct: number | null;
  pending: HabitConfigView["pending"];
}

function defaultEntry(category: HabitCategory): CategoryEntry {
  const meta = HABIT_CATEGORIES[category];
  return {
    category,
    enabled: false,
    goalId: null,
    assignedByCoach: false,
    assignedByName: null,
    locked: false,
    targetValue: meta.target.default,
    unit: meta.unit,
    period: meta.period,
    completionRule: meta.completionRule,
    daysPerWeek: meta.daysPerWeek?.default ?? null,
    tolerancePct: meta.tolerancePct?.default ?? null,
    pending: null,
  };
}

export type HabitConfigRepositories = {
  HabitConfigRepository: HabitConfigRepository;
  NutritionTargetRepository: NutritionTargetRepository;
};

/**
 * Everything `GET /users/me/habits/config` returns. Shared by the route and by
 * `GET /users/me/bootstrap`.
 */
export async function loadHabitConfig(
  ctx: HabitConfigRepositories,
  userId: string,
): Promise<CategoryEntry[]> {
  const configured = await ctx.HabitConfigRepository.listForUser(userId);
  const byCategory = new Map(configured.map((c) => [c.category, c]));

  // The Calories target is owned by Nutrition Fuel-Targets — resolve it live
  // so the card always shows the current daily_kcal (single source of truth),
  // never the stale habit-config snapshot or the 2000 default.
  const calorieTarget = resolveCalorieHabitTarget(
    (await ctx.NutritionTargetRepository.get(userId))?.dailyKcal,
  );

  const data: CategoryEntry[] = [];
  for (const category of HABIT_CATEGORY_ORDER) {
    const cfg = byCategory.get(category);
    let entry: CategoryEntry;
    if (!cfg) {
      entry = defaultEntry(category);
    } else {
      const assignedByCoach = cfg.assignedByUserId !== null;
      // Lock only when the assigning relationship is still active.
      const locked = assignedByCoach
        ? await ctx.HabitConfigRepository.isHabitCoachLocked(userId, category)
        : false;
      entry = {
        category,
        enabled: cfg.enabled,
        goalId: cfg.goalId,
        assignedByCoach,
        assignedByName: cfg.assignedByName,
        locked,
        targetValue: cfg.targetValue,
        unit: cfg.unit,
        period: cfg.period,
        completionRule: cfg.completionRule,
        daysPerWeek: cfg.daysPerWeek,
        tolerancePct: cfg.tolerancePct,
        pending: cfg.pending,
      };
    }
    if (category === "calories") entry.targetValue = calorieTarget;
    data.push(entry);
  }
  return data;
}
