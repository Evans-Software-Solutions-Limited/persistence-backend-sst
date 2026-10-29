import Elysia, { t } from "elysia";
import {
  getAuthUser,
  getUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";
import { adminCorsHeaders } from "../admin/adminCors";
import { VoucherService } from "./voucherService";
import { VoucherError } from "./voucherRules";
const isVoucher = (url: string) =>
  new URL(url).pathname.startsWith("/vouchers/");
export const vouchersHandler = new Elysia()
  .onRequest(({ request, set }) => {
    if (!isVoucher(request.url)) return;
    const headers = adminCorsHeaders(
      request.headers.get("origin") ?? undefined,
    );
    Object.assign(set.headers, headers);
    set.headers["cache-control"] = "no-store";
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
  })
  .onError({ as: "global" }, ({ request, set, error }) => {
    if (!isVoucher(request.url)) return;
    Object.assign(
      set.headers,
      adminCorsHeaders(request.headers.get("origin") ?? undefined),
    );
    set.headers["cache-control"] = "no-store";
    if (error instanceof VoucherError) {
      set.status = error.status;
      return { message: error.message, code: error.code };
    }
  })
  // Public preflight only: membership creation and proof issuance remain authenticated.
  .post(
    "/vouchers/check",
    async ({ body, headers }) => ({
      data: await new VoucherService().check(
        body.code,
        body.eligibilityEmail,
        headers["x-persistence-source-ip"] ?? "unknown",
      ),
    }),
    {
      body: t.Object({
        code: t.String({ minLength: 1, maxLength: 128 }),
        eligibilityEmail: t.String({ minLength: 3, maxLength: 254 }),
      }),
    },
  )
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .post(
    "/vouchers/prepare",
    async (ctx) => ({
      data: await new VoucherService().prepare(
        getUser(ctx).sub,
        ctx.body.code,
        ctx.body.eligibilityEmail,
      ),
    }),
    {
      body: t.Object({
        code: t.String({ minLength: 1, maxLength: 128 }),
        eligibilityEmail: t.String({ minLength: 3, maxLength: 254 }),
      }),
    },
  )
  .post(
    "/vouchers/verify",
    async (ctx) => ({
      data: await new VoucherService().verify(
        getUser(ctx).sub,
        ctx.body.challengeId,
        ctx.body.otp,
      ),
    }),
    {
      body: t.Object({
        challengeId: t.String({ format: "uuid" }),
        otp: t.String({ pattern: "^[0-9]{6}$" }),
      }),
    },
  )
  .post(
    "/vouchers/redeem",
    async (ctx) => ({
      data: await new VoucherService().redeem(
        getUser(ctx).sub,
        ctx.body.challengeId,
      ),
    }),
    { body: t.Object({ challengeId: t.String({ format: "uuid" }) }) },
  );
