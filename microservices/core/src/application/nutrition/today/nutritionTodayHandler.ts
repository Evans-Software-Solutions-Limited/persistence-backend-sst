import Elysia, { t } from "elysia";
import { NutritionEntryService } from "../../repositories/nutritionEntryService";
import { NutritionTargetService } from "../../repositories/nutritionTargetService";
import { WaterLogService } from "../../repositories/waterLogService";
import { UserMealService } from "../../repositories/userMealService";
import { withEffectiveUserMealIds } from "../userMeals/effectiveUserMeal";
import type {
  NutritionEntryDTO,
  MealSlot,
} from "../../repositories/nutritionEntryRepository";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export type Consumed = {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

export type EntriesBySlot = Record<MealSlot, NutritionEntryDTO[]>;

/**
 * Pure sum over the day's entries. Done in JS (not SQL) because the screen
 * already needs the full entry list for `entriesBySlot`, so a separate SQL
 * aggregate would be wasted work — AND it sidesteps the Drizzle reused-param
 * GROUP BY / Postgres 42803 trap entirely (there is no GROUP BY here).
 */
export function summariseConsumed(entries: NutritionEntryDTO[]): Consumed {
  return entries.reduce<Consumed>(
    (acc, e) => ({
      kcal: acc.kcal + e.kcal,
      proteinG: acc.proteinG + e.proteinG,
      carbsG: acc.carbsG + e.carbsG,
      fatG: acc.fatG + e.fatG,
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
}

export function groupBySlot(entries: NutritionEntryDTO[]): EntriesBySlot {
  const bySlot: EntriesBySlot = {
    breakfast: [],
    lunch: [],
    snack: [],
    dinner: [],
  };
  for (const e of entries) bySlot[e.mealSlot].push(e);
  return bySlot;
}

/**
 * GET /nutrition/today?date=YYYY-MM-DD — the Fuel screen aggregate.
 *
 * `entriesBySlot` is unchanged for older bundles. Each entry also carries
 * `userMealId` (Design D): its own, or the default meal for its slot.
 */
export const nutritionTodayHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(NutritionEntryService)
  .use(NutritionTargetService)
  .use(WaterLogService)
  .use(UserMealService)
  .get(
    "/nutrition/today",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const date = ctx.query.date;

      // Your meals are read without seeding: this route serves older bundles
      // too, and must stay free of writes for them.
      const [stored, target, waterCups, meals] = await Promise.all([
        ctx.NutritionEntryRepository.listByDate(userId, date),
        ctx.NutritionTargetRepository.get(userId),
        ctx.WaterLogRepository.getCups(userId, date),
        ctx.UserMealRepository.listActive(userId),
      ]);
      const entries = withEffectiveUserMealIds(stored, meals);

      const consumed = summariseConsumed(entries);
      const remainingKcal = target ? target.dailyKcal - consumed.kcal : 0;

      return {
        data: {
          date,
          targets: target,
          consumed: { ...consumed, waterCups },
          remainingKcal,
          entriesBySlot: groupBySlot(entries),
        },
      };
    },
    {
      query: t.Object({ date: t.String() }),
    },
  );
