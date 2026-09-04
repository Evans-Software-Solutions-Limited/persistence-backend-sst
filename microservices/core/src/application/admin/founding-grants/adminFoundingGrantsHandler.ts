import Elysia, { t } from "elysia";
import { adminGuard } from "../_adminGuard";
import { getUser } from "@persistence/api-utils/auth/supabaseAuth";
import { FoundingGrantRepository } from "../../repositories/foundingGrantRepository";
import {
  FoundingGrantService,
  type GrantError,
} from "../../founding/foundingGrantService";
import {
  FOUNDING_OFFERS,
  FOUNDING_POOL_CAPS,
  FOUNDING_PAYMENT_METHODS,
} from "../../founding/foundingOffer";

const PAYMENT_METHOD = t.Union(
  FOUNDING_PAYMENT_METHODS.map((m) => t.Literal(m)),
);

function grantErrorResponse(error: GrantError): {
  status: number;
  body: Record<string, unknown>;
} {
  switch (error.code) {
    case "invalid_tier":
      return {
        status: 400,
        body: { message: "That tier isn't part of the founding offer" },
      };
    case "tier_missing":
      return {
        status: 500,
        body: {
          message: "Tier row missing in this environment — run migrations",
        },
      };
    case "invalid_email":
      return { status: 400, body: { message: "Enter a valid email address" } };
    case "user_not_found":
      return { status: 404, body: { message: "No account with that id" } };
    case "coach_demotion":
      return {
        status: 409,
        body: {
          message:
            "This account is a coach — a consumer tier would switch it to a regular user. Grant a coach tier, or confirm the role change.",
          code: "coach_demotion",
        },
      };
    case "active_store_subscription":
      return {
        status: 409,
        body: {
          message:
            "This account has a live App Store subscription. A founding grant would be undone by the next store sync. Grant after it expires, or confirm the override.",
          code: "active_store_subscription",
          subscription: error.subscription,
        },
      };
    case "invalid_referral_code":
      return {
        status: 400,
        body: { message: "That referral code isn't valid" },
      };
    case "referral_locked_elsewhere":
      return {
        status: 409,
        body: {
          message: "This user is already locked to a different referral code",
        },
      };
    case "pool_full":
      return {
        status: 409,
        body: { message: "Founding pool is full", seats: error.seats },
      };
    case "duplicate":
      return {
        status: 409,
        body: { message: "This person already has a live founding grant" },
      };
  }
}

/** /admin/founding-grants — catalogue, list, create (+invite), revoke, resend. */
export const adminFoundingGrantsHandler = new Elysia()
  .use(adminGuard)
  .get("/admin/founding-grants/catalogue", () => ({
    data: {
      offers: FOUNDING_OFFERS,
      caps: FOUNDING_POOL_CAPS,
      paymentMethods: FOUNDING_PAYMENT_METHODS,
    },
  }))
  .get(
    "/admin/founding-grants",
    async ({ query }) => ({
      data: await new FoundingGrantRepository().list({
        revoked:
          query.revoked === undefined ? undefined : query.revoked === "true",
        limit: query.limit,
      }),
    }),
    {
      query: t.Object({
        revoked: t.Optional(t.Union([t.Literal("true"), t.Literal("false")])),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 1000 })),
      }),
    },
  )
  .post(
    "/admin/founding-grants",
    async (ctx) => {
      const { sub: actorId } = getUser(ctx);
      const paidAt = ctx.body.paidAt ? new Date(ctx.body.paidAt) : undefined;
      if (paidAt && Number.isNaN(paidAt.getTime())) {
        ctx.set.status = 400;
        return { message: "paidAt is not a valid date" };
      }
      const outcome = await new FoundingGrantService().grant(
        {
          email: ctx.body.email,
          userId: ctx.body.userId,
          tierName: ctx.body.tierName,
          amountMinor: ctx.body.amountMinor,
          currency: ctx.body.currency,
          paymentMethod: ctx.body.paymentMethod,
          paymentReference: ctx.body.paymentReference ?? null,
          paidAt,
          referralCode: ctx.body.referralCode ?? null,
          notes: ctx.body.notes ?? null,
          allowRoleChange: ctx.body.allowRoleChange ?? false,
          allowSupersedeStoreSubscription:
            ctx.body.allowSupersedeStoreSubscription ?? false,
          sendInvite: ctx.body.sendInvite ?? true,
        },
        actorId,
      );
      if (!outcome.ok) {
        const { status, body } = grantErrorResponse(outcome.error);
        ctx.set.status = status;
        return body;
      }
      ctx.set.status = 201;
      return { data: outcome.result };
    },
    {
      body: t.Object({
        email: t.Optional(t.String({ maxLength: 320 })),
        userId: t.Optional(t.String({ format: "uuid" })),
        tierName: t.String(),
        amountMinor: t.Optional(t.Integer({ minimum: 0 })),
        currency: t.Optional(t.String({ minLength: 3, maxLength: 3 })),
        paymentMethod: PAYMENT_METHOD,
        paymentReference: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
        paidAt: t.Optional(t.String()),
        referralCode: t.Optional(t.Nullable(t.String({ maxLength: 64 }))),
        notes: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
        allowRoleChange: t.Optional(t.Boolean()),
        allowSupersedeStoreSubscription: t.Optional(t.Boolean()),
        sendInvite: t.Optional(t.Boolean()),
      }),
    },
  )
  .post(
    "/admin/founding-grants/:id/revoke",
    async (ctx) => {
      const { sub: actorId } = getUser(ctx);
      const res = await new FoundingGrantService().revoke(
        ctx.params.id,
        ctx.body.reason,
        actorId,
      );
      if (!res.ok) {
        ctx.set.status = res.error === "not_found" ? 404 : 409;
        return {
          message: res.error === "not_found" ? "Not found" : "Already revoked",
        };
      }
      return { data: { id: ctx.params.id, revoked: true } };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({ reason: t.String({ minLength: 3, maxLength: 500 }) }),
    },
  )
  .post(
    "/admin/founding-grants/:id/resend-invite",
    async (ctx) => {
      const { sub: actorId } = getUser(ctx);
      const res = await new FoundingGrantService().resendInvite(
        ctx.params.id,
        actorId,
      );
      if (!res.ok) {
        ctx.set.status =
          res.error === "not_found" ? 404 : res.error === "revoked" ? 409 : 502;
        return {
          message:
            res.error === "send_failed" ? "Email failed to send" : res.error,
        };
      }
      return { data: { id: ctx.params.id, sent: true } };
    },
    { params: t.Object({ id: t.String({ format: "uuid" }) }) },
  );
