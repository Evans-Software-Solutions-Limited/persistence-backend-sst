import type Stripe from "stripe";
import type { FoundingGrant, FoundingRefund } from "@persistence/db";
import {
  FoundingAdminError,
  FoundingAdminRepository,
} from "../repositories/foundingAdminRepository";
import { FoundingGrantRepository } from "../repositories/foundingGrantRepository";
import { FoundingCheckoutRepository } from "../repositories/foundingCheckoutRepository";
import { FoundingGrantService } from "./foundingGrantService";
import { getStripe } from "../stripe/stripeClient";

const view = (row: FoundingRefund) => ({
  status: row.status,
  refundId: row.refundId,
  reason: row.reason,
});

/** Full remaining refunds only. Stripe owns money; the DB owns retry identity and audit. */
export class FoundingAdminService {
  private readonly repo: FoundingAdminRepository;
  private readonly grants: FoundingGrantRepository;
  private readonly checkouts: FoundingCheckoutRepository;
  private readonly grantService: FoundingGrantService;
  private readonly stripe: () => Stripe;
  constructor(
    repo = new FoundingAdminRepository(),
    grants = new FoundingGrantRepository(),
    checkouts = new FoundingCheckoutRepository(),
    grantService = new FoundingGrantService(),
    stripe: () => Stripe = getStripe,
  ) {
    this.repo = repo;
    this.grants = grants;
    this.checkouts = checkouts;
    this.grantService = grantService;
    this.stripe = stripe;
  }

  private async purchase(id: string): Promise<FoundingGrant> {
    const grant = await this.grants.findById(id);
    if (!grant) throw new FoundingAdminError("not_found", 404);
    if (
      grant.paymentMethod !== "stripe_checkout" ||
      !grant.paymentReference?.startsWith("pi_")
    )
      throw new FoundingAdminError("not_stripe_purchase", 400);
    const checkout = await this.checkouts.findCompletedByGrantId(id);
    if (!checkout || !["completed", "refunded"].includes(checkout.status))
      throw new FoundingAdminError("purchase_not_completed");
    return grant;
  }

  private async charge(grant: FoundingGrant): Promise<Stripe.Charge> {
    const intent = await this.stripe().paymentIntents.retrieve(
      grant.paymentReference!,
      { expand: ["latest_charge"] },
    );
    const charge = intent.latest_charge;
    if (
      intent.status !== "succeeded" ||
      !charge ||
      typeof charge === "string" ||
      !charge.paid ||
      charge.amount !== grant.amountMinor ||
      charge.currency.toUpperCase() !== grant.currency.toUpperCase()
    )
      throw new FoundingAdminError("payment_mismatch");
    return charge;
  }

  private async cancelAccess(grant: FoundingGrant, operation: FoundingRefund) {
    const revoked = await this.grantService.revoke(
      grant.id,
      `Refund: ${operation.reason}`,
      operation.actorId,
    );
    if (!revoked.ok && revoked.error !== "already_revoked")
      throw new FoundingAdminError("access_cancellation_failed", 503);
    if (operation.status === "succeeded") {
      const checkout = await this.checkouts.findCompletedByGrantId(grant.id);
      if (checkout) await this.checkouts.markRefunded(checkout.id);
    }
  }

  private async reconcile(grant: FoundingGrant, refund: Stripe.Refund) {
    const intentId =
      typeof refund.payment_intent === "string"
        ? refund.payment_intent
        : refund.payment_intent?.id;
    if (
      intentId !== grant.paymentReference ||
      refund.metadata?.founding_grant_id !== grant.id
    )
      throw new FoundingAdminError("refund_mismatch");
    const row = await this.repo.recordRefund(
      grant.id,
      refund.id,
      refund.status ?? "pending",
    );
    if (["pending", "requires_action", "succeeded"].includes(row.status))
      await this.cancelAccess(grant, row);
    return row;
  }

  private async refresh(
    grant: FoundingGrant,
    operation: FoundingRefund,
  ): Promise<FoundingRefund> {
    if (operation.refundId)
      return this.reconcile(
        grant,
        await this.stripe().refunds.retrieve(operation.refundId),
      );
    // Recover a successful Stripe call whose HTTP response or DB write was lost.
    // Paginate: dashboard refunds can coexist with our one full-remainder request.
    for await (const refund of this.stripe().refunds.list({
      payment_intent: grant.paymentReference!,
      limit: 100,
    })) {
      if (
        refund.metadata?.founding_grant_id === grant.id &&
        refund.metadata?.source === "admin_founding_refund"
      )
        return this.reconcile(grant, refund);
    }
    return operation;
  }

  async preview(id: string) {
    const grant = await this.purchase(id);
    const saved = await this.repo.findRefund(id);
    const operation = saved ? await this.refresh(grant, saved) : null;
    const charge = await this.charge(grant);
    return {
      amountMinor: charge.amount,
      currency: charge.currency.toUpperCase(),
      refundedAmountMinor: charge.amount_refunded,
      remainingAmountMinor: Math.max(0, charge.amount - charge.amount_refunded),
      refund: operation ? view(operation) : null,
    };
  }

  async refund(id: string, reason: string, actorId: string) {
    const grant = await this.purchase(id);
    let operation = await this.repo.requestRefund(id, reason, actorId);
    operation = await this.refresh(grant, operation);
    if (operation.status !== "requested") return view(operation);
    // Stripe expires idempotency keys after >=24h. Never blindly re-create an
    // unresolved operation beyond that window; an administrator must reconcile it.
    if (Date.now() - operation.createdAt.getTime() > 23 * 60 * 60 * 1000)
      throw new FoundingAdminError("refund_recovery_required");
    const charge = await this.charge(grant);
    if (charge.amount_refunded >= charge.amount)
      throw new FoundingAdminError("already_refunded");
    const refund = await this.stripe().refunds.create(
      {
        payment_intent: grant.paymentReference!,
        reason: "requested_by_customer",
        metadata: {
          source: "admin_founding_refund",
          founding_grant_id: grant.id,
        },
      },
      { idempotencyKey: `founding-refund:${grant.id}` },
    );
    operation = await this.reconcile(grant, refund);
    return view(operation);
  }
}
