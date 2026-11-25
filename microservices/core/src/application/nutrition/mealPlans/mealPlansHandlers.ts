import Elysia, { t } from "elysia";
import {
  getAuthUser,
  getUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";
import { readIdempotencyKey } from "../../shared/idempotencyKey";
import { isActiveTrainer } from "../../coaching/clientProfileRepository";
import {
  NutritionPlanRepository,
  listAsOf,
  MAX_ITEMS_PER_MEAL,
  MAX_PLAN_MEALS,
  type PlanInput,
} from "../../repositories/nutritionPlanRepository";
import {
  canCreateManualMealPlans,
  MANUAL_MEAL_PLANS_DENIED,
} from "./manualMealPlans";
import { duplicatePlan } from "./copyGraph";
import { MealPlanRepository } from "../../repositories/mealPlanRepository";
import {
  MEALPRINT_PLAN_DEFAULT_NAME,
  planInputFromMealprint,
} from "./fromMealprint";
import { clientUpdateAssignment } from "./assignments";

/**
 * Design D (PER-118) — list meal plans.
 *
 * Athlete (and a coach's own plans): `/nutrition/meal-plans`. A new resource;
 * Mealprint's dated `/nutrition/plans*` routes are untouched.
 * Coach library: `/trainers/me/meal-plans` — the same service with the coach
 * as owner, trainer role required, and only the coach's own plans.
 *
 * Offline contract: create and duplicate take an `Idempotency-Key` (a replay
 * answers with the first plan); PUT takes `expectedRevision` (stale → 409
 * `revision_conflict` with the current plan; absent → last write wins);
 * DELETE archives and is idempotent; lists take `?since=` and return
 * `deletedIds` and `asOf`.
 */

const logSlot = t.Union([
  t.Literal("breakfast"),
  t.Literal("lunch"),
  t.Literal("snack"),
  t.Literal("dinner"),
]);

const itemSchema = t.Object({
  foodId: t.Optional(t.String()),
  recipeId: t.Optional(t.String()),
  mealId: t.Optional(t.String()),
  custom: t.Optional(
    t.Object({
      name: t.String({ maxLength: 200 }),
      kcal: t.Number(),
      proteinG: t.Number(),
      carbsG: t.Number(),
      fatG: t.Number(),
    }),
  ),
  servings: t.Number(),
  sortOrder: t.Optional(t.Integer({ minimum: 0 })),
});

const mealSchema = t.Object({
  name: t.String({ maxLength: 80 }),
  logSlot,
  sortOrder: t.Optional(t.Integer({ minimum: 0 })),
  items: t.Array(itemSchema, { maxItems: MAX_ITEMS_PER_MEAL }),
});

export const planBodyFields = {
  name: t.String({ maxLength: 200 }),
  notes: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
  meals: t.Array(mealSchema, { maxItems: MAX_PLAN_MEALS }),
};

const idParams = t.Object({ id: t.String() });
const sinceQuery = t.Object({ since: t.Optional(t.String()) });

/** `?since=` → a Date, null when absent, "invalid" when unparseable. */
export function parseSince(since: string | undefined): Date | null | "invalid" {
  if (since === undefined || since === "") return null;
  const ms = Date.parse(since);
  return Number.isNaN(ms) ? "invalid" : new Date(ms);
}

const authed = () =>
  new Elysia()
    .derive(async ({ headers }) => ({
      user: await getAuthUser(headers.authorization),
    }))
    .onBeforeHandle(requireAuth);

const repo = () => new NutritionPlanRepository();

const NOT_FOUND = { error: "not_found" } as const;
const READ_ONLY = {
  error: "read_only",
  message:
    "Plans from your coach can be read, duplicated and logged, not edited",
} as const;
const MEALPRINT_PLAN_NOT_FOUND = { error: "mealprint_plan_not_found" } as const;
const MEALPRINT_NUTRITION_UNAVAILABLE = {
  error: "plan_meal_nutrition_unavailable",
  message: "Some foods in this Mealprint day are no longer available",
} as const;
const NOT_A_TRAINER = {
  error: "not_a_trainer",
  message: "Coach actions require a trainer role",
} as const;

type Ctx = { set: { status?: number | string } };

/** 403 for an assigned client (they may read but never write), 404 otherwise. */
async function deniedWrite(ctx: Ctx, userId: string, planId: string) {
  const readable = await repo().getReadable(userId, planId);
  if (readable) {
    ctx.set.status = 403;
    return READ_ONLY;
  }
  ctx.set.status = 404;
  return NOT_FOUND;
}

async function createPlan(
  ctx: Ctx & { headers: Record<string, string | undefined> },
  userId: string,
  body: PlanInput,
  source: "manual" | "coach",
) {
  if (!(await canCreateManualMealPlans(userId))) {
    ctx.set.status = 403;
    return MANUAL_MEAL_PLANS_DENIED;
  }
  const result = await repo().create(userId, body, {
    source,
    clientRequestId: readIdempotencyKey(ctx.headers),
  });
  if (!result.ok) {
    ctx.set.status = 400;
    return { error: result.error };
  }
  // A replay answers exactly like the first create (201, same body), as
  // `POST /nutrition/entries` does.
  ctx.set.status = 201;
  return { data: result.plan };
}

/**
 * PER-119 — `POST /nutrition/meal-plans {fromMealprintPlanId}`. Same
 * capability, `Idempotency-Key` and 201 answer as a manual create; the plan
 * is `source: 'mealprint'` with `sourcePlanId` = the dated plan, which is
 * left unchanged. A replay answers with the first plan even if the dated
 * plan has gone since.
 */
async function createFromMealprint(
  ctx: Ctx & { headers: Record<string, string | undefined> },
  userId: string,
  body: { fromMealprintPlanId: string; name?: string },
) {
  if (!(await canCreateManualMealPlans(userId))) {
    ctx.set.status = 403;
    return MANUAL_MEAL_PLANS_DENIED;
  }
  const key = readIdempotencyKey(ctx.headers);
  if (key) {
    const existing = await repo().findByKey(userId, key);
    if (existing) {
      ctx.set.status = 201;
      return { data: await repo().getDto(userId, existing) };
    }
  }
  const source = await new MealPlanRepository().get(
    userId,
    body.fromMealprintPlanId,
  );
  if (!source) {
    ctx.set.status = 404;
    return MEALPRINT_PLAN_NOT_FOUND;
  }
  const built = await planInputFromMealprint(
    userId,
    source,
    body.name ?? MEALPRINT_PLAN_DEFAULT_NAME,
  );
  if (!built.ok) {
    ctx.set.status = 409;
    return { ...MEALPRINT_NUTRITION_UNAVAILABLE, items: built.items };
  }
  const result = await repo().create(userId, built.input, {
    source: "mealprint",
    sourcePlanId: source.id,
    clientRequestId: key,
  });
  if (!result.ok) {
    ctx.set.status = 400;
    return { error: result.error };
  }
  ctx.set.status = 201;
  return { data: result.plan };
}

async function replacePlan(
  ctx: Ctx,
  userId: string,
  planId: string,
  body: PlanInput & { expectedRevision?: number },
) {
  const { expectedRevision, ...input } = body;
  const owned = await repo().getOwned(userId, planId);
  if (!owned) return deniedWrite(ctx, userId, planId);
  const result = await repo().replace(userId, planId, input, expectedRevision);
  if (result.ok) return { data: result.plan };
  if (result.error === "revision_conflict") {
    ctx.set.status = 409;
    return {
      error: "revision_conflict",
      message: "This plan was updated on another device",
      current: (result as { current: unknown }).current,
    };
  }
  if (result.error === "not_found") {
    ctx.set.status = 404;
    return NOT_FOUND;
  }
  ctx.set.status = 400;
  return { error: result.error };
}

async function archivePlan(ctx: Ctx, userId: string, planId: string) {
  if (await repo().archive(userId, planId)) {
    ctx.set.status = 204;
    return new Response(null, { status: 204 });
  }
  return deniedWrite(ctx, userId, planId);
}

/** `/nutrition/meal-plans*` — the athlete's plans and plans from coaches. */
export const nutritionMealPlansHandlers = authed()
  .get(
    "/nutrition/meal-plans",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const since = parseSince(ctx.query.since);
      if (since === "invalid") {
        ctx.set.status = 400;
        return { error: "invalid_since" };
      }
      const asOf = listAsOf();
      const mine = await repo().listMine(userId, since);
      const coaches = await repo().listFromCoaches(userId, since);
      return {
        data: {
          mine: mine.plans,
          fromCoaches: coaches.fromCoaches,
          deletedIds: [...new Set([...mine.deletedIds, ...coaches.deletedIds])],
          asOf,
        },
      };
    },
    { query: sinceQuery },
  )
  .post(
    "/nutrition/meal-plans",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const body = ctx.body;
      if ("fromMealprintPlanId" in body) {
        return createFromMealprint(ctx, userId, body);
      }
      return createPlan(ctx, userId, body, "manual");
    },
    {
      // `{name, meals}`, or (PER-119, N21) `{fromMealprintPlanId, name?}`:
      // save a Mealprint day as a list plan with no weekdays.
      body: t.Union([
        t.Object(planBodyFields),
        t.Object({
          fromMealprintPlanId: t.String({ format: "uuid" }),
          name: t.Optional(t.String({ minLength: 1, maxLength: 80 })),
        }),
      ]),
    },
  )
  .get(
    "/nutrition/meal-plans/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const readable = await repo().getReadable(userId, ctx.params.id);
      if (!readable) {
        ctx.set.status = 404;
        return NOT_FOUND;
      }
      const plan = await repo().getDto(userId, readable.plan);
      if (readable.role === "owner")
        return { data: { ...plan, assignment: null } };
      const a = readable.assignment;
      return {
        data: {
          ...plan,
          assignment: {
            id: a.id,
            trainerId: a.trainerId,
            note: a.note,
            status: a.status,
            sentAt: a.sentAt.toISOString(),
            updatedSinceSeen: readable.plan.revision > a.seenRevision,
          },
        },
      };
    },
    { params: idParams },
  )
  .put(
    "/nutrition/meal-plans/:id",
    async (ctx) => replacePlan(ctx, getUser(ctx).sub, ctx.params.id, ctx.body),
    {
      params: idParams,
      body: t.Object({
        ...planBodyFields,
        expectedRevision: t.Optional(t.Integer({ minimum: 1 })),
      }),
    },
  )
  .delete(
    "/nutrition/meal-plans/:id",
    async (ctx) => archivePlan(ctx, getUser(ctx).sub, ctx.params.id),
    { params: idParams },
  )
  .post(
    "/nutrition/meal-plans/:id/duplicate",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const key = readIdempotencyKey(ctx.headers);
      // A replay must still answer after the source was archived or removed.
      if (key) {
        const existing = await repo().findByKey(userId, key);
        if (existing) {
          ctx.set.status = 201;
          return { data: await repo().getDto(userId, existing) };
        }
      }
      const readable = await repo().getReadable(userId, ctx.params.id);
      if (!readable) {
        ctx.set.status = 404;
        return NOT_FOUND;
      }
      // No capability check: any client with the assignment may duplicate.
      const { plan } = await duplicatePlan(readable.plan, userId, key);
      ctx.set.status = 201;
      return { data: plan };
    },
    { params: idParams },
  )
  .post(
    "/nutrition/meal-plans/:id/assignment",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const result = await clientUpdateAssignment(
        userId,
        ctx.params.id,
        ctx.body,
      );
      if (!result) {
        ctx.set.status = 404;
        return NOT_FOUND;
      }
      return {
        data: {
          ...result.assignment,
          updatedSinceSeen: result.updatedSinceSeen,
        },
      };
    },
    {
      params: idParams,
      body: t.Object({
        status: t.Optional(
          t.Union([t.Literal("added"), t.Literal("dismissed")]),
        ),
        seenRevision: t.Optional(t.Integer({ minimum: 0 })),
      }),
    },
  );

/** Trainer role or 403 — the coach library is the coach's own plans only. */
async function requireTrainer(ctx: Ctx, userId: string) {
  if (await isActiveTrainer(userId)) return null;
  ctx.set.status = 403;
  return NOT_A_TRAINER;
}

/** `/trainers/me/meal-plans*` — the coach library (C1 / C2 Nutrition library). */
export const trainerMealPlanLibraryHandlers = authed()
  .get(
    "/trainers/me/meal-plans",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const denied = await requireTrainer(ctx, userId);
      if (denied) return denied;
      const since = parseSince(ctx.query.since);
      if (since === "invalid") {
        ctx.set.status = 400;
        return { error: "invalid_since" };
      }
      const asOf = listAsOf();
      const mine = await repo().listMine(userId, since);
      return { data: { plans: mine.plans, deletedIds: mine.deletedIds, asOf } };
    },
    { query: sinceQuery },
  )
  .post(
    "/trainers/me/meal-plans",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const denied = await requireTrainer(ctx, userId);
      if (denied) return denied;
      return createPlan(ctx, userId, ctx.body, "coach");
    },
    { body: t.Object(planBodyFields) },
  )
  .get(
    "/trainers/me/meal-plans/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const denied = await requireTrainer(ctx, userId);
      if (denied) return denied;
      const plan = await repo().getOwned(userId, ctx.params.id);
      if (!plan) {
        ctx.set.status = 404;
        return NOT_FOUND;
      }
      return { data: await repo().getDto(userId, plan) };
    },
    { params: idParams },
  )
  .put(
    "/trainers/me/meal-plans/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const denied = await requireTrainer(ctx, userId);
      if (denied) return denied;
      return replacePlan(ctx, userId, ctx.params.id, ctx.body);
    },
    {
      params: idParams,
      body: t.Object({
        ...planBodyFields,
        expectedRevision: t.Optional(t.Integer({ minimum: 1 })),
      }),
    },
  )
  .delete(
    "/trainers/me/meal-plans/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const denied = await requireTrainer(ctx, userId);
      if (denied) return denied;
      return archivePlan(ctx, userId, ctx.params.id);
    },
    { params: idParams },
  );
