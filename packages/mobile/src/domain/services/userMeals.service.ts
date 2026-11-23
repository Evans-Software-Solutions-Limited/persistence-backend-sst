/**
 * Your meals (PER-132, Design D N1/N1b) — pure helpers. No framework imports.
 *
 * - Grouping a day's entries under the person's meals, including entries
 *   logged by 1.2.0 (no `userMealId`), which sit under the default meal for
 *   their slot exactly as the server's `effectiveUserMeal` rule does.
 * - The list edits the Your meals sheet makes (rename, reorder, add) and the
 *   `PUT /nutrition/user-meals` body they produce.
 * - Per-meal calorie and macro summaries, the week strip's day states and the
 *   Recents list on Add to a meal.
 */
import type {
  FuelToday,
  LogEntryInput,
  MealSlot,
  NutritionEntry,
} from "@/domain/models/nutrition";
import type { UserMeal, UserMealPutRow } from "@/domain/models/userMeals";
import { USER_MEALS_MAX, USER_MEAL_NAME_MAX } from "@/domain/models/userMeals";

const SLOT_ORDER: readonly { slot: MealSlot; label: string }[] = [
  { slot: "breakfast", label: "Breakfast" },
  { slot: "lunch", label: "Lunch" },
  { slot: "snack", label: "Snack" },
  { slot: "dinner", label: "Dinner" },
];

const SYNTHETIC_PREFIX = "slot:";

/** A placeholder meal shown before Your meals has ever been fetched. */
export function isSyntheticUserMealId(id: string): boolean {
  return id.startsWith(SYNTHETIC_PREFIX);
}

/** A meal added on this phone that the server hasn't confirmed yet. */
export function isLocalUserMealId(id: string): boolean {
  return id.startsWith("local-");
}

/**
 * The four defaults, in the order and with the names the server seeds them
 * (`GET /nutrition/user-meals` on first read). Used only until the real list
 * is cached; their ids are synthetic and are never sent.
 */
export function syntheticDefaultUserMeals(): UserMeal[] {
  return SLOT_ORDER.map(({ slot, label }, i) => ({
    id: `${SYNTHETIC_PREFIX}${slot}`,
    name: label,
    logSlot: slot,
    sortOrder: i,
    defaultKey: slot,
    clientRequestId: null,
    archivedAt: null,
    updatedAt: "1970-01-01T00:00:00.000Z",
  }));
}

/**
 * Find a meal by id, following ids that a screen or drawer may still hold:
 * a `local-<key>` resolves to the synced meal with that `clientRequestId`, and
 * a placeholder `slot:<slot>` to that slot's default meal (Inspector Brad, #550).
 */
export function findUserMeal(
  meals: readonly UserMeal[],
  id: string,
): UserMeal | undefined {
  const exact = meals.find((m) => m.id === id);
  if (exact) return exact;
  if (isLocalUserMealId(id)) {
    const key = id.slice("local-".length);
    return meals.find((m) => m.clientRequestId === key);
  }
  // A placeholder `slot:<slot>` held from before the list loaded resolves to
  // that slot's default meal once it has (Inspector Brad, #550).
  if (isSyntheticUserMealId(id)) {
    const slot = id.slice(SYNTHETIC_PREFIX.length) as MealSlot;
    const defaultId = defaultUserMealIdForSlot(meals, slot);
    return meals.find((m) => m.id === defaultId);
  }
  return undefined;
}

/** Active meals in display order. */
export function activeUserMeals(meals: readonly UserMeal[]): UserMeal[] {
  return meals
    .filter((m) => m.archivedAt === null)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * The meal an entry without a usable `userMealId` is shown under: the seeded
 * default for its slot if still active and still on that slot, else the first
 * active meal on that slot, else null. Same rule as the server's
 * `defaultUserMealIdForSlot`, so phone and server agree.
 */
export function defaultUserMealIdForSlot(
  meals: readonly UserMeal[],
  slot: MealSlot,
): string | null {
  const inSlot = activeUserMeals(meals).filter((m) => m.logSlot === slot);
  return (inSlot.find((m) => m.defaultKey === slot) ?? inSlot[0])?.id ?? null;
}

/** The meal an entry belongs to on screen. */
export function userMealIdForEntry(
  entry: Pick<NutritionEntry, "userMealId" | "mealSlot">,
  meals: readonly UserMeal[],
): string | null {
  const active = activeUserMeals(meals);
  if (entry.userMealId && active.some((m) => m.id === entry.userMealId)) {
    return entry.userMealId;
  }
  return defaultUserMealIdForSlot(active, entry.mealSlot);
}

export type UserMealGroup = {
  meal: UserMeal;
  entries: NutritionEntry[];
};

/**
 * A day's entries grouped under the person's meals, in meal order. Every
 * active meal appears (empty ones too). An entry whose slot has no meal at all
 * (every meal on that slot was moved or removed) gets a section named after
 * its old slot, so nothing logged is ever hidden.
 */
export function groupEntriesByUserMeal(
  entries: readonly NutritionEntry[],
  meals: readonly UserMeal[],
): UserMealGroup[] {
  const active = activeUserMeals(meals);
  const groups = new Map<string, UserMealGroup>();
  for (const meal of active) groups.set(meal.id, { meal, entries: [] });
  for (const entry of entries) {
    const id = userMealIdForEntry(entry, active);
    if (id !== null) {
      groups.get(id)?.entries.push(entry);
      continue;
    }
    const orphanId = `${SYNTHETIC_PREFIX}${entry.mealSlot}`;
    let group = groups.get(orphanId);
    if (!group) {
      const label =
        SLOT_ORDER.find((s) => s.slot === entry.mealSlot)?.label ??
        entry.mealSlot;
      group = {
        meal: {
          id: orphanId,
          name: label,
          logSlot: entry.mealSlot,
          sortOrder: Number.MAX_SAFE_INTEGER,
          defaultKey: entry.mealSlot,
          clientRequestId: null,
          archivedAt: null,
          updatedAt: "1970-01-01T00:00:00.000Z",
        },
        entries: [],
      };
      groups.set(orphanId, group);
    }
    group.entries.push(entry);
  }
  return [...groups.values()];
}

export type MacroTotals = {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

export function sumEntryMacros(
  entries: readonly NutritionEntry[],
): MacroTotals {
  return entries.reduce<MacroTotals>(
    (a, e) => ({
      kcal: a.kcal + e.kcal,
      proteinG: a.proteinG + e.proteinG,
      carbsG: a.carbsG + e.carbsG,
      fatG: a.fatG + e.fatG,
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
}

/**
 * The per-meal summary line under a meal's name (N1): "32g C · 21g F · 34g P".
 * Empty when nothing is logged in the meal.
 */
export function mealMacroLine(totals: MacroTotals): string {
  if (totals.kcal <= 0) return "";
  const r = (n: number) => Math.round(n);
  return `${r(totals.carbsG)}g C · ${r(totals.fatG)}g F · ${r(totals.proteinG)}g P`;
}

// -- Your meals edits (N1b) --------------------------------------------------

/** Trimmed, length-checked name, or null when unusable. */
export function cleanUserMealName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > USER_MEAL_NAME_MAX) return null;
  return trimmed;
}

function renumber(meals: readonly UserMeal[]): UserMeal[] {
  return meals.map((m, i) => (m.sortOrder === i ? m : { ...m, sortOrder: i }));
}

export function renameUserMeal(
  meals: readonly UserMeal[],
  id: string,
  name: string,
): UserMeal[] {
  const clean = cleanUserMealName(name);
  if (clean === null) return activeUserMeals(meals);
  return activeUserMeals(meals).map((m) =>
    m.id === id ? { ...m, name: clean } : m,
  );
}

/** Apply a committed drag order. Ids not in the list are ignored. */
export function reorderUserMeals(
  meals: readonly UserMeal[],
  orderedIds: readonly string[],
): UserMeal[] {
  const active = activeUserMeals(meals);
  const byId = new Map(active.map((m) => [m.id, m]));
  const ordered = orderedIds
    .map((id) => byId.get(id))
    .filter((m): m is UserMeal => m !== undefined);
  const rest = active.filter((m) => !orderedIds.includes(m.id));
  return renumber([...ordered, ...rest]);
}

/**
 * Add a meal at the end of the list. It takes the old "snack" slot: an extra
 * meal is closest to a snack for 1.2.0 phones, which only know four slots.
 * Returns the list unchanged when the name is unusable or the list is full.
 */
export function addUserMeal(
  meals: readonly UserMeal[],
  name: string,
  key: string,
  now: string,
): UserMeal[] {
  const active = activeUserMeals(meals);
  const clean = cleanUserMealName(name);
  if (clean === null || active.length >= USER_MEALS_MAX) return active;
  return renumber([
    ...active,
    {
      id: `local-${key}`,
      name: clean,
      logSlot: "snack",
      sortOrder: active.length,
      defaultKey: null,
      clientRequestId: key,
      archivedAt: null,
      updatedAt: now,
    },
  ]);
}

/**
 * The `PUT /nutrition/user-meals` body for a list. Synthetic and `local-…`
 * ids are left out (the server matches a new meal by `clientRequestId`);
 * order is the list order.
 */
export function toUserMealsPutBody(meals: readonly UserMeal[]): {
  meals: UserMealPutRow[];
} {
  return {
    meals: activeUserMeals(meals).map((m, i) => {
      const row: UserMealPutRow = {
        name: m.name,
        logSlot: m.logSlot,
        sortOrder: i,
      };
      if (!isSyntheticUserMealId(m.id) && !isLocalUserMealId(m.id)) {
        row.id = m.id;
      }
      if (m.clientRequestId) row.clientRequestId = m.clientRequestId;
      return row;
    }),
  };
}

/**
 * Where a log into `meal` goes: its slot, plus its id unless it's a synthetic
 * placeholder (then the entry is slot-only, as 1.2.0 sends it).
 */
export function logTargetForUserMeal(
  meal: Pick<UserMeal, "id" | "logSlot">,
): Pick<LogEntryInput, "mealSlot" | "userMealId"> {
  return isSyntheticUserMealId(meal.id)
    ? { mealSlot: meal.logSlot }
    : { mealSlot: meal.logSlot, userMealId: meal.id };
}

// -- Week strip (N1) ---------------------------------------------------------

function parseDay(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The Monday-to-Sunday week (YYYY-MM-DD) containing `dayIso`. */
export function weekDaysFor(dayIso: string): string[] {
  const d = parseDay(dayIso);
  const offset = (d.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(d.getTime() - offset * 86_400_000);
  return Array.from({ length: 7 }, (_, i) =>
    formatDay(new Date(monday.getTime() + i * 86_400_000)),
  );
}

export type WeekDayState = "logged" | "over" | "today" | "future" | "empty";

/**
 * A day dot's state. "planned" from the canvas is gone (no plans on days, 17
 * Nov). Over = above target by more than 10% (the band `withinBand` uses).
 */
export function weekDayState(
  dayIso: string,
  todayIso: string,
  fuel: FuelToday | null,
): WeekDayState {
  if (dayIso > todayIso) return "future";
  if (dayIso === todayIso) return "today";
  if (!fuel || fuel.consumed.kcal <= 0) return "empty";
  const target = fuel.targets?.dailyKcal ?? 0;
  if (target > 0 && fuel.consumed.kcal > target * 1.1) return "over";
  return "logged";
}

// -- Recents (Add to a meal) -------------------------------------------------

export type RecentEntry = {
  /** Stable key for the list. */
  key: string;
  entry: NutritionEntry;
};

function recentKey(e: NutritionEntry): string {
  if (e.foodId) return `food:${e.foodId}`;
  if (e.recipeId) return `recipe:${e.recipeId}`;
  if (e.mealId) return `meal:${e.mealId}`;
  return `custom:${(e.customName ?? "").toLowerCase()}:${Math.round(e.kcal)}`;
}

/**
 * Distinct foods logged recently, newest first. `entries` may span several
 * days in any order.
 */
export function recentEntries(
  entries: readonly NutritionEntry[],
  limit = 20,
): RecentEntry[] {
  const sorted = [...entries].sort((a, b) =>
    b.loggedAt.localeCompare(a.loggedAt),
  );
  const seen = new Set<string>();
  const out: RecentEntry[] = [];
  for (const entry of sorted) {
    const key = recentKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, entry });
    if (out.length >= limit) break;
  }
  return out;
}

/** Log the same thing again into another meal/day. */
export function relogInput(
  entry: NutritionEntry,
  target: Pick<LogEntryInput, "mealSlot" | "userMealId">,
  loggedAt: string,
): LogEntryInput {
  const input: LogEntryInput = {
    ...target,
    servings: entry.servings,
    loggedAt,
  };
  if (entry.foodId) input.foodId = entry.foodId;
  else if (entry.recipeId) input.recipeId = entry.recipeId;
  else if (entry.mealId) input.mealId = entry.mealId;
  else {
    input.kcal = entry.kcal;
    input.proteinG = entry.proteinG;
    input.carbsG = entry.carbsG;
    input.fatG = entry.fatG;
    if (entry.customName) input.customName = entry.customName;
  }
  return input;
}

// -- Copy from earlier days (Add to a meal → Recent) -------------------------

export type EarlierDay = {
  /** YYYY-MM-DD */
  iso: string;
  /** "Yesterday", "Wed 21" */
  label: string;
  fuel: FuelToday | null;
};

export type EarlierGroup = {
  /** "Yesterday · Lunch" */
  heading: string;
  key: string;
  entries: NutritionEntry[];
};

/**
 * Earlier days' entries grouped by day and meal, newest day first, meals in
 * the person's order (canvas N2 "Copy from earlier days").
 */
export function earlierDayGroups(
  days: readonly EarlierDay[],
  meals: readonly UserMeal[],
): EarlierGroup[] {
  const out: EarlierGroup[] = [];
  for (const day of days) {
    if (!day.fuel) continue;
    const entries = Object.values(day.fuel.entriesBySlot).flat();
    for (const group of groupEntriesByUserMeal(entries, meals)) {
      if (group.entries.length === 0) continue;
      out.push({
        heading: `${day.label} · ${group.meal.name}`,
        key: `${day.iso}:${group.meal.id}`,
        entries: group.entries,
      });
    }
  }
  return out;
}

// -- Quick log (N2e) ---------------------------------------------------------

export type QuickLogValues = {
  name: string;
  kcal: string;
  protein: string;
  carbs: string;
  fat: string;
};

export type QuickLogDraft = {
  kcal: number | null;
  proteinG: number;
  carbsG: number;
  fatG: number;
  name: string | null;
  /** 4/4/9 kcal from the macros typed, or null when none were typed. */
  macroKcal: number | null;
  /** Calories typed and macros disagree by more than 20 kcal. */
  mismatch: boolean;
  canLog: boolean;
};

function num(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Parse the Quick log form. Calories are required (> 0, ≤ 10,000). */
export function quickLogDraft(values: QuickLogValues): QuickLogDraft {
  const kcal = num(values.kcal);
  const p = num(values.protein);
  const c = num(values.carbs);
  const f = num(values.fat);
  const anyMacro = p !== null || c !== null || f !== null;
  const macroKcal = anyMacro
    ? Math.round((p ?? 0) * 4 + (c ?? 0) * 4 + (f ?? 0) * 9)
    : null;
  const name = values.name.trim();
  return {
    kcal,
    proteinG: p ?? 0,
    carbsG: c ?? 0,
    fatG: f ?? 0,
    name: name.length > 0 ? name : null,
    macroKcal,
    mismatch:
      kcal !== null && macroKcal !== null && Math.abs(macroKcal - kcal) > 20,
    canLog: kcal !== null && kcal > 0 && kcal <= 10_000,
  };
}
