import { useCallback, useEffect, useMemo, useState } from "react";
import * as Haptics from "expo-haptics";
import { useFuelSheets } from "@/state/fuel-sheets";
import { useLogEntry } from "@/ui/hooks/useLogEntry";
import { useUserMeals } from "@/ui/hooks/useUserMeals";
import { loggedAtNoonUtc } from "@/shared/utils";
import {
  logTargetForUserMeal,
  quickLogDraft,
  type QuickLogValues,
} from "@/domain/services/userMeals.service";
import {
  QuickLogSheetPresenter,
  type QuickLogField,
} from "@/ui/presenters/fuel/QuickLogSheetPresenter";

const EMPTY: QuickLogValues = {
  name: "",
  kcal: "",
  protein: "",
  carbs: "",
  fat: "",
};

/**
 * <QuickLogSheetContainer> — root-mounted N2e Quick log (PER-132): a one-off
 * entry with typed calories (and optional name and macros), logged
 * offline-first into the chosen meal. The calories typed are what is logged.
 */
export function QuickLogSheetContainer() {
  const sheet = useFuelSheets((s) => s.sheet);
  const slot = useFuelSheets((s) => s.slot);
  const userMealId = useFuelSheets((s) => s.userMealId);
  const date = useFuelSheets((s) => s.date);
  const close = useFuelSheets((s) => s.close);
  const notifyMutated = useFuelSheets((s) => s.notifyMutated);
  const visible = sheet === "quickLog";
  const { meals } = useUserMeals(visible);
  const logEntry = useLogEntry();

  const [values, setValues] = useState<QuickLogValues>(EMPTY);
  const [mealKey, setMealKey] = useState<string>("");

  useEffect(() => {
    if (!visible) return;
    setValues(EMPTY);
    setMealKey(
      userMealId ??
        meals.find((m) => m.logSlot === slot)?.id ??
        meals[0]?.id ??
        "",
    );
    // Only on open: later list changes must not reset a half-typed form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const draft = useMemo(() => quickLogDraft(values), [values]);
  const meal = meals.find((m) => m.id === mealKey) ?? meals[0];

  const onClose = useCallback(() => {
    if (visible) close();
  }, [visible, close]);

  const onLog = useCallback(async () => {
    if (!draft.canLog || draft.kcal === null || !meal) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await logEntry.mutate({
      ...logTargetForUserMeal(meal),
      servings: 1,
      kcal: draft.kcal,
      proteinG: draft.proteinG,
      carbsG: draft.carbsG,
      fatG: draft.fatG,
      ...(draft.name ? { customName: draft.name } : {}),
      loggedAt: loggedAtNoonUtc(date),
    });
    notifyMutated();
    close();
  }, [draft, meal, logEntry, date, notifyMutated, close]);

  return (
    <QuickLogSheetPresenter
      visible={visible}
      onClose={onClose}
      values={values}
      onChange={(field: QuickLogField, value: string) =>
        setValues((v) => ({ ...v, [field]: value }))
      }
      meals={meals.map((m) => ({ key: m.id, label: m.name }))}
      selectedMealKey={meal?.id ?? ""}
      onSelectMeal={setMealKey}
      warning={
        draft.mismatch && draft.kcal !== null && draft.macroKcal !== null
          ? `Your macros add up to ${draft.macroKcal} kcal. We'll log the ${Math.round(draft.kcal)} you typed.`
          : null
      }
      kcalLabel={
        draft.kcal !== null && draft.kcal > 0
          ? Math.round(draft.kcal).toLocaleString("en-GB")
          : ""
      }
      mealLabel={meal?.name ?? ""}
      canLog={draft.canLog && meal !== undefined}
      onLog={() => void onLog()}
    />
  );
}
