import Elysia, { t } from "elysia";
import { getUser } from "@persistence/api-utils/auth/supabaseAuth";
import { adminGuard } from "../_adminGuard";
import {
  FoundingAdminError,
  FoundingAdminRepository,
} from "../../repositories/foundingAdminRepository";
import { FoundingAdminService } from "../../founding/foundingAdminService";

const params = t.Object({ id: t.String({ format: "uuid" }) });
const reason = t.String({
  minLength: 3,
  maxLength: 500,
  pattern: "\\S[\\s\\S]{1,498}\\S",
});
const messages: Record<string, string> = {
  not_found: "Grant not found.",
  invalid_tier: "Choose a valid tier.",
  different_audience: "Choose a tier for the same account type.",
  different_pool: "Choose a tier in the same founding offer pool.",
  tier_missing: "That tier is not configured.",
  revoked: "This grant has been revoked.",
  account_deleted: "This account has been deleted.",
  account_pending_deletion: "This account is pending deletion.",
  protected_account: "This account cannot be changed here.",
  coach_demotion: "A consumer tier cannot replace this coach account's access.",
  grant_not_active:
    "This grant no longer provides active access. Refresh the account before changing it.",
  grant_changed_retry: "The grant changed. Refresh and try again.",
  not_stripe_purchase: "Only founding website purchases can be refunded here.",
  purchase_not_completed: "The purchase is not complete.",
  payment_mismatch:
    "The payment does not match this purchase. Review it in Stripe.",
  refund_mismatch:
    "The refund does not match this purchase. Review it in Stripe.",
  refund_already_requested:
    "A refund was already requested. Refresh to see its status.",
  refund_recovery_required:
    "This refund needs manual review in Stripe before another attempt.",
  already_refunded: "The payment has already been fully refunded.",
  access_cancellation_failed:
    "The refund was recorded, but access cancellation needs a retry. Refresh the refund status.",
};

export const adminFoundingActionsHandler = new Elysia()
  .use(adminGuard)
  .onError(({ error, code, set }) => {
    if (error instanceof FoundingAdminError) {
      set.status = error.status;
      return { message: messages[error.code] ?? error.code, code: error.code };
    }
    // Validation and auth keep Elysia's normal status; external failures must
    // not leak Stripe customer/payment details or suggest a fresh refund.
    if (code === "VALIDATION") return;
    set.status = 503;
    return {
      message:
        "The operation could not be confirmed. Refresh its status before retrying.",
    };
  })
  .post(
    "/admin/founding-grants/:id/change-tier",
    async (ctx) => ({
      data: await new FoundingAdminRepository().changeTier(
        ctx.params.id,
        ctx.body.tierName,
        ctx.body.reason.trim(),
        getUser(ctx).sub,
      ),
    }),
    { params, body: t.Object({ tierName: t.String(), reason }) },
  )
  .get(
    "/admin/founding-grants/:id/refund",
    async (ctx) => ({
      data: await new FoundingAdminService().preview(ctx.params.id),
    }),
    { params },
  )
  .post(
    "/admin/founding-grants/:id/refund",
    async (ctx) => ({
      data: await new FoundingAdminService().refund(
        ctx.params.id,
        ctx.body.reason.trim(),
        getUser(ctx).sub,
      ),
    }),
    { params, body: t.Object({ reason }) },
  );
