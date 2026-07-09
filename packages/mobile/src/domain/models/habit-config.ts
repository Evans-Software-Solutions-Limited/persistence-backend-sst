/**
 * Habit-config domain model (18-habit-setup, Phase 18.7 — T-18.7.1).
 *
 * Mirrors the backend `GET /users/me/habits/config` entry (design.md § 3.1) as
 * the client-side offline shape, plus the FIXED five-category metadata the
 * setup screen renders (bounds/defaults/tone/label/sub/period), ported 1:1 from
 * the prototype `~/Downloads/habit_design/habit-setup.jsx` (`HABIT_CATS`,
 * `HABIT_ORDER`, `defaultHabitState`).
 *
 * Category `period` / `completionRule` / bounds are server-authoritative; the
 * client mirrors them so `deriveCollectionStreak` (T-18.7.4) can score offline
 * identically to the backend `collection.ts`.
 */

import type { HabitTileTone } from "@/domain/models/habit-completion";
import type { HabitConfigEntry } from "@/domain/ports/api.port";

/** The five fixed habit categories (prototype HABIT_ORDER). */
export type HabitCategory = "water" | "gym" | "steps" | "sleep" | "calories";

export type HabitPeriod = "daily" | "weekly";
export type HabitCompletionRule = "count" | "value_gte" | "within_tolerance";

/** Ordered category slugs — the render order of the setup screen + the grid. */
export const HABIT_ORDER: readonly HabitCategory[] = [
  "water",
  "gym",
  "steps",
  "sleep",
  "calories",
];

/**
 * A queued config edit, promoted at the next Monday boundary (design.md § 4.4).
 * The wire shape from the self PUT/GET is `{ from, config }`; the mobile side
 * flattens it to the fields the UI needs to render the "Starts Monday" tag.
 */
export type PendingHabitConfig = {
  /** The Monday (YYYY-MM-DD) the queued edit promotes. */
  from: string;
  targetValue?: number;
  daysPerWeek?: number | null;
  tolerancePct?: number | null;
  /** A queued disable (`{ enabled: false }`). */
  enabled?: boolean;
};

/**
 * A single habit category's live config + coach-lock state, as the setup screen
 * and the offline streak both consume it. Enabled=false collapses the card to
 * its header (prototype). `goalId` may be a `local-…` id for a habit configured
 * offline before the queue drains (STORY-009 AC 9.3).
 */
export type HabitConfig = {
  category: HabitCategory;
  enabled: boolean;
  goalId: string | null;
  /** A coach assigned this habit (attribution kept even after transfer). */
  assignedByCoach: boolean;
  /**
   * The assigning coach's display name for the attribution badge (Phase 11).
   * Null for self-set habits or when the coach profile has no name.
   */
  assignedByName: string | null;
  /** Assigned + relationship still active → controls disabled (design.md § 5). */
  locked: boolean;
  targetValue: number;
  unit: string;
  period: HabitPeriod;
  completionRule: HabitCompletionRule;
  daysPerWeek: number | null;
  tolerancePct: number | null;
  /**
   * The Monday (YYYY-MM-DD) this habit's live config started counting toward the
   * collection streak. A fresh enable sets it to next Monday, so the habit is
   * loggable now but not yet part of the requirement (design.md § 4.4). Optional
   * because the wire GET doesn't currently echo it — falls back to a safe
   * "already effective" when absent so a synced habit still scores.
   */
  effectiveFrom?: string;
  /** A queued edit awaiting the next week boundary, or null. */
  pending: PendingHabitConfig | null;
};

/** Per-category presentation + bound metadata (prototype HABIT_CATS). */
export type HabitCategoryMeta = {
  category: HabitCategory;
  name: string;
  sub: string;
  tone: HabitTileTone;
  period: HabitPeriod;
  completionRule: HabitCompletionRule;
  unit: string;
  target: {
    label: string;
    min: number;
    max: number;
    step: number;
    default: number;
    /** Owned by Nutrition (Calories) — rendered as a read-only deep-link. */
    readOnly?: boolean;
  };
  /** Days/week control ("hit it on N of 7"); null for Gym. */
  freq: { label: string; default: number } | null;
  /** Calorie leniency band (± %); null otherwise. */
  leniency: {
    label: string;
    min: number;
    max: number;
    step: number;
    default: number;
  } | null;
};

/**
 * The five fixed categories, ported verbatim from the prototype's `HABIT_CATS`
 * + `defaultHabitState` + `README § Bounds & Defaults`. Tones follow the
 * prototype (water=primary, gym=ember, steps=trainer, sleep=success,
 * calories=gold) — NOT the placeholder tones in the pre-18.7 grid.
 */
export const HABIT_CATEGORY_META: Record<HabitCategory, HabitCategoryMeta> = {
  water: {
    category: "water",
    name: "Water",
    sub: "Stay hydrated",
    tone: "primary",
    period: "daily",
    completionRule: "value_gte",
    unit: "l",
    target: { label: "Litres / day", min: 0.1, max: 20, step: 0.1, default: 2 },
    freq: { label: "Days / week to hit it", default: 5 },
    leniency: null,
  },
  gym: {
    category: "gym",
    name: "Gym",
    sub: "Train consistently",
    tone: "ember",
    period: "weekly",
    completionRule: "count",
    unit: "×",
    target: { label: "Sessions / week", min: 1, max: 14, step: 1, default: 3 },
    freq: null,
    leniency: null,
  },
  steps: {
    category: "steps",
    name: "Steps",
    sub: "Keep moving",
    tone: "trainer",
    period: "daily",
    completionRule: "value_gte",
    unit: "steps",
    target: {
      label: "Steps / day",
      min: 1000,
      max: 30000,
      step: 500,
      default: 8000,
    },
    freq: { label: "Days / week to hit it", default: 6 },
    leniency: null,
  },
  sleep: {
    category: "sleep",
    name: "Sleep",
    sub: "Recover well",
    tone: "success",
    period: "daily",
    completionRule: "value_gte",
    unit: "h",
    target: { label: "Hours / night", min: 1, max: 24, step: 0.5, default: 8 },
    freq: { label: "Nights / week to hit it", default: 6 },
    leniency: null,
  },
  calories: {
    category: "calories",
    name: "Calories",
    sub: "Fuel to your goal",
    tone: "gold",
    period: "daily",
    completionRule: "within_tolerance",
    unit: "kcal",
    target: {
      label: "Daily goal",
      min: 500,
      max: 20000,
      step: 50,
      default: 2000,
      readOnly: true,
    },
    freq: { label: "Days / week to hit it", default: 6 },
    leniency: { label: "Leniency", min: 0, max: 50, step: 5, default: 10 },
  },
};

/** Narrow an arbitrary string to a known habit category. */
export function isHabitCategory(value: string): value is HabitCategory {
  return Object.prototype.hasOwnProperty.call(HABIT_CATEGORY_META, value);
}

/**
 * Format a target value per the prototype's `fmt` for each category:
 *  - water → 1 dp; steps/calories → locale-grouped; sleep → 0.5 (drop trailing
 *    .0); gym → integer.
 */
export function formatTarget(category: HabitCategory, value: number): string {
  switch (category) {
    case "water":
      return value.toFixed(1);
    case "steps":
    case "calories":
      return value.toLocaleString();
    case "sleep":
      return value % 1 ? value.toFixed(1) : String(value);
    case "gym":
      return String(value);
  }
}

/**
 * Map the backend wire entry (`HabitConfigEntry`, from GET .../habits/config)
 * to the domain `HabitConfig`. Flattens the `{ from, config }` pending envelope
 * to `PendingHabitConfig` so the UI can read the queued fields + "Starts Monday"
 * date directly. Skips unknown categories (returns null) so a future backend
 * category can't crash the mobile render.
 */
export function habitConfigFromEntry(
  entry: HabitConfigEntry,
): HabitConfig | null {
  if (!isHabitCategory(entry.category)) return null;
  const meta = HABIT_CATEGORY_META[entry.category];
  let pending: PendingHabitConfig | null = null;
  if (entry.pending) {
    const c = entry.pending.config ?? {};
    pending = {
      from: entry.pending.from,
      targetValue:
        typeof c.targetValue === "number" ? c.targetValue : undefined,
      daysPerWeek:
        c.daysPerWeek === null || typeof c.daysPerWeek === "number"
          ? (c.daysPerWeek as number | null)
          : undefined,
      tolerancePct:
        c.tolerancePct === null || typeof c.tolerancePct === "number"
          ? (c.tolerancePct as number | null)
          : undefined,
      enabled: typeof c.enabled === "boolean" ? c.enabled : undefined,
    };
  }
  return {
    category: entry.category,
    enabled: entry.enabled,
    goalId: entry.goalId,
    assignedByCoach: entry.assignedByCoach,
    assignedByName: entry.assignedByName ?? null,
    locked: entry.locked,
    targetValue: entry.targetValue,
    unit: entry.unit || meta.unit,
    period: (entry.period as HabitPeriod) ?? meta.period,
    completionRule:
      (entry.completionRule as HabitCompletionRule) ?? meta.completionRule,
    daysPerWeek: entry.daysPerWeek,
    tolerancePct: entry.tolerancePct,
    pending,
  };
}

/**
 * Merge a wire config set with the FIXED five categories in `HABIT_ORDER`, so
 * the setup screen always renders all five (disabled default when the server
 * has no row). Server rows win; missing categories fall back to
 * `defaultHabitConfig`.
 */
export function mergeHabitConfigs(
  entries: readonly HabitConfig[],
): HabitConfig[] {
  const byCategory = new Map(entries.map((c) => [c.category, c]));
  return HABIT_ORDER.map(
    (category) => byCategory.get(category) ?? defaultHabitConfig(category),
  );
}

/**
 * A default (disabled) config entry for a category — used when the server /
 * cache has no row yet, so the setup screen renders the toggle-off card with
 * the prototype's default target/days/leniency.
 */
export function defaultHabitConfig(category: HabitCategory): HabitConfig {
  const meta = HABIT_CATEGORY_META[category];
  return {
    category,
    enabled: false,
    goalId: null,
    assignedByCoach: false,
    assignedByName: null,
    locked: false,
    targetValue: meta.target.default,
    unit:
      meta.completionRule === "count"
        ? "x"
        : category === "calories"
          ? "kcal"
          : meta.unit,
    period: meta.period,
    completionRule: meta.completionRule,
    daysPerWeek: meta.freq?.default ?? null,
    tolerancePct: meta.leniency?.default ?? null,
    pending: null,
  };
}
