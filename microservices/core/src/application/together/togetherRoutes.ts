import Elysia, { t } from "elysia";
import {
  getAuthUser,
  getUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";
import { TogetherRepository } from "./togetherRepository";
import { TogetherError, withActors, enforceRateLimit } from "./shared";
import {
  uuidSchema,
  planSchema,
  executionSchema,
  commandSchema,
} from "./types";
import { wakeTogether } from "./transport";
const headers = t.Object(
  { "idempotency-key": uuidSchema },
  { additionalProperties: true },
);
const params = t.Object({ id: uuidSchema });
const finish = t.Object({ expectedOwnRevision: t.Integer({ minimum: 0 }) });
const repository = new TogetherRepository();
export const togetherRoutes = new Elysia({ name: "togetherRoutes" })
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle((ctx) => {
    if (requireAuth(ctx))
      return {
        error: { code: "UNAUTHENTICATED", message: "Authentication required" },
      };
  })
  .onBeforeHandle(async (ctx) => {
    await withActors([getUser(ctx).sub], (tx) =>
      enforceRateLimit(tx, getUser(ctx).sub, "together-http", 120),
    );
  })
  .onError(({ error, set, code }) => {
    if (code === "VALIDATION") {
      set.status = 400;
      return { error: { code: "INVALID_SCHEMA", message: "Invalid request" } };
    }
    if (error instanceof TogetherError) {
      set.status = error.status;
      if (error.status === 429) set.headers["Retry-After"] = "60";
      return {
        error: {
          code: error.code,
          message: error.message,
          ...(error.currentRevision === undefined
            ? {}
            : { currentRevision: error.currentRevision }),
        },
      };
    }
  })
  .onAfterHandle(async ({ request }) => {
    if (request.method !== "GET") await wakeTogether();
  })
  .post(
    "/together/sessions",
    async (c) => ({
      data: await repository.create(
        getUser(c).sub,
        c.headers["idempotency-key"],
        c.body,
      ),
    }),
    {
      headers,
      body: t.Object({
        clientDraftId: uuidSchema,
        plan: planSchema,
        ownExecution: executionSchema,
      }),
    },
  )
  .get("/together/sessions/active", (c) => repository.active(getUser(c).sub))
  .get(
    "/together/sessions/:id",
    async (c) => ({
      data: await repository.snapshot(getUser(c).sub, c.params.id),
    }),
    { params },
  )
  .post(
    "/together/sessions/:id/invites",
    async (c) => ({
      data: await repository.invite(
        getUser(c).sub,
        c.params.id,
        c.headers["idempotency-key"],
        c.body,
      ),
    }),
    { params, headers, body: t.Object({ expiresInMinutes: t.Literal(15) }) },
  )
  .delete(
    "/together/sessions/:id/invites/:tokenId",
    async (c) => ({
      data: await repository.revokeInvite(
        getUser(c).sub,
        c.params.id,
        c.params.tokenId,
        c.headers["idempotency-key"],
      ),
    }),
    { params: t.Object({ id: uuidSchema, tokenId: uuidSchema }), headers },
  )
  .post(
    "/together/join-requests",
    async (c) => ({
      data: await repository.requestJoin(
        getUser(c).sub,
        c.headers["idempotency-key"],
        c.body,
      ),
    }),
    {
      headers,
      body: t.Union([
        t.Object({
          inviteToken: t.String({ minLength: 20, maxLength: 200 }),
          consentVersion: t.Literal("together-v1"),
          consentAccepted: t.Literal(true),
        }),
        t.Object({
          sessionId: uuidSchema,
          consentVersion: t.Literal("together-v1"),
          consentAccepted: t.Literal(true),
        }),
      ]),
    },
  )
  .get(
    "/together/sessions/:id/join-requests",
    (c) => repository.listRequests(getUser(c).sub, c.params.id, c.query),
    {
      params,
      query: t.Object({
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
        cursor: t.Optional(t.String({ maxLength: 1000 })),
      }),
    },
  )
  .post(
    "/together/sessions/:id/join-requests/:requestId/decision",
    async (c) => ({
      data: await repository.decide(
        getUser(c).sub,
        c.params.id,
        c.params.requestId,
        c.headers["idempotency-key"],
        c.body,
      ),
    }),
    {
      headers,
      params: t.Object({ id: uuidSchema, requestId: uuidSchema }),
      body: t.Object({
        decision: t.Union([t.Literal("approve"), t.Literal("reject")]),
        expectedRevision: t.Integer({ minimum: 1 }),
      }),
    },
  )
  .post(
    "/together/sessions/:id/commands",
    async (c) => ({
      data: await repository.command(
        getUser(c).sub,
        c.params.id,
        c.headers["idempotency-key"],
        c.body,
      ),
    }),
    { headers, params, body: commandSchema },
  )
  .put(
    "/together/sessions/:id/delegation",
    async (c) => ({
      data: await repository.delegation(
        getUser(c).sub,
        c.params.id,
        c.headers["idempotency-key"],
        c.body,
      ),
    }),
    { headers, params, body: t.Object({ allowPartnerLogging: t.Boolean() }) },
  )
  .put(
    "/together/sessions/:id/visibility",
    async (c) => ({
      data: await repository.visibility(
        getUser(c).sub,
        c.params.id,
        c.headers["idempotency-key"],
        c.body,
      ),
    }),
    {
      headers,
      params,
      body: t.Object({
        audience: t.Union([
          t.Literal("private"),
          t.Literal("friends"),
          t.Literal("nearby"),
        ]),
        placeId: t.Optional(t.String({ minLength: 1, maxLength: 300 })),
        expiresAt: t.String({ format: "date-time" }),
      }),
    },
  )
  .get(
    "/together/discovery",
    (c) => repository.discovery(getUser(c).sub, c.query),
    {
      query: t.Object({
        audience: t.Union([t.Literal("friends"), t.Literal("nearby")]),
        placeId: t.Optional(t.String({ maxLength: 300 })),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
        cursor: t.Optional(t.String({ maxLength: 1000 })),
      }),
    },
  )
  .get(
    "/together/sessions/:id/events",
    (c) =>
      repository.events(getUser(c).sub, c.params.id, c.query.afterRevision),
    { params, query: t.Object({ afterRevision: t.Numeric({ minimum: 0 }) }) },
  )
  .post(
    "/together/sessions/:id/realtime-ticket",
    async (c) => ({
      data: await repository.ticket(
        getUser(c).sub,
        c.params.id,
        c.headers["idempotency-key"],
      ),
    }),
    { params, headers, body: t.Object({}) },
  )
  .post(
    "/together/sessions/:id/finish",
    async (c) => ({
      data: await repository.finish(
        getUser(c).sub,
        c.params.id,
        c.headers["idempotency-key"],
        c.body,
      ),
    }),
    { params, headers, body: finish },
  )
  .post(
    "/together/sessions/:id/leave",
    async (c) => ({
      data: await repository.finish(
        getUser(c).sub,
        c.params.id,
        c.headers["idempotency-key"],
        c.body,
        true,
      ),
    }),
    { params, headers, body: finish },
  );
