import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { FoundingGrant, FoundingRefund } from "@persistence/db";
import { FoundingAdminService } from "../foundingAdminService";
import { FoundingAdminRepository } from "../../repositories/foundingAdminRepository";
import { FoundingGrantRepository } from "../../repositories/foundingGrantRepository";
import { FoundingCheckoutRepository } from "../../repositories/foundingCheckoutRepository";
import { FoundingGrantService } from "../foundingGrantService";

const grant = {
  id: "g1",
  paymentMethod: "stripe_checkout",
  paymentReference: "pi_1",
  amountMinor: 3000,
  currency: "GBP",
} as FoundingGrant;
const intent = {
  status: "succeeded",
  latest_charge: {
    id: "ch_1",
    paid: true,
    amount: 3000,
    amount_refunded: 0,
    currency: "gbp",
  },
};
const refund = {
  id: "re_1",
  payment_intent: "pi_1",
  status: "succeeded",
  metadata: { founding_grant_id: "g1", source: "admin_founding_refund" },
} as unknown as Stripe.Refund;
const operation = () =>
  ({
    grantId: "g1",
    refundId: null,
    status: "requested",
    reason: "Customer request",
    actorId: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as FoundingRefund;
let saved: FoundingRefund;
let service: FoundingAdminService;
const repo = new FoundingAdminRepository(),
  grants = new FoundingGrantRepository(),
  checkouts = new FoundingCheckoutRepository(),
  grantService = new FoundingGrantService();
const create = vi.fn(),
  retrieve = vi.fn(),
  list = vi.fn(),
  payment = vi.fn();
beforeEach(() => {
  vi.restoreAllMocks();
  create.mockReset();
  retrieve.mockReset();
  list.mockReset();
  payment.mockReset();
  saved = operation();
  vi.spyOn(repo, "findRefund").mockResolvedValue(null);
  vi.spyOn(repo, "requestRefund").mockImplementation(async () => saved);
  vi.spyOn(repo, "recordRefund").mockImplementation(
    async (_id, refundId, status) => {
      saved = { ...saved, refundId, status };
      return saved;
    },
  );
  vi.spyOn(grants, "findById").mockResolvedValue(grant);
  vi.spyOn(checkouts, "findCompletedByGrantId").mockResolvedValue({
    id: "checkout",
    status: "completed",
  } as never);
  vi.spyOn(checkouts, "markRefunded").mockResolvedValue();
  vi.spyOn(grantService, "revoke").mockResolvedValue({ ok: true });
  payment.mockResolvedValue(intent);
  create.mockResolvedValue(refund);
  retrieve.mockResolvedValue(refund);
  list.mockImplementation(() => ({
    async *[Symbol.asyncIterator]() {
      /* no prior refund */
    },
  }));
  service = new FoundingAdminService(
    repo,
    grants,
    checkouts,
    grantService,
    () =>
      ({
        paymentIntents: { retrieve: payment },
        refunds: { create, retrieve, list },
      }) as unknown as Stripe,
  );
});
describe("founding refund orchestration", () => {
  it("previews Stripe's remaining payment, not a guessed plan price", async () => {
    payment.mockResolvedValue({
      ...intent,
      latest_charge: { ...intent.latest_charge, amount_refunded: 500 },
    });
    expect(await service.preview("g1")).toEqual({
      amountMinor: 3000,
      currency: "GBP",
      refundedAmountMinor: 500,
      remainingAmountMinor: 2500,
      refund: null,
    });
    expect(create).not.toHaveBeenCalled();
    expect(grantService.revoke).not.toHaveBeenCalled();
  });
  it("creates a full remaining refund with a stable idempotency key and cancels access", async () => {
    expect(await service.refund("g1", "Customer request", "admin")).toEqual({
      status: "succeeded",
      refundId: "re_1",
      reason: "Customer request",
    });
    expect(create).toHaveBeenCalledWith(
      {
        payment_intent: "pi_1",
        reason: "requested_by_customer",
        metadata: { source: "admin_founding_refund", founding_grant_id: "g1" },
      },
      { idempotencyKey: "founding-refund:g1" },
    );
    expect(repo.requestRefund).toHaveBeenCalledWith(
      "g1",
      "Customer request",
      "admin",
    );
    expect(grantService.revoke).toHaveBeenCalledWith(
      "g1",
      "Refund: Customer request",
      "admin",
    );
    expect(checkouts.markRefunded).toHaveBeenCalledWith("checkout");
  });
  it.each(["pending", "requires_action"])(
    "cancels access immediately for an accepted %s refund without claiming it succeeded",
    async (status) => {
      create.mockResolvedValue({ ...refund, status });
      expect(
        await service.refund("g1", "Customer request", "admin"),
      ).toMatchObject({ status });
      expect(grantService.revoke).toHaveBeenCalled();
      expect(checkouts.markRefunded).not.toHaveBeenCalled();
    },
  );
  it.each(["failed", "canceled"])(
    "does not revoke access for a %s attempt",
    async (status) => {
      create.mockResolvedValue({ ...refund, status });
      expect(
        await service.refund("g1", "Customer request", "admin"),
      ).toMatchObject({ status });
      expect(grantService.revoke).not.toHaveBeenCalled();
    },
  );
  it("records missing Stripe status as pending", async () => {
    create.mockResolvedValue({ ...refund, status: null });
    expect(
      await service.refund("g1", "Customer request", "admin"),
    ).toMatchObject({ status: "pending" });
  });
  it("does not cancel on an API failure; retry keeps the same operation", async () => {
    create.mockRejectedValueOnce(new Error("timeout"));
    await expect(
      service.refund("g1", "Customer request", "admin"),
    ).rejects.toThrow("timeout");
    expect(grantService.revoke).not.toHaveBeenCalled();
    await service.refund("g1", "Customer request", "admin");
    expect(create.mock.calls[0][1]).toEqual(create.mock.calls[1][1]);
  });
  it("recovers a lost response using Stripe metadata without issuing another refund", async () => {
    list.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        yield { ...refund, metadata: {} };
        yield refund;
      },
    }));
    await service.refund("g1", "Customer request", "admin");
    expect(create).not.toHaveBeenCalled();
    expect(grantService.revoke).toHaveBeenCalled();
  });
  it("refreshes an existing refund and completes a previously failed access cancellation", async () => {
    saved = { ...saved, refundId: "re_1", status: "pending" };
    vi.mocked(repo.findRefund).mockResolvedValue(saved);
    vi.mocked(grantService.revoke).mockResolvedValue({
      ok: false,
      error: "already_revoked",
    });
    expect((await service.preview("g1")).refund).toMatchObject({
      status: "succeeded",
    });
    expect(create).not.toHaveBeenCalled();
    expect(checkouts.markRefunded).toHaveBeenCalled();
  });
  it("returns the existing result on a duplicate POST", async () => {
    saved = { ...saved, refundId: "re_1", status: "succeeded" };
    await service.refund("g1", "Customer request", "admin");
    expect(create).not.toHaveBeenCalled();
  });
  it("accepts an expanded refund payment intent", async () => {
    create.mockResolvedValue({ ...refund, payment_intent: { id: "pi_1" } });
    expect(
      await service.refund("g1", "Customer request", "admin"),
    ).toMatchObject({ status: "succeeded" });
  });
  it.each([
    null,
    { ...grant, paymentMethod: "bank_transfer" },
    { ...grant, paymentReference: null },
  ])(
    "rejects missing/non-Stripe grants before touching money",
    async (value) => {
      vi.mocked(grants.findById).mockResolvedValue(
        value as FoundingGrant | null,
      );
      await expect(
        service.refund("g1", "reason", "admin"),
      ).rejects.toMatchObject({
        code: value ? "not_stripe_purchase" : "not_found",
      });
      expect(create).not.toHaveBeenCalled();
    },
  );
  it.each([null, { status: "open" }])(
    "rejects an uncompleted purchase",
    async (value) => {
      vi.mocked(checkouts.findCompletedByGrantId).mockResolvedValue(
        value as never,
      );
      await expect(service.preview("g1")).rejects.toMatchObject({
        code: "purchase_not_completed",
      });
    },
  );
  it.each([
    { ...intent, status: "processing" },
    { ...intent, latest_charge: null },
    { ...intent, latest_charge: "ch_1" },
    { ...intent, latest_charge: { ...intent.latest_charge, paid: false } },
    { ...intent, latest_charge: { ...intent.latest_charge, amount: 5000 } },
    { ...intent, latest_charge: { ...intent.latest_charge, currency: "usd" } },
  ])(
    "refuses a payment inconsistent with the recorded purchase",
    async (value) => {
      payment.mockResolvedValue(value);
      await expect(
        service.refund("g1", "reason", "admin"),
      ).rejects.toMatchObject({ code: "payment_mismatch" });
      expect(create).not.toHaveBeenCalled();
    },
  );
  it("never creates a fresh charge refund after the idempotency window", async () => {
    saved.createdAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await expect(service.refund("g1", "reason", "admin")).rejects.toMatchObject(
      { code: "refund_recovery_required" },
    );
    expect(create).not.toHaveBeenCalled();
  });
  it("refuses a fully refunded charge", async () => {
    payment.mockResolvedValue({
      ...intent,
      latest_charge: { ...intent.latest_charge, amount_refunded: 3000 },
    });
    await expect(service.refund("g1", "reason", "admin")).rejects.toMatchObject(
      { code: "already_refunded" },
    );
    expect(create).not.toHaveBeenCalled();
  });
  it.each([
    { ...refund, payment_intent: null },
    { ...refund, payment_intent: "pi_other" },
    { ...refund, metadata: {} },
  ])("refuses mismatched refunds", async (value) => {
    create.mockResolvedValue(value);
    await expect(service.refund("g1", "reason", "admin")).rejects.toMatchObject(
      { code: "refund_mismatch" },
    );
    expect(grantService.revoke).not.toHaveBeenCalled();
  });
  it("surfaces access cancellation failure so it can be retried", async () => {
    vi.mocked(grantService.revoke).mockResolvedValue({
      ok: false,
      error: "not_found",
    });
    await expect(service.refund("g1", "reason", "admin")).rejects.toMatchObject(
      { code: "access_cancellation_failed" },
    );
  });
});
