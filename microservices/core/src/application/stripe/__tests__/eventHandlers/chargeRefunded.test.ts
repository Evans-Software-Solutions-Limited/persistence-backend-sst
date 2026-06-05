import { afterEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { handleChargeRefunded } from "../../eventHandlers/chargeRefunded";

function event(charge: Partial<Stripe.Charge>): Stripe.Event {
  return {
    id: "evt_refund",
    type: "charge.refunded",
    data: { object: { id: "ch_1", currency: "gbp", ...charge } },
  } as unknown as Stripe.Event;
}

describe("handleChargeRefunded", () => {
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
});
