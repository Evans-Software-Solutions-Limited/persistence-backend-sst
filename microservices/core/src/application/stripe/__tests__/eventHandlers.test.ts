import { describe, expect, it, vi } from "vitest";
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

  it("stub handlers log and resolve without throwing", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const handler = eventHandlers["customer.subscription.updated"];
    expect(handler).toBeDefined();
    await expect(
      handler!({
        id: "evt_test",
        type: "customer.subscription.updated",
        // Minimal subset — the stub only reads .type and .id for logging.
      } as unknown as Parameters<typeof handler>[0]),
    ).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
