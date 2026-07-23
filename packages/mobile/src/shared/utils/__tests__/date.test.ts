import {
  isIsoDateString,
  localDayISO,
  weekStartMondayISO,
  timeGreeting,
  addDaysISO,
  previousDayISO,
  loggedAtNoonUtc,
  dayLabel,
} from "../date";

describe("timeGreeting", () => {
  const at = (h: number) => new Date(2026, 5, 10, h, 0, 0); // local hour h
  it("picks the greeting by local hour", () => {
    expect(timeGreeting(at(6))).toBe("Good morning"); // 06:00
    expect(timeGreeting(at(11))).toBe("Good morning"); // 11:59-ish
    expect(timeGreeting(at(12))).toBe("Good afternoon"); // noon
    expect(timeGreeting(at(17))).toBe("Good afternoon");
    expect(timeGreeting(at(18))).toBe("Good evening");
    expect(timeGreeting(at(23))).toBe("Good evening");
    expect(timeGreeting(at(4))).toBe("Good evening"); // pre-dawn
  });
});

describe("weekStartMondayISO", () => {
  it("returns the Monday of the week for any day", () => {
    // 2026-06-15 is a Monday.
    expect(weekStartMondayISO("2026-06-15")).toBe("2026-06-15"); // Mon → itself
    expect(weekStartMondayISO("2026-06-17")).toBe("2026-06-15"); // Wed → Mon
    expect(weekStartMondayISO("2026-06-21")).toBe("2026-06-15"); // Sun → Mon
    expect(weekStartMondayISO("2026-06-14")).toBe("2026-06-08"); // Sun (prev wk)
  });

  it("crosses a month boundary correctly", () => {
    // 2026-07-01 is a Wednesday → Monday 2026-06-29.
    expect(weekStartMondayISO("2026-07-01")).toBe("2026-06-29");
  });

  // Regression: the Mon→Sun window `[monday, monday+6]` must ALWAYS contain its
  // own anchor day — including at the boundaries (Monday → index 0, Sunday →
  // index 6). A Monday-boundary off-by-one here is what made the habits grid's
  // `weekDates.indexOf(today)` return -1 on Mondays.
  it("builds a Mon→Sun window that always contains the anchor day", () => {
    const addDays = (iso: string, n: number) => {
      const d = new Date(`${iso}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };
    // 2026-07-06 Mon … 2026-07-12 Sun — one anchor per weekday.
    for (let i = 0; i < 7; i++) {
      const day = addDays("2026-07-06", i);
      const monday = weekStartMondayISO(day);
      const window = Array.from({ length: 7 }, (_, k) => addDays(monday, k));
      expect(new Date(`${monday}T00:00:00.000Z`).getUTCDay()).toBe(1); // Monday
      expect(window).toContain(day);
      expect(window.indexOf(day)).toBe(i); // Mon=0 … Sun=6
    }
  });
});

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

describe("addDaysISO", () => {
  it("steps forward and backward within a month", () => {
    expect(addDaysISO("2026-07-15", 1)).toBe("2026-07-16");
    expect(addDaysISO("2026-07-15", -1)).toBe("2026-07-14");
  });

  it("crosses a month boundary in both directions", () => {
    expect(addDaysISO("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDaysISO("2026-08-01", -1)).toBe("2026-07-31");
  });

  it("crosses a year boundary", () => {
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysISO("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("is a no-op for delta 0", () => {
    expect(addDaysISO("2026-07-15", 0)).toBe("2026-07-15");
  });
});

describe("previousDayISO", () => {
  it("returns the day before, crossing month/year boundaries", () => {
    expect(previousDayISO("2026-07-15")).toBe("2026-07-14");
    expect(previousDayISO("2026-08-01")).toBe("2026-07-31");
    expect(previousDayISO("2027-01-01")).toBe("2026-12-31");
  });
});

describe("loggedAtNoonUtc", () => {
  it("anchors a day to noon UTC", () => {
    expect(loggedAtNoonUtc("2026-07-15")).toBe("2026-07-15T12:00:00.000Z");
  });
});

describe("dayLabel", () => {
  it('returns "Today" when the day matches the injected today', () => {
    expect(dayLabel("2026-07-15", new Date(2026, 6, 15))).toBe("Today");
  });

  it("returns the weekday · short-month day format for any other day", () => {
    // 2026-07-14 is a Tuesday.
    expect(dayLabel("2026-07-14", new Date(2026, 6, 15))).toBe(
      "TUESDAY · JUL 14",
    );
  });

  it("defaults `today` to now when omitted", () => {
    expect(dayLabel(localDayISO())).toBe("Today");
  });

  it("returns an empty string for a malformed day", () => {
    expect(dayLabel("not-a-date", new Date(2026, 6, 15))).toBe("");
  });
});
