import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { MealPlanService } from "../../../../repositories/mealPlanService";
import { ActivePlanExistsError } from "../../../../repositories/mealPlanRepository";

/**
 * Meal-plan reads and lifecycle edits (spec-26 Phase 2, AC 4.5 / 5.4).
 *
 *   GET    /nutrition/plans/active     — today's/that date's active plan
 *   GET    /nutrition/plans            — recent history
 *   GET    /nutrition/plans/:id        — one plan
 *   PATCH  /nutrition/plans/:id        — archive / re-date ("use again")
 *   DELETE /nutrition/plans/:id        — plan only; logged entries survive
 *
 * ⚠ **`/plans/active` is declared before `/plans/:id` as a convention, NOT
 * because Elysia requires it.** An earlier version of this docstring claimed the
 * order was load-bearing, by analogy with `loadoutRouteOrdering.test.ts`. That
 * was **measured and found false**: swapping the two declarations leaves every
 * test in `nutritionPlansHandlers.test.ts` green, because Elysia's radix router
 * prefers a STATIC segment over a dynamic one whatever the declaration order. So
 * `active` is never captured as an `:id`.
 *
 * The literal-first ordering stays because it reads correctly and costs nothing —
 * but do not add a test that claims to prove ordering matters here. It cannot
 * fail, which makes it exactly the kind of fake test this repo has been bitten
 * by. What IS worth asserting (and is asserted) is the OUTCOME: a request to
 * `/plans/active` reaches the active handler and never the `:id` one.
 *
 * ⚠ **Ungated, like the preferences endpoints.** The `meal_ai` paywall sits on
 * GENERATION. Reading, re-dating and deleting a plan the user already generated
 * must keep working after a subscription lapses — gating it would revoke access
 * to data they created while paying.
 */
export const nutritionPlansReadHandlers = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(MealPlanService)
  // Literal before parameterised — convention, not a requirement (see above).
  .get(
    "/nutrition/plans/active",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      // `date` is supplied by the client, not derived from server time: "today"
      // is the DEVICE's local day. Same contract as `GET /nutrition/today` and
      // `meal-suggest` — deriving it here gives a user in NZ the wrong day.
      const plan = await ctx.MealPlanRepository.getActiveForDate(
        userId,
        ctx.query.date,
      );
      // 200 with null, not 404: "no plan for today" is a normal state the Fuel
      // card renders as an offer to generate one, not an error.
      return { data: plan };
    },
    {
      query: t.Object({
        date: t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
      }),
    },
  )
  .get(
    "/nutrition/plans",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const plans = await ctx.MealPlanRepository.listRecent(
        userId,
        ctx.query.limit ?? 30,
      );
      return { data: plans };
    },
    {
      query: t.Object({
        limit: t.Optional(t.Number({ minimum: 1, maximum: 90 })),
      }),
    },
  )
  .get(
    "/nutrition/plans/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const plan = await ctx.MealPlanRepository.get(userId, ctx.params.id);
      if (!plan) {
        // 404 for another user's id as well as a nonexistent one — the
        // repository filters by userId, so the two are indistinguishable here.
        // That is the intended behaviour: a 403 would confirm the plan exists.
        ctx.set.status = 404;
        return { error: "not_found" };
      }
      return { data: plan };
    },
    { params: t.Object({ id: t.String({ format: "uuid" }) }) },
  )
  .patch(
    "/nutrition/plans/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { id } = ctx.params;

      try {
        // Archive and re-date are mutually exclusive; the schema enforces that
        // exactly one arrives (see the body note below).
        const plan =
          ctx.body.status === "archived"
            ? await ctx.MealPlanRepository.archive(userId, id)
            : await ctx.MealPlanRepository.redate(
                userId,
                id,
                ctx.body.planDate!,
              );

        if (!plan) {
          ctx.set.status = 404;
          return { error: "not_found" };
        }
        return { data: plan };
      } catch (error) {
        if (error instanceof ActivePlanExistsError) {
          // ⚠ Re-dating onto an occupied day is a 409, never a silent
          // overwrite. The target day may already have logged meals against it.
          ctx.set.status = 409;
          return { error: "active_plan_exists", planDate: error.planDate };
        }
        throw error;
      }
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      // A union rather than two optional fields, so "archive it AND move it" is
      // unrepresentable instead of being resolved by whichever branch the
      // handler happens to check first.
      body: t.Union([
        t.Object({
          status: t.Literal("archived"),
          planDate: t.Optional(t.Undefined()),
        }),
        t.Object({
          status: t.Optional(t.Undefined()),
          planDate: t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
        }),
      ]),
    },
  )
  .delete(
    "/nutrition/plans/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const removed = await ctx.MealPlanRepository.remove(
        userId,
        ctx.params.id,
      );
      if (!removed) {
        ctx.set.status = 404;
        return { error: "not_found" };
      }
      // ⚠ The plan's meals cascade; the user's logged `nutrition_entries` do
      // NOT (AC 5.4 — `logged_entry_id` is ON DELETE SET NULL). Deleting a plan
      // must never remove food the user actually ate.
      console.info(
        `[mealprint-plan-delete] user=${userId} plan=${ctx.params.id}`,
      );
      return { data: { deleted: true } };
    },
    { params: t.Object({ id: t.String({ format: "uuid" }) }) },
  );
