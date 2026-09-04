import { describe, expect, it } from "vitest";

import { addMonths } from "../foundingOffer";

describe("addMonths", () => {
  it("preserves the UTC day and time when the target month contains it", () => {
    const from = new Date("2026-08-15T18:45:12.345Z");

    expect(addMonths(from, 6).toISOString()).toBe("2027-02-15T18:45:12.345Z");
  });

  it("clamps a late-month date to the final day of a shorter month", () => {
    const from = new Date("2026-08-31T18:45:12.345Z");

    expect(addMonths(from, 6).toISOString()).toBe("2027-02-28T18:45:12.345Z");
  });

  it("clamps to leap day when February has 29 days", () => {
    const from = new Date("2024-01-31T08:30:00.000Z");

    expect(addMonths(from, 1).toISOString()).toBe("2024-02-29T08:30:00.000Z");
  });

  it("does not mutate the source date", () => {
    const from = new Date("2026-08-31T18:45:12.345Z");

    addMonths(from, 6);

    expect(from.toISOString()).toBe("2026-08-31T18:45:12.345Z");
  });
});
