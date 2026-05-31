import { computeAge } from "../age";

describe("computeAge", () => {
  it("returns null for null / undefined / empty DOB", () => {
    expect(computeAge(null)).toBeNull();
    expect(computeAge(undefined)).toBeNull();
    expect(computeAge("")).toBeNull();
  });

  it("returns null for a malformed date string", () => {
    expect(computeAge("not-a-date")).toBeNull();
  });

  it("computes whole years for a birthday already passed this year", () => {
    // Born 1990-01-15; 'now' is 2026-05-31 → 36.
    expect(computeAge("1990-01-15", new Date("2026-05-31T12:00:00Z"))).toBe(36);
  });

  it("does not count this year's birthday before it arrives", () => {
    // Born 1990-12-15; 'now' is 2026-05-31 (before December) → 35.
    expect(computeAge("1990-12-15", new Date("2026-05-31T12:00:00Z"))).toBe(35);
  });

  it("ticks over exactly on the birthday", () => {
    const dob = "2000-05-31";
    // Day before → 25.
    expect(computeAge(dob, new Date("2026-05-30T12:00:00Z"))).toBe(26 - 1);
    // On the day → 26.
    expect(computeAge(dob, new Date("2026-05-31T00:00:00Z"))).toBe(26);
  });

  it("handles a Feb 29 (leap-day) birthday in a common year", () => {
    const dob = "2000-02-29";
    // 2025 is not a leap year. On Feb 28 the birthday hasn't arrived → 24.
    expect(computeAge(dob, new Date("2025-02-28T12:00:00Z"))).toBe(24);
    // On Mar 1 it has → 25.
    expect(computeAge(dob, new Date("2025-03-01T12:00:00Z"))).toBe(25);
  });

  it("returns 0 for an infant born earlier the same year", () => {
    expect(computeAge("2026-01-01", new Date("2026-05-31T12:00:00Z"))).toBe(0);
  });

  it("returns null for a future DOB", () => {
    expect(computeAge("2030-01-01", new Date("2026-05-31T12:00:00Z"))).toBeNull();
  });
});
