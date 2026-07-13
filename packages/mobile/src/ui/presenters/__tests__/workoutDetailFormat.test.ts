import {
  formatMinutesFromSeconds,
  formatRelativeDay,
  formatShortDate,
  formatVolumeKg,
} from "@/ui/presenters/workoutDetailFormat";

describe("formatRelativeDay", () => {
  const now = Date.parse("2026-07-12T12:00:00Z");

  it("returns null for empty / unparseable input", () => {
    expect(formatRelativeDay(null, now)).toBeNull();
    expect(formatRelativeDay("not-a-date", now)).toBeNull();
  });

  it("labels today and yesterday", () => {
    expect(formatRelativeDay("2026-07-12T09:00:00Z", now)).toBe("Today");
    expect(formatRelativeDay("2026-07-11T09:00:00Z", now)).toBe("Yesterday");
  });

  it("labels days, weeks, months and years", () => {
    expect(formatRelativeDay("2026-07-09T12:00:00Z", now)).toBe("3d ago");
    expect(formatRelativeDay("2026-07-01T12:00:00Z", now)).toBe("1w ago");
    expect(formatRelativeDay("2026-06-01T12:00:00Z", now)).toBe("1mo ago");
    expect(formatRelativeDay("2025-06-01T12:00:00Z", now)).toBe("1y ago");
  });

  it("clamps a future timestamp to Today", () => {
    expect(formatRelativeDay("2026-07-20T12:00:00Z", now)).toBe("Today");
  });
});

describe("formatShortDate", () => {
  it("formats month + day", () => {
    expect(formatShortDate("2026-03-21T10:00:00Z")).toBe("Mar 21");
  });
  it("returns null for bad input", () => {
    expect(formatShortDate(null)).toBeNull();
    expect(formatShortDate("nope")).toBeNull();
  });
});

describe("formatVolumeKg", () => {
  it("groups thousands and appends kg (default weightUnit)", () => {
    expect(formatVolumeKg(6240)).toBe("6,240 kg");
    expect(formatVolumeKg(999)).toBe("999 kg");
    expect(formatVolumeKg(1234567)).toBe("1,234,567 kg");
  });
  it("rounds and floors negatives to zero", () => {
    expect(formatVolumeKg(120.6)).toBe("121 kg");
    expect(formatVolumeKg(-5)).toBe("0 kg");
  });
  it("groups thousands and appends kg when weightUnit is explicitly kg", () => {
    expect(formatVolumeKg(6240, "kg")).toBe("6,240 kg");
  });
  it("converts to lb and appends lb when weightUnit is lb", () => {
    // 6240 kg -> 13,756.845... lb, rounded to 13,757.
    expect(formatVolumeKg(6240, "lb")).toBe("13,757 lb");
    expect(formatVolumeKg(0, "lb")).toBe("0 lb");
  });
});

describe("formatMinutesFromSeconds", () => {
  it("rounds seconds to whole minutes", () => {
    expect(formatMinutesFromSeconds(2640)).toBe("44m");
    expect(formatMinutesFromSeconds(2820)).toBe("47m");
  });
  it("returns null for null / NaN", () => {
    expect(formatMinutesFromSeconds(null)).toBeNull();
    expect(formatMinutesFromSeconds(NaN)).toBeNull();
  });
});
