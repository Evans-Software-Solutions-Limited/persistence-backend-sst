import { isIsoDateString } from "../date";

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
