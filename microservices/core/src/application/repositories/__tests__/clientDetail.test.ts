import { describe, it, expect } from "vitest";
import {
  ageYearsFrom,
  calorieCategoryPct,
  habitProgressPct,
  weightGoalPct,
} from "../clientDetail";

describe("clientDetail pure helpers", () => {
  describe("ageYearsFrom", () => {
    const now = new Date("2026-07-06T12:00:00.000Z");

    it("returns null for missing / unparseable DOB", () => {
      expect(ageYearsFrom(null, now)).toBeNull();
      expect(ageYearsFrom(undefined, now)).toBeNull();
      expect(ageYearsFrom("not-a-date", now)).toBeNull();
    });

    it("computes whole years, not-yet-had-birthday-this-year down by one", () => {
      // birthday already passed this year (June) → 36
      expect(ageYearsFrom("1990-06-01", now)).toBe(36);
      // birthday later this year (August) → still 35
      expect(ageYearsFrom("1990-08-01", now)).toBe(35);
      // birthday is exactly today → counts
      expect(ageYearsFrom("1990-07-06", now)).toBe(36);
    });

    it("clamps a future DOB to null (never negative)", () => {
      expect(ageYearsFrom("2030-01-01", now)).toBeNull();
    });
  });

  describe("calorieCategoryPct", () => {
    it("is null when nothing logged", () => {
      expect(calorieCategoryPct(0, 0)).toBeNull();
    });
    it("rounds hit/logged to a 0..100 integer", () => {
      expect(calorieCategoryPct(3, 5)).toBe(60);
      expect(calorieCategoryPct(1, 3)).toBe(33);
      expect(calorieCategoryPct(7, 7)).toBe(100);
    });
  });

  describe("weightGoalPct", () => {
    it("is null when any endpoint is missing", () => {
      expect(weightGoalPct(null, 80, 75)).toBeNull();
      expect(weightGoalPct(85, null, 75)).toBeNull();
      expect(weightGoalPct(85, 80, null)).toBeNull();
    });
    it("is null when start === target (divide by zero)", () => {
      expect(weightGoalPct(80, 79, 80)).toBeNull();
    });
    it("computes and clamps 0..1 (weight loss)", () => {
      // start 90, now 85, target 80 → halfway → 0.5
      expect(weightGoalPct(90, 85, 80)).toBe(0.5);
      // overshoot past target → clamp to 1
      expect(weightGoalPct(90, 75, 80)).toBe(1);
      // moved the wrong way → clamp to 0
      expect(weightGoalPct(90, 95, 80)).toBe(0);
    });
  });

  describe("habitProgressPct", () => {
    it("count habits divide sessionCount by the target, clamped", () => {
      expect(
        habitProgressPct({
          completionRule: "count",
          targetValue: 4,
          daysPerWeek: null,
          qualifyingDays: 0,
          sessionCount: 2,
        }),
      ).toBe(0.5);
      expect(
        habitProgressPct({
          completionRule: "count",
          targetValue: 3,
          daysPerWeek: null,
          qualifyingDays: 0,
          sessionCount: 5,
        }),
      ).toBe(1);
    });

    it("day-based habits divide qualifyingDays by days_per_week, clamped", () => {
      expect(
        habitProgressPct({
          completionRule: "value_gte",
          targetValue: 2,
          daysPerWeek: 5,
          qualifyingDays: 3,
          sessionCount: 0,
        }),
      ).toBe(0.6);
      expect(
        habitProgressPct({
          completionRule: "within_tolerance",
          targetValue: 2000,
          daysPerWeek: 6,
          qualifyingDays: 6,
          sessionCount: 0,
        }),
      ).toBe(1);
    });

    it("defaults days_per_week to 1 and guards non-positive denominators", () => {
      expect(
        habitProgressPct({
          completionRule: "value_gte",
          targetValue: 2,
          daysPerWeek: null,
          qualifyingDays: 1,
          sessionCount: 0,
        }),
      ).toBe(1);
      expect(
        habitProgressPct({
          completionRule: "count",
          targetValue: 0,
          daysPerWeek: null,
          qualifyingDays: 0,
          sessionCount: 0,
        }),
      ).toBe(1);
    });
  });
});
