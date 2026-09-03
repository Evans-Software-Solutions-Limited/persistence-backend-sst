import Elysia, { t } from "elysia";
import { adminGuard } from "../_adminGuard";
import { getUser } from "@persistence/api-utils/auth/supabaseAuth";
import { AdminAuditRepository } from "../../repositories/adminAuditRepository";
import { ReferralRepository } from "../../repositories/referralRepository";
import { isUniqueViolation } from "../../stripe/pgErrors";
import {
  isValidReferralCode,
  normalizeReferralCode,
} from "../../referrals/referralCode";
import { getDb } from "@persistence/db/client";

const KIND = t.Union([
  t.Literal("vendor"),
  t.Literal("campaign"),
  t.Literal("founding"),
  t.Literal("internal"),
]);
const STATUS = t.Union([
  t.Literal("active"),
  t.Literal("paused"),
  t.Literal("archived"),
]);

function parseDate(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** /admin/referral-codes — list, create, patch, redemptions. */
export const adminReferralCodesHandler = new Elysia()
  .use(adminGuard)
  .get(
    "/admin/referral-codes",
    async ({ query }) => ({
      data: await new ReferralRepository().listCodes({
        status: query.status,
        q: query.q,
      }),
    }),
    {
      query: t.Object({
        status: t.Optional(STATUS),
        q: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/admin/referral-codes",
    async (ctx) => {
      const { sub: actorId } = getUser(ctx);
      const canonical = normalizeReferralCode(ctx.body.code);
      if (!isValidReferralCode(canonical)) {
        ctx.set.status = 400;
        return { message: "Code must be 4–24 letters or digits" };
      }
      const startsAt = parseDate(ctx.body.startsAt);
      const endsAt = parseDate(ctx.body.endsAt);
      if (startsAt === undefined && ctx.body.startsAt) {
        ctx.set.status = 400;
        return { message: "startsAt is not a valid date" };
      }
      if (endsAt === undefined && ctx.body.endsAt) {
        ctx.set.status = 400;
        return { message: "endsAt is not a valid date" };
      }
      const repo = new ReferralRepository();
      try {
        const created = await getDb().transaction(async (transaction) => {
          const row = await repo.createCodeIn(transaction, {
            code: canonical,
            displayCode: ctx.body.displayCode?.trim() || canonical,
            label: ctx.body.label.trim(),
            partnerName: ctx.body.partnerName?.trim() || null,
            kind: ctx.body.kind,
            maxRedemptions: ctx.body.maxRedemptions ?? null,
            startsAt: startsAt ?? null,
            endsAt: endsAt ?? null,
            campaignSlug: ctx.body.campaignSlug?.trim() || null,
            notes: ctx.body.notes?.trim() || null,
            createdBy: actorId,
          });
          await new AdminAuditRepository().record(
            {
              actorId,
              action: "referral_code.create",
              entityType: "referral_code",
              entityId: row.id,
              after: {
                code: row.code,
                label: row.label,
                kind: row.kind,
                maxRedemptions: row.maxRedemptions,
              },
            },
            transaction,
          );
          return row;
        });
        ctx.set.status = 201;
        return { data: created };
      } catch (err) {
        if (isUniqueViolation(err)) {
          ctx.set.status = 409;
          return { message: "That code already exists" };
        }
        throw err;
      }
    },
    {
      body: t.Object({
        code: t.String({ minLength: 1, maxLength: 64 }),
        displayCode: t.Optional(t.String({ maxLength: 64 })),
        label: t.String({ minLength: 1, maxLength: 200 }),
        partnerName: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
        kind: KIND,
        maxRedemptions: t.Optional(t.Nullable(t.Integer({ minimum: 0 }))),
        startsAt: t.Optional(t.Nullable(t.String())),
        endsAt: t.Optional(t.Nullable(t.String())),
        campaignSlug: t.Optional(t.Nullable(t.String({ maxLength: 64 }))),
        notes: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
      }),
    },
  )
  .patch(
    "/admin/referral-codes/:id",
    async (ctx) => {
      const { sub: actorId } = getUser(ctx);
      const repo = new ReferralRepository();
      const startsAt = parseDate(ctx.body.startsAt);
      const endsAt = parseDate(ctx.body.endsAt);
      if (startsAt === undefined && ctx.body.startsAt) {
        ctx.set.status = 400;
        return { message: "startsAt is not a valid date" };
      }
      if (endsAt === undefined && ctx.body.endsAt) {
        ctx.set.status = 400;
        return { message: "endsAt is not a valid date" };
      }
      const result = await getDb().transaction(async (transaction) => {
        const before = await repo.findCodeByIdForUpdate(
          transaction,
          ctx.params.id,
        );
        if (!before) return null;
        const updated = await repo.updateCodeIn(transaction, ctx.params.id, {
          status: ctx.body.status,
          label: ctx.body.label?.trim(),
          partnerName:
            ctx.body.partnerName === undefined
              ? undefined
              : ctx.body.partnerName?.trim() || null,
          maxRedemptions: ctx.body.maxRedemptions,
          startsAt: startsAt === undefined ? undefined : startsAt,
          endsAt: endsAt === undefined ? undefined : endsAt,
          campaignSlug:
            ctx.body.campaignSlug === undefined
              ? undefined
              : ctx.body.campaignSlug?.trim() || null,
          notes:
            ctx.body.notes === undefined
              ? undefined
              : ctx.body.notes?.trim() || null,
        });
        await new AdminAuditRepository().record(
          {
            actorId,
            action: "referral_code.update",
            entityType: "referral_code",
            entityId: ctx.params.id,
            before: {
              status: before.status,
              label: before.label,
              maxRedemptions: before.maxRedemptions,
              startsAt: before.startsAt,
              endsAt: before.endsAt,
            },
            after: { ...ctx.body },
          },
          transaction,
        );
        return updated;
      });
      if (!result) {
        ctx.set.status = 404;
        return { message: "Not found" };
      }
      return { data: result };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        status: t.Optional(STATUS),
        label: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
        partnerName: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
        maxRedemptions: t.Optional(t.Nullable(t.Integer({ minimum: 0 }))),
        startsAt: t.Optional(t.Nullable(t.String())),
        endsAt: t.Optional(t.Nullable(t.String())),
        campaignSlug: t.Optional(t.Nullable(t.String({ maxLength: 64 }))),
        notes: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
      }),
    },
  )
  .get(
    "/admin/referral-codes/:id/redemptions",
    async (ctx) => {
      const repo = new ReferralRepository();
      const code = await repo.findCodeById(ctx.params.id);
      if (!code) {
        ctx.set.status = 404;
        return { message: "Not found" };
      }
      return { data: await repo.listRedemptionsForCode(ctx.params.id) };
    },
    { params: t.Object({ id: t.String({ format: "uuid" }) }) },
  );
