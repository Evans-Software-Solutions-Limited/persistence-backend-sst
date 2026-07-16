import { describe, it, expect } from "vitest";
import { isValidCalendarDate } from "../sleepDate";

describe("isValidCalendarDate", () => {
  it("accepts real calendar dates", () => {
    expect(isValidCalendarDate("2026-07-16")).toBe(true);
    expect(isValidCalendarDate("2024-02-29")).toBe(true); // leap day
    expect(isValidCalendarDate("2026-12-31")).toBe(true);
    expect(isValidCalendarDate("2026-01-01")).toBe(true);
  });

  it("rejects the wrong shape", () => {
    expect(isValidCalendarDate("16-07-2026")).toBe(false);
    expect(isValidCalendarDate("2026-7-16")).toBe(false);
    expect(isValidCalendarDate("not-a-date")).toBe(false);
    expect(isValidCalendarDate("")).toBe(false);
  });

  it("rejects shape-valid but calendar-impossible dates", () => {
    expect(isValidCalendarDate("2026-13-45")).toBe(false); // month + day
    expect(isValidCalendarDate("2026-00-10")).toBe(false); // month 0
    expect(isValidCalendarDate("2026-02-30")).toBe(false); // Feb 30
    expect(isValidCalendarDate("2025-02-29")).toBe(false); // not a leap year
    expect(isValidCalendarDate("2026-04-31")).toBe(false); // Apr has 30
  });
});
