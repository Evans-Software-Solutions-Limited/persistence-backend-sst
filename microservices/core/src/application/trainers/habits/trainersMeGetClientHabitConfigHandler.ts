import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { HabitConfigService } from "../../repositories/habitConfigService";
import { NutritionTargetService } from "../../repositories/nutritionTargetService";
import { assertTrainerCanActForClient } from "../../relationships/assertTrainerCanActForClient";
import { auditClientDataRead } from "../../relationships/auditClientDataRead";
import {
  HABIT_CATEGORIES,
  HABIT_CATEGORY_ORDER,
  resolveCalorieHabitTarget,
  type HabitCategory,
} from "../../habits/habitCategories";

/**
 * GET /trainers/me/clients/:clientId/habits/config — a coach reads the client's
 * habit config FROM THE DB (18-habit-setup Phase 18.3; design.md § 3.2, STORY-006
 * AC 6.5). Same five-category shape as the self GET; `assignedByCoach`/`locked`
 * are computed so the coach UI can render attribution. Auth via the shared
 * gate (cross-cuts § 1.3). The read is logged to the coach read-audit
 * (specs/27-coach-health-data-read-audit) AFTER the gate passes, via the
 * best-effort `auditClientDataRead` helper.
 */
export const trainersMeGetClientHabitConfigHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(HabitConfigService)
  .use(NutritionTargetService)
  .get(
    "/trainers/me/clients/:clientId/habits/config",
    async (ctx) => {
      const { sub: trainerId } = getUser(ctx);
      const { clientId } = ctx.params as { clientId: string };

      const verdict = await assertTrainerCanActForClient(trainerId, clientId);
      if (!verdict.allowed) {
        ctx.set.status = verdict.status;
        return verdict.body;
      }

      await auditClientDataRead({
        trainerId,
        clientId,
        dataCategory: "habits",
        route: "/trainers/me/clients/:clientId/habits/config",
      }).catch(() => {});

      const configured = await ctx.HabitConfigRepository.listForUser(clientId);
      const byCategory = new Map(configured.map((c) => [c.category, c]));

      // Calories target is owned by the CLIENT's Nutrition Fuel-Targets — resolve
      // live so the coach sees the same number the client's card/streak use.
      const calorieTarget = resolveCalorieHabitTarget(
        (await ctx.NutritionTargetRepository.get(clientId))?.dailyKcal,
      );

      const data = [];
      for (const category of HABIT_CATEGORY_ORDER) {
        const cfg = byCategory.get(category);
        let entry;
        if (!cfg) {
          entry = defaultEntry(category);
        } else {
          const assignedByCoach = cfg.assignedByUserId !== null;
          const locked = assignedByCoach
            ? await ctx.HabitConfigRepository.isHabitCoachLocked(
                clientId,
                category,
              )
            : false;
          entry = {
            category,
            enabled: cfg.enabled,
            goalId: cfg.goalId,
            assignedByCoach,
            assignedByName: cfg.assignedByName,
            assignedByUserId: cfg.assignedByUserId,
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
      return { data };
    },
    {
      params: t.Object({ clientId: t.String({ minLength: 1 }) }),
    },
  );

function defaultEntry(category: HabitCategory) {
  const meta = HABIT_CATEGORIES[category];
  return {
    category,
    enabled: false,
    goalId: null,
    assignedByCoach: false,
    assignedByName: null,
    assignedByUserId: null,
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
