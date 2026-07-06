/**
 * Habit category metadata + config-input validation (18-habit-setup).
 * Per specs/18-habit-setup/design.md § 1.1 + § 3.1 and cross-cuts § 3.7.
 *
 * The five habit categories are FIXED. `period` and `completion_rule` are
 * server-authoritative (derived from the category, never client-supplied), as
 * are the bounds — the client may only choose target / days-per-week / leniency
 * within them. Pure: no DB, no clock; fully unit-tested.
 */

export type HabitCategory = "water" | "gym" | "steps" | "sleep" | "calories";

export type HabitPeriod = "daily" | "weekly";
export type HabitCompletionRule = "count" | "value_gte" | "within_tolerance";

export interface NumericBound {
  min: number;
  max: number;
  default: number;
}

export interface HabitCategoryMeta {
  category: HabitCategory;
  period: HabitPeriod;
  completionRule: HabitCompletionRule;
  unit: string;
  /** Target bounds + default (litres / sessions-per-week / steps / hours / kcal). */
  target: NumericBound;
  /**
   * Days-per-week ("hit it on N of 7") bound + default for DAILY habits.
   * `null` for Gym, whose sessions/week IS the target (no separate frequency).
   */
  daysPerWeek: { min: number; max: number; default: number } | null;
  /** Calorie leniency band (± %); `null` for every other category. */
  tolerancePct: NumericBound | null;
  /**
   * When true the target is OWNED ELSEWHERE and read-only here — a
   * client-supplied target is ignored and the canonical value substituted.
   * Only Calories (owned by Nutrition Fuel-Targets, M9; AC 2.4 / locked
   * decision 9). The default stands in until M9 wires the real value through.
   */
  targetReadOnly?: boolean;
}

/** The five fixed habit categories. Order matches the prototype's HABIT_ORDER. */
export const HABIT_CATEGORIES: Record<HabitCategory, HabitCategoryMeta> = {
  water: {
    category: "water",
    period: "daily",
    completionRule: "value_gte",
    unit: "l",
    target: { min: 0.1, max: 20, default: 2 },
    daysPerWeek: { min: 1, max: 7, default: 5 },
    tolerancePct: null,
  },
  gym: {
    category: "gym",
    period: "weekly",
    completionRule: "count",
    unit: "x",
    target: { min: 1, max: 14, default: 3 },
    daysPerWeek: null,
    tolerancePct: null,
  },
  steps: {
    category: "steps",
    period: "daily",
    completionRule: "value_gte",
    unit: "steps",
    target: { min: 1000, max: 30000, default: 8000 },
    daysPerWeek: { min: 1, max: 7, default: 6 },
    tolerancePct: null,
  },
  sleep: {
    category: "sleep",
    period: "daily",
    completionRule: "value_gte",
    unit: "h",
    target: { min: 1, max: 24, default: 8 },
    daysPerWeek: { min: 1, max: 7, default: 6 },
    tolerancePct: null,
  },
  calories: {
    category: "calories",
    period: "daily",
    completionRule: "within_tolerance",
    unit: "kcal",
    target: { min: 500, max: 20000, default: 2000 },
    daysPerWeek: { min: 1, max: 7, default: 6 },
    tolerancePct: { min: 0, max: 50, default: 10 },
    targetReadOnly: true,
  },
};

/** Ordered category slugs (prototype HABIT_ORDER). */
export const HABIT_CATEGORY_ORDER: readonly HabitCategory[] = [
  "water",
  "gym",
  "steps",
  "sleep",
  "calories",
];

/** Narrow an arbitrary string to a known habit category. */
export function isHabitCategory(value: string): value is HabitCategory {
  return Object.prototype.hasOwnProperty.call(HABIT_CATEGORIES, value);
}

export interface HabitConfigInput {
  targetValue: number;
  /** Required for daily habits; ignored (forced null) for Gym. */
  daysPerWeek?: number;
  /** Calories only; ignored elsewhere. */
  tolerancePct?: number;
}

/** A validated, server-normalised config ready to persist. */
export interface ValidatedHabitConfig {
  category: HabitCategory;
  period: HabitPeriod;
  completionRule: HabitCompletionRule;
  unit: string;
  targetValue: number;
  daysPerWeek: number | null;
  tolerancePct: number | null;
}

export type ValidationResult =
  | { ok: true; config: ValidatedHabitConfig }
  | { ok: false; error: string };

function inRange(v: number, b: { min: number; max: number }): boolean {
  return Number.isFinite(v) && v >= b.min && v <= b.max;
}

/**
 * Whether a completion `value` is REQUIRED for a category — true for the
 * value-carrying rules (`value_gte`, `within_tolerance`), false for `count`
 * (Gym; satisfaction is derived from logged workout_sessions, not a value).
 */
export function completionValueRequired(category: HabitCategory): boolean {
  const rule = HABIT_CATEGORIES[category].completionRule;
  return rule === "value_gte" || rule === "within_tolerance";
}

/**
 * Accepted range for a logged completion `value` per category (litres / steps /
 * hours / kcal). Bounds mirror the target bounds' scale (design.md § 1.1) with
 * the floor dropped to 0 (a partial day still logs a real value below target)
 * and a headroom cap so an obviously-bogus value (negative, or absurdly large —
 * a fat-fingered "80000 l") is rejected before persistence (anti-gaming
 * AC 8.5). `count` (Gym) carries no value, so it has no band.
 */
const COMPLETION_VALUE_BOUNDS: Partial<Record<HabitCategory, NumericBound>> = {
  water: { min: 0, max: 40, default: 0 }, // litres/day
  steps: { min: 0, max: 200000, default: 0 }, // steps/day
  sleep: { min: 0, max: 24, default: 0 }, // hours/night
  calories: { min: 0, max: 20000, default: 0 }, // kcal/day
};

export type CompletionValueResult =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

/**
 * Validate the `value` on a habit completion for `category` (T-18.4.1 /
 * design.md § 3.3). For a value-carrying rule the value is REQUIRED and must
 * fall inside the per-category band; for `count` (Gym) any supplied value is
 * ignored (returned as null). Pure — no DB, no clock.
 */
export function validateCompletionValue(
  category: HabitCategory,
  value: number | undefined,
): CompletionValueResult {
  if (!completionValueRequired(category)) {
    // Gym / count: no value semantics — drop whatever was sent.
    return { ok: true, value: null };
  }
  if (value === undefined || value === null) {
    return { ok: false, error: `${category} completion requires a value` };
  }
  const bounds = COMPLETION_VALUE_BOUNDS[category];
  if (bounds && !inRange(value, bounds)) {
    return {
      ok: false,
      error: `value must be between ${bounds.min} and ${bounds.max} for ${category}`,
    };
  }
  return { ok: true, value };
}

/**
 * Validate + normalise a client config payload for `category`. Enforces the
 * per-category bounds (anti-gaming AC 8.5) and fills the server-authoritative
 * `period` / `completion_rule` / `unit`. `daysPerWeek` must be a 1–7 integer
 * for daily habits and is forced to `null` for Gym; `tolerancePct` is honoured
 * only for Calories (defaulting when omitted) and forced `null` otherwise.
 */
export function validateHabitConfigInput(
  category: HabitCategory,
  input: HabitConfigInput,
): ValidationResult {
  const meta = HABIT_CATEGORIES[category];

  // A read-only target (Calories) is owned by Nutrition — ignore whatever the
  // client sent and substitute the canonical value (the default until M9 wires
  // the Fuel-Targets value through), so habit-setup can't write it (AC 2.4).
  const targetValue = meta.targetReadOnly
    ? meta.target.default
    : input.targetValue;

  if (!inRange(targetValue, meta.target)) {
    return {
      ok: false,
      error: `targetValue must be between ${meta.target.min} and ${meta.target.max}`,
    };
  }

  let daysPerWeek: number | null = null;
  if (meta.daysPerWeek) {
    const dpw = input.daysPerWeek ?? meta.daysPerWeek.default;
    if (!Number.isInteger(dpw) || !inRange(dpw, meta.daysPerWeek)) {
      return {
        ok: false,
        error: `daysPerWeek must be an integer between ${meta.daysPerWeek.min} and ${meta.daysPerWeek.max}`,
      };
    }
    daysPerWeek = dpw;
  }

  let tolerancePct: number | null = null;
  if (meta.tolerancePct) {
    const tol = input.tolerancePct ?? meta.tolerancePct.default;
    if (!inRange(tol, meta.tolerancePct)) {
      return {
        ok: false,
        error: `tolerancePct must be between ${meta.tolerancePct.min} and ${meta.tolerancePct.max}`,
      };
    }
    tolerancePct = tol;
  }

  return {
    ok: true,
    config: {
      category,
      period: meta.period,
      completionRule: meta.completionRule,
      unit: meta.unit,
      targetValue,
      daysPerWeek,
      tolerancePct,
    },
  };
}
