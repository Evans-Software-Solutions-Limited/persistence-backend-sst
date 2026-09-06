import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const grantRepoMocks = vi.hoisted(() => ({
  findLiveByPaymentReference: vi.fn<(...args: unknown[]) => Promise<unknown>>(
    async () => null,
  ),
}));
vi.mock("../../../repositories/foundingGrantRepository", () => ({
  FoundingGrantRepository: class {
    findLiveByPaymentReference = grantRepoMocks.findLiveByPaymentReference;
  },
}));

const checkoutRepoMocks = vi.hoisted(() => ({
  findCompletedByGrantId: vi.fn<(...args: unknown[]) => Promise<unknown>>(
    async () => null,
  ),
  markRefunded: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
}));
vi.mock("../../../repositories/foundingCheckoutRepository", () => ({
  FoundingCheckoutRepository: class {
    findCompletedByGrantId = checkoutRepoMocks.findCompletedByGrantId;
    markRefunded = checkoutRepoMocks.markRefunded;
  },
}));

const revokeMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ ok: true })),
);
vi.mock("../../../founding/foundingGrantService", () => ({
  FoundingGrantService: class {
    revoke = revokeMock;
  },
}));

import { handleChargeRefunded } from "../../eventHandlers/chargeRefunded";

function event(charge: Partial<Stripe.Charge>): Stripe.Event {
  return {
    id: "evt_refund",
    type: "charge.refunded",
    data: { object: { id: "ch_1", currency: "gbp", ...charge } },
  } as unknown as Stripe.Event;
}

describe("handleChargeRefunded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    grantRepoMocks.findLiveByPaymentReference.mockResolvedValue(null);
    checkoutRepoMocks.findCompletedByGrantId.mockResolvedValue(null);
    revokeMock.mockResolvedValue({ ok: true });
  });
  afterEach(() => vi.restoreAllMocks());

  it("emits a CRITICAL alert for a full refund", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await handleChargeRefunded(
      event({ amount: 1299, amount_refunded: 1299, customer: "cus_1" }),
    );
    const line = String(error.mock.calls[0]?.[0]);
    expect(line).toContain("[stripe:alert]");
    expect(line).toContain('"kind":"charge.refunded"');
    expect(line).toContain('"severity":"critical"');
    expect(line).toContain('"fullyRefunded":true');
    expect(line).toContain('"customer":"cus_1"');
  });

  it("emits a WARN alert for a partial refund", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await handleChargeRefunded(event({ amount: 1299, amount_refunded: 500 }));
    expect(error).not.toHaveBeenCalled();
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain('"severity":"warn"');
    expect(line).toContain('"fullyRefunded":false');
  });

  describe("a founding web purchase", () => {
    const FOUNDING_CHARGE = {
      amount: 3000,
      amount_refunded: 3000,
      payment_intent: "pi_1",
    };

    beforeEach(() => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    it("revokes the grant on a FULL refund — the money has gone back", async () => {
      grantRepoMocks.findLiveByPaymentReference.mockResolvedValue({
        id: "grant-1",
      });
      await handleChargeRefunded(event(FOUNDING_CHARGE));
      expect(revokeMock).toHaveBeenCalledWith(
        "grant-1",
        "refund ch_1",
        "00000000-0000-0000-0000-000000000000",
      );
    });

    it("marks the checkout refunded so the admin view tells the truth", async () => {
      grantRepoMocks.findLiveByPaymentReference.mockResolvedValue({
        id: "grant-1",
      });
      checkoutRepoMocks.findCompletedByGrantId.mockResolvedValue({
        id: "checkout-1",
      });
      await handleChargeRefunded(event(FOUNDING_CHARGE));
      expect(checkoutRepoMocks.markRefunded).toHaveBeenCalledWith("checkout-1");
    });

    it("does NOT revoke on a partial refund — it alerts instead", async () => {
      // Usually a goodwill gesture on a term someone is still using. Cutting
      // their access off because £5 went back would be worse than a nudge.
      grantRepoMocks.findLiveByPaymentReference.mockResolvedValue({
        id: "grant-1",
      });
      await handleChargeRefunded(
        event({ ...FOUNDING_CHARGE, amount_refunded: 500 }),
      );
      expect(revokeMock).not.toHaveBeenCalled();
      const lines = (
        console.warn as unknown as { mock: { calls: unknown[][] } }
      ).mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes("partial_refund"))).toBe(true);
    });

    it("leaves a refund that belongs to no founding grant alone", async () => {
      await handleChargeRefunded(event(FOUNDING_CHARGE));
      expect(revokeMock).not.toHaveBeenCalled();
      expect(checkoutRepoMocks.markRefunded).not.toHaveBeenCalled();
    });

    it("accepts an expanded customer and payment intent, not just ids", async () => {
      // Stripe sends either shape depending on how the event was expanded.
      grantRepoMocks.findLiveByPaymentReference.mockResolvedValue({
        id: "grant-1",
      });
      await handleChargeRefunded(
        event({
          amount: 3000,
          amount_refunded: 3000,
          customer: { id: "cus_expanded" } as Stripe.Customer,
          payment_intent: { id: "pi_expanded" } as Stripe.PaymentIntent,
        }),
      );
      expect(grantRepoMocks.findLiveByPaymentReference).toHaveBeenCalledWith(
        "pi_expanded",
      );
      const lines = (
        console.error as unknown as { mock: { calls: unknown[][] } }
      ).mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes("cus_expanded"))).toBe(true);
    });

    it("does not look anything up when the charge has no payment intent", async () => {
      await handleChargeRefunded(
        event({ amount: 3000, amount_refunded: 3000 }),
      );
      expect(grantRepoMocks.findLiveByPaymentReference).not.toHaveBeenCalled();
    });

    it("alerts loudly when the revoke itself fails", async () => {
      grantRepoMocks.findLiveByPaymentReference.mockResolvedValue({
        id: "grant-1",
      });
      revokeMock.mockResolvedValue({ ok: false, error: "already_revoked" });
      await handleChargeRefunded(event(FOUNDING_CHARGE));
      const lines = (
        console.error as unknown as { mock: { calls: unknown[][] } }
      ).mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes("revoke_failed"))).toBe(true);
      expect(checkoutRepoMocks.markRefunded).not.toHaveBeenCalled();
    });
  });
});
