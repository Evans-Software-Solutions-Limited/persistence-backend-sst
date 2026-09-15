import { GRANTABLE_TIERS } from "@persistence/subscription-catalog";
import Elysia, { t } from "elysia";
import { getUser } from "@persistence/api-utils/auth/supabaseAuth";
import { adminGuard } from "../_adminGuard";
import { VoucherRepository } from "../../repositories/voucherRepository";
import { VoucherError } from "../../vouchers/voucherRules";
const id = t.String({ format: "uuid" });
const email = t.Nullable(t.String({ maxLength: 254 }));
const repo = () => new VoucherRepository();
export const adminVouchersHandler = new Elysia()
  .onError(({ error, set }) => {
    if (error instanceof VoucherError) {
      set.status = error.status;
      return { message: error.message, code: error.code };
    }
  })
  .use(adminGuard)
  .get(
    "/admin/voucher-batches",
    async ({ query }) => ({ data: await repo().list(query.q) }),
    { query: t.Object({ q: t.Optional(t.String({ maxLength: 200 })) }) },
  )
  .post(
    "/admin/voucher-batches",
    async (ctx) => {
      const data = await repo().create(ctx.body, getUser(ctx).sub);
      ctx.set.status = 201;
      ctx.set.headers["cache-control"] = "no-store";
      return { data };
    },
    {
      body: t.Object({
        businessName: t.String({ minLength: 1, maxLength: 200 }),
        reference: t.Optional(t.String({ maxLength: 200 })),
        quantity: t.Integer({ minimum: 1, maximum: 500 }),
        tierName: t.Union(GRANTABLE_TIERS.map((tier) => t.Literal(tier.id))),
        months: t.Integer({ minimum: 1, maximum: 120 }),
        allowedDomains: t.Array(t.String({ maxLength: 253 }), { maxItems: 50 }),
        redeemBy: t.Nullable(t.String({ maxLength: 40 })),
        employeeEmails: t.Optional(
          t.Array(t.String({ maxLength: 254 }), { maxItems: 500 }),
        ),
      }),
    },
  )
  .post(
    "/admin/voucher-batches/:id/issue",
    async (ctx) => {
      const data = await repo().issue(
        ctx.params.id,
        ctx.body,
        getUser(ctx).sub,
      );
      ctx.set.status = 201;
      ctx.set.headers["cache-control"] = "no-store";
      return { data };
    },
    {
      params: t.Object({ id }),
      body: t.Object({
        quantity: t.Integer({ minimum: 1, maximum: 500 }),
        employeeEmails: t.Optional(
          t.Array(t.String({ maxLength: 254 }), { maxItems: 500 }),
        ),
      }),
    },
  )
  .get(
    "/admin/voucher-batches/:id",
    async ({ params }) => ({ data: await repo().detail(params.id) }),
    { params: t.Object({ id }) },
  )
  .patch(
    "/admin/voucher-batches/:id/vouchers/:voucherId",
    async (ctx) => {
      await repo().assign(
        ctx.params.id,
        [
          {
            voucherId: ctx.params.voucherId,
            employeeEmail: ctx.body.employeeEmail,
          },
        ],
        getUser(ctx).sub,
      );
      const detail = await repo().detail(ctx.params.id);
      return {
        data: detail.vouchers.find((v) => v.id === ctx.params.voucherId)!,
      };
    },
    {
      params: t.Object({ id, voucherId: id }),
      body: t.Object({ employeeEmail: email }),
    },
  )
  .post(
    "/admin/voucher-batches/:id/assignments",
    async (ctx) => ({
      data: await repo().assign(
        ctx.params.id,
        ctx.body.assignments,
        getUser(ctx).sub,
      ),
    }),
    {
      params: t.Object({ id }),
      body: t.Object({
        assignments: t.Array(
          t.Object({ voucherId: id, employeeEmail: email }),
          { minItems: 1, maxItems: 500 },
        ),
      }),
    },
  )
  .post(
    "/admin/voucher-batches/:id/revoke",
    async (ctx) => ({
      data: await repo().revoke(
        ctx.params.id,
        undefined,
        ctx.body.reason,
        getUser(ctx).sub,
      ),
    }),
    {
      params: t.Object({ id }),
      body: t.Object({ reason: t.String({ minLength: 1, maxLength: 2000 }) }),
    },
  )
  .post(
    "/admin/voucher-batches/:id/vouchers/:voucherId/revoke",
    async (ctx) => ({
      data: await repo().revoke(
        ctx.params.id,
        ctx.params.voucherId,
        ctx.body.reason,
        getUser(ctx).sub,
      ),
    }),
    {
      params: t.Object({ id, voucherId: id }),
      body: t.Object({ reason: t.String({ minLength: 1, maxLength: 2000 }) }),
    },
  )
  .post(
    "/admin/voucher-batches/:id/export-audit",
    async (ctx) => ({
      data: await repo().exportAudit(ctx.params.id, getUser(ctx).sub),
    }),
    { params: t.Object({ id }) },
  );
