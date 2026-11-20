import Elysia, { t } from "elysia";
import { UserMealService } from "../../../repositories/userMealService";
import { normaliseIdempotencyKey } from "../../../shared/idempotencyKey";
import { stripNul } from "../../../shared/stripNul";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/** Generous for "as many meals as the user wants", bounded for the payload. */
export const MAX_USER_MEALS = 30;

/**
 * PUT /nutrition/user-meals — `{ meals: [{ id?, clientRequestId?, name,
 * logSlot, sortOrder }] }` replaces the caller's list (Design D, N1b).
 *
 * - Meals left out are archived; entries logged into them keep `user_meal_id`.
 * - A meal created offline sends no server id (or its `local-…` id) and a
 *   `clientRequestId`; a re-sent PUT updates that meal rather than adding a
 *   second one, and the response's `clientRequestId` lets the phone swap ids.
 * - An `id` that isn't one of the caller's meals → 400 `user_meal_not_found`,
 *   and nothing changes.
 * - Last write wins (no revision), per the contract.
 */
export const nutritionUserMealsPutHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(UserMealService)
  .put(
    "/nutrition/user-meals",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);

      const meals = [];
      for (const meal of ctx.body.meals) {
        // NUL stripped first: Postgres `text` rejects it (a 500 otherwise).
        const name = stripNul(meal.name).trim();
        if (name.length === 0 || name.length > 40) {
          ctx.set.status = 400;
          return { error: "invalid_user_meal_name" };
        }
        let clientRequestId: string | null = null;
        if (meal.clientRequestId !== undefined) {
          clientRequestId = normaliseIdempotencyKey(meal.clientRequestId);
          if (clientRequestId === null) {
            ctx.set.status = 400;
            return { error: "invalid_client_request_id" };
          }
        }
        meals.push({
          id: meal.id,
          clientRequestId,
          name,
          logSlot: meal.logSlot,
          sortOrder: meal.sortOrder,
        });
      }

      const result = await ctx.UserMealRepository.replace(userId, meals);
      if (!result.ok) {
        ctx.set.status = 400;
        return { error: result.error };
      }
      return {
        data: { meals: result.meals, asOf: new Date().toISOString() },
      };
    },
    {
      body: t.Object({
        meals: t.Array(
          t.Object({
            id: t.Optional(t.String()),
            clientRequestId: t.Optional(t.String({ maxLength: 200 })),
            name: t.String({ minLength: 1, maxLength: 80 }),
            logSlot: t.Union([
              t.Literal("breakfast"),
              t.Literal("lunch"),
              t.Literal("snack"),
              t.Literal("dinner"),
            ]),
            sortOrder: t.Integer({ minimum: 0, maximum: 1000 }),
          }),
          { minItems: 1, maxItems: MAX_USER_MEALS },
        ),
      }),
    },
  );
