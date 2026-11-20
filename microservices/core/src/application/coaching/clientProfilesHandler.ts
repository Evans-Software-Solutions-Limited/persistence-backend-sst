import Elysia, { t } from "elysia";
import {
  getAuthUser,
  getUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";
import { readIdempotencyKey } from "../shared/idempotencyKey";
import { assertTrainerCanInvite } from "../trainers/seats/trainerSeats";
import { assertTrainerCanActForClient } from "../relationships/assertTrainerCanActForClient";
import {
  ClientProfileRepository,
  isActiveTrainer,
  isRefusal,
  isUuid,
  type Refusal,
} from "./clientProfileRepository";
import { hasAcceptedCurrentDeclaration } from "./declaration";

/**
 * Invited client profiles (PER-108, design A D3, canvas C11). Every route
 * requires the trainer role; a profile that isn't the caller's is a 404.
 *
 * Offline: create/patch/setup/delete are queueable (Idempotency-Key on create,
 * `expectedRevision` on edits → 409 `revision_conflict` with the current row).
 * Issuing, resending or cancelling a code and copy-from need a connection.
 */

const repo = () => new ClientProfileRepository();

type Ctx = { set: { status?: number | string } };

/** Map a domain refusal to its HTTP status and body. */
export function refusalResponse(ctx: Ctx, refusal: Refusal) {
  switch (refusal.refused) {
    case "not_found":
      ctx.set.status = 404;
      return { code: "not_found", message: "Client profile not found" };
    case "revision_conflict":
      ctx.set.status = 409;
      return {
        code: "revision_conflict",
        message: "This profile was updated on another device",
        current: refusal.current,
      };
    case "not_editable":
      ctx.set.status = 409;
      return {
        code: "profile_not_editable",
        message: `This profile is ${refusal.status} and can no longer be changed`,
        status: refusal.status,
      };
    case "section_unavailable":
      ctx.set.status = 422;
      return {
        code: "section_unavailable",
        message: `${refusal.section} can't be set up yet`,
        section: refusal.section,
      };
    case "invalid_setup":
      ctx.set.status = 400;
      return { code: "invalid_setup", message: refusal.message };
  }
}

const nullableText = (maxLength: number) =>
  t.Optional(t.Union([t.String({ maxLength }), t.Null()]));

const profileFields = {
  contactEmail: nullableText(320),
  contactPhone: nullableText(40),
  goal: nullableText(200),
  privateNotes: nullableText(4000),
};

const idParams = t.Object({ id: t.String() });

const forbidden = (ctx: Ctx) => {
  ctx.set.status = 403;
  return {
    code: "not_a_trainer",
    message: "Coach actions require a trainer role",
  };
};

export const clientProfilesHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .onBeforeHandle(async (ctx) => {
    if (!(await isActiveTrainer(getUser(ctx).sub))) return forbidden(ctx);
  })
  .post(
    "/trainers/me/client-profiles",
    async (ctx) => {
      const { sub } = getUser(ctx);
      const displayName = ctx.body.displayName.trim();
      if (displayName.length === 0) {
        ctx.set.status = 400;
        return { code: "invalid_profile", message: "displayName is required" };
      }
      const { profile, created } = await repo().create(
        sub,
        { ...ctx.body, displayName },
        readIdempotencyKey(ctx.headers),
      );
      ctx.set.status = created ? 201 : 200;
      return { data: profile };
    },
    {
      body: t.Object({
        displayName: t.String({ minLength: 1, maxLength: 80 }),
        ...profileFields,
      }),
    },
  )
  .get(
    "/trainers/me/client-profiles",
    async (ctx) => {
      const { sub } = getUser(ctx);
      let since: Date | undefined;
      if (ctx.query.since) {
        since = new Date(ctx.query.since);
        if (Number.isNaN(since.getTime())) {
          ctx.set.status = 400;
          return {
            code: "invalid_since",
            message: "since must be an ISO date",
          };
        }
      }
      return repo().list(sub, { status: ctx.query.status, since });
    },
    {
      query: t.Object({
        status: t.Optional(
          t.Union([
            t.Literal("invited"),
            t.Literal("active"),
            t.Literal("cancelled"),
            t.Literal("ended"),
          ]),
        ),
        since: t.Optional(t.String()),
      }),
    },
  )
  .get(
    "/trainers/me/client-profiles/:id",
    async (ctx) => {
      const profile = await repo().detail(getUser(ctx).sub, ctx.params.id);
      if (!profile) return refusalResponse(ctx, { refused: "not_found" });
      return { data: profile };
    },
    { params: idParams },
  )
  .patch(
    "/trainers/me/client-profiles/:id",
    async (ctx) => {
      const { expectedRevision, ...fields } = ctx.body;
      if (fields.displayName !== undefined) {
        fields.displayName = fields.displayName.trim();
        if (fields.displayName.length === 0) {
          ctx.set.status = 400;
          return {
            code: "invalid_profile",
            message: "displayName is required",
          };
        }
      }
      const result = await repo().patch(
        getUser(ctx).sub,
        ctx.params.id,
        fields,
        expectedRevision,
      );
      return isRefusal(result)
        ? refusalResponse(ctx, result)
        : { data: result };
    },
    {
      params: idParams,
      body: t.Object({
        displayName: t.Optional(t.String({ minLength: 1, maxLength: 80 })),
        ...profileFields,
        expectedRevision: t.Optional(t.Integer({ minimum: 1 })),
      }),
    },
  )
  .put(
    "/trainers/me/client-profiles/:id/setup/:section",
    async (ctx) => {
      const result = await repo().replaceSection(
        getUser(ctx).sub,
        ctx.params.id,
        ctx.params.section,
        ctx.body.items.map((i) => ({
          refId: i.refId ?? null,
          config: i.config ?? {},
          sortOrder: i.sortOrder,
        })),
        ctx.body.expectedRevision,
      );
      return isRefusal(result)
        ? refusalResponse(ctx, result)
        : { data: result };
    },
    {
      params: t.Object({ id: t.String(), section: t.String() }),
      body: t.Object({
        items: t.Array(
          t.Object({
            refId: t.Optional(
              t.Union([t.String({ format: "uuid" }), t.Null()]),
            ),
            config: t.Optional(t.Record(t.String(), t.Unknown())),
            sortOrder: t.Integer({ minimum: 0 }),
          }),
          { maxItems: 50 },
        ),
        expectedRevision: t.Optional(t.Integer({ minimum: 1 })),
      }),
    },
  )
  .post(
    "/trainers/me/client-profiles/:id/setup/copy-from",
    async (ctx) => {
      const { sourceClientId, sourceProfileId, sections } = ctx.body;
      if (!!sourceClientId === !!sourceProfileId) {
        ctx.set.status = 400;
        return {
          code: "invalid_source",
          message: "Give exactly one of sourceClientId or sourceProfileId",
        };
      }
      const { sub } = getUser(ctx);
      if (sourceClientId) {
        // Only from one of the caller's own active clients.
        const verdict = isUuid(sourceClientId)
          ? await assertTrainerCanActForClient(sub, sourceClientId)
          : null;
        if (!verdict?.allowed) {
          ctx.set.status = 403;
          return {
            code: "not_your_client",
            message: "You can only act for your active clients",
          };
        }
      }
      const result = await repo().copyFrom(
        sub,
        ctx.params.id,
        sourceClientId
          ? { kind: "client", clientId: sourceClientId }
          : { kind: "profile", profileId: sourceProfileId as string },
        sections,
      );
      return isRefusal(result)
        ? refusalResponse(ctx, result)
        : { data: result };
    },
    {
      params: idParams,
      body: t.Object({
        sourceClientId: t.Optional(t.String()),
        sourceProfileId: t.Optional(t.String()),
        sections: t.Optional(t.Array(t.String(), { maxItems: 7 })),
      }),
    },
  )
  .get(
    "/trainers/me/client-profiles/:id/preview",
    async (ctx) => {
      const preview = await repo().preview(getUser(ctx).sub, ctx.params.id);
      if (!preview) return refusalResponse(ctx, { refused: "not_found" });
      return { data: preview };
    },
    { params: idParams },
  )
  .post(
    "/trainers/me/client-profiles/:id/invite",
    async (ctx) => {
      const { sub } = getUser(ctx);
      if (!(await repo().findOwned(sub, ctx.params.id))) {
        return refusalResponse(ctx, { refused: "not_found" });
      }
      // D6b: only this NEW route is gated on the declaration.
      if (!(await hasAcceptedCurrentDeclaration(sub))) {
        ctx.set.status = 403;
        return {
          code: "declaration_required",
          message: "Confirm the coach declaration before inviting a client",
        };
      }
      // Seat cap (throws EntitlementError → 402 via coreErrorHandler).
      await assertTrainerCanInvite(sub);
      const result = await repo().issueInvite(
        sub,
        ctx.params.id,
        readIdempotencyKey(ctx.headers),
      );
      if (isRefusal(result)) return refusalResponse(ctx, result);
      ctx.set.status = 201;
      return {
        data: {
          code: result.code,
          link: result.link,
          expiresAt: result.expiresAt,
        },
      };
    },
    { params: idParams },
  )
  .delete(
    "/trainers/me/client-profiles/:id/invite",
    async (ctx) => {
      const result = await repo().cancelInvite(getUser(ctx).sub, ctx.params.id);
      if (isRefusal(result)) return refusalResponse(ctx, result);
      ctx.set.status = 204;
      return new Response(null, { status: 204 });
    },
    { params: idParams },
  )
  .delete(
    "/trainers/me/client-profiles/:id",
    async (ctx) => {
      const result = await repo().remove(getUser(ctx).sub, ctx.params.id);
      if (isRefusal(result)) return refusalResponse(ctx, result);
      ctx.set.status = 204;
      return new Response(null, { status: 204 });
    },
    { params: idParams },
  );
