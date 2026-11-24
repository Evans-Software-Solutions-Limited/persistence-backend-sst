import { useCallback, useEffect, useMemo, useState } from "react";
import * as Haptics from "expo-haptics";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useLogEntries } from "@/ui/hooks/useLogEntries";
import { useUserMeals } from "@/ui/hooks/useUserMeals";
import { useFuelSheets } from "@/state/fuel-sheets";
import { addDaysISO, localDayISO, loggedAtNoonUtc } from "@/shared/utils";
import {
  activeUserMeals,
  logTargetForUserMeal,
} from "@/domain/services/userMeals.service";
import type { LogEntryInput } from "@/domain/models/nutrition";
import {
  LogMealSheetPresenter,
  type LogMealField,
} from "@/ui/presenters/fuel/LogMealSheetPresenter";
import { mealForNow } from "./MealsTabContainer";

/**
 * <LogMealSheetContainer> — canvas N14 (PER-133): logs a saved meal or a
 * recipe to a day (today or the six before it), into one of Your meals, at a
 * portion. It is one entry, as every other saved-meal/recipe log.
 */

export type LogMealItem = {
  kind: "meal" | "recipe";
  id: string;
  name: string;
  /** Kcal of one portion (a whole saved meal, or one recipe serving). */
  kcal: number;
};

export type LogMealSheetContainerProps = {
  visible: boolean;
  item: LogMealItem | null;
  onClose: () => void;
  /** Called after the entry is written (the detail page goes back). */
  onLogged: () => void;
};

/** How many days the Day field offers, today included. */
export const LOG_DAYS = 7;
export const PORTIONS = [0.5, 1, 1.5, 2, 3] as const;

const SHORT_DAY = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
});
const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");

/** "Today", "Yesterday", "Wed 21". */
export function logDayLabel(iso: string, today: string): string {
  if (iso === today) return "Today";
  if (iso === addDaysISO(today, -1)) return "Yesterday";
  return SHORT_DAY.format(new Date(`${iso}T12:00:00`)).replace(",", "");
}

export function LogMealSheetContainer({
  visible,
  item,
  onClose,
  onLogged,
}: LogMealSheetContainerProps) {
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const viewedDate = useFuelSheets((s) => s.date);
  const notifyMutated = useFuelSheets((s) => s.notifyMutated);
  const userMeals = useUserMeals();
  const logEntries = useLogEntries();

  const today = localDayISO();
  const meals = useMemo(
    () => activeUserMeals(userMeals.meals),
    [userMeals.meals],
  );

  const [dayIso, setDayIso] = useState(viewedDate);
  const [mealId, setMealId] = useState<string | null>(null);
  const [portion, setPortion] = useState(1);
  const [openField, setOpenField] = useState<LogMealField | null>(null);
  const [logging, setLogging] = useState(false);

  // Every open starts on the day Fuel is showing, the meal for the time of
  // day and one portion.
  useEffect(() => {
    if (!visible) return;
    // Only a day the sheet offers (Inspector Brad, #554).
    const oldest = addDaysISO(today, -(LOG_DAYS - 1));
    setDayIso(
      viewedDate > today ? today : viewedDate < oldest ? today : viewedDate,
    );
    setMealId(null);
    setPortion(1);
    setOpenField(null);
  }, [visible, viewedDate, today]);

  const meal =
    meals.find((m) => m.id === mealId) ?? mealForNow(meals, new Date());

  const dayOptions = useMemo(
    () =>
      Array.from({ length: LOG_DAYS }, (_, i) => {
        const iso = addDaysISO(today, -i);
        return { key: iso, label: logDayLabel(iso, today) };
      }),
    [today],
  );

  const kcal = (item?.kcal ?? 0) * portion;

  const note = useMemo(() => {
    const base = `${fmt(kcal)} kcal`;
    if (!userId) return `${base}.`;
    const day = storage.getCachedFuelToday(userId, dayIso);
    const target =
      day?.targets?.dailyKcal ??
      storage.getCachedNutritionTarget(userId)?.dailyKcal ??
      null;
    if (!day || target === null) return `${base}.`;
    const when =
      dayIso === today ? "today" : `on ${logDayLabel(dayIso, today)}`;
    const left = target - day.consumed.kcal - kcal;
    return left >= 0
      ? `${base} · leaves ${fmt(left)} ${when}.`
      : `${base} · ${fmt(-left)} over ${when}.`;
  }, [kcal, userId, storage, dayIso, today]);

  const onToggleField = useCallback((field: LogMealField) => {
    setOpenField((cur) => (cur === field ? null : field));
  }, []);

  const onPick = useCallback((field: LogMealField, key: string) => {
    if (field === "day") setDayIso(key);
    else if (field === "meal") setMealId(key);
    else setPortion(Number(key));
    setOpenField(null);
  }, []);

  const onLog = useCallback(async () => {
    if (!item || !meal || logging) return;
    setLogging(true);
    const input: LogEntryInput = {
      ...logTargetForUserMeal(meal),
      ...(item.kind === "meal" ? { mealId: item.id } : { recipeId: item.id }),
      servings: portion,
      loggedAt: loggedAtNoonUtc(dayIso),
    };
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await logEntries.mutate([input]);
      notifyMutated();
      onLogged();
    } finally {
      setLogging(false);
    }
  }, [
    item,
    meal,
    logging,
    portion,
    dayIso,
    logEntries,
    notifyMutated,
    onLogged,
  ]);

  return (
    <LogMealSheetPresenter
      visible={visible}
      onClose={onClose}
      name={item?.name ?? ""}
      day={{ options: dayOptions, selectedKey: dayIso }}
      meal={{
        options: meals.map((m) => ({ key: m.id, label: m.name })),
        selectedKey: meal?.id ?? "",
      }}
      portion={{
        options: PORTIONS.map((p) => ({ key: String(p), label: `${p}×` })),
        selectedKey: String(portion),
      }}
      openField={openField}
      onToggleField={onToggleField}
      onPick={onPick}
      note={note}
      kcalLabel={fmt(kcal)}
      canLog={item !== null && meal !== null}
      logging={logging}
      onLog={() => void onLog()}
    />
  );
}
