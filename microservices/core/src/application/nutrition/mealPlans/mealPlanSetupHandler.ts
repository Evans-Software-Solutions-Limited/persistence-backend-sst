import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import {
  nutritionPlanAssignments,
  nutritionPlans,
  ptClientRelationships,
} from "@persistence/db";
import type {
  SetupItemInput,
  SetupSectionHandler,
} from "../../coaching/setupSections";
import { NutritionPlanRepository } from "../../repositories/nutritionPlanRepository";
import { assignPlanInTx, cleanNote, MAX_NOTE_LENGTH } from "./assignments";

/**
 * Set-up section `meal_plan` (PER-108's hook, design A D3; PER-118). A coach
 * prepares an invited client's profile with up to `maxItems` of their own
 * library plans, each with an optional note. On accept, each item becomes a
 * `sent` assignment on the new relationship (with the same audit row and push
 * as sending it by hand), exactly once per set-up item.
 *
 * Item shape: `{ refId: <coach's nutrition_plans.id>, config: { note? } }`.
 */
export const MEAL_PLAN_SETUP_MAX_ITEMS = 10;

export const mealPlanSetupHandler: SetupSectionHandler = {
  maxItems: MEAL_PLAN_SETUP_MAX_ITEMS,
  async validate(db, trainerId, item: SetupItemInput) {
    if (!item.refId) {
      return {
        ok: false,
        message: "A meal plan needs refId (one of your plans)",
      };
    }
    const plan = await new NutritionPlanRepository().getOwned(
      trainerId,
      item.refId,
      db,
    );
    if (!plan) {
      return { ok: false, message: "refId must be one of your meal plans" };
    }
    const rawNote = item.config.note;
    if (
      rawNote !== undefined &&
      rawNote !== null &&
      typeof rawNote !== "string"
    ) {
      return { ok: false, message: "config.note must be a string" };
    }
    if (typeof rawNote === "string" && rawNote.length > MAX_NOTE_LENGTH) {
      return {
        ok: false,
        message: `config.note must be at most ${MAX_NOTE_LENGTH} characters`,
      };
    }
    const note = cleanNote(rawNote as string | null | undefined);
    return {
      ok: true,
      item: {
        refId: plan.id,
        config: note ? { note } : {},
        sortOrder: item.sortOrder,
      },
    };
  },
  async materialise(ctx, item) {
    if (!item.refId) return { refId: null };
    const result = await assignPlanInTx(
      ctx.tx,
      {
        trainerId: ctx.trainerId,
        clientId: ctx.clientId,
        relationshipId: ctx.relationshipId,
      },
      item.refId,
      cleanNote(item.config.note as string | undefined),
      null,
    );
    // The plan was archived after set-up: nothing to send.
    if (!result.ok) return { refId: null };
    return { refId: result.assignment.id, afterCommit: result.afterCommit };
  },
  async copyFromClient(db, trainerId, clientId) {
    const rows = await db
      .select({
        planId: nutritionPlanAssignments.planId,
        note: nutritionPlanAssignments.note,
      })
      .from(nutritionPlanAssignments)
      .innerJoin(
        ptClientRelationships,
        eq(ptClientRelationships.id, nutritionPlanAssignments.relationshipId),
      )
      .innerJoin(
        nutritionPlans,
        eq(nutritionPlans.id, nutritionPlanAssignments.planId),
      )
      .where(
        and(
          eq(nutritionPlanAssignments.trainerId, trainerId),
          eq(nutritionPlanAssignments.clientId, clientId),
          ne(nutritionPlanAssignments.status, "removed"),
          eq(ptClientRelationships.status, "active"),
          eq(nutritionPlans.ownerId, trainerId),
          isNull(nutritionPlans.archivedAt),
        ),
      )
      .orderBy(asc(nutritionPlanAssignments.sentAt))
      .limit(MEAL_PLAN_SETUP_MAX_ITEMS);
    return rows.map((r, i) => ({
      refId: r.planId,
      config: r.note ? { note: r.note } : {},
      sortOrder: i,
    }));
  },
  async preview(db, items) {
    const ids = items.map((i) => i.refId).filter((id): id is string => !!id);
    if (ids.length === 0) return { plans: [] };
    const rows = await db
      .select({ id: nutritionPlans.id, name: nutritionPlans.name })
      .from(nutritionPlans)
      .where(
        and(inArray(nutritionPlans.id, ids), isNull(nutritionPlans.archivedAt)),
      );
    const byId = new Map(rows.map((r) => [r.id, r.name]));
    return {
      plans: ids
        .filter((id) => byId.has(id))
        .map((id) => ({ name: byId.get(id)! })),
    };
  },
};
