import { describe, expect, it } from "vitest";
import { canTransition, reconcilePaymentStatus } from "../subscriptionState";

describe("canTransition", () => {
  it("allows when the prior status is unknown/empty (nothing to protect)", () => {
    expect(canTransition(null, "active")).toBe(true);
    expect(canTransition(undefined, "cancelled")).toBe(true);
    expect(canTransition("", "active")).toBe(true);
  });

  it("allows idempotent same-status re-writes", () => {
    expect(canTransition("cancelled", "cancelled")).toBe(true);
    expect(canTransition("active", "active")).toBe(true);
  });

  it("BLOCKS reviving a terminal status into a live one (the core guard)", () => {
    for (const terminal of ["cancelled", "canceled", "expired"]) {
      for (const live of ["active", "trialing", "past_due", "pending"]) {
        expect(canTransition(terminal, live)).toBe(false);
      }
    }
  });

  it("allows all legitimate live transitions", () => {
    expect(canTransition("past_due", "active")).toBe(true); // recovery
    expect(canTransition("trialing", "active")).toBe(true);
    expect(canTransition("active", "past_due")).toBe(true);
    expect(canTransition("pending", "active")).toBe(true);
  });

  it("allows live → terminal (cancellation / expiry)", () => {
    expect(canTransition("active", "cancelled")).toBe(true);
    expect(canTransition("past_due", "expired")).toBe(true);
    expect(canTransition("trialing", "cancelled")).toBe(true);
  });
});

describe("reconcilePaymentStatus", () => {
  it("returns the proposed status (not blocked) for a legal transition", () => {
    expect(reconcilePaymentStatus("active", "cancelled")).toEqual({
      status: "cancelled",
      blocked: false,
    });
  });

  it("keeps the existing status and flags blocked for an illegal transition", () => {
    expect(reconcilePaymentStatus("cancelled", "active")).toEqual({
      status: "cancelled",
      blocked: true,
    });
  });

  it("never throws on a blocked transition (webhooks must not 500 on policy)", () => {
    expect(() => reconcilePaymentStatus("expired", "trialing")).not.toThrow();
  });
});
