import { router, type Href } from "expo-router";
import type { MealSlot } from "@/domain/models/nutrition";

/**
 * PER-134: Mealprint is one full-screen page (canvas N15), `/(app)/fuel/mealprint`,
 * opened on One meal or Whole day. One meal can be preset to a meal (Add to a
 * meal → Suggest, a plan's gap row), which only picks where the chosen idea is
 * logged. People without Premium+ see the locked page (N26) there.
 */
export type MealprintMode = "meal" | "day";

export type MealprintTarget = {
  slot?: MealSlot;
  /** One of Your meals; never a synthetic `slot:` id. */
  userMealId?: string | null;
};

export function mealprintHref(
  mode: MealprintMode,
  target: MealprintTarget = {},
): Href {
  const params = [`mode=${mode}`];
  if (target.slot) params.push(`slot=${target.slot}`);
  if (target.userMealId) {
    params.push(`userMealId=${encodeURIComponent(target.userMealId)}`);
  }
  return `/(app)/fuel/mealprint?${params.join("&")}` as Href;
}

export function openMealprint(
  mode: MealprintMode,
  target: MealprintTarget = {},
): void {
  router.push(mealprintHref(mode, target));
}
