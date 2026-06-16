import { isIsoDateString, localDayISO } from "../date";

describe("localDayISO", () => {
  it("returns the device-local calendar date as YYYY-MM-DD", () => {
    // `new Date(y, m, d)` builds LOCAL midnight, so getFullYear/Month/Date
    // round-trip the same components regardless of the runner's timezone.
    expect(localDayISO(new Date(2026, 5, 10))).toBe("2026-06-10"); // month is 0-based
    expect(localDayISO(new Date(2026, 0, 1))).toBe("2026-01-01");
    expect(localDayISO(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("zero-pads single-digit months and days", () => {
    expect(localDayISO(new Date(2026, 2, 5))).toBe("2026-03-05");
  });

  it("uses local components, not the UTC date, near midnight", () => {
    // 23:30 local on Jun 10 is still Jun 10 locally even though it may be
    // Jun 11 in UTC (positive offsets). The local date is what we want.
    const lateLocal = new Date(2026, 5, 10, 23, 30, 0);
    expect(localDayISO(lateLocal)).toBe("2026-06-10");
  });
});

describe("isIsoDateString", () => {
  it("accepts a valid YYYY-MM-DD date", () => {
    expect(isIsoDateString("1990-01-15")).toBe(true);
    expect(isIsoDateString("2000-02-29")).toBe(true); // 2000 is a leap year
    expect(isIsoDateString("2026-12-31")).toBe(true);
  });

  it("rejects the wrong shape", () => {
    expect(isIsoDateString("1990")).toBe(false);
    expect(isIsoDateString("1990-1-5")).toBe(false);
    expect(isIsoDateString("1990/01/15")).toBe(false);
    expect(isIsoDateString("15-01-1990")).toBe(false);
    expect(isIsoDateString("")).toBe(false);
    expect(isIsoDateString("not-a-date")).toBe(false);
  });

  it("rejects impossible months and days", () => {
    expect(isIsoDateString("1990-13-50")).toBe(false);
    expect(isIsoDateString("1990-00-10")).toBe(false);
    expect(isIsoDateString("1990-01-00")).toBe(false);
    expect(isIsoDateString("1990-01-32")).toBe(false);
  });

  it("rejects Feb 29 in a non-leap year", () => {
    expect(isIsoDateString("1990-02-29")).toBe(false);
    expect(isIsoDateString("2025-02-29")).toBe(false);
  });

  it("rejects April 31 (a month that doesn't have 31 days)", () => {
    expect(isIsoDateString("2026-04-31")).toBe(false);
  });
});
