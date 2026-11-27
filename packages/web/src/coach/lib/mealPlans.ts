import type {
  ClientPlanAssignment,
  ClientTarget,
  CoachRecipe,
  CoachSavedMeal,
  FoodResult,
  LibraryPlan,
  LogSlot,
  Macros,
  PlanInput,
  PlanItem,
} from "../api/types";

/**
 * Coach meal plans (PER-135, canvas C1 / C3.2). Pure helpers, so the screens'
 * numbers and copy are tested without a browser.
 *
 * Product rules (Brad, 17 Nov): a plan is a list of meals for ideas. It has no
 * target of its own and no dates or weekdays. The wheel and the Target ·
 * Planned · To plan strip compare its totals with the client's own target.
 */

/** The server's caps (`MAX_PLAN_MEALS`, `MAX_ITEMS_PER_MEAL`, `MAX_ITEM_SERVINGS`). */
export const PLAN_MEALS_MAX = 20;
export const PLAN_ITEMS_PER_MEAL_MAX = 50;
export const PORTION_STEP = 0.25;
export const PORTION_MIN = 0.25;
export const PORTION_MAX = 100;
/** Within this many kcal of the target counts as on target (C3 strip). */
export const ON_TARGET_KCAL = 100;

export const EDITED_ELSEWHERE =
  "This plan was changed somewhere else. You're seeing the latest version.";

const ZERO: Macros = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };

/** "2,476" */
export function kcalText(n: number): string {
  return Math.round(n).toLocaleString("en-GB");
}

/** "186P 294C 63F" */
export function macroLine(m: Macros): string {
  return `${Math.round(m.proteinG)}P ${Math.round(m.carbsG)}C ${Math.round(m.fatG)}F`;
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** C2 library row: "5 meals · 186P 294C 63F". */
export function planSubline(plan: Pick<LibraryPlan, "meals" | "totals">) {
  return `${plural(plan.meals.length, "meal", "meals")} · ${macroLine(plan.totals)}`;
}

/** C3.2 row: "5 meals · 2,476 kcal · 186P 294C 63F". */
export function planDetailLine(plan: Pick<LibraryPlan, "meals" | "totals">) {
  return `${plural(plan.meals.length, "meal", "meals")} · ${kcalText(plan.totals.kcal)} kcal · ${macroLine(plan.totals)}`;
}

/** "today", "yesterday", "3 days ago", or "21 Oct" after two weeks. */
export function daysAgo(iso: string, now: number = Date.now()): string {
  const then = new Date(iso);
  const start = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(new Date(now)) - start(then)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return then.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** "Sent 21 Oct" or "Sent 2 days ago" (the editor's subtitle and the send line). */
export function sentWords(iso: string, now: number = Date.now()): string {
  const ago = daysAgo(iso, now);
  return `Sent ${ago}`;
}

/**
 * C3.2 / C1b status pill: what the client has done with the plan.
 * `tone` picks the pill colour (ok = green, warn = amber, idle = grey).
 */
export function assignmentStatus(
  a: Pick<ClientPlanAssignment, "status" | "sentAt" | "usedDays">,
  clientFirst: string,
  now: number = Date.now(),
): { text: string; tone: "ok" | "warn" | "idle" } {
  if (a.status === "added") {
    return {
      text:
        a.usedDays > 0
          ? `In ${clientFirst}’s plans · used ${plural(a.usedDays, "day", "days")}`
          : `In ${clientFirst}’s plans`,
      tone: "ok",
    };
  }
  if (a.status === "dismissed") {
    return { text: `${clientFirst} chose Not now`, tone: "idle" };
  }
  // The API has no "opened" signal: the server sets seenRevision to the
  // plan's revision when it's sent, so only the send time is shown.
  return { text: sentWords(a.sentAt, now), tone: "warn" };
}

/** "Plan meals logged this week: 19" across the client's plans. */
export function loggedThisWeek(assignments: ClientPlanAssignment[]): number {
  return assignments.reduce((n, a) => n + a.loggedThisWeek, 0);
}

/** C3.2 calorie adherence (PER-114): "5 of 7 days on target · 1 not logged". */
export function calorieLine(c: {
  daysOnTarget: number;
  daysCounted: number;
  daysNotLogged: number;
}): string | null {
  if (c.daysCounted === 0) return null;
  const base = `${c.daysOnTarget} of ${plural(c.daysCounted, "day", "days")} on target`;
  return c.daysNotLogged > 0 ? `${base} · ${c.daysNotLogged} not logged` : base;
}

// ─── The editor's form model ──────────────────────────────────────────────────

export type ItemSource =
  | { kind: "food"; foodId: string }
  | { kind: "recipe"; recipeId: string }
  | { kind: "meal"; mealId: string }
  | { kind: "custom" };

export interface EditorItem {
  /** Stable React key (the server id, or a local one). */
  key: string;
  source: ItemSource;
  name: string;
  /** "80 g", "1 portion": one serving. */
  serving: string;
  perServing: Macros;
  servings: number;
}

export interface EditorMeal {
  key: string;
  name: string;
  logSlot: LogSlot;
  items: EditorItem[];
}

export interface PlanEditorValues {
  name: string;
  meals: EditorMeal[];
}

let keySeq = 0;
export function newKey(prefix = "local"): string {
  keySeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${keySeq}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function perServingOf(item: PlanItem): Macros {
  const fromSource =
    item.food?.perServing ??
    item.recipe?.perServing ??
    item.meal?.perServing ??
    (item.custom
      ? {
          kcal: item.custom.kcal,
          proteinG: item.custom.proteinG,
          carbsG: item.custom.carbsG,
          fatG: item.custom.fatG,
        }
      : null);
  if (fromSource) return fromSource;
  // A deleted source: the item's own macros divided back to one serving.
  const s = item.servings > 0 ? item.servings : 1;
  return {
    kcal: round2(item.kcal / s),
    proteinG: round2(item.proteinG / s),
    carbsG: round2(item.carbsG / s),
    fatG: round2(item.fatG / s),
  };
}

function servingOf(item: PlanItem): string {
  if (item.food) return `${item.food.servingSize} ${item.food.servingUnit}`;
  if (item.recipe) return "1 portion";
  return "1 serving";
}

function sourceOf(item: PlanItem): ItemSource {
  if (item.kind === "food" && item.foodId)
    return { kind: "food", foodId: item.foodId };
  if (item.kind === "recipe" && item.recipeId)
    return { kind: "recipe", recipeId: item.recipeId };
  if (item.kind === "meal" && item.mealId)
    return { kind: "meal", mealId: item.mealId };
  return { kind: "custom" };
}

/** A saved plan → the editor's values. */
export function editorValues(plan: LibraryPlan): PlanEditorValues {
  return {
    name: plan.name,
    meals: [...plan.meals]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((m) => ({
        key: m.id,
        name: m.name,
        logSlot: m.logSlot,
        items: [...m.items]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((i) => ({
            key: i.id,
            source: sourceOf(i),
            name: i.name,
            serving: servingOf(i),
            perServing: perServingOf(i),
            servings: i.servings,
          })),
      })),
  };
}

/** The four old slots, cycled for new meals so 1.2.0 phones still group them. */
const SLOTS: LogSlot[] = ["breakfast", "lunch", "dinner", "snack"];

export function newMeal(existing: EditorMeal[]): EditorMeal {
  return {
    key: newKey("meal"),
    name: `Meal ${existing.length + 1}`,
    logSlot: SLOTS[existing.length % SLOTS.length]!,
    items: [],
  };
}

/** A new plan starts with one empty meal. */
export function emptyPlanValues(): PlanEditorValues {
  return { name: "", meals: [newMeal([])] };
}

export function itemMacros(item: EditorItem): Macros {
  return {
    kcal: item.perServing.kcal * item.servings,
    proteinG: item.perServing.proteinG * item.servings,
    carbsG: item.perServing.carbsG * item.servings,
    fatG: item.perServing.fatG * item.servings,
  };
}

function sum(list: Macros[]): Macros {
  return list.reduce(
    (t, m) => ({
      kcal: t.kcal + m.kcal,
      proteinG: t.proteinG + m.proteinG,
      carbsG: t.carbsG + m.carbsG,
      fatG: t.fatG + m.fatG,
    }),
    { ...ZERO },
  );
}

export function mealTotals(meal: EditorMeal): Macros {
  return sum(meal.items.map(itemMacros));
}

export function planTotals(values: PlanEditorValues): Macros {
  return sum(values.meals.map(mealTotals));
}

/** "×1.25" */
export function portionText(servings: number): string {
  return `×${servings}`;
}

/** "80 g × 1.25", or the serving alone at one portion. */
export function servingText(item: EditorItem): string {
  return item.servings === 1
    ? item.serving
    : `${item.serving} × ${item.servings}`;
}

export function stepPortion(servings: number, by: 1 | -1): number {
  if (by < 0 && servings <= PORTION_MIN) return servings;
  const next = Math.round((servings + by * PORTION_STEP) * 100) / 100;
  return Math.min(PORTION_MAX, Math.max(PORTION_MIN, next));
}

/** The editor's values → the API body (trimmed names, renumbered). */
export function toPlanInput(values: PlanEditorValues): PlanInput {
  return {
    name: values.name.trim(),
    meals: values.meals.map((m, mi) => ({
      name: m.name.trim(),
      logSlot: m.logSlot,
      sortOrder: mi,
      items: m.items.map((i, ii) => {
        const base = { servings: i.servings, sortOrder: ii };
        switch (i.source.kind) {
          case "food":
            return { ...base, foodId: i.source.foodId };
          case "recipe":
            return { ...base, recipeId: i.source.recipeId };
          case "meal":
            return { ...base, mealId: i.source.mealId };
          default:
            return {
              ...base,
              custom: { name: i.name, ...i.perServing },
            };
        }
      }),
    })),
  };
}

/** True when the editor holds what the saved plan already has. */
export function samePlan(a: PlanEditorValues, b: PlanEditorValues): boolean {
  return JSON.stringify(toPlanInput(a)) === JSON.stringify(toPlanInput(b));
}

// ─── C4 Add to a meal: picker rows → editor items ─────────────────────────────

export function foodItem(f: FoodResult): EditorItem {
  return {
    key: newKey("item"),
    source: { kind: "food", foodId: f.id },
    name: f.name,
    serving: `${f.servingSize} ${f.servingUnit}`,
    perServing: {
      kcal: f.kcal,
      proteinG: f.proteinG,
      carbsG: f.carbsG,
      fatG: f.fatG,
    },
    servings: 1,
  };
}

/** A recipe's macros for one portion (cards carry whole-recipe totals). */
export function recipePortion(r: CoachRecipe): Macros {
  const n = r.servings > 0 ? r.servings : 1;
  return {
    kcal: round2((r.totalKcal ?? 0) / n),
    proteinG: round2((r.totalProteinG ?? 0) / n),
    carbsG: round2((r.totalCarbsG ?? 0) / n),
    fatG: round2((r.totalFatG ?? 0) / n),
  };
}

export function recipeItem(r: CoachRecipe): EditorItem {
  return {
    key: newKey("item"),
    source: { kind: "recipe", recipeId: r.id },
    name: r.name,
    serving: "1 portion",
    perServing: recipePortion(r),
    servings: 1,
  };
}

export function savedMealItem(m: CoachSavedMeal): EditorItem {
  return {
    key: newKey("item"),
    source: { kind: "meal", mealId: m.id },
    name: m.name,
    serving: "1 serving",
    perServing: {
      kcal: m.totalKcal,
      proteinG: m.totalProteinG,
      carbsG: m.totalCarbsG,
      fatG: m.totalFatG,
    },
    servings: 1,
  };
}

/** C2 Recipes row: "Recipe · 4 portions" / "Imported from a link · 6 portions". */
export function recipeSubline(r: CoachRecipe): string {
  const kind = r.sourceUrl ? "Imported from a link" : "Recipe";
  return `${kind} · ${plural(r.servings, "portion", "portions")}`;
}

// ─── The wheel and the strip (C3, C3.2, C5) ───────────────────────────────────

export const MACRO_COLOURS = {
  protein: "#34d399",
  carbs: "#22d3ee",
  fat: "#fb923c",
} as const;

export interface RingSegment {
  colour: string;
  /** Arc length and offset on a circle of circumference `RING_C`. */
  length: number;
  offset: number;
}

export const RING_R = 40;
export const RING_C = 2 * Math.PI * RING_R;

export interface PlanVsTarget {
  segments: RingSegment[];
  /** Centre number and its label ("2,476" / "of 2,500"; "24" / "To plan"). */
  centre: string;
  centreLabel: string;
  centreTone: "ok" | "under" | "over" | "plain";
  /** The strip's third cell: "On target" / "24" / "+60". */
  left: string;
  leftLabel: string;
  ringLabel: string;
  macros: {
    key: "protein" | "carbs" | "fat";
    label: string;
    planned: number;
    target: number | null;
    /** Bar width, 0–100. */
    pct: number;
  }[];
}

/**
 * The wheel (segments by share of calories, filled up to planned / target)
 * and the strip, as the C3 board draws them. With no target the wheel fills
 * completely and the centre shows what's planned.
 */
export function planVsTarget(
  planned: Macros,
  target: Pick<
    ClientTarget,
    "dailyKcal" | "proteinG" | "carbsG" | "fatG"
  > | null,
): PlanVsTarget {
  const kC = planned.carbsG * 4;
  const kF = planned.fatG * 9;
  const kP = planned.proteinG * 4;
  const ks = kC + kF + kP || 1;
  const frac =
    target && target.dailyKcal > 0
      ? Math.min(1, planned.kcal / target.dailyKcal)
      : kC + kF + kP > 0
        ? 1
        : 0;
  let start = 0;
  const segments = (
    [
      [kC, MACRO_COLOURS.carbs],
      [kF, MACRO_COLOURS.fat],
      [kP, MACRO_COLOURS.protein],
    ] as const
  ).map(([k, colour]) => {
    const full = (k / ks) * frac * RING_C;
    const seg = { colour, length: Math.max(0, full - 1.5), offset: -start };
    start += full;
    return seg;
  });
  const pct = (n: number, of: number | null) =>
    of && of > 0 ? Math.min(100, Math.round((n / of) * 100)) : 0;
  const macros = [
    {
      key: "protein" as const,
      label: "Protein",
      planned: Math.round(planned.proteinG),
      target: target ? Math.round(target.proteinG) : null,
      pct: pct(planned.proteinG, target?.proteinG ?? null),
    },
    {
      key: "carbs" as const,
      label: "Carbs",
      planned: Math.round(planned.carbsG),
      target: target ? Math.round(target.carbsG) : null,
      pct: pct(planned.carbsG, target?.carbsG ?? null),
    },
    {
      key: "fat" as const,
      label: "Fat",
      planned: Math.round(planned.fatG),
      target: target ? Math.round(target.fatG) : null,
      pct: pct(planned.fatG, target?.fatG ?? null),
    },
  ];
  const share = (k: number) => Math.round((k / ks) * 100);
  const shares = `Carbs ${share(kC)} percent, fat ${share(kF)} percent, protein ${share(kP)} percent of calories.`;
  if (!target) {
    return {
      segments,
      centre: kcalText(planned.kcal),
      centreLabel: "Planned",
      centreTone: "plain",
      left: "—",
      leftLabel: "No target",
      ringLabel: `${kcalText(planned.kcal)} kcal planned. ${shares}`,
      macros,
    };
  }
  const left = target.dailyKcal - planned.kcal;
  const ok = Math.abs(left) <= ON_TARGET_KCAL;
  return {
    segments,
    centre: ok
      ? kcalText(planned.kcal)
      : left > 0
        ? kcalText(left)
        : `+${kcalText(-left)}`,
    centreLabel: ok
      ? `of ${kcalText(target.dailyKcal)}`
      : left > 0
        ? "To plan"
        : "Over",
    centreTone: ok ? "ok" : left > 0 ? "under" : "over",
    left: ok ? "On target" : left > 0 ? kcalText(left) : `+${kcalText(-left)}`,
    leftLabel: ok ? `Within ${ON_TARGET_KCAL}` : left > 0 ? "To plan" : "Over",
    ringLabel: `${kcalText(planned.kcal)} of ${kcalText(target.dailyKcal)} kcal planned. ${shares}`,
    macros,
  };
}

/** Who set the target: this coach, the client, or another of their coaches. */
export function targetSetBy(
  setByUserId: string | null,
  coachId: string | null,
  clientId: string,
  clientFirst: string,
): string {
  if (setByUserId && setByUserId === coachId) return "Set by you";
  if (!setByUserId || setByUserId === clientId) {
    return `${clientFirst}’s own target`;
  }
  return "Set by another coach";
}

/** C4 row keys are unique across the picker's tabs. */
export const rowKey = (tab: string, id: string) => `${tab}:${id}`;
