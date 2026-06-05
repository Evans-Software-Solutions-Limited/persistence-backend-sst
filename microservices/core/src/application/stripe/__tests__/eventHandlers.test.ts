import { describe, expect, it } from "vitest";
import { eventHandlers, resolveEventHandler } from "../eventHandlers";

describe("resolveEventHandler", () => {
  it("returns a handler for each supported webhook event type", () => {
    const supportedTypes = [
      // 6 legacy types
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "invoice.payment_succeeded",
      "invoice.payment_failed",
      "customer.subscription.trial_will_end",
      // spec 17 / Phase C additions
      "customer.subscription.paused",
      "customer.subscription.resumed",
      "charge.refunded",
      "charge.dispute.created",
    ];
    for (const type of supportedTypes) {
      expect(resolveEventHandler(type)).toBeInstanceOf(Function);
    }
  });

  it("routes pause + resume to the same handler as `updated` (refresh-from-truth)", () => {
    const updated = resolveEventHandler("customer.subscription.updated");
    expect(resolveEventHandler("customer.subscription.paused")).toBe(updated);
    expect(resolveEventHandler("customer.subscription.resumed")).toBe(updated);
  });

  it("returns null for unknown event types", () => {
    expect(resolveEventHandler("checkout.session.completed")).toBeNull();
    expect(resolveEventHandler("not.a.real.event")).toBeNull();
    expect(resolveEventHandler("")).toBeNull();
  });

  it("exposes the same set of handlers via `eventHandlers` map and `resolveEventHandler`", () => {
    // Sanity check that the named exports stay in lockstep — without this,
    // a future contributor could add a handler to one but not the other.
    for (const [type, handler] of Object.entries(eventHandlers)) {
      expect(resolveEventHandler(type)).toBe(handler);
    }
  });
});
