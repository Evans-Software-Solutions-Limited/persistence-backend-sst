import {
  defaultHabitConfig,
  formatTarget,
  habitConfigFromEntry,
  isHabitCategory,
  mergeHabitConfigs,
  HABIT_ORDER,
} from "../habit-config";
import type { HabitConfigEntry } from "@/domain/ports/api.port";

describe("habit-config model", () => {
  describe("isHabitCategory", () => {
    it("accepts the five categories, rejects others", () => {
      for (const c of HABIT_ORDER) expect(isHabitCategory(c)).toBe(true);
      expect(isHabitCategory("meditation")).toBe(false);
    });
  });

  describe("formatTarget", () => {
    it("water → 1dp, steps/calories → grouped, sleep drops .0, gym integer", () => {
      expect(formatTarget("water", 2)).toBe("2.0");
      expect(formatTarget("steps", 8000)).toBe((8000).toLocaleString());
      expect(formatTarget("calories", 2000)).toBe((2000).toLocaleString());
      expect(formatTarget("sleep", 8)).toBe("8");
      expect(formatTarget("sleep", 7.5)).toBe("7.5");
      expect(formatTarget("gym", 3)).toBe("3");
    });
  });

  describe("defaultHabitConfig", () => {
    it("returns a disabled entry with the prototype defaults", () => {
      const water = defaultHabitConfig("water");
      expect(water.enabled).toBe(false);
      expect(water.targetValue).toBe(2);
      expect(water.daysPerWeek).toBe(5);
      const gym = defaultHabitConfig("gym");
      expect(gym.daysPerWeek).toBeNull();
      const cals = defaultHabitConfig("calories");
      expect(cals.tolerancePct).toBe(10);
    });
  });

  describe("habitConfigFromEntry", () => {
    const base: HabitConfigEntry = {
      category: "water",
      enabled: true,
      goalId: "g1",
      assignedByCoach: false,
      locked: false,
      targetValue: 2.5,
      unit: "l",
      period: "daily",
      completionRule: "value_gte",
      daysPerWeek: 5,
      tolerancePct: null,
      pending: null,
    };

    it("maps a live entry", () => {
      const cfg = habitConfigFromEntry(base);
      expect(cfg).not.toBeNull();
      expect(cfg!.category).toBe("water");
      expect(cfg!.targetValue).toBe(2.5);
      expect(cfg!.pending).toBeNull();
    });

    it("flattens the { from, config } pending envelope", () => {
      const cfg = habitConfigFromEntry({
        ...base,
        pending: {
          from: "2026-06-15",
          config: { targetValue: 3, daysPerWeek: 6 },
        },
      });
      expect(cfg!.pending).toEqual({
        from: "2026-06-15",
        targetValue: 3,
        daysPerWeek: 6,
        tolerancePct: undefined,
        enabled: undefined,
      });
    });

    it("maps a queued disable ({ enabled: false })", () => {
      const cfg = habitConfigFromEntry({
        ...base,
        pending: { from: "2026-06-15", config: { enabled: false } },
      });
      expect(cfg!.pending?.enabled).toBe(false);
    });

    it("returns null for an unknown category", () => {
      expect(
        habitConfigFromEntry({ ...base, category: "meditation" }),
      ).toBeNull();
    });
  });

  describe("mergeHabitConfigs", () => {
    it("returns all five in HABIT_ORDER, server rows winning", () => {
      const water = defaultHabitConfig("water");
      water.enabled = true;
      const merged = mergeHabitConfigs([water]);
      expect(merged.map((c) => c.category)).toEqual([...HABIT_ORDER]);
      expect(merged[0].enabled).toBe(true); // water (server row)
      expect(merged[1].enabled).toBe(false); // gym (default)
    });
  });
});
