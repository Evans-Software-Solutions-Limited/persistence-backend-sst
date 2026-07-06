import { describe, it, expect } from "vitest";
import {
  collectionAtRisk,
  collectionSatisfied,
  weekMet,
  type HabitWeekAggregate,
} from "../collection";

const valueGte = (o: Partial<HabitWeekAggregate> = {}): HabitWeekAggregate => ({
  goalId: "g",
  completionRule: "value_gte",
  targetValue: 2,
  daysPerWeek: 5,
  tolerancePct: null,
  qualifyingDays: 0,
  sessionCount: 0,
  ...o,
});

const gym = (o: Partial<HabitWeekAggregate> = {}): HabitWeekAggregate => ({
  goalId: "gym",
  completionRule: "count",
  targetValue: 3,
  daysPerWeek: null,
  tolerancePct: null,
  qualifyingDays: 0,
  sessionCount: 0,
  ...o,
});

const calories = (o: Partial<HabitWeekAggregate> = {}): HabitWeekAggregate => ({
  goalId: "cal",
  completionRule: "within_tolerance",
  targetValue: 2000,
  daysPerWeek: 6,
  tolerancePct: 10,
  qualifyingDays: 0,
  sessionCount: 0,
  ...o,
});

describe("weekMet (design.md § 4.1)", () => {
  it("value_gte: met when qualifyingDays >= days_per_week", () => {
    expect(weekMet(valueGte({ qualifyingDays: 5 }))).toBe(true);
    expect(weekMet(valueGte({ qualifyingDays: 6 }))).toBe(true);
    expect(weekMet(valueGte({ qualifyingDays: 4 }))).toBe(false);
  });

  it("value_gte: a null days_per_week floors need at 1", () => {
    expect(weekMet(valueGte({ daysPerWeek: null, qualifyingDays: 1 }))).toBe(
      true,
    );
    expect(weekMet(valueGte({ daysPerWeek: null, qualifyingDays: 0 }))).toBe(
      false,
    );
  });

  it("count (Gym): met when sessions >= target (target ceils)", () => {
    expect(weekMet(gym({ sessionCount: 3 }))).toBe(true);
    expect(weekMet(gym({ sessionCount: 2 }))).toBe(false);
    expect(weekMet(gym({ targetValue: 2.5, sessionCount: 3 }))).toBe(true);
    expect(weekMet(gym({ targetValue: 2.5, sessionCount: 2 }))).toBe(false);
  });

  it("within_tolerance (Calories): met when in-tolerance days >= days_per_week", () => {
    expect(weekMet(calories({ qualifyingDays: 6 }))).toBe(true);
    expect(weekMet(calories({ qualifyingDays: 5 }))).toBe(false);
  });
});

describe("collectionSatisfied (design.md § 4.2)", () => {
  it("is false with no enabled habits", () => {
    expect(collectionSatisfied([])).toBe(false);
  });

  it("is true only when EVERY enabled habit's week is met", () => {
    expect(
      collectionSatisfied([
        valueGte({ qualifyingDays: 5 }),
        gym({ sessionCount: 3 }),
        calories({ qualifyingDays: 6 }),
      ]),
    ).toBe(true);
  });

  it("is false when any single habit falls short", () => {
    expect(
      collectionSatisfied([
        valueGte({ qualifyingDays: 5 }),
        gym({ sessionCount: 2 }), // short
      ]),
    ).toBe(false);
  });
});

describe("collectionAtRisk (design.md § 4.2)", () => {
  it("is false with no habits or when already satisfied", () => {
    expect(collectionAtRisk([], 3)).toBe(false);
    expect(collectionAtRisk([valueGte({ qualifyingDays: 5 })], 2)).toBe(false);
  });

  it("value_gte: at risk when qualifyingDays + remaining < days_per_week", () => {
    // need 5, have 2, 2 days left → best case 4 < 5 → at risk.
    expect(collectionAtRisk([valueGte({ qualifyingDays: 2 })], 2)).toBe(true);
    // need 5, have 3, 2 days left → best case 5 == 5 → still reachable.
    expect(collectionAtRisk([valueGte({ qualifyingDays: 3 })], 2)).toBe(false);
  });

  it("count (Gym): at risk when sessions + remaining < target", () => {
    expect(collectionAtRisk([gym({ sessionCount: 0 })], 2)).toBe(true); // need 3
    expect(collectionAtRisk([gym({ sessionCount: 1 })], 2)).toBe(false); // 1+2=3
  });

  it("flags at risk if ANY habit is doomed even when another is fine", () => {
    expect(
      collectionAtRisk(
        [
          valueGte({ qualifyingDays: 5 }), // already met
          gym({ sessionCount: 0 }), // doomed with 1 day left
        ],
        1,
      ),
    ).toBe(true);
  });
});
