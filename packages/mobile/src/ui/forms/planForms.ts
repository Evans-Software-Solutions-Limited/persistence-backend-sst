import { Type } from "@sinclair/typebox";
import { schemaAccepts, schemaResolver, trimmed } from "@/shared/form";
import { PLAN_NAME_MAX } from "@/domain/models/nutritionPlans";

/**
 * Meal plan forms on react-hook-form (PER-147): New plan (N5), the plan
 * builder's Save (N29/N32/N34), an item's amount (add or edit) and renaming
 * a plan. Limits match the API's plan routes (name 1–200 once trimmed).
 * Rules that depend on the screen (meals ticked, the day or plan picked, a
 * full meal) come in through react-hook-form's `context`.
 */

// ─── New plan (N5) ───────────────────────────────────────────────────────────

export interface NewPlanValues {
  name: string;
}

export interface NewPlanContext {
  from: string;
  /** Meals ticked for the plan. */
  meals: number;
  /** From a day: that day is on the phone and fits in a plan. */
  dayReady: boolean;
  /** From a plan: one is picked. */
  planReady: boolean;
}

export const newPlanSchema = Type.Object({
  from: Type.String(),
  name: Type.String({ maxLength: PLAN_NAME_MAX }),
  meals: Type.Integer({ minimum: 0 }),
  dayReady: Type.Boolean(),
  planReady: Type.Boolean(),
});

type NewPlanPrepared = NewPlanContext & { name: string };

export function prepareNewPlan(
  v: NewPlanValues,
  context?: unknown,
): NewPlanPrepared {
  return { ...(context as NewPlanContext), name: v.name.trim() };
}

/** Mealprint needs nothing here; every other start needs a name and meals. */
export function newPlanGaps(p: NewPlanPrepared): Record<string, string> {
  if (p.from === "mealprint") return {};
  const out: Record<string, string> = {};
  if (!p.name) out.name = "Name the plan.";
  if (p.meals < 1) out.meals = "Tick at least one meal.";
  if (p.from === "day" && !p.dayReady) out.dayReady = "Pick a day.";
  if (p.from === "plan" && !p.planReady) out.planReady = "Pick a plan.";
  return out;
}

export const newPlanResolver = schemaResolver<NewPlanValues>(newPlanSchema, {
  prepare: prepareNewPlan,
  refine: newPlanGaps,
});

export function newPlanAccepts(v: NewPlanValues, c: NewPlanContext): boolean {
  return schemaAccepts(newPlanSchema, prepareNewPlan(v, c), newPlanGaps);
}

// ─── Builder Save ────────────────────────────────────────────────────────────

export interface PlanSaveContext {
  mode: "new" | "edit";
  /** Foods across the plan's meals. */
  items: number;
}

export const planSaveSchema = Type.Object({
  mode: Type.String(),
  items: Type.Integer({ minimum: 0 }),
});

/** A new plan needs something in it; an edit can save as it is. */
export function planSaveGaps(c: PlanSaveContext): Record<string, string> {
  return c.mode === "new" && c.items < 1
    ? { items: "Add something to save" }
    : {};
}

export const planSaveResolver = schemaResolver<Record<string, never>>(
  planSaveSchema,
  { prepare: (_v, context) => context, refine: planSaveGaps },
);

export function planSaveAccepts(c: PlanSaveContext): boolean {
  return schemaAccepts(planSaveSchema, c, planSaveGaps);
}

// ─── An item's amount (add or edit) ──────────────────────────────────────────

export interface AmountValues {
  amount: string;
}

export interface AmountContext {
  /** The meal it would go into is full. */
  blocked: boolean;
}

export const amountSchema = Type.Object({
  amount: Type.Number({
    exclusiveMinimum: 0,
    errorMessage: "Enter an amount.",
  }),
  blocked: Type.Literal(false),
});

/** "1,5" or "1.5" → 1.5; blank or not a number → null (refused). */
export function prepareAmount(v: AmountValues, context?: unknown) {
  const t = v.amount.trim().replace(",", ".");
  const n = t === "" ? NaN : Number(t);
  return {
    amount: Number.isFinite(n) ? n : null,
    blocked: (context as AmountContext | undefined)?.blocked ?? false,
  };
}

export const amountResolver = schemaResolver<AmountValues>(amountSchema, {
  prepare: prepareAmount,
});

export function amountAccepts(v: AmountValues, c: AmountContext): boolean {
  return schemaAccepts(amountSchema, prepareAmount(v, c));
}

// ─── Rename a plan ───────────────────────────────────────────────────────────

export interface PlanNameValues {
  name: string;
}

export const planNameSchema = Type.Object({
  name: Type.String({
    minLength: 1,
    maxLength: PLAN_NAME_MAX,
    errorMessage: "Name the plan.",
  }),
});

export const planNameResolver = schemaResolver<PlanNameValues>(planNameSchema, {
  prepare: trimmed,
});

export function planNameAccepts(v: PlanNameValues): boolean {
  return schemaAccepts(planNameSchema, trimmed(v));
}
