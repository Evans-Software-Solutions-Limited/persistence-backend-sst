import { useCallback, useEffect, useMemo, useState } from "react";
import * as Haptics from "expo-haptics";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useFuelSheets } from "@/state/fuel-sheets";
import { useGetMeals } from "@/ui/hooks/useGetMeals";
import { useSearchFoods } from "@/ui/hooks/useSearchFoods";
import { useLogEntry } from "@/ui/hooks/useLogEntry";
import { useNutritionAiGate } from "@/ui/hooks/useNutritionAiGate";
import { localDayISO } from "@/shared/utils";
import {
  MEAL_SLOTS,
  entryDisplayLabel,
  type EntryNameLookups,
} from "@/domain/services";
import type { Food, MealSlot } from "@/domain/models/nutrition";
import {
  QuickAddSheetPresenter,
  type QuickAddMeal,
  type QuickAddYesterday,
} from "@/ui/presenters/QuickAddSheetPresenter";

/**
 * <QuickAddSheetContainer> — the per-meal Quick-add menu (fuel-sheets.jsx
 * QuickAddSheet). Surfaces "same as yesterday" (re-logs yesterday's entries for
 * the slot), saved meals (one-tap log), and the new-food action tiles. The
 * Search tile opens a functional food-search stage. Snap is the locked Tier-B
 * affordance (routes to upgrade); Scan hands off to the barcode sheet.
 *
 * Implements: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § <QuickAddSheet>
 */

/** YYYY-MM-DD for the day before `dayIso`. */
function previousDayISO(dayIso: string): string {
  const d = new Date(`${dayIso}T00:00:00`);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function QuickAddSheetContainer() {
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const sheet = useFuelSheets((s) => s.sheet);
  const slotFromStore = useFuelSheets((s) => s.slot);
  const close = useFuelSheets((s) => s.close);
  const openScan = useFuelSheets((s) => s.openScan);
  const notifyMutated = useFuelSheets((s) => s.notifyMutated);
  const visible = sheet === "quickAdd";

  const meals = useGetMeals();
  const logEntry = useLogEntry();
  const aiGate = useNutritionAiGate();

  const [stage, setStage] = useState<"menu" | "search">("menu");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Food | null>(null);
  const [servings, setServings] = useState(1);
  const [slot, setSlot] = useState<MealSlot>(slotFromStore);

  const search = useSearchFoods(query);

  useEffect(() => {
    if (visible) {
      setStage("menu");
      setQuery("");
      setSelected(null);
      setServings(1);
      setSlot(slotFromStore);
    }
  }, [visible, slotFromStore]);

  const mealLabel = MEAL_SLOTS.find((m) => m.slot === slot)?.label ?? "Meal";

  const lookups: EntryNameLookups = useMemo(
    () => ({
      food: (id) => storage.getCachedFoodById(id)?.name,
      recipe: (id) =>
        userId
          ? (storage.getCachedRecipe(userId, id)?.name ?? undefined)
          : undefined,
      meal: (id) =>
        userId
          ? (storage.getCachedMeals(userId).find((m) => m.id === id)?.name ??
            undefined)
          : undefined,
    }),
    [storage, userId],
  );

  // "From yesterday" for this slot, read straight from the cached day aggregate.
  const yesterday: QuickAddYesterday | null = useMemo(() => {
    if (!userId || !visible) return null;
    const prev = storage.getCachedFuelToday(
      userId,
      previousDayISO(localDayISO()),
    );
    const entries = prev?.entriesBySlot[slot] ?? [];
    if (entries.length === 0) return null;
    return {
      items: entries.map((e) => entryDisplayLabel(e, lookups)),
      kcal: entries.reduce((a, e) => a + e.kcal, 0),
    };
  }, [storage, userId, visible, slot, lookups]);

  const savedMeals: QuickAddMeal[] = useMemo(
    () =>
      (meals.data ?? []).map((m) => ({
        id: m.id,
        name: m.name,
        kcal: m.totalKcal,
      })),
    [meals.data],
  );

  const loggedAt = () => new Date(`${localDayISO()}T12:00:00`).toISOString();

  const onLogYesterday = useCallback(async () => {
    if (!userId) return;
    const prev = storage.getCachedFuelToday(
      userId,
      previousDayISO(localDayISO()),
    );
    const entries = prev?.entriesBySlot[slot] ?? [];
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    for (const e of entries) {
      await logEntry.mutate({
        foodId: e.foodId ?? undefined,
        recipeId: e.recipeId ?? undefined,
        mealId: e.mealId ?? undefined,
        mealSlot: slot,
        servings: e.servings,
        loggedAt: loggedAt(),
      });
    }
    notifyMutated();
    close();
  }, [storage, userId, slot, logEntry, notifyMutated, close]);

  const onLogMeal = useCallback(
    async (id: string) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await logEntry.mutate({
        mealId: id,
        mealSlot: slot,
        servings: 1,
        loggedAt: loggedAt(),
      });
      notifyMutated();
      close();
    },
    [slot, logEntry, notifyMutated, close],
  );

  const onAdd = useCallback(async () => {
    if (!selected) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await logEntry.mutate({
      foodId: selected.id,
      mealSlot: slot,
      servings,
      loggedAt: loggedAt(),
    });
    notifyMutated();
    close();
  }, [selected, slot, servings, logEntry, notifyMutated, close]);

  return (
    <QuickAddSheetPresenter
      visible={visible}
      onClose={close}
      mealLabel={mealLabel}
      stage={stage}
      aiLocked={!aiGate.allowed}
      yesterday={yesterday}
      savedMeals={savedMeals}
      onLogYesterday={() => void onLogYesterday()}
      onLogMeal={(id) => void onLogMeal(id)}
      onScan={() => {
        close();
        openScan(slot);
      }}
      onSnap={() => aiGate.gateProps.onUpgrade()}
      onSearch={() => setStage("search")}
      onManual={() => setStage("search")}
      query={query}
      onQueryChange={setQuery}
      results={search.results}
      isSearching={search.isSearching}
      selected={selected}
      onSelect={setSelected}
      onClearSelection={() => setSelected(null)}
      servings={servings}
      onServingsChange={setServings}
      slot={slot}
      onSlotChange={setSlot}
      onAdd={() => void onAdd()}
      onBackToMenu={() => {
        setStage("menu");
        setSelected(null);
        setQuery("");
      }}
    />
  );
}
