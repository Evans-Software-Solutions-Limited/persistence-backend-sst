import { useCallback, useMemo, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useGetMeals } from "@/ui/hooks/useGetMeals";
import { useGetRecipes } from "@/ui/hooks/useGetRecipes";
import { useLogEntries } from "@/ui/hooks/useLogEntries";
import { useMealQuickActions } from "@/ui/hooks/useMealQuickActions";
import { useUserMeals } from "@/ui/hooks/useUserMeals";
import { useFuelSheets } from "@/state/fuel-sheets";
import { addDaysISO, localDayISO, loggedAtNoonUtc } from "@/shared/utils";
import {
  entryDisplayLabel,
  perServingDivisor,
  type EntryNameLookups,
} from "@/domain/services";
import {
  earlierDayGroups,
  findUserMeal,
  logTargetForUserMeal,
  relogInput,
  type EarlierDay,
} from "@/domain/services/userMeals.service";
import type { LogEntryInput, NutritionEntry } from "@/domain/models/nutrition";
import {
  AddToMealPresenter,
  type AddToMealTab,
  type PickGroupVM,
  type PickRowVM,
} from "@/ui/presenters/fuel/AddToMealPresenter";

/** How many earlier days "Copy from earlier days" looks back. */
export const EARLIER_DAYS = 7;

const SHORT_DAY = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
});

/** "Yesterday" or "Wed 21" for an earlier day. */
export function earlierDayLabel(iso: string, viewedIso: string): string {
  if (iso === addDaysISO(viewedIso, -1) && viewedIso === localDayISO()) {
    return "Yesterday";
  }
  return SHORT_DAY.format(new Date(`${iso}T12:00:00`)).replace(",", "");
}

/**
 * <AddToMealContainer> — the full-page Add to a meal (PER-132). Resolves the
 * meal from `?meal=` (a Your meals id, or `slot:<slot>` before the list is
 * fetched), aims the five quick buttons at it, and logs ticked Recent /
 * Saved meal / Recipe rows into it as one offline batch.
 */
export function AddToMealContainer() {
  const params = useLocalSearchParams<{ meal?: string; tab?: string }>();
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const date = useFuelSheets((s) => s.date);
  const notifyMutated = useFuelSheets((s) => s.notifyMutated);

  const userMeals = useUserMeals();
  const savedMeals = useGetMeals();
  const recipes = useGetRecipes();
  const logEntries = useLogEntries();

  const mealKey = typeof params.meal === "string" ? params.meal : "";
  const meal =
    findUserMeal(userMeals.meals, mealKey) ??
    userMeals.meals.find((m) => `slot:${m.logSlot}` === mealKey) ??
    userMeals.meals[0];

  const quick = useMealQuickActions(meal ?? null);

  const [tab, setTab] = useState<AddToMealTab>(
    params.tab === "saved" || params.tab === "recipes" ? params.tab : "recent",
  );
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState(false);

  const recipeMap = useMemo(
    () => new Map((recipes.data ?? []).map((r) => [r.id, r])),
    [recipes.data],
  );
  const mealMap = useMemo(
    () => new Map((savedMeals.data ?? []).map((m) => [m.id, m])),
    [savedMeals.data],
  );
  const lookups: EntryNameLookups = useMemo(
    () => ({
      food: (id) => storage.getCachedFoodById(id)?.name,
      recipe: (id) => recipeMap.get(id)?.name,
      meal: (id) => mealMap.get(id)?.name,
    }),
    [storage, recipeMap, mealMap],
  );

  // Earlier days from the offline day cache (no network).
  const groups = useMemo(() => {
    if (!userId) return [];
    const days: EarlierDay[] = Array.from({ length: EARLIER_DAYS }, (_, i) => {
      const iso = addDaysISO(date, -(i + 1));
      return {
        iso,
        label: earlierDayLabel(iso, date),
        fuel: storage.getCachedFuelToday(userId, iso),
      };
    });
    return earlierDayGroups(days, userMeals.meals);
  }, [userId, date, storage, userMeals.meals]);

  const entryByKey = useMemo(() => {
    const m = new Map<string, NutritionEntry>();
    for (const g of groups) for (const e of g.entries) m.set(`e:${e.id}`, e);
    return m;
  }, [groups]);

  const recentGroups: PickGroupVM[] = groups.map((g) => ({
    key: g.key,
    heading: g.heading,
    rows: g.entries.map((e) => ({
      key: `e:${e.id}`,
      name: entryDisplayLabel(e, lookups),
      sub: `${e.servings} ${e.servings === 1 ? "serving" : "servings"}`,
      kcal: e.kcal,
      selected: selected.has(`e:${e.id}`),
    })),
  }));
  const savedRows: PickRowVM[] = (savedMeals.data ?? []).map((m) => ({
    key: `m:${m.id}`,
    name: m.name,
    sub: "Saved meal",
    kcal: m.totalKcal,
    selected: selected.has(`m:${m.id}`),
  }));
  const recipeRows: PickRowVM[] = (recipes.data ?? []).map((r) => ({
    key: `r:${r.id}`,
    name: r.name,
    sub: "Recipe · 1 portion",
    kcal: (r.totalKcal ?? 0) / perServingDivisor(r.servings),
    selected: selected.has(`r:${r.id}`),
  }));

  const kcalFor = useCallback(
    (key: string): number => {
      if (key.startsWith("e:")) return entryByKey.get(key)?.kcal ?? 0;
      if (key.startsWith("m:"))
        return mealMap.get(key.slice(2))?.totalKcal ?? 0;
      const r = recipeMap.get(key.slice(2));
      return r ? (r.totalKcal ?? 0) / perServingDivisor(r.servings) : 0;
    },
    [entryByKey, mealMap, recipeMap],
  );
  const totalKcal = [...selected].reduce((a, k) => a + kcalFor(k), 0);
  const count = selected.size;
  const addLabel =
    count === 0
      ? "Pick what to add"
      : `Add ${count} ${count === 1 ? "item" : "items"} · ${Math.round(totalKcal).toLocaleString("en-GB")} kcal`;

  const onToggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const onAddAll = useCallback(
    (groupKey: string) => {
      const g = groups.find((x) => x.key === groupKey);
      if (!g) return;
      setSelected((prev) => {
        const next = new Set(prev);
        for (const e of g.entries) next.add(`e:${e.id}`);
        return next;
      });
    },
    [groups],
  );

  const onAdd = useCallback(async () => {
    if (!meal || selected.size === 0 || adding) return;
    setAdding(true);
    const target = logTargetForUserMeal(meal);
    const loggedAt = loggedAtNoonUtc(date);
    const inputs: LogEntryInput[] = [];
    for (const key of selected) {
      if (key.startsWith("e:")) {
        const e = entryByKey.get(key);
        if (e) inputs.push(relogInput(e, target, loggedAt));
      } else if (key.startsWith("m:")) {
        inputs.push({ ...target, mealId: key.slice(2), servings: 1, loggedAt });
      } else if (key.startsWith("r:")) {
        inputs.push({
          ...target,
          recipeId: key.slice(2),
          servings: 1,
          loggedAt,
        });
      }
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await logEntries.mutate(inputs);
    notifyMutated();
    setAdding(false);
    router.back();
  }, [meal, selected, adding, date, entryByKey, logEntries, notifyMutated]);

  return (
    <AddToMealPresenter
      mealName={meal?.name ?? ""}
      onBack={() => router.back()}
      quickActions={quick}
      tab={tab}
      onTab={setTab}
      recentGroups={recentGroups}
      savedRows={savedRows}
      recipeRows={recipeRows}
      onToggle={onToggle}
      onAddAll={onAddAll}
      addLabel={addLabel}
      canAdd={count > 0 && meal !== undefined}
      adding={adding}
      onAdd={() => void onAdd()}
    />
  );
}
