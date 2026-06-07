import { deriveStreak } from "../streak.service";

const TODAY = new Date("2026-06-10T12:00:00.000Z"); // Wed; week Monday = 06-08

const c = (day: string) => ({ completedAt: `${day}T09:00:00.000Z` });

describe("deriveStreak — daily", () => {
  it("returns 0 for an empty cache", () => {
    expect(deriveStreak([], TODAY, "daily")).toBe(0);
  });

  it("counts consecutive days ending today", () => {
    expect(
      deriveStreak(
        [c("2026-06-10"), c("2026-06-09"), c("2026-06-08")],
        TODAY,
        "daily",
      ),
    ).toBe(3);
  });

  it("grace: today-not-yet-done starts the walk at yesterday", () => {
    expect(
      deriveStreak([c("2026-06-09"), c("2026-06-08")], TODAY, "daily"),
    ).toBe(2);
  });

  it("stops at a gap", () => {
    expect(deriveStreak([c("2026-06-10")], TODAY, "daily")).toBe(1);
    // 06-08 exists but 06-09 is missing → today's streak is just today... none
    expect(deriveStreak([c("2026-06-08")], TODAY, "daily")).toBe(0);
  });

  it("ignores future-dated completions", () => {
    expect(deriveStreak([c("2026-06-11")], TODAY, "daily")).toBe(0);
  });

  it("dedupes multiple completions on the same day", () => {
    expect(
      deriveStreak(
        [c("2026-06-10"), { completedAt: "2026-06-10T20:00:00.000Z" }],
        TODAY,
        "daily",
      ),
    ).toBe(1);
  });
});

describe("deriveStreak — weekly", () => {
  it("counts consecutive Mon–Sun weeks ending this week", () => {
    expect(
      deriveStreak([c("2026-06-09"), c("2026-06-02")], TODAY, "weekly"),
    ).toBe(2);
  });

  it("grace: no completion this week yet starts at last week", () => {
    expect(
      deriveStreak([c("2026-06-02"), c("2026-05-26")], TODAY, "weekly"),
    ).toBe(2);
  });

  it("stops at a missed week", () => {
    // this week satisfied, but the week before last (skipping last week) → 1
    expect(
      deriveStreak([c("2026-06-09"), c("2026-05-26")], TODAY, "weekly"),
    ).toBe(1);
  });

  it("returns 0 when neither this nor last week has a completion", () => {
    expect(deriveStreak([c("2026-05-20")], TODAY, "weekly")).toBe(0);
  });
});
