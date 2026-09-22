import Elysia, { t } from "elysia";
import {
  getAuthUser,
  getUser,
  requireAuth,
  isAdmin,
} from "@persistence/api-utils/auth/supabaseAuth";
import { socialRepository as repo } from "./socialRepository";
import {
  TogetherError,
  withActors,
  enforceRateLimit,
} from "../together/shared";
export const socialPageQuery = t.Object({
  cursor: t.Optional(t.String({ maxLength: 1000 })),
  limit: t.Optional(
    t.Numeric({ minimum: 1, maximum: 50, multipleOf: 1, default: 20 }),
  ),
});
export const socialMutationHeaders = t.Object(
  { "idempotency-key": t.String({ format: "uuid" }) },
  { additionalProperties: true },
);
const userParams = t.Object({ userId: t.String({ format: "uuid" }) });
export const socialHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .onBeforeHandle(async (c) => {
    const path = new URL(c.request.url).pathname;
    const bucket =
      path === "/social/people"
        ? "search"
        : c.request.method === "POST" && path === "/social/requests"
          ? "invite"
          : path === "/social/reports"
            ? "report"
            : null;
    if (bucket)
      await withActors([getUser(c).sub], (tx) =>
        enforceRateLimit(
          tx,
          getUser(c).sub,
          bucket,
          bucket === "report" ? 10 : 30,
        ),
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
  .put(
    "/social/profile",
    async (c) => ({
      data: await repo.profile(
        getUser(c).sub,
        c.headers["idempotency-key"],
        c.body.discoverable,
      ),
    }),
    {
      headers: socialMutationHeaders,
      body: t.Object(
        { discoverable: t.Boolean() },
        { additionalProperties: false },
      ),
    },
  )
  .get(
    "/social/people",
    (c) =>
      repo.people(getUser(c).sub, c.query.q, c.query.limit, c.query.cursor),
    {
      query: t.Object({
        ...socialPageQuery.properties,
        q: t.String({ minLength: 2, maxLength: 100 }),
      }),
    },
  )
  .get(
    "/social/friends",
    (c) => repo.list(getUser(c).sub, "accepted", c.query.limit, c.query.cursor),
    { query: socialPageQuery },
  )
  .get(
    "/social/requests",
    (c) => repo.list(getUser(c).sub, "pending", c.query.limit, c.query.cursor),
    { query: socialPageQuery },
  )
  .post(
    "/social/requests",
    async (c) => ({
      data: await repo.request(
        getUser(c).sub,
        c.body.userId,
        c.headers["idempotency-key"],
      ),
    }),
    { headers: socialMutationHeaders, body: userParams },
  )
  .post(
    "/social/requests/:id/decision",
    async (c) => ({
      data: await repo.decision(
        getUser(c).sub,
        c.params.id,
        c.headers["idempotency-key"],
        c.body.decision,
      ),
    }),
    {
      headers: socialMutationHeaders,
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        decision: t.Union([t.Literal("accept"), t.Literal("reject")]),
      }),
    },
  )
  .delete(
    "/social/friends/:userId",
    async (c) => ({
      data: await repo.remove(
        getUser(c).sub,
        c.params.userId,
        c.headers["idempotency-key"],
      ),
    }),
    { headers: socialMutationHeaders, params: userParams },
  )
  .put(
    "/social/blocks/:userId",
    async (c) => ({
      data: await repo.block(
        getUser(c).sub,
        c.params.userId,
        c.headers["idempotency-key"],
        true,
      ),
    }),
    {
      headers: socialMutationHeaders,
      params: userParams,
      body: t.Object({}, { additionalProperties: false }),
    },
  )
  .delete(
    "/social/blocks/:userId",
    async (c) => ({
      data: await repo.block(
        getUser(c).sub,
        c.params.userId,
        c.headers["idempotency-key"],
        false,
      ),
    }),
    { headers: socialMutationHeaders, params: userParams },
  )
  .post(
    "/social/reports",
    async (c) => ({
      data: await repo.report(
        getUser(c).sub,
        c.headers["idempotency-key"],
        c.body,
      ),
    }),
    {
      headers: socialMutationHeaders,
      body: t.Object(
        {
          subjectUserId: t.String({ format: "uuid" }),
          context: t.Union([t.Literal("together"), t.Literal("coach")]),
          resourceId: t.Optional(t.String({ format: "uuid" })),
          reason: t.Union([
            t.Literal("harassment"),
            t.Literal("spam"),
            t.Literal("unsafe"),
            t.Literal("other"),
          ]),
          details: t.Optional(t.String({ maxLength: 2000 })),
        },
        { additionalProperties: false },
      ),
    },
  )
  .get(
    "/social/moderation/reports",
    (c) => {
      if (!isAdmin(c.user)) {
        c.set.status = 403;
        return { error: { code: "FORBIDDEN", message: "Forbidden" } };
      }
      return repo.moderation(getUser(c).sub, c.query.limit, c.query.cursor);
    },
    { query: socialPageQuery },
  );
