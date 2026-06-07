import { describe, it, expect } from "vitest";
import {
  parseWindowKind,
  windowStartISO,
  weekStartISO,
  trailingRange,
} from "../window";

const LON = "Europe/London";

describe("parseWindowKind", () => {
  it("accepts known kinds and defaults to month", () => {
    expect(parseWindowKind("quarter")).toBe("quarter");
    expect(parseWindowKind("year")).toBe("year");
    expect(parseWindowKind("lifetime")).toBe("lifetime");
    expect(parseWindowKind("month")).toBe("month");
    expect(parseWindowKind(undefined)).toBe("month");
    expect(parseWindowKind("garbage")).toBe("month");
  });
});

describe("windowStartISO", () => {
  const now = new Date("2026-08-13T12:00:00Z"); // Aug → Q3
  it("month → first of month", () => {
    expect(windowStartISO(now, "month", LON)).toBe("2026-08-01");
  });
  it("quarter → first of the quarter (Jul for Aug)", () => {
    expect(windowStartISO(now, "quarter", LON)).toBe("2026-07-01");
  });
  it("year → Jan 1", () => {
    expect(windowStartISO(now, "year", LON)).toBe("2026-01-01");
  });
  it("lifetime → epoch", () => {
    expect(windowStartISO(now, "lifetime", LON)).toBe("1970-01-01");
  });
  it("quarter boundaries", () => {
    expect(
      windowStartISO(new Date("2026-01-15T12:00:00Z"), "quarter", LON),
    ).toBe("2026-01-01");
    expect(
      windowStartISO(new Date("2026-12-31T12:00:00Z"), "quarter", LON),
    ).toBe("2026-10-01");
  });
});

describe("weekStartISO", () => {
  it("returns the Monday of the current week", () => {
    // Wed 2026-06-10 → Mon 2026-06-08
    expect(weekStartISO(new Date("2026-06-10T12:00:00Z"), LON)).toBe(
      "2026-06-08",
    );
    // Sun 2026-06-07 → Mon 2026-06-01
    expect(weekStartISO(new Date("2026-06-07T12:00:00Z"), LON)).toBe(
      "2026-06-01",
    );
    // Mon 2026-06-08 → itself
    expect(weekStartISO(new Date("2026-06-08T12:00:00Z"), LON)).toBe(
      "2026-06-08",
    );
  });
});

describe("trailingRange", () => {
  it("returns an inclusive N-day range ending today", () => {
    expect(trailingRange(new Date("2026-06-10T12:00:00Z"), 7, LON)).toEqual({
      start: "2026-06-04",
      end: "2026-06-10",
    });
  });
});
