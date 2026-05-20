import { describe, expect, it } from "vitest";
import { eventHandlers, resolveEventHandler } from "../eventHandlers";

describe("resolveEventHandler", () => {
  it("returns a handler for each of the 6 legacy webhook event types", () => {
    const supportedTypes = [
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "invoice.payment_succeeded",
      "invoice.payment_failed",
      "customer.subscription.trial_will_end",
    ];
    for (const type of supportedTypes) {
      expect(resolveEventHandler(type)).toBeInstanceOf(Function);
    }
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
