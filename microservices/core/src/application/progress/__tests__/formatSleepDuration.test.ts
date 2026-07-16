import { describe, it, expect } from "vitest";
import { formatSleepDuration } from "../formatSleepDuration";

describe("formatSleepDuration", () => {
  it("formats hours + minutes for >= 60", () => {
    expect(formatSleepDuration(450)).toBe("7h 30m");
  });

  it("formats minutes-only for < 60", () => {
    expect(formatSleepDuration(45)).toBe("45m");
  });

  it("returns null for null/undefined", () => {
    expect(formatSleepDuration(null)).toBeNull();
    expect(formatSleepDuration(undefined)).toBeNull();
  });

  it("formats an exact-hour duration with 0 remainder minutes", () => {
    expect(formatSleepDuration(420)).toBe("7h 0m");
  });

  it("formats 0 minutes as '0m'", () => {
    expect(formatSleepDuration(0)).toBe("0m");
  });

  it("formats a single minute", () => {
    expect(formatSleepDuration(1)).toBe("1m");
  });
});
