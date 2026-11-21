import Elysia, { t } from "elysia";
import {
  getAuthUser,
  getUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";
import { getDb } from "@persistence/db/client";
import { readIdempotencyKey } from "../../shared/idempotencyKey";
import { resolveCoachScope } from "../../relationships/resolveCoachScope";
import { auditTrainerAction } from "../../relationships/auditTrainerAction";
import { isUuid } from "../../repositories/userMealRepository";
import {
  assignPlan,
  cleanNote,
  listClientAssignments,
  MAX_NOTE_LENGTH,
  patchAssignmentNote,
  removeAssignment,
} from "./assignments";
import { copyRecipeToUser } from "./copyGraph";
import {
  addShoppingPlan,
  buildShoppingList,
  removeShoppingPlan,
} from "./shoppingList";

/**
 * Design D (PER-118) — coach → client: assignments (C1, C3.2) and the recipe
 * share, plus the athlete's shopping list. Every coach route runs
 * `resolveCoachScope` first (trainer role, an ACTIVE relationship, neither
 * account deleted) and every write is scoped to the caller's own
 * relationship with this client.
 */

const authed = () =>
  new Elysia()
    .derive(async ({ headers }) => ({
      user: await getAuthUser(headers.authorization),
    }))
    .onBeforeHandle(requireAuth);

const clientParams = t.Object({ clientId: t.String({ format: "uuid" }) });
const assignmentParams = t.Object({
  clientId: t.String({ format: "uuid" }),
  assignmentId: t.String(),
});
const NOT_FOUND = { error: "not_found" } as const;

export const coachMealPlanAssignmentHandlers = authed()
  .get(
    "/trainers/me/clients/:clientId/meal-plans",
    async (ctx) => {
      const scope = await resolveCoachScope(
        getUser(ctx).sub,
        ctx.params.clientId,
      );
      if (!scope.allowed) {
        ctx.set.status = scope.status;
        return scope.body;
      }
      return { data: await listClientAssignments(scope.scope) };
    },
    { params: clientParams },
  )
  .post(
    "/trainers/me/clients/:clientId/meal-plans",
    async (ctx) => {
      const scope = await resolveCoachScope(
        getUser(ctx).sub,
        ctx.params.clientId,
      );
      if (!scope.allowed) {
        ctx.set.status = scope.status;
        return scope.body;
      }
      const result = await assignPlan(
        scope.scope,
        ctx.body.planId,
        cleanNote(ctx.body.note),
        readIdempotencyKey(ctx.headers),
      );
      if (!result.ok) {
        ctx.set.status = 404;
        return { error: result.error };
      }
      ctx.set.status = result.created ? 201 : 200;
      return { data: result.assignment };
    },
    {
      params: clientParams,
      body: t.Object({
        planId: t.String(),
        note: t.Optional(
          t.Nullable(t.String({ maxLength: MAX_NOTE_LENGTH * 2 })),
        ),
      }),
    },
  )
  .patch(
    "/trainers/me/clients/:clientId/meal-plans/:assignmentId",
    async (ctx) => {
      const scope = await resolveCoachScope(
        getUser(ctx).sub,
        ctx.params.clientId,
      );
      if (!scope.allowed) {
        ctx.set.status = scope.status;
        return scope.body;
      }
      const row = await patchAssignmentNote(
        scope.scope,
        ctx.params.assignmentId,
        cleanNote(ctx.body.note),
      );
      if (!row) {
        ctx.set.status = 404;
        return NOT_FOUND;
      }
      return { data: row };
    },
    {
      params: assignmentParams,
      body: t.Object({
        note: t.Nullable(t.String({ maxLength: MAX_NOTE_LENGTH * 2 })),
      }),
    },
  )
  .delete(
    "/trainers/me/clients/:clientId/meal-plans/:assignmentId",
    async (ctx) => {
      const scope = await resolveCoachScope(
        getUser(ctx).sub,
        ctx.params.clientId,
      );
      if (!scope.allowed) {
        ctx.set.status = scope.status;
        return scope.body;
      }
      if (!(await removeAssignment(scope.scope, ctx.params.assignmentId))) {
        ctx.set.status = 404;
        return NOT_FOUND;
      }
      ctx.set.status = 204;
      return new Response(null, { status: 204 });
    },
    { params: assignmentParams },
  )
  .post(
    "/trainers/me/clients/:clientId/recipes/:recipeId/share",
    async (ctx) => {
      const scope = await resolveCoachScope(
        getUser(ctx).sub,
        ctx.params.clientId,
      );
      if (!scope.allowed) {
        ctx.set.status = scope.status;
        return scope.body;
      }
      const { trainerId, clientId } = scope.scope;
      const recipeId = ctx.params.recipeId;
      if (!isUuid(recipeId)) {
        ctx.set.status = 404;
        return { error: "recipe_not_found" };
      }
      const result = await getDb().transaction(async (tx) => {
        const copied = await copyRecipeToUser(
          tx,
          recipeId,
          trainerId,
          clientId,
        );
        if (copied.ok && copied.created) {
          await auditTrainerAction({
            trainerId,
            clientId,
            actionType: "recipe_shared",
            targetTable: "recipes",
            targetRowId: copied.recipeId,
            payload: { sourceRecipeId: recipeId },
            tx,
          });
        }
        return copied;
      });
      if (!result.ok) {
        ctx.set.status = 404;
        return { error: result.error };
      }
      ctx.set.status = result.created ? 201 : 200;
      return {
        data: {
          recipeId: result.recipeId,
          sourceRecipeId: recipeId,
          sharedByUserId: trainerId,
          created: result.created,
        },
      };
    },
    {
      params: t.Object({
        clientId: t.String({ format: "uuid" }),
        recipeId: t.String(),
      }),
    },
  );

/** `/nutrition/shopping-list*` — the list built from added plans. */
export const shoppingListHandlers = authed()
  .get("/nutrition/shopping-list", async (ctx) => ({
    data: await buildShoppingList(getUser(ctx).sub),
  }))
  .post(
    "/nutrition/shopping-list/plans",
    async (ctx) => {
      const { nutritionPlanId, mealPlanId } = ctx.body;
      if ((nutritionPlanId ? 1 : 0) + (mealPlanId ? 1 : 0) !== 1) {
        ctx.set.status = 400;
        return { error: "one_plan_required" };
      }
      const userId = getUser(ctx).sub;
      const result = await addShoppingPlan(userId, {
        nutritionPlanId,
        mealPlanId,
      });
      if (!result.ok) {
        ctx.set.status = 404;
        return { error: result.error };
      }
      return { data: await buildShoppingList(userId) };
    },
    {
      body: t.Object({
        nutritionPlanId: t.Optional(t.String()),
        mealPlanId: t.Optional(t.String()),
      }),
    },
  )
  .delete(
    "/nutrition/shopping-list/plans/:planId",
    async (ctx) => {
      await removeShoppingPlan(getUser(ctx).sub, ctx.params.planId);
      ctx.set.status = 204;
      return new Response(null, { status: 204 });
    },
    { params: t.Object({ planId: t.String() }) },
  );
