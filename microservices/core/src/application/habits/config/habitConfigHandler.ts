import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { HabitConfigService } from "../../repositories/habitConfigService";
import type { HabitConfigView } from "../../repositories/habitConfigRepository";
import {
  HABIT_CATEGORIES,
  HABIT_CATEGORY_ORDER,
  isHabitCategory,
  validateHabitConfigInput,
  type HabitCategory,
} from "../habitCategories";

/**
 * Habit-setup config routes (18-habit-setup, Phase 18.2). Per design.md § 3.1.
 *
 *   GET    /users/me/habits/config          — all five categories (enabled or
 *                                              default), with coach-lock state
 *   PUT    /users/me/habits/:category/config — enable + configure (deferred
 *                                              edit when already active)
 *   DELETE /users/me/habits/:category        — disable (deferred to Monday)
 *
 * A coach-assigned habit is complete-only for the client: PUT/DELETE 403 while
 * the relationship is active (cross-cuts § 2.2). Bounds are enforced by
 * validateHabitConfigInput (422) — anti-gaming AC 8.5.
 */

interface CategoryEntry {
  category: HabitCategory;
  enabled: boolean;
  goalId: string | null;
  assignedByCoach: boolean;
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

export const habitConfigHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(HabitConfigService)
  .get("/users/me/habits/config", async (ctx) => {
    const { sub: userId } = getUser(ctx);
    const configured = await ctx.HabitConfigRepository.listForUser(userId);
    const byCategory = new Map(configured.map((c) => [c.category, c]));

    const data: CategoryEntry[] = [];
    for (const category of HABIT_CATEGORY_ORDER) {
      const cfg = byCategory.get(category);
      if (!cfg) {
        data.push(defaultEntry(category));
        continue;
      }
      const assignedByCoach = cfg.assignedByUserId !== null;
      // Lock only when the assigning relationship is still active.
      const locked = assignedByCoach
        ? await ctx.HabitConfigRepository.isHabitCoachLocked(userId, category)
        : false;
      data.push({
        category,
        enabled: cfg.enabled,
        goalId: cfg.goalId,
        assignedByCoach,
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
  })
  .put(
    "/users/me/habits/:category/config",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { category } = ctx.params;
      if (!isHabitCategory(category)) {
        ctx.set.status = 404;
        return { error: "Unknown habit category" };
      }
      // Client can't retune a habit their coach owns (cross-cuts § 2.2).
      if (await ctx.HabitConfigRepository.isHabitCoachLocked(userId, category)) {
        ctx.set.status = 403;
        return { error: "This habit is managed by your coach" };
      }
      const validated = validateHabitConfigInput(category, {
        targetValue: ctx.body.targetValue,
        daysPerWeek: ctx.body.daysPerWeek,
        tolerancePct: ctx.body.tolerancePct,
      });
      if (!validated.ok) {
        ctx.set.status = 422;
        return { error: validated.error };
      }
      const view = await ctx.HabitConfigRepository.upsert(
        userId,
        category,
        validated.config,
      );
      if (!view) {
        ctx.set.status = 404;
        return { error: "Unknown habit category" };
      }
      return { data: view };
    },
    {
      params: t.Object({ category: t.String() }),
      body: t.Object({
        targetValue: t.Number(),
        daysPerWeek: t.Optional(t.Number()),
        tolerancePct: t.Optional(t.Number()),
      }),
    },
  )
  .delete(
    "/users/me/habits/:category",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { category } = ctx.params;
      if (!isHabitCategory(category)) {
        ctx.set.status = 404;
        return { error: "Unknown habit category" };
      }
      if (await ctx.HabitConfigRepository.isHabitCoachLocked(userId, category)) {
        ctx.set.status = 403;
        return { error: "This habit is managed by your coach" };
      }
      const ok = await ctx.HabitConfigRepository.disable(userId, category);
      if (!ok) {
        ctx.set.status = 404;
        return { error: "Habit not enabled" };
      }
      return { data: { category, disabled: true } };
    },
    { params: t.Object({ category: t.String() }) },
  );
