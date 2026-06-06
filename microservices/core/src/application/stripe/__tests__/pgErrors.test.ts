import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "../pgErrors";

describe("pgErrors.isUniqueViolation", () => {
  it("detects SQLSTATE 23505 on the top-level error", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("detects 23505 buried in the cause chain (Drizzle wrapping)", () => {
    const err = new Error("Failed query");
    (err as { cause?: unknown }).cause = {
      cause: { code: "23505" },
    };
    expect(isUniqueViolation(err)).toBe(true);
  });

  it("falls back to matching the active-unique constraint name in the message", () => {
    const err = new Error(
      'duplicate key value violates unique constraint "user_subscriptions_active_unique"',
    );
    expect(isUniqueViolation(err)).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isUniqueViolation(new Error("network down"))).toBe(false);
    expect(isUniqueViolation({ code: "23503" })).toBe(false); // FK violation
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });

  it("does not walk the cause chain past a bounded depth", () => {
    // Build a chain deeper than the walk limit (4) with the 23505 at the
    // bottom — should NOT be found (and not infinite-loop).
    let deep: Record<string, unknown> = { code: "23505" };
    for (let i = 0; i < 8; i += 1) deep = { cause: deep };
    expect(isUniqueViolation(deep)).toBe(false);
  });
});
