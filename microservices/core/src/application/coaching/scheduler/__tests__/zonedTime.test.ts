import { describe, expect, it } from "vitest";
import {
  isQuietAt,
  isoWeekKey,
  isoWeekday,
  localMinutesIn,
  mondayOf,
  zonedInstant,
} from "../zonedTime";
import { duePeriods } from "../jobs/formPeriods";

/** PER-117 — the wall-clock maths behind weekly/daily sends and quiet hours. */

const iso = (d: Date) => d.toISOString();

describe("zonedInstant", () => {
  it("reads a local time in each zone, either side of the clock changes", () => {
    // London: GMT in winter, BST in summer.
    expect(iso(zonedInstant("2026-11-22", "18:00", "Europe/London"))).toBe(
      "2026-11-22T18:00:00.000Z",
    );
    expect(iso(zonedInstant("2027-03-28", "18:00", "Europe/London"))).toBe(
      "2027-03-28T17:00:00.000Z",
    );
    // New York: EDT until 1 Nov 2026, EST after, EDT again from 14 Mar 2027.
    expect(iso(zonedInstant("2026-10-25", "18:00", "America/New_York"))).toBe(
      "2026-10-25T22:00:00.000Z",
    );
    expect(iso(zonedInstant("2026-11-01", "18:00", "America/New_York"))).toBe(
      "2026-11-01T23:00:00.000Z",
    );
    expect(iso(zonedInstant("2027-03-14", "18:00", "America/New_York"))).toBe(
      "2027-03-14T22:00:00.000Z",
    );
  });

  it("moves a time in the spring-forward gap forward, and takes the first of a repeated time", () => {
    // 01:30 never happens in London on 28 Mar 2027 → 02:30 BST.
    expect(iso(zonedInstant("2027-03-28", "01:30", "Europe/London"))).toBe(
      "2027-03-28T01:30:00.000Z",
    );
    // 01:30 happens twice on 25 Oct 2026 → the first (BST).
    expect(iso(zonedInstant("2026-10-25", "01:30", "Europe/London"))).toBe(
      "2026-10-25T00:30:00.000Z",
    );
    // 02:30 never happens in New York on 14 Mar 2027 → 03:30 EDT.
    expect(iso(zonedInstant("2027-03-14", "02:30", "America/New_York"))).toBe(
      "2027-03-14T07:30:00.000Z",
    );
  });

  it("falls back to Europe/London for an unknown zone", () => {
    expect(iso(zonedInstant("2026-11-22", "09:00", "Not/AZone"))).toBe(
      "2026-11-22T09:00:00.000Z",
    );
  });
});

describe("weeks and days", () => {
  it("numbers ISO weeks, including a 53-week year", () => {
    expect(isoWeekKey("2026-11-22")).toBe("2026-W47");
    expect(isoWeekKey("2026-11-23")).toBe("2026-W48");
    expect(isoWeekKey("2027-01-01")).toBe("2026-W53");
    expect(isoWeekKey("2027-01-04")).toBe("2027-W01");
    expect(isoWeekKey("2024-12-30")).toBe("2025-W01");
  });

  it("finds weekdays and Mondays", () => {
    expect(isoWeekday("2026-11-22")).toBe(7);
    expect(isoWeekday("2026-11-23")).toBe(1);
    expect(mondayOf("2026-11-22")).toBe("2026-11-16");
    expect(mondayOf("2026-11-23")).toBe("2026-11-23");
  });

  it("reads local minutes", () => {
    expect(
      localMinutesIn(new Date("2026-07-01T21:30:00Z"), "Europe/London"),
    ).toBe(22 * 60 + 30);
  });
});

describe("isQuietAt", () => {
  const at = (s: string) => new Date(s);
  it("handles a window that wraps midnight, in the coach's zone", () => {
    const quiet = (s: string, tz = "Europe/London") =>
      isQuietAt(at(s), tz, "22:00", "07:00");
    expect(quiet("2026-11-23T21:59:00Z")).toBe(false);
    expect(quiet("2026-11-23T22:00:00Z")).toBe(true);
    expect(quiet("2026-11-24T06:59:00Z")).toBe(true);
    expect(quiet("2026-11-24T07:00:00Z")).toBe(false);
    // 07:00 UTC is 02:00 in New York: still quiet there.
    expect(quiet("2026-11-24T07:00:00Z", "America/New_York")).toBe(true);
    expect(quiet("2026-11-24T12:00:00Z", "America/New_York")).toBe(false);
  });

  it("handles a daytime window and no window", () => {
    expect(
      isQuietAt(at("2026-11-23T13:00:00Z"), "Europe/London", "12:00", "14:00"),
    ).toBe(true);
    expect(
      isQuietAt(at("2026-11-23T15:00:00Z"), "Europe/London", "12:00", "14:00"),
    ).toBe(false);
    expect(
      isQuietAt(at("2026-11-23T13:00:00Z"), "Europe/London", null, "14:00"),
    ).toBe(false);
    expect(
      isQuietAt(at("2026-11-23T13:00:00Z"), "Europe/London", "12:00", "12:00"),
    ).toBe(false);
  });
});

describe("duePeriods", () => {
  it("needs a time, and a weekday for weekly rules", () => {
    const now = new Date("2026-11-22T18:00:00Z");
    expect(
      duePeriods(
        "daily",
        { weekday: null, timeLocal: null },
        "Europe/London",
        now,
      ),
    ).toEqual([]);
    expect(
      duePeriods(
        "weekly",
        { weekday: null, timeLocal: "18:00" },
        "Europe/London",
        now,
      ),
    ).toEqual([]);
  });

  it("includes the previous period while it is fresh (a send just before midnight)", () => {
    const now = new Date("2026-11-23T00:05:00Z");
    const periods = duePeriods(
      "daily",
      { weekday: null, timeLocal: "23:50" },
      "Europe/London",
      now,
    );
    expect(periods.map((p) => p.key)).toEqual(["2026-11-22"]);
  });

  it("drops a period more than six hours old", () => {
    const now = new Date("2026-11-23T03:00:00Z");
    expect(
      duePeriods(
        "weekly",
        { weekday: 7, timeLocal: "18:00" },
        "Europe/London",
        now,
      ),
    ).toEqual([]);
  });
});
