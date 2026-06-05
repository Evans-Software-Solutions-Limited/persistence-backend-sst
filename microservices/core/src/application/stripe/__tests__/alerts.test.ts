import { afterEach, describe, expect, it, vi } from "vitest";
import { emitStripeAlert } from "../alerts";

describe("emitStripeAlert", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes a [stripe:alert] line to console.warn for warn severity", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    emitStripeAlert("trial_will_end", "warn", { userId: "u1" });
    expect(error).not.toHaveBeenCalled();
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain("[stripe:alert]");
    expect(line).toContain('"kind":"trial_will_end"');
    expect(line).toContain('"severity":"warn"');
    expect(line).toContain('"userId":"u1"');
  });

  it("writes a [stripe:alert] line to console.error for critical severity", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    emitStripeAlert("charge.dispute.created", "critical", {
      disputeId: "dp_1",
    });
    expect(warn).not.toHaveBeenCalled();
    const line = String(error.mock.calls[0]?.[0]);
    expect(line).toContain("[stripe:alert]");
    expect(line).toContain('"severity":"critical"');
    expect(line).toContain('"disputeId":"dp_1"');
  });
});
