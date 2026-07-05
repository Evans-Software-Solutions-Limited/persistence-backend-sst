import { useCallback, useState } from "react";
import * as Haptics from "expo-haptics";
import { rescaleAiFoodItem, sumKeptAiItemsKcal } from "@/domain/services";
import { localDayISO } from "@/shared/utils";
import type { AiEstimate, MealSlot } from "@/domain/models/nutrition";
import type { AiDraftItem } from "@/ui/presenters/AiDraftConfirmPresenter";
import { useLogEntry } from "./useLogEntry";

/**
 * Shared draft-item state + confirm logic for the M9.5 Tier B AI estimate
 * confirm stage — used by BOTH the Snap (photo) sheet container and the
 * Quick-add free-text ("Or describe it…") container so the toggle/edit/log
 * logic isn't duplicated (mirrors the presenter-level extraction in
 * <AiDraftConfirmPresenter>).
 *
 * Confirm logs ONE entry per KEPT item via the SAME `useLogEntry` command
 * path QuickAdd uses for manual/custom foods (a one-off entry — no
 * `foodId`/`recipeId`/`mealId` reference — carrying the item's own
 * kcal/macros). The shipped `POST /nutrition/entries` schema has no
 * `customName`/`aiEstimated`/`aiConfidence` fields (verified against
 * `nutritionEntriesCreateHandler.ts`'s `t.Object` body), so those are NOT
 * sent — per the brief, we don't invent new backend fields.
 *
 * Implements: specs/13-nutrition-tracking/design.md § Revised 2026-07-03
 *             › Mobile flow (SnapAISheet)
 */

const CONFIDENCE_AUTO_TICK_THRESHOLD = 0.7;

export function draftItemsFromEstimate(estimate: AiEstimate): AiDraftItem[] {
  return estimate.foods.map((f) => ({
    ...f,
    on: f.confidence >= CONFIDENCE_AUTO_TICK_THRESHOLD,
  }));
}

export type UseAiDraftItems = {
  items: AiDraftItem[];
  setItems: (items: AiDraftItem[]) => void;
  totalKcal: number;
  onToggleItem: (index: number) => void;
  onEditGrams: (index: number, grams: number) => void;
  /** Logs one entry per kept item into `slot`, then resolves. Returns the
   * number of entries created (0 when nothing is kept — no-op). */
  confirm: (slot: MealSlot) => Promise<number>;
};

export function useAiDraftItems(): UseAiDraftItems {
  const logEntry = useLogEntry();
  const [items, setItems] = useState<AiDraftItem[]>([]);

  const onToggleItem = useCallback((index: number) => {
    setItems((prev) =>
      prev.map((it, i) => (i === index ? { ...it, on: !it.on } : it)),
    );
  }, []);

  const onEditGrams = useCallback((index: number, grams: number) => {
    setItems((prev) =>
      prev.map((it, i) =>
        i === index ? { ...rescaleAiFoodItem(it, grams), on: it.on } : it,
      ),
    );
  }, []);

  const confirm = useCallback(
    async (slot: MealSlot) => {
      const kept = items.filter((i) => i.on);
      if (kept.length === 0) return 0;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const loggedAt = `${localDayISO()}T12:00:00.000Z`;
      for (const item of kept) {
        await logEntry.mutate({
          mealSlot: slot,
          servings: 1,
          kcal: item.kcal,
          proteinG: item.proteinG,
          carbsG: item.carbsG,
          fatG: item.fatG,
          loggedAt,
        });
      }
      return kept.length;
    },
    [items, logEntry],
  );

  return {
    items,
    setItems,
    totalKcal: sumKeptAiItemsKcal(items),
    onToggleItem,
    onEditGrams,
    confirm,
  };
}
