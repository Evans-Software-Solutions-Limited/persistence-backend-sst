import { useCallback, useEffect, useMemo, useState } from "react";
import * as Haptics from "expo-haptics";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useFuelSheets } from "@/state/fuel-sheets";
import { useGetMeals } from "@/ui/hooks/useGetMeals";
import { useGetRecipes } from "@/ui/hooks/useGetRecipes";
import { useSearchFoods } from "@/ui/hooks/useSearchFoods";
import { useLogEntry } from "@/ui/hooks/useLogEntry";
import { useNutritionAiGate } from "@/ui/hooks/useNutritionAiGate";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import {
  useAiDraftItems,
  draftItemsFromEstimate,
} from "@/ui/hooks/useAiDraftItems";
import {
  dayLabel,
  loggedAtNoonUtc,
  localDayISO,
  previousDayISO,
} from "@/shared/utils";
import {
  MEAL_SLOTS,
  entryDisplayLabel,
  perServingDivisor,
  type EntryNameLookups,
} from "@/domain/services";
import type { Food, MealSlot } from "@/domain/models/nutrition";
import {
  QuickAddSheetPresenter,
  type QuickAddMeal,
  type QuickAddRecipe,
  type QuickAddStage,
  type QuickAddYesterday,
} from "@/ui/presenters/QuickAddSheetPresenter";

/**
 * <QuickAddSheetContainer> — the per-meal Quick-add menu (fuel-sheets.jsx
 * QuickAddSheet). Surfaces "same as yesterday" (re-logs yesterday's entries for
 * the slot), saved meals (one-tap log), and the new-food action tiles. The
 * Search tile opens a functional food-search stage. Snap hands off to the
 * root-mounted Snap sheet (gate-checked here); "Or describe it…" is the
 * M9.5 STORY-012 free-text AI flow, sharing the same `useAiDraftItems`
 * confirm logic and <AiDraftConfirmPresenter> UI as the Snap sheet. Scan
 * hands off to the barcode sheet.
 *
 * Implements: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § <QuickAddSheet>
 *             specs/13-nutrition-tracking/design.md § Revised 2026-07-03 › Mobile flow
 *             specs/13-nutrition-tracking/tasks.md T-13.11.2
 */

export function QuickAddSheetContainer() {
  const { storage, api } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const sheet = useFuelSheets((s) => s.sheet);
  const slotFromStore = useFuelSheets((s) => s.slot);
  // The day this Quick-add flow logs into (QA-20) — kept in sync with the
  // Fuel screen's viewed day by <FuelContainer>, so a past-day view logs onto
  // that day rather than always today.
  const activeDate = useFuelSheets((s) => s.date);
  const close = useFuelSheets((s) => s.close);
  const openScan = useFuelSheets((s) => s.openScan);
  const openSnap = useFuelSheets((s) => s.openSnap);
  const notifyMutated = useFuelSheets((s) => s.notifyMutated);
  const visible = sheet === "quickAdd";

  // gorhom fires `onClose` on ANY close — including the CONTROLLED close that
  // happens when this sheet hands off to another (Quick-add → Scan/Snap flips
  // the shared store, so this sheet's `visible` drops to false and gorhom
  // animates it shut). Clearing the store unconditionally there would null
  // `sheet` right after `openScan`/`openSnap` set it, snapping the just-opened
  // sheet closed. Guard on `visible`: only a genuine dismiss (this sheet still
  // active) clears the store; a handoff is a no-op.
  const onSheetClose = useCallback(() => {
    if (visible) close();
  }, [visible, close]);

  const meals = useGetMeals();
  const recipes = useGetRecipes();
  const logEntry = useLogEntry();
  const aiGate = useNutritionAiGate();
  const online = useOnlineStatus();
  const describeDraft = useAiDraftItems();

  const [stage, setStage] = useState<QuickAddStage>("menu");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Food | null>(null);
  const [servings, setServings] = useState(1);
  const [slot, setSlot] = useState<MealSlot>(slotFromStore);
  const [describeText, setDescribeText] = useState("");
  const [isEstimatingText, setIsEstimatingText] = useState(false);
  const [describeError, setDescribeError] = useState<string | null>(null);
  const [describeAdded, setDescribeAdded] = useState(false);

  const search = useSearchFoods(query);

  const { setItems: setDescribeItems } = describeDraft;
  useEffect(() => {
    if (visible) {
      setStage("menu");
      setQuery("");
      setSelected(null);
      setServings(1);
      setSlot(slotFromStore);
      setDescribeText("");
      setIsEstimatingText(false);
      setDescribeError(null);
      setDescribeAdded(false);
      setDescribeItems([]);
    }
  }, [visible, slotFromStore, setDescribeItems]);

  const mealLabel = MEAL_SLOTS.find((m) => m.slot === slot)?.label ?? "Meal";
  // Day-context line (QA-20) — only surfaced on a past day, so the sheet
  // doesn't read as a blind add when the Fuel screen is viewing history.
  const dayContext =
    activeDate === localDayISO() ? undefined : dayLabel(activeDate);

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

  // "From yesterday" for this slot, read straight from the cached day
  // aggregate. Rebased to the day BEFORE the active day (QA-20 owner
  // decision) — on a past-day view this reads "the day before the day
  // you're viewing", not always literally yesterday.
  const yesterday: QuickAddYesterday | null = useMemo(() => {
    if (!userId || !visible) return null;
    const prev = storage.getCachedFuelToday(userId, previousDayISO(activeDate));
    const entries = prev?.entriesBySlot[slot] ?? [];
    if (entries.length === 0) return null;
    return {
      items: entries.map((e) => entryDisplayLabel(e, lookups)),
      kcal: entries.reduce((a, e) => a + e.kcal, 0),
    };
  }, [storage, userId, visible, slot, lookups, activeDate]);

  const savedMeals: QuickAddMeal[] = useMemo(
    () =>
      (meals.data ?? []).map((m) => ({
        id: m.id,
        name: m.name,
        kcal: m.totalKcal,
      })),
    [meals.data],
  );

  // Recipe `total_*` are WHOLE-recipe totals — a saved recipe's row shows the
  // PER-SERVING kcal (matches the Recipe library/detail per-serving fix),
  // guarding a zero/absent servings count.
  const savedRecipes: QuickAddRecipe[] = useMemo(
    () =>
      (recipes.data ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        kcal:
          r.totalKcal === null
            ? 0
            : Math.round(r.totalKcal / perServingDivisor(r.servings)),
      })),
    [recipes.data],
  );

  // Noon-UTC of the ACTIVE day (QA-20 — not always today): the sync-queue
  // command derives the cache day-key by slicing this ISO string, so
  // anchoring at noon UTC keeps the optimistic entry in the viewed day's
  // bucket for every timezone (a local-noon anchor drifts to the previous
  // day for tz > +12). See shared/utils/date.ts `loggedAtNoonUtc`.
  const loggedAt = loggedAtNoonUtc(activeDate);

  const onLogYesterday = useCallback(async () => {
    if (!userId) return;
    const prev = storage.getCachedFuelToday(userId, previousDayISO(activeDate));
    const entries = prev?.entriesBySlot[slot] ?? [];
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    for (const e of entries) {
      await logEntry.mutate({
        foodId: e.foodId ?? undefined,
        recipeId: e.recipeId ?? undefined,
        mealId: e.mealId ?? undefined,
        mealSlot: slot,
        servings: e.servings,
        loggedAt,
      });
    }
    notifyMutated();
    close();
  }, [
    storage,
    userId,
    slot,
    logEntry,
    notifyMutated,
    close,
    activeDate,
    loggedAt,
  ]);

  const onLogMeal = useCallback(
    async (id: string) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await logEntry.mutate({
        mealId: id,
        mealSlot: slot,
        servings: 1,
        loggedAt,
      });
      notifyMutated();
      close();
    },
    [slot, logEntry, notifyMutated, close, loggedAt],
  );

  const onLogRecipe = useCallback(
    async (id: string) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await logEntry.mutate({
        recipeId: id,
        mealSlot: slot,
        servings: 1,
        loggedAt,
      });
      notifyMutated();
      close();
    },
    [slot, logEntry, notifyMutated, close, loggedAt],
  );

  const onAdd = useCallback(async () => {
    if (!selected) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await logEntry.mutate({
      foodId: selected.id,
      mealSlot: slot,
      servings,
      loggedAt,
    });
    notifyMutated();
    close();
  }, [selected, slot, servings, logEntry, notifyMutated, close, loggedAt]);

  const onSubmitDescribe = useCallback(async () => {
    const description = describeText.trim();
    if (description.length === 0 || description.length > 1000) return;
    setIsEstimatingText(true);
    setDescribeError(null);
    const result = await api.estimateFromText({ description });
    setIsEstimatingText(false);
    if (!result.ok) {
      setDescribeError(
        result.error.status === 429
          ? "Daily AI limit reached — it resets tomorrow. Log with Quick Add instead."
          : "Couldn't estimate that — try rephrasing or use Quick Add instead.",
      );
      return;
    }
    setDescribeItems(draftItemsFromEstimate(result.value));
    setStage("describeConfirm");
  }, [api, describeText, setDescribeItems]);

  const { confirm: confirmDescribeDraft } = describeDraft;
  const onConfirmDescribe = useCallback(async () => {
    const count = await confirmDescribeDraft(slot);
    if (count === 0) return;
    notifyMutated();
    setDescribeAdded(true);
    setTimeout(() => {
      close();
    }, 900);
  }, [confirmDescribeDraft, slot, notifyMutated, close]);

  return (
    <QuickAddSheetPresenter
      visible={visible}
      onClose={onSheetClose}
      mealLabel={mealLabel}
      dayContext={dayContext}
      stage={stage}
      aiLocked={!aiGate.allowed}
      aiOffline={!online}
      yesterday={yesterday}
      savedMeals={savedMeals}
      savedRecipes={savedRecipes}
      onLogYesterday={() => void onLogYesterday()}
      onLogMeal={(id) => void onLogMeal(id)}
      onLogRecipe={(id) => void onLogRecipe(id)}
      onScan={() => {
        // No explicit close() — `openScan` flips the shared store to "scan",
        // which drops this sheet's `visible` to false (the guarded onSheetClose
        // then no-ops). Calling close() first would briefly null the store and
        // race the handoff.
        openScan(slot);
      }}
      onSnap={() => {
        if (!online) return;
        if (aiGate.allowed) {
          // Handoff to the Snap sheet, mirroring the Scan handoff above — no
          // explicit close() here either.
          openSnap(slot);
          return;
        }
        aiGate.gateProps.onUpgrade();
      }}
      onSearch={() => setStage("search")}
      onManual={() => setStage("search")}
      onDescribe={() => setStage("describe")}
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
      describeText={describeText}
      onDescribeTextChange={setDescribeText}
      isEstimatingText={isEstimatingText}
      describeError={describeError}
      onSubmitDescribe={() => void onSubmitDescribe()}
      describeItems={describeDraft.items}
      onToggleDescribeItem={describeDraft.onToggleItem}
      onEditDescribeGrams={describeDraft.onEditGrams}
      describeTotalKcal={describeDraft.totalKcal}
      describeAdded={describeAdded}
      describeConfirming={describeDraft.confirming}
      onConfirmDescribe={() => void onConfirmDescribe()}
    />
  );
}
