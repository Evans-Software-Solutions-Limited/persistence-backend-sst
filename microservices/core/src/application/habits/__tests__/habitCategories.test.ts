import { describe, it, expect } from "vitest";
import {
  HABIT_CATEGORIES,
  HABIT_CATEGORY_ORDER,
  isHabitCategory,
  validateHabitConfigInput,
} from "../habitCategories";

describe("HABIT_CATEGORIES metadata", () => {
  it("defines exactly the five fixed categories in prototype order", () => {
    expect(HABIT_CATEGORY_ORDER).toEqual([
      "water",
      "gym",
      "steps",
      "sleep",
      "calories",
    ]);
    expect(Object.keys(HABIT_CATEGORIES).sort()).toEqual(
      [...HABIT_CATEGORY_ORDER].sort(),
    );
  });

  it("maps each category to its server-authoritative period + rule", () => {
    expect(HABIT_CATEGORIES.water.completionRule).toBe("value_gte");
    expect(HABIT_CATEGORIES.gym.period).toBe("weekly");
    expect(HABIT_CATEGORIES.gym.completionRule).toBe("count");
    expect(HABIT_CATEGORIES.gym.daysPerWeek).toBeNull();
    expect(HABIT_CATEGORIES.calories.completionRule).toBe("within_tolerance");
    expect(HABIT_CATEGORIES.calories.tolerancePct).not.toBeNull();
  });

  it("only Calories carries a tolerance band", () => {
    for (const c of HABIT_CATEGORY_ORDER) {
      const hasTol = HABIT_CATEGORIES[c].tolerancePct !== null;
      expect(hasTol).toBe(c === "calories");
    }
  });
});

describe("isHabitCategory", () => {
  it("accepts known slugs and rejects others", () => {
    expect(isHabitCategory("water")).toBe(true);
    expect(isHabitCategory("calories")).toBe(true);
    expect(isHabitCategory("mood")).toBe(false);
    expect(isHabitCategory("")).toBe(false);
    expect(isHabitCategory("toString")).toBe(false); // not an own-property
  });
});

describe("validateHabitConfigInput", () => {
  it("accepts a valid Water config and normalises server fields", () => {
    const r = validateHabitConfigInput("water", {
      targetValue: 2.5,
      daysPerWeek: 6,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.config).toEqual({
      category: "water",
      period: "daily",
      completionRule: "value_gte",
      unit: "l",
      targetValue: 2.5,
      daysPerWeek: 6,
      tolerancePct: null,
    });
  });

  it("defaults daysPerWeek for a daily habit when omitted", () => {
    const r = validateHabitConfigInput("steps", { targetValue: 10000 });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.config.daysPerWeek).toBe(
      HABIT_CATEGORIES.steps.daysPerWeek!.default,
    );
  });

  it("forces daysPerWeek null for Gym even if supplied", () => {
    const r = validateHabitConfigInput("gym", {
      targetValue: 4,
      daysPerWeek: 5,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.config.daysPerWeek).toBeNull();
    expect(r.config.completionRule).toBe("count");
  });

  it("defaults calorie leniency when omitted and honours a supplied one", () => {
    const def = validateHabitConfigInput("calories", { targetValue: 2200 });
    expect(def.ok && def.config.tolerancePct).toBe(10);
    const custom = validateHabitConfigInput("calories", {
      targetValue: 2200,
      tolerancePct: 15,
    });
    expect(custom.ok && custom.config.tolerancePct).toBe(15);
  });

  it("forces tolerancePct null for non-calorie habits", () => {
    const r = validateHabitConfigInput("sleep", {
      targetValue: 8,
      tolerancePct: 20,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.config.tolerancePct).toBeNull();
  });

  it("rejects an out-of-range target (low and high)", () => {
    expect(validateHabitConfigInput("water", { targetValue: 0 }).ok).toBe(
      false,
    );
    expect(validateHabitConfigInput("water", { targetValue: 21 }).ok).toBe(
      false,
    );
    const r = validateHabitConfigInput("steps", { targetValue: 999 });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected error");
    expect(r.error).toContain("targetValue");
  });

  it("rejects a non-finite target", () => {
    expect(validateHabitConfigInput("sleep", { targetValue: NaN }).ok).toBe(
      false,
    );
    expect(
      validateHabitConfigInput("sleep", { targetValue: Infinity }).ok,
    ).toBe(false);
  });

  it("rejects out-of-range or non-integer daysPerWeek for a daily habit", () => {
    expect(
      validateHabitConfigInput("water", { targetValue: 2, daysPerWeek: 0 }).ok,
    ).toBe(false);
    expect(
      validateHabitConfigInput("water", { targetValue: 2, daysPerWeek: 8 }).ok,
    ).toBe(false);
    const frac = validateHabitConfigInput("water", {
      targetValue: 2,
      daysPerWeek: 3.5,
    });
    expect(frac.ok).toBe(false);
    if (frac.ok) throw new Error("expected error");
    expect(frac.error).toContain("daysPerWeek");
  });

  it("rejects an out-of-range calorie leniency", () => {
    const r = validateHabitConfigInput("calories", {
      targetValue: 2000,
      tolerancePct: 60,
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected error");
    expect(r.error).toContain("tolerancePct");
  });

  it("ignores a client-supplied Calories target (read-only, owned by Nutrition)", () => {
    const r = validateHabitConfigInput("calories", {
      targetValue: 5000, // client tries to set its calorie goal here
      tolerancePct: 12,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    // Forced to the canonical (Nutrition-owned) value, NOT the client's 5000.
    expect(r.config.targetValue).toBe(HABIT_CATEGORIES.calories.target.default);
    expect(r.config.tolerancePct).toBe(12);
  });

  it("an out-of-bounds Calories target is harmless (ignored, not rejected)", () => {
    // 999999 would be out of range, but read-only means it's never read.
    const r = validateHabitConfigInput("calories", { targetValue: 999999 });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.config.targetValue).toBe(2000);
  });

  it("marks only the Calories target read-only", () => {
    for (const c of HABIT_CATEGORY_ORDER) {
      expect(Boolean(HABIT_CATEGORIES[c].targetReadOnly)).toBe(
        c === "calories",
      );
    }
  });

  it("accepts the documented bounds + defaults for every category", () => {
    for (const c of HABIT_CATEGORY_ORDER) {
      const meta = HABIT_CATEGORIES[c];
      const r = validateHabitConfigInput(c, {
        targetValue: meta.target.default,
      });
      expect(r.ok).toBe(true);
    }
  });
});
