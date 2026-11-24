/**
 * List meal plans (PER-133, Design D) — pure rules for the Plan tab, the
 * builder (N5), adding a plan to today and the shopping list (N23).
 *
 * Everything here is deterministic and side-effect free, so the commands,
 * hooks and presenters share one calculation.
 */
import type {
  Food,
  FuelToday,
  LogEntryInput,
  Meal,
  MealSlot,
  NutritionEntry,
  NutritionTarget,
  Recipe,
} from "@/domain/models/nutrition";
import type {
  NutritionPlan,
  NutritionPlansCache,
  NutritionPlansResponse,
  PlanFromCoach,
  PlanInput,
  PlanItem,
  PlanItemInput,
  PlanMacros,
  PlanMeal,
  PlansShoppingList,
} from "@/domain/models/nutritionPlans";
import {
  PLAN_ITEM_SERVINGS_MAX,
  PLAN_MEAL_NAME_MAX,
  PLAN_NAME_MAX,
} from "@/domain/models/nutritionPlans";
import type { UserMeal } from "@/domain/models/userMeals";
import {
  activeUserMeals,
  defaultUserMealIdForSlot,
  isSyntheticUserMealId,
} from "./userMeals.service";
import { flattenFuelEntries } from "./nutrition.service";

// -- Macros -----------------------------------------------------------------

export function zeroMacros(): PlanMacros {
  return { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
}

export function sumMacros(list: readonly PlanMacros[]): PlanMacros {
  return list.reduce<PlanMacros>(
    (a, m) => ({
      kcal: a.kcal + m.kcal,
      proteinG: a.proteinG + m.proteinG,
      carbsG: a.carbsG + m.carbsG,
      fatG: a.fatG + m.fatG,
    }),
    zeroMacros(),
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function scale(per: PlanMacros, factor: number): PlanMacros {
  return {
    kcal: Math.round(per.kcal * factor),
    proteinG: round1(per.proteinG * factor),
    carbsG: round1(per.carbsG * factor),
    fatG: round1(per.fatG * factor),
  };
}

/** Meal and plan totals recomputed from the items (after a local edit). */
export function recomputePlan(plan: NutritionPlan): NutritionPlan {
  const meals = plan.meals.map((m) => ({
    ...m,
    totals: sumMacros(m.items),
  }));
  return { ...plan, meals, totals: sumMacros(meals.map((m) => m.totals)) };
}

// -- Target · Planned · To plan ----------------------------------------------

/** Within this many kcal of the target counts as on target (canvas N29). */
export const ON_TARGET_KCAL = 100;

export type TargetComparison = {
  /** Null when the person has no target yet. */
  targetKcal: number | null;
  plannedKcal: number;
  /** Target minus planned; negative when over. Null without a target. */
  toPlanKcal: number | null;
  state: "no_target" | "to_plan" | "on_target" | "over";
};

/**
 * The plan compared with the person's OWN target (coach-set or their own).
 * A plan has no target of its own (Design D).
 */
export function compareWithTarget(
  planned: PlanMacros,
  target: NutritionTarget | null,
): TargetComparison {
  const plannedKcal = Math.round(planned.kcal);
  if (!target || target.dailyKcal <= 0) {
    return {
      targetKcal: null,
      plannedKcal,
      toPlanKcal: null,
      state: "no_target",
    };
  }
  const toPlan = Math.round(target.dailyKcal - plannedKcal);
  const state =
    Math.abs(toPlan) <= ON_TARGET_KCAL
      ? "on_target"
      : toPlan > 0
        ? "to_plan"
        : "over";
  return {
    targetKcal: Math.round(target.dailyKcal),
    plannedKcal,
    toPlanKcal: toPlan,
    state,
  };
}

export type MacroVsTarget = {
  key: "protein" | "carbs" | "fat";
  label: "Protein" | "Carbs" | "Fat";
  letter: "P" | "C" | "F";
  plannedG: number;
  targetG: number | null;
};

/** P / C / F planned against the target, in the canvas order. */
export function macrosVsTarget(
  planned: PlanMacros,
  target: NutritionTarget | null,
): MacroVsTarget[] {
  return [
    {
      key: "protein",
      label: "Protein",
      letter: "P",
      plannedG: Math.round(planned.proteinG),
      targetG: target ? Math.round(target.proteinG) : null,
    },
    {
      key: "carbs",
      label: "Carbs",
      letter: "C",
      plannedG: Math.round(planned.carbsG),
      targetG: target ? Math.round(target.carbsG) : null,
    },
    {
      key: "fat",
      label: "Fat",
      letter: "F",
      plannedG: Math.round(planned.fatG),
      targetG: target ? Math.round(target.fatG) : null,
    },
  ];
}

/** The first meal with nothing in it: the gap row's meal (canvas N8). */
export function firstEmptyMeal(plan: NutritionPlan): PlanMeal | null {
  return plan.meals.find((m) => m.items.length === 0) ?? null;
}

// -- Reading the cache ---------------------------------------------------------

export type PlanRef =
  | { kind: "mine"; plan: NutritionPlan }
  | { kind: "coach"; plan: NutritionPlan; fromCoach: PlanFromCoach };

/** Coach plans the person can see (removed assignments never show). */
export function visibleCoachPlans(cache: NutritionPlansCache): PlanFromCoach[] {
  return cache.fromCoaches.filter(
    (c) => c.status !== "removed" && c.plan.archivedAt === null,
  );
}

export function visibleMyPlans(cache: NutritionPlansCache): NutritionPlan[] {
  return cache.mine.filter((p) => p.archivedAt === null);
}

/** A plan id after following a synced local id to its server id. */
export function resolvePlanId(
  cache: NutritionPlansCache | null,
  planId: string,
): string {
  return cache?.aliases?.[planId] ?? planId;
}

export function findPlan(
  cache: NutritionPlansCache,
  rawId: string,
): PlanRef | null {
  const planId = resolvePlanId(cache, rawId);
  const mine = visibleMyPlans(cache).find((p) => p.id === planId);
  if (mine) return { kind: "mine", plan: mine };
  const coach = visibleCoachPlans(cache).find((c) => c.plan.id === planId);
  return coach ? { kind: "coach", plan: coach.plan, fromCoach: coach } : null;
}

/**
 * The plan the Plan tab opens on when nothing is picked: the first coach plan
 * the person added, then their own newest plan, then any coach plan still
 * waiting for an answer.
 */
export function defaultPlanId(cache: NutritionPlansCache): string | null {
  const coach = visibleCoachPlans(cache);
  const added = coach.find((c) => c.status === "added");
  if (added) return added.plan.id;
  const mine = [...visibleMyPlans(cache)].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  )[0];
  if (mine) return mine.id;
  return coach.find((c) => c.status === "sent")?.plan.id ?? null;
}

/** Coach plans sent and not yet answered: they open the C6 sheet. */
export function newCoachPlans(cache: NutritionPlansCache): PlanFromCoach[] {
  return visibleCoachPlans(cache).filter((c) => c.status === "sent");
}

// -- Merging reads -------------------------------------------------------------

/**
 * Apply a `GET /nutrition/meal-plans` answer. A full read (no `since`)
 * replaces the cache; a delta read upserts what changed and drops
 * `deletedIds`. Conflict flags survive.
 */
export function mergePlansResponse(
  cache: NutritionPlansCache | null,
  response: NutritionPlansResponse,
  isDelta: boolean,
): NutritionPlansCache {
  const conflictPlanIds = cache?.conflictPlanIds ?? [];
  const aliases = cache?.aliases ? { aliases: cache.aliases } : {};
  if (!isDelta || !cache) {
    return {
      mine: response.mine,
      fromCoaches: response.fromCoaches,
      asOf: response.asOf,
      conflictPlanIds,
      ...aliases,
    };
  }
  const gone = new Set(response.deletedIds);
  const mineById = new Map(response.mine.map((p) => [p.id, p]));
  const coachById = new Map(response.fromCoaches.map((c) => [c.plan.id, c]));
  const mine = [
    ...cache.mine
      .filter((p) => !gone.has(p.id) && !mineById.has(p.id))
      .concat(response.mine),
  ];
  const fromCoaches = cache.fromCoaches
    .filter((c) => !gone.has(c.plan.id) && !coachById.has(c.plan.id))
    .concat(response.fromCoaches);
  return {
    mine,
    fromCoaches,
    asOf: response.asOf,
    conflictPlanIds,
    ...aliases,
    serverDeletedIds: response.deletedIds,
  };
}

/**
 * Keep local intent over a server read: a plan with a live queued create,
 * edit or delete keeps its local version (or stays gone), and a coach plan
 * with a live queued answer keeps its local status and seen marker.
 */
export function overlayLocalPlans(
  server: NutritionPlansCache,
  local: NutritionPlansCache | null,
  livePlanIds: ReadonlySet<string>,
  liveAssignmentPlanIds: ReadonlySet<string>,
): NutritionPlansCache {
  if (!local) return server;
  const goneOnServer = new Set(server.serverDeletedIds ?? []);
  let mine = server.mine;
  for (const id of livePlanIds) {
    if (goneOnServer.has(id)) continue;
    const localPlan = local.mine.find((p) => p.id === id);
    mine = mine.filter((p) => p.id !== id);
    if (localPlan) mine = [...mine, localPlan];
  }
  const fromCoaches = server.fromCoaches.map((c) => {
    if (!liveAssignmentPlanIds.has(c.plan.id)) return c;
    const mineLocal = local.fromCoaches.find((l) => l.plan.id === c.plan.id);
    return mineLocal
      ? {
          ...c,
          status: mineLocal.status,
          updatedSinceSeen: mineLocal.updatedSinceSeen,
          addedAt: mineLocal.addedAt,
        }
      : c;
  });
  return { ...server, mine, fromCoaches };
}

// -- Writing ---------------------------------------------------------------------

/** A trimmed plan name, or null when unusable. */
export function cleanPlanName(name: string): string | null {
  const t = name.replace(/\s+/g, " ").trim();
  if (t.length === 0) return null;
  return t.slice(0, PLAN_NAME_MAX);
}

/** The `POST` / `PUT` body for a plan. One-offs send their macros. */
export function toPlanInput(plan: NutritionPlan): PlanInput {
  return {
    name: plan.name,
    notes: plan.notes,
    meals: plan.meals.map((m, mi) => ({
      name: m.name.slice(0, PLAN_MEAL_NAME_MAX),
      logSlot: m.logSlot,
      sortOrder: mi,
      items: m.items.map((it, ii): PlanItemInput => {
        const base = { servings: it.servings, sortOrder: ii };
        if (it.kind === "food" && it.foodId)
          return { ...base, foodId: it.foodId };
        if (it.kind === "recipe" && it.recipeId)
          return { ...base, recipeId: it.recipeId };
        if (it.kind === "meal" && it.mealId)
          return { ...base, mealId: it.mealId };
        // The server reads a one-off's macros PER SERVING and multiplies by
        // `servings` itself (`resolvePlanInput`); the item holds the total.
        const per = perServingOf(it);
        return {
          ...base,
          custom: {
            name: it.name,
            kcal: per.kcal,
            proteinG: per.proteinG,
            carbsG: per.carbsG,
            fatG: per.fatG,
          },
        };
      }),
    })),
  };
}

export function clampServings(servings: number): number {
  if (!Number.isFinite(servings) || servings <= 0) return 1;
  return Math.min(PLAN_ITEM_SERVINGS_MAX, Math.round(servings * 100) / 100);
}

function baseItem(
  id: string,
  servings: number,
): Omit<PlanItem, "kind" | "name" | "logEntry" | keyof PlanMacros> {
  return {
    id,
    foodId: null,
    recipeId: null,
    mealId: null,
    servings,
    sortOrder: 0,
    food: null,
    recipe: null,
    meal: null,
    custom: null,
  };
}

/**
 * A food, recipe or saved meal created offline still has a `local-…` id. The
 * sync swaps it in food logs but not inside plans, so a plan keeps such an
 * item as a one-off with its name and macros (Inspector Brad, #554).
 */
function localSourceAsOneOff(
  id: string,
  sourceId: string,
  name: string,
  per: PlanMacros,
  servings: number,
): PlanItem | null {
  if (!sourceId.startsWith("local-")) return null;
  return planItemCustom(id, name, scale(per, servings), servings);
}

export function planItemFromFood(
  id: string,
  food: Food,
  servings: number,
): PlanItem {
  const s = clampServings(servings);
  const per = {
    kcal: food.kcal,
    proteinG: food.proteinG,
    carbsG: food.carbsG,
    fatG: food.fatG,
  };
  const oneOff = localSourceAsOneOff(id, food.id, food.name, per, s);
  if (oneOff) return oneOff;
  return {
    ...baseItem(id, s),
    ...scale(per, s),
    kind: "food",
    foodId: food.id,
    name: food.name,
    food: {
      name: food.name,
      brand: food.brand,
      servingSize: food.servingSize,
      servingUnit: food.servingUnit,
      perServing: per,
    },
    logEntry: { foodId: food.id, servings: s },
  };
}

export function planItemFromRecipe(
  id: string,
  recipe: Recipe,
  servings: number,
): PlanItem {
  const s = clampServings(servings);
  const portions = recipe.servings > 0 ? recipe.servings : 1;
  const per = {
    kcal: (recipe.totalKcal ?? 0) / portions,
    proteinG: (recipe.totalProteinG ?? 0) / portions,
    carbsG: (recipe.totalCarbsG ?? 0) / portions,
    fatG: (recipe.totalFatG ?? 0) / portions,
  };
  const oneOff = localSourceAsOneOff(id, recipe.id, recipe.name, per, s);
  if (oneOff) return oneOff;
  return {
    ...baseItem(id, s),
    ...scale(per, s),
    kind: "recipe",
    recipeId: recipe.id,
    name: recipe.name,
    recipe: {
      name: recipe.name,
      photoUrl: recipe.photoUrl,
      servings: recipe.servings,
      instructions: recipe.instructions,
      perServing: per,
      ingredients: [],
      sharedByUserId: null,
    },
    logEntry: { recipeId: recipe.id, servings: s },
  };
}

export function planItemFromSavedMeal(
  id: string,
  meal: Meal,
  servings: number,
): PlanItem {
  const s = clampServings(servings);
  const per = {
    kcal: meal.totalKcal,
    proteinG: meal.totalProteinG,
    carbsG: meal.totalCarbsG,
    fatG: meal.totalFatG,
  };
  const oneOff = localSourceAsOneOff(id, meal.id, meal.name, per, s);
  if (oneOff) return oneOff;
  return {
    ...baseItem(id, s),
    ...scale(per, s),
    kind: "meal",
    mealId: meal.id,
    name: meal.name,
    meal: { name: meal.name, photoUrl: meal.photoUrl, perServing: per },
    logEntry: { mealId: meal.id, servings: s },
  };
}

export function planItemCustom(
  id: string,
  name: string,
  macros: PlanMacros,
  servings = 1,
): PlanItem {
  const total = {
    kcal: Math.round(macros.kcal),
    proteinG: round1(macros.proteinG),
    carbsG: round1(macros.carbsG),
    fatG: round1(macros.fatG),
  };
  return {
    ...baseItem(id, servings),
    ...total,
    kind: "custom",
    name,
    // Per serving, as the server stores and returns it.
    custom: {
      name,
      ...(servings > 0 && servings !== 1
        ? {
            kcal: total.kcal / servings,
            proteinG: total.proteinG / servings,
            carbsG: total.carbsG / servings,
            fatG: total.fatG / servings,
          }
        : total),
    },
    logEntry: { customName: name, servings, ...total },
  };
}

/** Per-serving macros of an item (for changing its amount). */
export function perServingOf(item: PlanItem): PlanMacros {
  const per =
    item.food?.perServing ?? item.recipe?.perServing ?? item.meal?.perServing;
  if (per) return per;
  const s = item.servings > 0 ? item.servings : 1;
  return {
    kcal: item.kcal / s,
    proteinG: item.proteinG / s,
    carbsG: item.carbsG / s,
    fatG: item.fatG / s,
  };
}

/** The item at a new amount; its log hint follows. */
export function withServings(item: PlanItem, servings: number): PlanItem {
  const s = clampServings(servings);
  const totals = scale(perServingOf(item), s);
  const logEntry =
    "customName" in item.logEntry
      ? { ...item.logEntry, ...totals, servings: s }
      : { ...item.logEntry, servings: s };
  return {
    ...item,
    ...totals,
    servings: s,
    logEntry,
  };
}

export function updateMeal(
  plan: NutritionPlan,
  mealId: string,
  update: (meal: PlanMeal) => PlanMeal,
): NutritionPlan {
  return recomputePlan({
    ...plan,
    meals: plan.meals.map((m) => (m.id === mealId ? update(m) : m)),
  });
}

export function addItemToMeal(
  plan: NutritionPlan,
  mealId: string,
  item: PlanItem,
): NutritionPlan {
  return updateMeal(plan, mealId, (m) => ({
    ...m,
    items: [...m.items, { ...item, sortOrder: m.items.length }],
  }));
}

export function replaceItem(
  plan: NutritionPlan,
  mealId: string,
  item: PlanItem,
): NutritionPlan {
  return updateMeal(plan, mealId, (m) => ({
    ...m,
    items: m.items.map((it) => (it.id === item.id ? item : it)),
  }));
}

export function removeItem(
  plan: NutritionPlan,
  mealId: string,
  itemId: string,
): NutritionPlan {
  return updateMeal(plan, mealId, (m) => ({
    ...m,
    items: m.items.filter((it) => it.id !== itemId),
  }));
}

/** A new empty meal on the plan. */
export function emptyPlanMeal(
  id: string,
  name: string,
  logSlot: MealSlot,
  sortOrder: number,
): PlanMeal {
  return {
    id,
    name: name.slice(0, PLAN_MEAL_NAME_MAX),
    logSlot,
    sortOrder,
    totals: zeroMacros(),
    items: [],
  };
}

/**
 * Set which of Your meals the plan has (the N28b ticks), in Your meals'
 * order. A meal kept keeps its items; one of Your meals left unticked is
 * dropped. Plan meals that aren't one of Your meals (a coach's "Meal 5")
 * stay at the end.
 */
export function withPlanMeals(
  plan: NutritionPlan,
  ticked: readonly UserMeal[],
  newId: () => string,
  yourMeals: readonly UserMeal[],
): NutritionPlan {
  const key = (n: string) => n.trim().toLowerCase();
  const kept: PlanMeal[] = ticked.map((um) => {
    const existing = plan.meals.find((m) => key(m.name) === key(um.name));
    return existing ?? emptyPlanMeal(newId(), um.name, um.logSlot, 0);
  });
  const known = new Set([...yourMeals, ...ticked].map((u) => key(u.name)));
  const extra = plan.meals.filter((m) => !known.has(key(m.name)));
  return recomputePlan({
    ...plan,
    meals: [...kept, ...extra].map((m, i) => ({ ...m, sortOrder: i })),
  });
}

/** A new plan drafted on the phone (N28). Never logs anything. */
export function newDraftPlan(args: {
  id: string;
  ownerId: string;
  name: string;
  meals: PlanMeal[];
  now: string;
}): NutritionPlan {
  return recomputePlan({
    id: args.id,
    ownerId: args.ownerId,
    name: args.name,
    notes: null,
    source: "manual",
    sourcePlanId: null,
    revision: 0,
    archivedAt: null,
    createdAt: args.now,
    updatedAt: args.now,
    totals: zeroMacros(),
    meals: args.meals.map((m, i) => ({ ...m, sortOrder: i })),
  });
}

/** Copy a plan's meals and items with fresh ids (Start from: one of your plans). */
export function copyPlanMeals(
  plan: NutritionPlan,
  newId: () => string,
): PlanMeal[] {
  return plan.meals.map((m) => ({
    ...m,
    id: newId(),
    items: m.items.map((it) => ({ ...it, id: newId() })),
  }));
}

/**
 * Meals from a day the person logged (Start from: a day you logged). Each of
 * Your meals with food becomes a plan meal; foods, recipes and saved meals
 * stay references, anything else becomes a one-off with its logged macros.
 */
export function planMealsFromDay(
  day: FuelToday,
  userMeals: readonly UserMeal[],
  newId: () => string,
  nameFor: (entry: NutritionEntry) => string | undefined = () => undefined,
): PlanMeal[] {
  const meals = activeUserMeals(userMeals);
  const entries = flattenFuelEntries(day);
  const groups = new Map<string, PlanMeal>();
  const order: string[] = [];
  for (const e of entries) {
    const um =
      meals.find((m) => m.id === e.userMealId) ??
      meals.find((m) => m.id === defaultUserMealIdForSlot(meals, e.mealSlot)) ??
      null;
    const name = um?.name ?? slotName(e.mealSlot);
    const logSlot = um?.logSlot ?? e.mealSlot;
    const k = name.toLowerCase();
    if (!groups.has(k)) {
      groups.set(k, emptyPlanMeal(newId(), name, logSlot, order.length));
      order.push(k);
    }
    const meal = groups.get(k) as PlanMeal;
    const macros = {
      kcal: e.kcal,
      proteinG: e.proteinG,
      carbsG: e.carbsG,
      fatG: e.fatG,
    };
    const label = nameFor(e) ?? e.customName ?? "Logged food";
    const localRef = [e.foodId, e.recipeId, e.mealId].some((r) =>
      r?.startsWith("local-"),
    );
    const kind: PlanItem["kind"] | null = localRef
      ? null
      : e.foodId
        ? "food"
        : e.recipeId
          ? "recipe"
          : e.mealId
            ? "meal"
            : null;
    const logEntry: PlanItem["logEntry"] | null = e.foodId
      ? { foodId: e.foodId, servings: e.servings }
      : e.recipeId
        ? { recipeId: e.recipeId, servings: e.servings }
        : e.mealId
          ? { mealId: e.mealId, servings: e.servings }
          : null;
    const item: PlanItem =
      kind && logEntry
        ? {
            ...baseItem(newId(), e.servings),
            ...macros,
            kind,
            foodId: e.foodId,
            recipeId: e.foodId ? null : e.recipeId,
            mealId: e.foodId || e.recipeId ? null : e.mealId,
            name: label,
            logEntry,
          }
        : planItemCustom(newId(), label, macros, e.servings);
    meal.items.push({ ...item, sortOrder: meal.items.length });
  }
  return order.map((k) => {
    const m = groups.get(k) as PlanMeal;
    return { ...m, totals: sumMacros(m.items) };
  });
}

function slotName(slot: MealSlot): string {
  return slot === "snack" ? "Snack" : slot[0].toUpperCase() + slot.slice(1);
}

// -- Adding to today ---------------------------------------------------------------

/**
 * Which of Your meals a plan meal lands in: the meal with the same name, else
 * the default meal for its slot. Null (slot only) before Your meals loads.
 */
export function userMealForPlanMeal(
  planMeal: PlanMeal,
  userMeals: readonly UserMeal[],
): UserMeal | null {
  const meals = activeUserMeals(userMeals).filter(
    (m) => !isSyntheticUserMealId(m.id),
  );
  const byName = meals.find(
    (m) => m.name.trim().toLowerCase() === planMeal.name.trim().toLowerCase(),
  );
  if (byName) return byName;
  const id = defaultUserMealIdForSlot(meals, planMeal.logSlot);
  return meals.find((m) => m.id === id) ?? null;
}

const isServerId = (id: string) => !id.startsWith("local-");

/**
 * Today's log entries for one plan meal, built from the cached plan. Each
 * becomes its own queued entry with its own Idempotency-Key, so the drain
 * sends them through `POST /nutrition/entries/batch` (PER-132) and a replay
 * never logs twice. The entry carries its own macros, so a later coach edit
 * to the plan never changes food already logged.
 */
export function logInputsForPlanMeal(
  plan: NutritionPlan,
  planMeal: PlanMeal,
  userMeals: readonly UserMeal[],
  loggedAt: string,
): LogEntryInput[] {
  const um = userMealForPlanMeal(planMeal, userMeals);
  const slot = um?.logSlot ?? planMeal.logSlot;
  const source =
    isServerId(plan.id) && isServerId(planMeal.id)
      ? { sourcePlanId: plan.id, sourcePlanMealId: planMeal.id }
      : {};
  return planMeal.items.map((item) => {
    const hint = item.logEntry;
    const macros = {
      kcal: item.kcal,
      proteinG: item.proteinG,
      carbsG: item.carbsG,
      fatG: item.fatG,
    };
    const base: LogEntryInput = {
      mealSlot: slot,
      servings: hint.servings,
      loggedAt,
      ...(um ? { userMealId: um.id } : {}),
      ...source,
    };
    if ("foodId" in hint) return { ...base, foodId: hint.foodId, ...macros };
    if ("recipeId" in hint)
      return { ...base, recipeId: hint.recipeId, ...macros };
    if ("mealId" in hint) return { ...base, mealId: hint.mealId, ...macros };
    return {
      ...base,
      customName: hint.customName,
      kcal: hint.kcal,
      proteinG: hint.proteinG,
      carbsG: hint.carbsG,
      fatG: hint.fatG,
    };
  });
}

/** Every meal of the plan, in order (Add the whole plan to today). */
export function logInputsForPlan(
  plan: NutritionPlan,
  userMeals: readonly UserMeal[],
  loggedAt: string,
): LogEntryInput[] {
  return plan.meals.flatMap((m) =>
    logInputsForPlanMeal(plan, m, userMeals, loggedAt),
  );
}

// -- Shopping list ---------------------------------------------------------------------

/** Ticked items still on the list (stale ticks don't count). */
export function shoppingProgress(
  list: PlansShoppingList | null,
  ticked: readonly string[],
): { done: number; total: number } {
  if (!list) return { done: 0, total: 0 };
  const ids = new Set(ticked);
  const items = list.aisles.flatMap((a) => a.items);
  return {
    done: items.filter((i) => ids.has(i.id)).length,
    total: items.length,
  };
}

/** Is this plan in the shopping list? */
export function isPlanInShoppingList(
  list: PlansShoppingList | null,
  planId: string,
): boolean {
  return !!list?.plans.some((p) => p.nutritionPlanId === planId);
}
