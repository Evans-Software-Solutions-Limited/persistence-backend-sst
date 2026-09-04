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
    case "invalid_months":
      return {
        status: 400,
        body: { message: "Months must be between 1 and 120" },
      };
    case "invalid_contribution":
      return {
        status: 400,
        body: {
          message: "Contribution details are incomplete or inconsistent",
        },
      };
    case "contribution_reference_required":
      return {
        status: 400,
        body: {
          message: "Enter the bank or Stripe reference for this contribution",
          code: "contribution_reference_required",
        },
      };
    case "account_pending_deletion":
      return {
        status: 409 as const,
        body: {
          message:
            "This account is pending deletion. Restore it before granting, or wait until deletion finishes and the buyer signs up again.",
          code: "account_pending_deletion",
        },
      };
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
            "This account has a live App Store or Play Store subscription. Grant access after the store subscription expires.",
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
        body: { message: "This person already has a live access grant" },
      };
  }
}

/** /admin/founding-grants — catalogue, list, create (+invite), revoke, resend. */
const catalogueOffers = Object.fromEntries(
  Object.entries(FOUNDING_OFFERS).map(([tier, offer]) => [
    tier,
    { months: offer.months, pool: offer.pool, label: offer.label },
  ]),
);

export const adminFoundingGrantsHandler = new Elysia()
  .use(adminGuard)
  .get("/admin/founding-grants/catalogue", async () => {
    const repo = new FoundingGrantRepository();
    const [consumer, coach] = await Promise.all([
      repo.seatsForPool("consumer"),
      repo.seatsForPool("coach"),
    ]);
    return {
      data: {
        offers: catalogueOffers,
        caps: { consumer: consumer.cap, coach: coach.cap },
        contributionMethods: FOUNDING_PAYMENT_METHODS,
      },
    };
  })
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
      const contributedAt = ctx.body.contributedAt
        ? new Date(ctx.body.contributedAt)
        : undefined;
      if (contributedAt && Number.isNaN(contributedAt.getTime())) {
        ctx.set.status = 400;
        return { message: "contributedAt is not a valid date" };
      }
      const outcome = await new FoundingGrantService().grant(
        {
          email: ctx.body.email,
          userId: ctx.body.userId,
          tierName: ctx.body.tierName,
          grantKind: ctx.body.grantKind,
          months: ctx.body.months,
          contributionAmountMinor: ctx.body.contributionAmountMinor,
          contributionCurrency: ctx.body.contributionCurrency,
          contributionMethod: ctx.body.contributionMethod ?? null,
          contributionReference: ctx.body.contributionReference ?? null,
          contributedAt,
          referralCode: ctx.body.referralCode ?? null,
          notes: ctx.body.notes ?? null,
          allowRoleChange: ctx.body.allowRoleChange ?? false,
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
        grantKind: t.Union([t.Literal("founding"), t.Literal("complimentary")]),
        months: t.Integer({ minimum: 1, maximum: 120 }),
        contributionAmountMinor: t.Optional(t.Integer({ minimum: 0 })),
        contributionCurrency: t.Optional(
          t.String({ minLength: 3, maxLength: 3 }),
        ),
        contributionMethod: t.Optional(t.Nullable(PAYMENT_METHOD)),
        contributionReference: t.Optional(
          t.Nullable(t.String({ maxLength: 200 })),
        ),
        contributedAt: t.Optional(t.String()),
        referralCode: t.Optional(t.Nullable(t.String({ maxLength: 64 }))),
        notes: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
        allowRoleChange: t.Optional(t.Boolean()),
        sendInvite: t.Optional(t.Boolean()),
      }),
    },
  )
  .post(
    "/admin/founding-grants/:id/extend",
    async (ctx) => {
      const { sub: actorId } = getUser(ctx);
      const res = await new FoundingGrantService().extend(
        ctx.params.id,
        ctx.body.additionalMonths,
        ctx.body.reason,
        actorId,
      );
      if (!res.ok) {
        ctx.set.status =
          res.error === "not_found"
            ? 404
            : res.error === "invalid_months"
              ? 400
              : 409;
        return { message: res.error, code: res.error };
      }
      return { data: res.result };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        additionalMonths: t.Integer({ minimum: 1, maximum: 120 }),
        reason: t.String({ minLength: 3, maxLength: 500 }),
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
