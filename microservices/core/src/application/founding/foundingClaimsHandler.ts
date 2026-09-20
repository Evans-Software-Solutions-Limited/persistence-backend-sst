import Elysia, { t } from "elysia";
import {
  getAuthUser,
  getUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";
import { FoundingClaimService } from "./foundingClaimService";
import { FoundingClaimError } from "../repositories/foundingClaimRepository";
import { VoucherError } from "../vouchers/voucherRules";
export const foundingClaimsHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .onError(({ error, set, code }) => {
    if (error instanceof FoundingClaimError || error instanceof VoucherError) {
      set.status = error.status;
      return { message: error.message, code: error.code };
    }
    if (code === "VALIDATION") return;
    set.status = 503;
    return {
      message: "Access could not be confirmed. Please try again.",
      code: "claim_unavailable",
    };
  })
  .post(
    "/founding/claims/request",
    async (ctx) => ({
      data: await new FoundingClaimService().request(
        getUser(ctx).sub,
        ctx.body.email,
      ),
    }),
    { body: t.Object({ email: t.String({ minLength: 3, maxLength: 254 }) }) },
  )
  .post(
    "/founding/claims/verify",
    async (ctx) => ({
      data: await new FoundingClaimService().verify(
        getUser(ctx).sub,
        ctx.body.challengeId,
        ctx.body.code,
      ),
    }),
    {
      body: t.Object({
        challengeId: t.String({ format: "uuid" }),
        code: t.String({ pattern: "^[0-9]{6}$" }),
      }),
    },
  );
