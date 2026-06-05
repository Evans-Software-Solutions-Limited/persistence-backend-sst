import { afterEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { handleChargeDisputeCreated } from "../../eventHandlers/chargeDisputeCreated";

function event(dispute: Partial<Stripe.Dispute>): Stripe.Event {
  return {
    id: "evt_dispute",
    type: "charge.dispute.created",
    data: {
      object: {
        id: "dp_1",
        currency: "gbp",
        amount: 1299,
        reason: "fraudulent",
        status: "needs_response",
        charge: "ch_1",
        ...dispute,
      },
    },
  } as unknown as Stripe.Event;
}

describe("handleChargeDisputeCreated", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits a CRITICAL alert carrying dispute id, charge, reason", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await handleChargeDisputeCreated(event({}));
    const line = String(error.mock.calls[0]?.[0]);
    expect(line).toContain("[stripe:alert]");
    expect(line).toContain('"kind":"charge.dispute.created"');
    expect(line).toContain('"severity":"critical"');
    expect(line).toContain('"disputeId":"dp_1"');
    expect(line).toContain('"charge":"ch_1"');
    expect(line).toContain('"reason":"fraudulent"');
  });

  it("handles an expanded charge object (reads its id)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await handleChargeDisputeCreated(
      event({ charge: { id: "ch_obj" } as Stripe.Charge }),
    );
    expect(String(error.mock.calls[0]?.[0])).toContain('"charge":"ch_obj"');
  });
});
