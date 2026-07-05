import { useCallback, useEffect, useMemo, useState } from "react";
import * as Haptics from "expo-haptics";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useFuelSheets } from "@/state/fuel-sheets";
import { useGetMeals } from "@/ui/hooks/useGetMeals";
import { useSearchFoods } from "@/ui/hooks/useSearchFoods";
import { useLogEntry } from "@/ui/hooks/useLogEntry";
import { useNutritionAiGate } from "@/ui/hooks/useNutritionAiGate";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import {
  useAiDraftItems,
  draftItemsFromEstimate,
} from "@/ui/hooks/useAiDraftItems";
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

/** YYYY-MM-DD for the day before `dayIso` (UTC-anchored so it can't double-step
 * for positive UTC offsets — parsing `${dayIso}T00:00:00` as local time then
 * re-serialising to UTC already rolls the date back east of UTC). */
function previousDayISO(dayIso: string): string {
  const d = new Date(`${dayIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function QuickAddSheetContainer() {
  const { storage, api } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const sheet = useFuelSheets((s) => s.sheet);
  const slotFromStore = useFuelSheets((s) => s.slot);
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

  // Noon-UTC of the user-local day (matches the habit-completion pattern): the
  // sync-queue command derives the cache day-key by slicing this ISO string, so
  // anchoring at noon UTC keeps the optimistic entry in TODAY's bucket for every
  // timezone (a local-noon anchor drifts to the previous day for tz > +12).
  const loggedAt = () => `${localDayISO()}T12:00:00.000Z`;

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

  const onSubmitDescribe = useCallback(async () => {
    const description = describeText.trim();
    if (description.length === 0 || description.length > 1000) return;
    setIsEstimatingText(true);
    setDescribeError(null);
    const result = await api.estimateFromText({ description });
    setIsEstimatingText(false);
    if (!result.ok) {
      setDescribeError(
        "Couldn't estimate that — try rephrasing or use Quick Add instead.",
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
      stage={stage}
      aiLocked={!aiGate.allowed}
      aiOffline={!online}
      yesterday={yesterday}
      savedMeals={savedMeals}
      onLogYesterday={() => void onLogYesterday()}
      onLogMeal={(id) => void onLogMeal(id)}
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
      onConfirmDescribe={() => void onConfirmDescribe()}
    />
  );
}
