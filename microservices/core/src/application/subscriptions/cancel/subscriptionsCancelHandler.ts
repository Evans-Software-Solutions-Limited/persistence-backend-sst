import Elysia, { t } from "elysia";
import type Stripe from "stripe";
import {
  getAuthUser,
  getUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";

import { SubscriptionRepository } from "../../repositories/subscriptionRepository";
import { getStripe } from "../../stripe/stripeClient";

/**
 * POST /subscriptions/:id/cancel — cancel a subscription either at the
 * end of the current billing period (default) or immediately.
 *
 *   - `:id` is the local `user_subscriptions.id` UUID (NOT the Stripe
 *     `sub_…` id). Path-param-only — no auto-find of "the user's active
 *     sub" like legacy supported. Mobile sends the UUID it already
 *     knows about (Brad Q11 sign-off).
 *   - Scoped to the authenticated user via `findByIdForUser`. A
 *     mismatched id (wrong user OR nonexistent) returns 404 without
 *     leaking which case applied.
 *   - `cancel_immediately = false` (default): Stripe-side
 *     `cancel_at_period_end: true`. Local `payment_status` is
 *     preserved (the user keeps paid access until the period elapses);
 *     `cancelled_at` is stamped now; `expires_at` is updated to the
 *     period end from Stripe truth.
 *   - `cancel_immediately = true`: Stripe-side
 *     `subscriptions.cancel()`. Local `payment_status` flips to
 *     `cancelled` immediately. `expires_at` is set to the
 *     Stripe-returned `canceled_at` (falling back to now if Stripe
 *     omitted it).
 *   - Already-cancelled rows return 400 — no-op semantics rather than
 *     an idempotent success because the legacy mobile relies on the
 *     400 to swap UI state.
 *
 * Like the create endpoint, this writes ONLY to `user_subscriptions`.
 * The DB trigger `update_subscription_limits_trigger` propagates
 * `profiles.subscription_id`, `profiles.role`, and
 * `subscription_limits.*` automatically. The webhook handler
 * (`subscriptionDeleted`) will also fire on the immediate-cancel
 * branch — its handler is idempotent w/r/t row state thanks to PR #69
 * sweep #3, so a double-update is safe.
 */

type CancelSuccess = {
  success: true;
  cancelled_at: string;
  subscription_ends_at: string;
  message: string;
};

type CancelError = { error: string };

function unixToIso(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || seconds === 0) return null;
  return new Date(seconds * 1000).toISOString();
}

export const subscriptionsCancelHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .post(
    "/subscriptions/:id/cancel",
    async (ctx): Promise<CancelSuccess | CancelError> => {
      const { sub: userId } = getUser(ctx);
      const subscriptionId = ctx.params.id;
      const cancelImmediately = ctx.body.cancel_immediately ?? false;

      const subRepo = new SubscriptionRepository();
      const subscription = await subRepo.findByIdForUser(
        subscriptionId,
        userId,
      );
      if (subscription === null) {
        // 404 covers both "doesn't exist" and "exists but belongs to
        // another user" — never disclose which.
        ctx.set.status = 404;
        return { error: "Subscription not found" };
      }

      if (subscription.paymentStatus === "cancelled") {
        ctx.set.status = 400;
        return { error: "Subscription is already cancelled" };
      }

      const stripeSubscriptionId = subscription.externalSubscriptionId;
      if (
        typeof stripeSubscriptionId !== "string" ||
        stripeSubscriptionId.length === 0
      ) {
        // Local row predates the Stripe integration, or was created
        // out-of-band without a Stripe pointer. Can't issue any Stripe
        // call — surface as 404 (the row exists but the Stripe side
        // doesn't), keeping the response shape consistent with the
        // other "no actionable subscription" branches.
        ctx.set.status = 404;
        return { error: "Stripe subscription id not found on this row" };
      }

      const stripe = getStripe();

      // Track when the cancellation request was made (this is the
      // `cancelled_at` we write — distinct from when access actually
      // expires, which is `expires_at`).
      const cancelledAt = new Date();

      let endsAt: Date;
      let nextPaymentStatus: string;

      if (cancelImmediately) {
        let cancelled: Stripe.Subscription;
        try {
          // Cast as in eventHandlers/subscriptionUpdated.ts — Stripe SDK
          // v22 wraps the response in `Stripe.Response<T>` which TS
          // refuses to index, but the runtime payload IS a Subscription.
          cancelled = (await stripe.subscriptions.cancel(
            stripeSubscriptionId,
          )) as unknown as Stripe.Subscription;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(
            `[subscriptions:cancel] stripe.subscriptions.cancel failed for ${stripeSubscriptionId}: ${message}`,
          );
          ctx.set.status = 502;
          return { error: `Failed to cancel subscription: ${message}` };
        }
        const canceledAtSeconds = cancelled.canceled_at;
        endsAt =
          typeof canceledAtSeconds === "number" && canceledAtSeconds > 0
            ? new Date(canceledAtSeconds * 1000)
            : cancelledAt;
        nextPaymentStatus = "cancelled";
      } else {
        let updated: Stripe.Subscription;
        try {
          updated = (await stripe.subscriptions.update(stripeSubscriptionId, {
            cancel_at_period_end: true,
          })) as unknown as Stripe.Subscription;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(
            `[subscriptions:cancel] stripe.subscriptions.update(cancel_at_period_end) failed for ${stripeSubscriptionId}: ${message}`,
          );
          ctx.set.status = 502;
          return {
            error: `Failed to schedule subscription cancellation: ${message}`,
          };
        }
        // Read current_period_end across API versions — Stripe migrated
        // the field onto items in newer dashboard endpoints. Same
        // pattern as eventHandlers/_helpers.ts:readCurrentPeriodEnd.
        const legacyEnd = (
          updated as unknown as { current_period_end?: number | null }
        ).current_period_end;
        const periodEnd =
          typeof legacyEnd === "number" && legacyEnd > 0
            ? legacyEnd
            : updated.items?.data?.[0]?.current_period_end ?? null;
        const periodEndDate = unixToIso(periodEnd);
        if (periodEndDate !== null) {
          endsAt = new Date(periodEndDate);
        } else if (subscription.expiresAt) {
          // Fallback to whatever expiresAt we already had — keeps the
          // UI's "Active until X" stable even if Stripe returns a
          // truncated payload.
          endsAt = new Date(subscription.expiresAt);
        } else {
          endsAt = cancelledAt;
        }
        // Preserve existing paymentStatus — the user still has paid
        // access until the period elapses, the webhook flips it to
        // "cancelled" when current_period_end passes.
        nextPaymentStatus = subscription.paymentStatus ?? "active";
      }

      const existingMeta =
        (subscription.metadata as Record<string, unknown> | null) ?? {};
      const updatedRow = await subRepo.updateById(subscription.id, {
        paymentStatus: nextPaymentStatus,
        cancelledAt,
        expiresAt: endsAt,
        metadata: {
          ...existingMeta,
          cancelled_at: cancelledAt.toISOString(),
          cancel_immediately: cancelImmediately,
        },
      });

      if (updatedRow === null) {
        // Shouldn't happen — we located the row immediately above.
        // Treat as 500 so it shows up loudly.
        console.error(
          `[subscriptions:cancel] updateById returned null for user_subscriptions.id=${subscription.id} after Stripe cancel of ${stripeSubscriptionId}`,
        );
        ctx.set.status = 500;
        return {
          error:
            "Cancellation succeeded on Stripe but the local record could not be updated. Please contact support.",
        };
      }

      return {
        success: true,
        cancelled_at: cancelledAt.toISOString(),
        subscription_ends_at: endsAt.toISOString(),
        message: cancelImmediately
          ? "Subscription cancelled immediately"
          : "Subscription will be cancelled at the end of the billing period",
      };
    },
    {
      params: t.Object({
        id: t.String({ minLength: 1 }),
      }),
      body: t.Object({
        cancel_immediately: t.Optional(t.Boolean()),
      }),
    },
  );
