import { describe, it, expect } from "vitest";
import {
  localDateISO,
  localWeekday,
  addDaysISO,
  compareISO,
  periodEndISO,
  periodStartFromEndISO,
  previousPeriodEndISO,
  lastCompletedPeriodEndISO,
  periodsBetween,
} from "../period";

const LON = "Europe/London";
const LA = "America/Los_Angeles";

describe("period — local date extraction", () => {
  it("localDateISO returns user-local YYYY-MM-DD", () => {
    expect(localDateISO(new Date("2026-06-07T12:00:00Z"), LON)).toBe(
      "2026-06-07",
    );
  });

  it("localDateISO shifts across the date line by tz", () => {
    // 02:00Z is still 06-06 (19:00) in Los Angeles
    expect(localDateISO(new Date("2026-06-07T02:00:00Z"), LA)).toBe(
      "2026-06-06",
    );
    expect(localDateISO(new Date("2026-06-07T02:00:00Z"), LON)).toBe(
      "2026-06-07",
    );
  });

  it("localWeekday returns 0=Sun..6=Sat", () => {
    expect(localWeekday(new Date("2026-06-07T12:00:00Z"), LON)).toBe(0); // Sun
    expect(localWeekday(new Date("2026-06-08T12:00:00Z"), LON)).toBe(1); // Mon
    expect(localWeekday(new Date("2026-06-10T12:00:00Z"), LON)).toBe(3); // Wed
  });
});

describe("period — date arithmetic", () => {
  it("addDaysISO crosses month and year boundaries", () => {
    expect(addDaysISO("2026-06-30", 1)).toBe("2026-07-01");
    expect(addDaysISO("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysISO("2026-06-10", 4)).toBe("2026-06-14");
  });

  it("compareISO orders chronologically", () => {
    expect(compareISO("2026-06-07", "2026-06-08")).toBe(-1);
    expect(compareISO("2026-06-08", "2026-06-07")).toBe(1);
    expect(compareISO("2026-06-07", "2026-06-07")).toBe(0);
  });
});

describe("period — periodEndISO", () => {
  it("daily ⇒ that day", () => {
    expect(periodEndISO(new Date("2026-06-10T12:00:00Z"), "daily", LON)).toBe(
      "2026-06-10",
    );
  });

  it("weekly ⇒ the Sunday of that week (Mon–Sun)", () => {
    // Wed 06-10 → Sun 06-14
    expect(periodEndISO(new Date("2026-06-10T12:00:00Z"), "weekly", LON)).toBe(
      "2026-06-14",
    );
    // Sun 06-07 → same day
    expect(periodEndISO(new Date("2026-06-07T12:00:00Z"), "weekly", LON)).toBe(
      "2026-06-07",
    );
    // Mon 06-08 → 06-14
    expect(periodEndISO(new Date("2026-06-08T12:00:00Z"), "weekly", LON)).toBe(
      "2026-06-14",
    );
  });

  it("monthly ⇒ last day of month (non-leap Feb)", () => {
    expect(periodEndISO(new Date("2026-06-10T12:00:00Z"), "monthly", LON)).toBe(
      "2026-06-30",
    );
    expect(periodEndISO(new Date("2026-02-15T12:00:00Z"), "monthly", LON)).toBe(
      "2026-02-28",
    );
  });
});

describe("period — start / previous / last-completed", () => {
  it("periodStartFromEndISO", () => {
    expect(periodStartFromEndISO("2026-06-10", "daily")).toBe("2026-06-10");
    expect(periodStartFromEndISO("2026-06-14", "weekly")).toBe("2026-06-08"); // Monday
    expect(periodStartFromEndISO("2026-06-30", "monthly")).toBe("2026-06-01");
  });

  it("previousPeriodEndISO", () => {
    expect(previousPeriodEndISO("2026-06-10", "daily")).toBe("2026-06-09");
    expect(previousPeriodEndISO("2026-06-14", "weekly")).toBe("2026-06-07");
    expect(previousPeriodEndISO("2026-06-30", "monthly")).toBe("2026-05-31");
    expect(previousPeriodEndISO("2026-01-31", "monthly")).toBe("2025-12-31");
  });

  it("lastCompletedPeriodEndISO", () => {
    const now = new Date("2026-06-10T12:00:00Z"); // Wed
    expect(lastCompletedPeriodEndISO(now, "daily", LON)).toBe("2026-06-09");
    expect(lastCompletedPeriodEndISO(now, "weekly", LON)).toBe("2026-06-07");
    expect(lastCompletedPeriodEndISO(now, "monthly", LON)).toBe("2026-05-31");
    // On the Sunday itself the current week is still open → prior Sunday.
    expect(
      lastCompletedPeriodEndISO(
        new Date("2026-06-07T12:00:00Z"),
        "weekly",
        LON,
      ),
    ).toBe("2026-05-31");
  });

  it("periodsBetween counts elapsed periods per grain", () => {
    // daily
    expect(periodsBetween("2026-06-06", "2026-06-09", "daily")).toBe(3);
    expect(periodsBetween("2026-06-09", "2026-06-09", "daily")).toBe(0);
    expect(periodsBetween("2026-06-10", "2026-06-09", "daily")).toBe(0); // not behind
    // weekly (Sundays, 7 apart)
    expect(periodsBetween("2026-05-17", "2026-06-07", "weekly")).toBe(3);
    expect(periodsBetween("2026-06-07", "2026-06-14", "weekly")).toBe(1);
    // monthly (last-of-month)
    expect(periodsBetween("2026-03-31", "2026-06-30", "monthly")).toBe(3);
    expect(periodsBetween("2025-12-31", "2026-01-31", "monthly")).toBe(1);
  });
});
