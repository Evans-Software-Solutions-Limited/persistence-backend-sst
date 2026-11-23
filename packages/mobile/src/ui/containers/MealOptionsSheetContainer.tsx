import { useCallback, useMemo } from "react";
import { router, type Href } from "expo-router";
import * as Haptics from "expo-haptics";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useDeleteEntry } from "@/ui/hooks/useDeleteEntry";
import { useUserMeals } from "@/ui/hooks/useUserMeals";
import { useFuelSheets } from "@/state/fuel-sheets";
import { groupEntriesByUserMeal } from "@/domain/services/userMeals.service";
import { MealOptionsSheetPresenter } from "@/ui/presenters/fuel/MealOptionsSheetPresenter";

/**
 * <MealOptionsSheetContainer> — root-mounted ⋯ menu for one meal on the viewed
 * day (PER-132, canvas N1).
 *
 * - Copy from earlier days → Add to a meal, on Recent.
 * - Save as a meal → the Save a meal screen with this meal's entries ticked.
 * - Edit your meals → N1b.
 * - Clear → removes this meal's entries for the day (offline-first, like a
 *   swipe delete).
 */
export function MealOptionsSheetContainer() {
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const sheet = useFuelSheets((s) => s.sheet);
  const mealKey = useFuelSheets((s) => s.optionsMealKey);
  const date = useFuelSheets((s) => s.date);
  const close = useFuelSheets((s) => s.close);
  const openYourMeals = useFuelSheets((s) => s.openYourMeals);
  const notifyMutated = useFuelSheets((s) => s.notifyMutated);
  const visible = sheet === "mealOptions";
  const { meals } = useUserMeals(false);
  const deleteEntry = useDeleteEntry();

  const group = useMemo(() => {
    if (!visible || !userId || !mealKey) return null;
    const fuel = storage.getCachedFuelToday(userId, date);
    const entries = fuel ? Object.values(fuel.entriesBySlot).flat() : [];
    return (
      groupEntriesByUserMeal(entries, meals).find(
        (g) => g.meal.id === mealKey,
      ) ?? null
    );
  }, [visible, userId, mealKey, storage, date, meals]);

  const onClose = useCallback(() => {
    if (visible) close();
  }, [visible, close]);

  const mealName = group?.meal.name ?? "";
  const entries = group?.entries ?? [];

  return (
    <MealOptionsSheetPresenter
      visible={visible}
      onClose={onClose}
      mealName={mealName}
      hasEntries={entries.length > 0}
      onCopy={() => {
        close();
        if (mealKey) {
          router.push(
            `/(app)/fuel/add-to-meal?meal=${encodeURIComponent(mealKey)}&tab=recent` as Href,
          );
        }
      }}
      onSaveAsMeal={() => {
        close();
        router.push({
          pathname: "/(app)/fuel/save-meal",
          params: {
            name: mealName,
            entryIds: entries
              .filter((e) => !e.mealId)
              .map((e) => e.id)
              .join(","),
          },
        } as Href);
      }}
      onEditMeals={openYourMeals}
      onClear={() => {
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Warning,
        );
        close();
        void Promise.all(
          entries.map((e) => deleteEntry.mutate({ id: e.id, date })),
        ).then(() => notifyMutated());
        notifyMutated();
      }}
    />
  );
}
