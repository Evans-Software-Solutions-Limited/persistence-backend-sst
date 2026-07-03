import { describe, it, expect } from "vitest";
import {
  INDEFINITE_HORIZON_DAYS,
  addDays,
  buildOccurrences,
  currentWeek,
  dayOffset,
  endDateFor,
} from "../scheduling";

describe("scheduling", () => {
  describe("addDays", () => {
    it("adds within a month", () => {
      expect(addDays("2026-07-03", 4)).toBe("2026-07-07");
    });

    it("rolls over month and year boundaries", () => {
      expect(addDays("2026-07-30", 3)).toBe("2026-08-02");
      expect(addDays("2026-12-30", 5)).toBe("2027-01-04");
    });

    it("supports negative and zero deltas", () => {
      expect(addDays("2026-07-03", 0)).toBe("2026-07-03");
      expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    });

    it("throws on malformed input", () => {
      expect(() => addDays("03/07/2026", 1)).toThrow("Invalid ISO date");
    });
  });

  describe("dayOffset", () => {
    it("d=1: one session at the start of each week", () => {
      expect([0, 1, 2].map((k) => dayOffset(k, 1))).toEqual([0, 7, 14]);
    });

    it("d=3: spreads 0/2/5 within the week", () => {
      expect([0, 1, 2, 3, 4, 5].map((k) => dayOffset(k, 3))).toEqual([
        0, 2, 5, 7, 9, 12,
      ]);
    });

    it("d=7: daily", () => {
      expect([0, 3, 6, 7].map((k) => dayOffset(k, 7))).toEqual([0, 3, 6, 7]);
    });

    it("covers every daysPerWeek without duplicate offsets in week 0", () => {
      for (let d = 1; d <= 7; d++) {
        const offsets = Array.from({ length: d }, (_, k) => dayOffset(k, d));
        expect(new Set(offsets).size).toBe(d);
        expect(Math.min(...offsets)).toBe(0);
        expect(Math.max(...offsets)).toBeLessThan(7);
      }
    });
  });

  describe("endDateFor", () => {
    it("finite: last day of the final week", () => {
      // 4 weeks from Fri 2026-07-03 → +27 days.
      expect(endDateFor("2026-07-03", 4)).toBe("2026-07-30");
      expect(endDateFor("2026-07-03", 1)).toBe("2026-07-09");
    });

    it("indefinite: null", () => {
      expect(endDateFor("2026-07-03", null)).toBeNull();
    });
  });

  describe("currentWeek", () => {
    it("week 1 on the start date and through day 6", () => {
      expect(currentWeek("2026-07-03", "2026-07-03", 4)).toBe(1);
      expect(currentWeek("2026-07-03", "2026-07-09", 4)).toBe(1);
    });

    it("week 2 from day 7", () => {
      expect(currentWeek("2026-07-03", "2026-07-10", 4)).toBe(2);
    });

    it("clamps to durationWeeks after the programme ends", () => {
      expect(currentWeek("2026-07-03", "2026-12-01", 4)).toBe(4);
    });

    it("indefinite: unbounded above, floored at week 1", () => {
      // 42 elapsed days = 6 full weeks → currently in week 7.
      expect(currentWeek("2026-07-03", "2026-08-14", null)).toBe(7);
      // Future start date still reads week 1.
      expect(currentWeek("2026-07-10", "2026-07-03", null)).toBe(1);
    });
  });

  describe("buildOccurrences — finite", () => {
    it("materialises durationWeeks × daysPerWeek occurrences, cycling workouts", () => {
      const out = buildOccurrences({
        startDate: "2026-07-03",
        daysPerWeek: 3,
        cycle: ["A", "B"],
        durationWeeks: 2,
        fromIndex: 0,
      });
      expect(out).toHaveLength(6);
      expect(out.map((o) => o.workoutId)).toEqual([
        "A",
        "B",
        "A",
        "B",
        "A",
        "B",
      ]);
      expect(out.map((o) => o.dueDate)).toEqual([
        "2026-07-03",
        "2026-07-05",
        "2026-07-08",
        "2026-07-10",
        "2026-07-12",
        "2026-07-15",
      ]);
      expect(out.map((o) => o.occurrenceIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it("cycle longer than a week's sessions still walks in order", () => {
      const out = buildOccurrences({
        startDate: "2026-07-03",
        daysPerWeek: 2,
        cycle: ["A", "B", "C"],
        durationWeeks: 3,
        fromIndex: 0,
      });
      expect(out.map((o) => o.workoutId)).toEqual([
        "A",
        "B",
        "C",
        "A",
        "B",
        "C",
      ]);
    });

    it("fromIndex resumes mid-set without renumbering", () => {
      const out = buildOccurrences({
        startDate: "2026-07-03",
        daysPerWeek: 2,
        cycle: ["A", "B", "C"],
        durationWeeks: 2,
        fromIndex: 3,
      });
      expect(out.map((o) => o.occurrenceIndex)).toEqual([3]);
      expect(out[0].workoutId).toBe("A"); // 3 mod 3
    });

    it("empty cycle yields nothing", () => {
      expect(
        buildOccurrences({
          startDate: "2026-07-03",
          daysPerWeek: 3,
          cycle: [],
          durationWeeks: 4,
          fromIndex: 0,
        }),
      ).toEqual([]);
    });
  });

  describe("buildOccurrences — indefinite", () => {
    it("stops at the horizon (inclusive)", () => {
      const out = buildOccurrences({
        startDate: "2026-07-03",
        daysPerWeek: 1,
        cycle: ["A"],
        durationWeeks: null,
        fromIndex: 0,
        horizonDate: "2026-07-17", // exactly occurrence 2's due date
      });
      expect(out.map((o) => o.dueDate)).toEqual([
        "2026-07-03",
        "2026-07-10",
        "2026-07-17",
      ]);
    });

    it("tops up from fromIndex with continuous numbering", () => {
      const out = buildOccurrences({
        startDate: "2026-07-03",
        daysPerWeek: 2,
        cycle: ["A", "B"],
        durationWeeks: null,
        fromIndex: 4,
        horizonDate: addDays("2026-07-03", INDEFINITE_HORIZON_DAYS),
      });
      expect(out[0].occurrenceIndex).toBe(4);
      expect(out.every((o, i) => o.occurrenceIndex === 4 + i)).toBe(true);
      const last = out[out.length - 1];
      expect(last.dueDate <= addDays("2026-07-03", 28)).toBe(true);
    });

    it("horizon fully in the past yields nothing beyond fromIndex", () => {
      const out = buildOccurrences({
        startDate: "2026-07-03",
        daysPerWeek: 3,
        cycle: ["A"],
        durationWeeks: null,
        fromIndex: 10,
        horizonDate: "2026-07-05",
      });
      expect(out).toEqual([]);
    });

    it("throws without a horizonDate", () => {
      expect(() =>
        buildOccurrences({
          startDate: "2026-07-03",
          daysPerWeek: 3,
          cycle: ["A"],
          durationWeeks: null,
          fromIndex: 0,
        }),
      ).toThrow("horizonDate is required");
    });
  });
});
