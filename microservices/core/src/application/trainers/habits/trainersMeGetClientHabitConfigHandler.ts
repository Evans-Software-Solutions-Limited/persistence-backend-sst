import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { HabitConfigService } from "../../repositories/habitConfigService";
import { assertTrainerCanActForClient } from "../../relationships/assertTrainerCanActForClient";
import {
  HABIT_CATEGORIES,
  HABIT_CATEGORY_ORDER,
  type HabitCategory,
} from "../../habits/habitCategories";

/**
 * GET /trainers/me/clients/:clientId/habits/config — a coach reads the client's
 * habit config FROM THE DB (18-habit-setup Phase 18.3; design.md § 3.2, STORY-006
 * AC 6.5). Same five-category shape as the self GET; `assignedByCoach`/`locked`
 * are computed so the coach UI can render attribution. Reads aren't audited
 * (cross-cuts § 1.4). Auth via the shared gate (cross-cuts § 1.3).
 */
export const trainersMeGetClientHabitConfigHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(HabitConfigService)
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

      const configured = await ctx.HabitConfigRepository.listForUser(clientId);
      const byCategory = new Map(configured.map((c) => [c.category, c]));

      const data = [];
      for (const category of HABIT_CATEGORY_ORDER) {
        const cfg = byCategory.get(category);
        if (!cfg) {
          data.push(defaultEntry(category));
          continue;
        }
        const assignedByCoach = cfg.assignedByUserId !== null;
        const locked = assignedByCoach
          ? await ctx.HabitConfigRepository.isHabitCoachLocked(
              clientId,
              category,
            )
          : false;
        data.push({
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
        });
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
