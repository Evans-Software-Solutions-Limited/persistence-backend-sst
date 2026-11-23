import { useCallback, useEffect, useMemo, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { localIdFactory } from "@/application/commands/localId";
import type {
  Food,
  Meal,
  NutritionEntry,
  Recipe,
} from "@/domain/models/nutrition";
import type { PlanItem } from "@/domain/models/nutritionPlans";
import { entryDisplayLabel, perServingDivisor } from "@/domain/services";
import {
  planItemCustom,
  planItemFromFood,
  planItemFromRecipe,
  planItemFromSavedMeal,
  withServings,
} from "@/domain/services/nutritionPlans.service";
import {
  quickLogDraft,
  recentEntries,
} from "@/domain/services/userMeals.service";
import { flattenFuelEntries } from "@/domain/services/nutrition.service";
import { addDaysISO, localDayISO } from "@/shared/utils";
import { usePlanDraft } from "@/state/plan-draft";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useGetMeals } from "@/ui/hooks/useGetMeals";
import { useGetRecipes } from "@/ui/hooks/useGetRecipes";
import { useSearchFoods } from "@/ui/hooks/useSearchFoods";
import {
  PlanAddFoodPresenter,
  type PlanAddRowVM,
  type PlanAddTab,
} from "@/ui/presenters/fuel/plans/PlanAddFoodPresenter";
import { PlanItemAmountSheetPresenter } from "@/ui/presenters/fuel/plans/PlanItemAmountSheetPresenter";
import {
  PlanQuickItemSheetPresenter,
  type PlanQuickField,
} from "@/ui/presenters/fuel/plans/PlanQuickItemSheetPresenter";
import { AMOUNT_CHIPS } from "./PlanBuilderContainer";
import {
  amountText,
  fmt,
  itemSub,
  macroShares,
  macrosAt,
  parseAmount,
  planItemFromEntry,
  servingSizeLabel,
} from "./planViewModels";

/** How many earlier days History looks back over (cached days only). */
export const HISTORY_DAYS = 14;

const EMPTY_QUICK: Record<PlanQuickField, string> = {
  name: "",
  kcal: "",
  protein: "",
  carbs: "",
  fat: "",
};

const EMPTY_TEXT: Record<PlanAddTab, string> = {
  all: "Nothing logged on earlier days yet.",
  meals: "No saved meals yet.",
  foods: "No foods logged on earlier days yet.",
  recipes: "No recipes yet.",
};

type Source =
  | { kind: "entry"; entry: NutritionEntry }
  | { kind: "food"; food: Food }
  | { kind: "meal"; meal: Meal }
  | { kind: "recipe"; recipe: Recipe };

function foodSub(food: Food, servings: number, kcal: number): string {
  return `${amountText(servings * food.servingSize)} ${food.servingUnit} · ${fmt(kcal)} kcal`;
}

/**
 * <PlanAddFoodContainer> — `fuel/plan-add?meal=<planMealId>` (PER-133, N30).
 * Adds foods to a meal of the plan being built (`usePlanDraft`); it never
 * logs. History comes from days already on the phone; search goes online.
 */
export function PlanAddFoodContainer() {
  const params = useLocalSearchParams<{ meal?: string }>();
  const draft = usePlanDraft((s) => s.draft);
  const addItems = usePlanDraft((s) => s.addItems);
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const savedMeals = useGetMeals();
  const recipes = useGetRecipes();

  const [mealId, setMealId] = useState(
    typeof params.meal === "string" ? params.meal : "",
  );
  const [mealPicker, setMealPicker] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<PlanAddTab>("all");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [amount, setAmount] = useState<{
    key: string;
    text: string;
    toMealId: string;
  } | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quick, setQuick] = useState(EMPTY_QUICK);

  const search = useSearchFoods(query);

  useEffect(() => {
    if (!draft) router.back();
  }, [draft]);

  const recipeMap = useMemo(
    () => new Map((recipes.data ?? []).map((r) => [r.id, r])),
    [recipes.data],
  );
  const mealMap = useMemo(
    () => new Map((savedMeals.data ?? []).map((m) => [m.id, m])),
    [savedMeals.data],
  );
  const lookups = useMemo(
    () => ({
      food: (id: string) => storage.getCachedFoodById(id),
      recipe: (id: string) => recipeMap.get(id) ?? null,
      meal: (id: string) => mealMap.get(id) ?? null,
      name: (e: NutritionEntry) =>
        entryDisplayLabel(e, {
          food: (id) => storage.getCachedFoodById(id)?.name,
          recipe: (id) => recipeMap.get(id)?.name,
          meal: (id) => mealMap.get(id)?.name,
        }),
    }),
    [storage, recipeMap, mealMap],
  );

  const history = useMemo(() => {
    if (!userId) return [];
    const today = localDayISO();
    const entries: NutritionEntry[] = [];
    for (let i = 0; i <= HISTORY_DAYS; i++) {
      const fuel = storage.getCachedFuelToday(userId, addDaysISO(today, -i));
      if (fuel) entries.push(...flattenFuelEntries(fuel));
    }
    return recentEntries(entries);
  }, [userId, storage]);

  // Every row the page can show, by key.
  const sources = useMemo(() => {
    const m = new Map<string, Source>();
    for (const h of history)
      m.set(`e:${h.entry.id}`, { kind: "entry", entry: h.entry });
    for (const h of history) {
      const food = h.entry.foodId
        ? storage.getCachedFoodById(h.entry.foodId)
        : null;
      if (food) m.set(`f:${food.id}`, { kind: "food", food });
    }
    for (const f of search.results)
      m.set(`f:${f.id}`, { kind: "food", food: f });
    for (const meal of savedMeals.data ?? [])
      m.set(`m:${meal.id}`, { kind: "meal", meal });
    for (const r of recipes.data ?? [])
      m.set(`r:${r.id}`, { kind: "recipe", recipe: r });
    return m;
  }, [history, storage, search.results, savedMeals.data, recipes.data]);

  const itemFor = useCallback(
    (key: string, servings?: number): PlanItem | null => {
      const s = sources.get(key);
      if (!s) return null;
      const id = `local-${localIdFactory()}`;
      switch (s.kind) {
        case "entry": {
          const item = planItemFromEntry(
            () => `local-${localIdFactory()}`,
            s.entry,
            lookups,
          );
          return servings === undefined ? item : withServings(item, servings);
        }
        case "food":
          return planItemFromFood(id, s.food, servings ?? 1);
        case "meal":
          return planItemFromSavedMeal(id, s.meal, servings ?? 1);
        default:
          return planItemFromRecipe(id, s.recipe, servings ?? 1);
      }
    },
    [sources, lookups],
  );

  if (!draft) return null;
  const meal = draft.meals.find((m) => m.id === mealId) ?? draft.meals[0];
  if (!meal) return null;

  const searching = query.trim().length >= 2;
  const row = (key: string, name: string, sub: string): PlanAddRowVM => ({
    key,
    name,
    sub,
    picked: picked.has(key),
  });

  let rows: PlanAddRowVM[];
  if (searching) {
    rows = search.results.map((f) =>
      row(`f:${f.id}`, f.name, foodSub(f, 1, f.kcal)),
    );
  } else if (tab === "meals") {
    rows = (savedMeals.data ?? []).map((m) =>
      row(`m:${m.id}`, m.name, `My meal · ${fmt(m.totalKcal)} kcal`),
    );
  } else if (tab === "recipes") {
    rows = (recipes.data ?? []).map((r) =>
      row(
        `r:${r.id}`,
        r.name,
        `Recipe · ${fmt((r.totalKcal ?? 0) / perServingDivisor(r.servings))} kcal`,
      ),
    );
  } else if (tab === "foods") {
    const seen = new Set<string>();
    rows = [];
    for (const h of history) {
      const food = h.entry.foodId
        ? storage.getCachedFoodById(h.entry.foodId)
        : null;
      if (!food || seen.has(food.id)) continue;
      seen.add(food.id);
      rows.push(row(`f:${food.id}`, food.name, foodSub(food, 1, food.kcal)));
    }
  } else {
    rows = history.map(({ entry: e }) => {
      const food = e.foodId ? storage.getCachedFoodById(e.foodId) : null;
      const sub = food
        ? foodSub(food, e.servings, e.kcal)
        : e.foodId
          ? `${amountText(e.servings)} ${e.servings === 1 ? "serving" : "servings"} · ${fmt(e.kcal)} kcal`
          : e.recipeId
            ? `Recipe · ${fmt(e.kcal)} kcal`
            : e.mealId
              ? `My meal · ${fmt(e.kcal)} kcal`
              : `${fmt(e.kcal)} kcal`;
      return row(`e:${e.id}`, lookups.name(e), sub);
    });
  }

  const emptyText = searching
    ? search.isSearching
      ? "Searching…"
      : "No foods found. Search needs a connection."
    : EMPTY_TEXT[tab];

  const n = picked.size;
  const ctaLabel =
    n > 0
      ? `Add ${n} ${n === 1 ? "item" : "items"} to ${meal.name}`
      : "Tap + to add, or tap a food for its amount";

  const onAdd = () => {
    const items = [...picked]
      .map((k) => itemFor(k))
      .filter((x): x is PlanItem => x !== null);
    if (items.length === 0) return;
    addItems(meal.id, items);
    router.back();
  };

  // N31 in add mode.
  const base = amount ? itemFor(amount.key) : null;
  const typed = amount ? parseAmount(amount.text) : null;
  const preview = base ? macrosAt(base, typed ?? base.servings) : null;
  const toMeal = amount
    ? (draft.meals.find((m) => m.id === amount.toMealId) ?? meal)
    : meal;

  const q = quickLogDraft(quick);

  return (
    <>
      <PlanAddFoodPresenter
        onBack={() => router.back()}
        mealName={meal.name}
        planName={draft.name}
        onOpenMealPicker={() => setMealPicker(true)}
        mealPickerVisible={mealPicker}
        meals={draft.meals.map((m) => ({ id: m.id, name: m.name }))}
        onSelectMeal={(id) => {
          setMealId(id);
          setMealPicker(false);
        }}
        onCloseMealPicker={() => setMealPicker(false)}
        query={query}
        onQuery={setQuery}
        tab={tab}
        onTab={setTab}
        onQuickLog={() => setQuickOpen(true)}
        sectionTitle={searching ? "Results" : "History"}
        rows={rows}
        emptyText={emptyText}
        onToggle={(key) =>
          setPicked((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          })
        }
        onRow={(key) => {
          const item = itemFor(key);
          if (item)
            setAmount({
              key,
              text: amountText(item.servings),
              toMealId: meal.id,
            });
        }}
        ctaLabel={ctaLabel}
        canAdd={n > 0}
        onAdd={onAdd}
      />

      <PlanItemAmountSheetPresenter
        visible={!!base}
        onClose={() => setAmount(null)}
        mode="add"
        name={base?.name ?? ""}
        sub={base ? itemSub(base) : ""}
        servingSize={base ? servingSizeLabel(base) : ""}
        amount={amount?.text ?? ""}
        onAmount={(text) => amount && setAmount({ ...amount, text })}
        chips={AMOUNT_CHIPS.map((c) => ({ ...c, selected: typed === c.value }))}
        onChip={(value) =>
          amount && setAmount({ ...amount, text: amountText(value) })
        }
        mealName={toMeal.name}
        meals={draft.meals.map((m) => ({ id: m.id, name: m.name }))}
        onMeal={(id) => amount && setAmount({ ...amount, toMealId: id })}
        kcal={preview?.kcal ?? 0}
        macros={preview ? macroShares(preview) : []}
        canSave={typed !== null}
        onSave={() => {
          if (!amount || !base || typed === null) return;
          addItems(toMeal.id, [withServings(base, typed)]);
          setAmount(null);
          router.back();
        }}
        onRemove={() => setAmount(null)}
      />

      <PlanQuickItemSheetPresenter
        visible={quickOpen}
        onClose={() => setQuickOpen(false)}
        values={quick}
        onChange={(field, value) => setQuick((v) => ({ ...v, [field]: value }))}
        mealName={meal.name}
        kcalLabel={q.kcal !== null && q.kcal > 0 ? fmt(q.kcal) : ""}
        warning={
          q.mismatch && q.macroKcal !== null && q.kcal !== null
            ? `Your macros add up to ${fmt(q.macroKcal)} kcal. We'll add the ${fmt(q.kcal)} you typed.`
            : null
        }
        canAdd={q.canLog}
        onAdd={() => {
          if (!q.canLog || q.kcal === null) return;
          addItems(meal.id, [
            planItemCustom(`local-${localIdFactory()}`, q.name ?? "Quick log", {
              kcal: q.kcal,
              proteinG: q.proteinG,
              carbsG: q.carbsG,
              fatG: q.fatG,
            }),
          ]);
          setQuickOpen(false);
          setQuick(EMPTY_QUICK);
          router.back();
        }}
      />
    </>
  );
}
