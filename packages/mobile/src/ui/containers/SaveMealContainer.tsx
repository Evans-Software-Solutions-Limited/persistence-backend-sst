import { useCallback, useMemo, useState } from "react";
import { router } from "expo-router";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useCreateMeal } from "@/ui/hooks/useCreateMeal";
import { localDayISO } from "@/shared/utils";
import {
  MEAL_SLOTS,
  entryDisplayLabel,
  type EntryNameLookups,
} from "@/domain/services";
import type { MealItemInput, NutritionEntry } from "@/domain/models/nutrition";
import {
  SaveMealPresenter,
  type SaveMealRowVM,
} from "@/ui/presenters/SaveMealPresenter";

/**
 * <SaveMealContainer> — "Save a meal" quick-save (recipes.jsx
 * `CreateMealManual`). Reads today + yesterday's cached day aggregate (same
 * cache `QuickAddSheetContainer`'s "from yesterday" affordance reads —
 * `storage.getCachedFuelToday`), presents every logged entry across both
 * days as a selectable row, and creates a meal from the ticked ones via
 * `useCreateMeal`.
 *
 * Implements: specs/milestones (Fuel → Recipes PR1 brief) § <SaveMealContainer>
 */

/** YYYY-MM-DD for the day before `dayIso` (UTC-anchored — mirrors
 * QuickAddSheetContainer's `previousDayISO`). */
function previousDayISO(dayIso: string): string {
  const d = new Date(`${dayIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

type CandidateRow = { entry: NutritionEntry; label: string };

export function SaveMealContainer() {
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const { mutate: createMeal } = useCreateMeal();

  const [name, setName] = useState("");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [isSaving, setIsSaving] = useState(false);

  const lookups: EntryNameLookups = useMemo(
    () => ({
      food: (fid) => storage.getCachedFoodById(fid)?.name,
      recipe: (rid) =>
        userId
          ? (storage.getCachedRecipe(userId, rid)?.name ?? undefined)
          : undefined,
      // Meal-referenced entries are filtered out of `candidates` below (a
      // MealItemInput can only ref a food/recipe), so `entryDisplayLabel`
      // never reaches the `mealId` branch and this resolver is never called.
      // Kept only because `EntryNameLookups` requires the field.
      meal: () => undefined,
    }),
    [storage, userId],
  );

  const candidates: CandidateRow[] = useMemo(() => {
    if (!userId) return [];
    const todayIso = localDayISO();
    const yesterdayIso = previousDayISO(todayIso);
    const days: { iso: string; label: string }[] = [
      { iso: todayIso, label: "Today" },
      { iso: yesterdayIso, label: "Yesterday" },
    ];
    const rows: CandidateRow[] = [];
    for (const day of days) {
      const aggregate = storage.getCachedFuelToday(userId, day.iso);
      if (!aggregate) continue;
      for (const slot of MEAL_SLOTS) {
        for (const entry of aggregate.entriesBySlot[slot.slot]) {
          // A meal item can only reference a food or a recipe (MealItemInput
          // carries no mealId, and macros materialise from those refs). Skip
          // entries with neither — a saved-meal log (mealId-only) or an
          // AI/custom macro entry — so we never build a ref-less item that the
          // backend would persist as a junk row contributing 0 macros.
          if (!entry.foodId && !entry.recipeId) continue;
          const itemName = entryDisplayLabel(entry, lookups);
          rows.push({
            entry,
            label: `${day.label} · ${slot.label} — ${itemName} · ${entry.kcal} kcal`,
          });
        }
      }
    }
    return rows;
  }, [storage, userId, lookups]);

  const rows: SaveMealRowVM[] = useMemo(
    () =>
      candidates.map((c) => ({
        entryId: c.entry.id,
        label: c.label,
        selected: selectedIds.has(c.entry.id),
      })),
    [candidates, selectedIds],
  );

  const onToggleRow = useCallback((entryId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }, []);

  const canSave = name.trim().length > 0 && selectedIds.size > 0;

  const onBack = useCallback(() => router.back(), []);

  const onSave = useCallback(async () => {
    if (!canSave) return;
    const selected = candidates.filter((c) => selectedIds.has(c.entry.id));
    const items: MealItemInput[] = selected.map((c, i) => ({
      foodId: c.entry.foodId ?? undefined,
      recipeId: c.entry.recipeId ?? undefined,
      servings: c.entry.servings,
      sortOrder: i,
    }));
    setIsSaving(true);
    try {
      const meal = await createMeal({ name: name.trim(), items });
      if (meal !== null) router.back();
    } finally {
      setIsSaving(false);
    }
  }, [canSave, candidates, selectedIds, name, createMeal]);

  return (
    <SaveMealPresenter
      name={name}
      onNameChange={setName}
      rows={rows}
      onToggleRow={onToggleRow}
      canSave={canSave}
      isSaving={isSaving}
      onSave={() => void onSave()}
      onBack={onBack}
    />
  );
}
