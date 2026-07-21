import { describe, expect, it } from "vitest";
import { CONSENT_VERSION } from "../consent";

describe("consent constants", () => {
  it("exports the current consent version string", () => {
    expect(CONSENT_VERSION).toBe("v1-2026-07");
    expect(typeof CONSENT_VERSION).toBe("string");
    expect(CONSENT_VERSION.length).toBeGreaterThan(0);
  });
});
