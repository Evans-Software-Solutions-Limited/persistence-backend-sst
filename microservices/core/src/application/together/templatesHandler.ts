import Elysia, { t } from "elysia";
import {
  getAuthUser,
  getUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";
import { templatesRepository as repo } from "./templatesRepository";
import { TogetherError, withActors, enforceRateLimit } from "./shared";
import {
  socialMutationHeaders,
  socialPageQuery,
} from "../social/socialHandler";
const params = t.Object({ id: t.String({ format: "uuid" }) });
export const templatePlanSchema = t.Object(
  {
    name: t.String({ minLength: 1, maxLength: 200 }),
    exercises: t.Array(
      t.Object(
        {
          planExerciseId: t.String({ format: "uuid" }),
          exerciseId: t.String({ format: "uuid" }),
          order: t.Integer({ minimum: 0, maximum: 99 }),
          targetSets: t.Integer({ minimum: 0, maximum: 100 }),
          targetReps: t.Optional(t.Integer({ minimum: 0, maximum: 10000 })),
        },
        { additionalProperties: false },
      ),
      { maxItems: 100 },
    ),
  },
  { additionalProperties: false },
);
export const templatesHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .onBeforeHandle(async (c) => {
    if (
      c.request.method === "POST" &&
      new URL(c.request.url).pathname === "/together/templates"
    )
      await withActors([getUser(c).sub], (tx) =>
        enforceRateLimit(tx, getUser(c).sub, "invite"),
      );
  })
  .onError(({ error, code, set }) => {
    if (code === "VALIDATION") {
      set.status = 400;
      return { error: { code: "INVALID_SCHEMA", message: "Invalid request" } };
    }
    if (error instanceof TogetherError) {
      set.status = error.status;
      if (error.status === 429) set.headers["Retry-After"] = "60";
      return { error: { code: error.code, message: error.message } };
    }
  })
  .post(
    "/together/templates",
    async (c) => ({
      data: await repo.create(
        getUser(c).sub,
        c.headers["idempotency-key"],
        c.body.recipientUserId,
        c.body.plan,
      ),
    }),
    {
      headers: socialMutationHeaders,
      body: t.Object(
        {
          recipientUserId: t.String({ format: "uuid" }),
          plan: templatePlanSchema,
        },
        { additionalProperties: false },
      ),
    },
  )
  .get(
    "/together/templates",
    (c) => repo.list(getUser(c).sub, c.query.limit, c.query.cursor),
    { query: socialPageQuery },
  )
  .get(
    "/together/templates/:id",
    async (c) => ({ data: await repo.get(getUser(c).sub, c.params.id) }),
    { params },
  )
  .post(
    "/together/templates/:id/copy",
    async (c) => ({
      data: await repo.copy(
        getUser(c).sub,
        c.params.id,
        c.headers["idempotency-key"],
      ),
    }),
    {
      params,
      headers: socialMutationHeaders,
      body: t.Object({}, { additionalProperties: false }),
    },
  )
  .delete(
    "/together/templates/:id",
    async (c) => ({
      data: await repo.revoke(
        getUser(c).sub,
        c.params.id,
        c.headers["idempotency-key"],
      ),
    }),
    { params, headers: socialMutationHeaders },
  );
