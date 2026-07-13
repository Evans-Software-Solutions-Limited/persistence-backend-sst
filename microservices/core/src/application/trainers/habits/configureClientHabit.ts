import { getDb } from "@persistence/db/client";
import { assertTrainerCanActForClient } from "../../relationships/assertTrainerCanActForClient";
import { auditTrainerAction } from "../../relationships/auditTrainerAction";
import { HabitConfigRepository } from "../../repositories/habitConfigRepository";
import type { HabitConfigView } from "../../repositories/habitConfigRepository";
import { NutritionTargetRepository } from "../../repositories/nutritionTargetRepository";
import {
  isHabitCategory,
  resolveCalorieHabitTarget,
  validateHabitConfigInput,
  type HabitCategory,
} from "../../habits/habitCategories";

/**
 * Body a coach sends to set/edit a client's habit. Mirrors the self
 * `PUT /users/me/habits/:category/config` validator (cross-cuts § 1.2).
 */
export interface ConfigureClientHabitBody {
  targetValue: number;
  daysPerWeek?: number;
  tolerancePct?: number;
}

export interface ConfigureClientHabitArgs {
  trainerId: string;
  clientId: string;
  category: string;
  body: ConfigureClientHabitBody;
}

export type ConfigureClientHabitResult =
  | { ok: true; view: HabitConfigView }
  | {
      ok: false;
      status: 403 | 404 | 422;
      body: { code?: string; message?: string; error?: string };
    };

/**
 * Shared core for a coach setting/editing a client's habit (18-habit-setup,
 * Phase 18.3 — T-18.3.1; design.md § 3.2 / § 5, cross-cuts § 1.2/§ 1.4/§ 2.1).
 *
 * Pattern (same as `assignClientGoalOnBehalf`):
 *   1. `assertTrainerCanActForClient` gate (role-first, then active
 *      relationship — cross-cuts § 1.3).
 *   2. Edit-own guard: a coach may only touch a habit that is UNASSIGNED or
 *      assigned by SELF. A habit assigned by a DIFFERENT coach → 403 (a coach
 *      can't steal another coach's habit; cross-cuts § 2.2).
 *   3. The config upsert (stamping `assigned_by_user_id = trainerId` on the
 *      client's `user_goals` row) + the `goal_assigned` audit insert happen
 *      inside ONE transaction (cross-cuts § 1.4.2). If the audit fails the
 *      config write rolls back — no assigned habit without an audit trail.
 */
export async function configureClientHabitOnBehalf({
  trainerId,
  clientId,
  category,
  body,
}: ConfigureClientHabitArgs): Promise<ConfigureClientHabitResult> {
  if (!isHabitCategory(category)) {
    return {
      ok: false,
      status: 404,
      body: { error: "Unknown habit category" },
    };
  }

  const verdict = await assertTrainerCanActForClient(trainerId, clientId);
  if (!verdict.allowed) {
    return { ok: false, status: verdict.status, body: verdict.body };
  }

  const cat = category as HabitCategory;
  const repo = new HabitConfigRepository();

  // Edit-own guard: reject when the client already has this habit assigned by a
  // DIFFERENT coach. An unassigned (self-set) or self-assigned habit is fine —
  // a coach may take over a self-set habit (it becomes coach-locked).
  const assigner = await repo.getAssigner(clientId, cat);
  if (assigner?.assignedByUserId && assigner.assignedByUserId !== trainerId) {
    return {
      ok: false,
      status: 403,
      body: {
        code: "not_your_habit",
        message: "This habit was assigned by a different coach",
      },
    };
  }

  // Calories: the target is owned by the CLIENT's Nutrition Fuel-Targets, not
  // anything the coach sends — substitute the client's canonical daily_kcal so
  // a coach-set calorie habit scores against the same number as the client's
  // nutrition streak (single source of truth).
  const calorieOverride =
    cat === "calories"
      ? resolveCalorieHabitTarget(
          (await new NutritionTargetRepository().get(clientId))?.dailyKcal,
        )
      : undefined;
  const validated = validateHabitConfigInput(
    cat,
    {
      targetValue: body.targetValue,
      daysPerWeek: body.daysPerWeek,
      tolerancePct: body.tolerancePct,
    },
    calorieOverride,
  );
  if (!validated.ok) {
    return { ok: false, status: 422, body: { error: validated.error } };
  }

  const view = await getDb().transaction(async (tx) => {
    const written = await repo.upsert(clientId, cat, validated.config, {
      assignedByUserId: trainerId,
      tx,
    });
    if (!written) return null;

    await auditTrainerAction({
      trainerId,
      clientId,
      actionType: "goal_assigned",
      targetTable: "user_goals",
      targetRowId: written.goalId,
      payload: { category: cat, ...body },
      tx,
    });

    return written;
  });

  if (!view) {
    return {
      ok: false,
      status: 404,
      body: { error: "Unknown habit category" },
    };
  }

  return { ok: true, view };
}
