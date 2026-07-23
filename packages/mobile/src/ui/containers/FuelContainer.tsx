import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScrollView } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useScrollToTopOnTabPress } from "@/ui/hooks/useScrollToTopOnTabPress";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useDashboard } from "@/ui/hooks/useDashboard";
import { useGetFuelToday } from "@/ui/hooks/useGetFuelToday";
import { useRefreshOnFocus } from "@/ui/hooks/useRefreshOnFocus";
import { useGetRecipes } from "@/ui/hooks/useGetRecipes";
import { useGetMeals } from "@/ui/hooks/useGetMeals";
import { useSetWater } from "@/ui/hooks/useSetWater";
import { useDeleteEntry } from "@/ui/hooks/useDeleteEntry";
import { useNutritionAiGate } from "@/ui/hooks/useNutritionAiGate";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import { useFuelSheets } from "@/state/fuel-sheets";
import {
  addDaysISO,
  dayLabel,
  localDayISO,
  preferredVolumeUnit,
  previousDayISO,
} from "@/shared/utils";
import { toneHex } from "@/ui/components/foundation/tones";
import {
  MEAL_SLOTS,
  detectDailyGoalHit,
  entryDisplayLabel,
  heroRingPct,
  macroPct,
  type EntryNameLookups,
} from "@/domain/services";
import type { MealSlot } from "@/domain/models/nutrition";
import { FuelPresenter } from "@/ui/presenters/FuelPresenter";
import type { MacroLineVM } from "@/ui/presenters/MacroHeroPresenter";
import type { MealSlotVM } from "@/ui/presenters/MealLogPresenter";

/**
 * <FuelContainer> — wires the cache-first day aggregate + water mutation + AI
 * gate + the root sheet store into the pure <FuelPresenter>. Resolves each
 * logged entry's display name from the local caches (the backend aggregate
 * carries none) and fires the immediate goal-hit reward (haptic + ring glow) the
 * moment the day enters the target band.
 *
 * Implements: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § <FuelContainer>
 */

const MACRO_COLORS = {
  protein: toneHex("primary").base,
  carbs: toneHex("gold").base,
  fat: toneHex("ember").base,
};

export function FuelContainer() {
  const router = useRouter();
  const { storage } = useAdapters();

  const scrollRef = useRef<ScrollView>(null);
  useScrollToTopOnTabPress(scrollRef);

  // The viewed day (QA-19). Starts on today; prev/next chevrons + the
  // calendar picker step it, clamped to <= today (Tier A is past+today only —
  // FRONTEND_BRIEF § day-picker post-M9, revised for BRIEF-7). Everything
  // downstream (useGetFuelToday, water/delete mutations, the sheet store) is
  // already date-parameterised, so re-pointing this one piece of state is
  // the whole day-nav wiring.
  const [date, setDate] = useState(localDayISO());
  const todayIso = localDayISO();
  const canGoNext = date < todayIso;

  const [calendarOpen, setCalendarOpen] = useState(false);

  const fuel = useGetFuelToday(date);
  // Kept-alive tab — re-pull the day's fuel on re-entry so totals/water/macros
  // reflect logs made elsewhere (skips the mount focus). `fuel.refresh` is a
  // stable callback from useGetFuelToday.
  const refreshFuel = fuel.refresh;
  const onFocusRefreshFuel = useCallback(() => {
    void refreshFuel();
  }, [refreshFuel]);
  useRefreshOnFocus(onFocusRefreshFuel);
  // Device-QA #5/#7 — the water tracker's display unit follows the user's
  // `preferredUnits` (metric/imperial), defaulting to litres. Reuses the
  // already-cached dashboard payload (Home's data source) rather than adding
  // a new field/endpoint — cache-first, so this is at worst a background
  // refresh already covered by Home's own read of the same cache.
  const dashboard = useDashboard();
  const volumeUnit = preferredVolumeUnit(
    dashboard.payload?.profile.preferredUnits,
  );
  const recipes = useGetRecipes();
  const meals = useGetMeals();
  const setWater = useSetWater();
  const deleteEntry = useDeleteEntry();
  const aiGate = useNutritionAiGate();
  const online = useOnlineStatus();
  const openScan = useFuelSheets((s) => s.openScan);
  const openQuickAdd = useFuelSheets((s) => s.openQuickAdd);
  const openSnap = useFuelSheets((s) => s.openSnap);
  const sheetRev = useFuelSheets((s) => s.rev);
  const setActiveDate = useFuelSheets((s) => s.setDate);

  // Keep the shared sheet store's active day in sync with the day being
  // viewed (QA-20) — Scan/Quick-add/Snap AND the pushed Recipe/Meal-detail
  // routes all read `useFuelSheets().date` for `loggedAt`, so this is the
  // single point where "which day am I logging to" gets threaded out of the
  // Fuel screen's own state.
  useEffect(() => {
    setActiveDate(date);
  }, [date, setActiveDate]);

  const onPrevDay = useCallback(() => {
    setDate((d) => previousDayISO(d));
  }, []);
  const onNextDay = useCallback(() => {
    setDate((d) => (d < localDayISO() ? addDaysISO(d, 1) : d));
  }, []);
  const onOpenCalendar = useCallback(() => setCalendarOpen(true), []);
  const onCloseCalendar = useCallback(() => setCalendarOpen(false), []);
  const onSelectDate = useCallback((iso: string) => {
    const today = localDayISO();
    setDate(iso > today ? today : iso);
    setCalendarOpen(false);
  }, []);

  const data = fuel.data;
  const target = data?.targets ?? null;

  // Name lookups for the meal log — recipes/meals from their cached lists, foods
  // by id from the offline food cache (entries reference ids, not names).
  const recipeMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of recipes.data ?? []) m.set(r.id, r.name);
    return m;
  }, [recipes.data]);
  const mealMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const meal of meals.data ?? []) m.set(meal.id, meal.name);
    return m;
  }, [meals.data]);

  const lookups: EntryNameLookups = useMemo(
    () => ({
      food: (id) => storage.getCachedFoodById(id)?.name,
      recipe: (id) => recipeMap.get(id),
      meal: (id) => mealMap.get(id),
    }),
    [storage, recipeMap, mealMap],
  );

  const slots: MealSlotVM[] = useMemo(() => {
    return MEAL_SLOTS.map(({ slot, label }) => {
      const entries = data?.entriesBySlot[slot] ?? [];
      const kcal = entries.reduce((a, e) => a + e.kcal, 0);
      return {
        slot,
        label,
        kcal,
        rows: entries.map((e) => ({
          id: e.id,
          name: entryDisplayLabel(e, lookups),
          sub: `${e.servings} ${e.servings === 1 ? "serving" : "servings"}`,
          kcal: e.kcal,
          proteinG: e.proteinG,
          carbsG: e.carbsG,
          fatG: e.fatG,
        })),
      };
    });
  }, [data, lookups]);

  const consumed = useMemo(
    () =>
      data?.consumed ?? {
        kcal: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        waterCups: 0,
      },
    [data],
  );

  const macros: MacroLineVM[] = useMemo(
    () => [
      {
        label: "Protein",
        value: consumed.proteinG,
        target: target?.proteinG ?? 0,
        color: MACRO_COLORS.protein,
        pct: macroPct(consumed.proteinG, target?.proteinG ?? 0),
      },
      {
        label: "Carbs",
        value: consumed.carbsG,
        target: target?.carbsG ?? 0,
        color: MACRO_COLORS.carbs,
        pct: macroPct(consumed.carbsG, target?.carbsG ?? 0),
      },
      {
        label: "Fat",
        value: consumed.fatG,
        target: target?.fatG ?? 0,
        color: MACRO_COLORS.fat,
        pct: macroPct(consumed.fatG, target?.fatG ?? 0),
      },
    ],
    [consumed.proteinG, consumed.carbsG, consumed.fatG, target],
  );

  const goalHit = useMemo(
    () => detectDailyGoalHit(consumed, target),
    [consumed, target],
  );

  // Immediate goal-hit reward: fire a success haptic on the false→true edge of
  // the all-macros-in-band verdict (FRONTEND_BRIEF § Immediate reward). The glow
  // (celebrate) is the live in-band state — it clears if later logging pushes
  // the day back out. Not a persistent streak (that's the cron's job).
  const prevHitRef = useRef(false);
  const hitBaselineRef = useRef(false);
  useEffect(() => {
    // Establish the baseline on the first render where the day aggregate is
    // actually LOADED — `data` is null on cold start until async auth resolves,
    // so banking the verdict at mount would treat the later null→in-band
    // hydration as a transition and fire a spurious success haptic on app open.
    if (!hitBaselineRef.current) {
      if (data !== null) {
        hitBaselineRef.current = true;
        prevHitRef.current = goalHit.all;
      }
      return;
    }
    if (goalHit.all && !prevHitRef.current) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    prevHitRef.current = goalHit.all;
  }, [goalHit.all, data]);

  // A sheet OR a pushed fuel route (Scan/QuickAdd/Snap sheets, the Targets
  // editor, recipe/meal logging) mutated fuel data → re-read the optimistic
  // cache + reconcile online. All those sites bump `sheetRev` via
  // `useFuelSheets().notifyMutated()`, so this single watcher covers them.
  const seenRevRef = useRef(sheetRev);
  useEffect(() => {
    if (seenRevRef.current === sheetRev) return;
    seenRevRef.current = sheetRev;
    fuel.reload();
    void fuel.refresh();
  }, [sheetRev, fuel]);

  const onSetWater = useCallback(
    (cups: number) => {
      const clamped = Math.max(0, cups);
      void Haptics.selectionAsync();
      void setWater.mutate({ date, cups: clamped }).then(() => fuel.reload());
      // Optimistic reflect immediately (offline-safe); reconcile online.
      fuel.reload();
    },
    [setWater, date, fuel],
  );

  // Swipe a logged entry left → tap the revealed Delete → optimistic remove.
  // The swipe+tap is the deliberate action (iOS-standard), so there's no extra
  // confirm dialog; the ring + slot totals reflect immediately off the cache and
  // the DELETE drains behind it.
  const onDeleteEntry = useCallback(
    (id: string, _slot: MealSlot) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      void deleteEntry.mutate({ id, date }).then(() => fuel.reload());
      // Optimistic reflect immediately (offline-safe); reconcile online.
      fuel.reload();
    },
    [deleteEntry, date, fuel],
  );

  const isLoading =
    (fuel.isRefreshing || (fuel.isStale && fuel.error === null)) &&
    data === null;

  return (
    <FuelPresenter
      scrollRef={scrollRef}
      dateLabel={dayLabel(date)}
      selectedDate={date}
      canGoNext={canGoNext}
      onPrevDay={onPrevDay}
      onNextDay={onNextDay}
      calendarOpen={calendarOpen}
      onCloseCalendar={onCloseCalendar}
      onSelectDate={onSelectDate}
      hasData={data !== null}
      isLoading={isLoading}
      isRefreshing={fuel.isRefreshing}
      error={fuel.error}
      onRefresh={() => void fuel.refresh()}
      remainingKcal={data?.remainingKcal ?? 0}
      consumedKcal={consumed.kcal}
      targetKcal={target?.dailyKcal ?? 0}
      ringPct={heroRingPct(target, consumed)}
      macros={macros}
      celebrate={goalHit.all}
      noTarget={target === null}
      aiLocked={!aiGate.allowed}
      snapOffline={!online}
      slots={slots}
      waterCups={consumed.waterCups}
      waterGoal={target?.waterCups ?? 8}
      volumeUnit={volumeUnit}
      onOpenTargets={() => router.push("/(app)/fuel/targets")}
      onOpenCalendar={onOpenCalendar}
      onScan={() => openScan("breakfast")}
      onSnap={() => {
        // Offline takes precedence — the row button is already disabled in
        // this state (QuickAddRowPresenter), but defend here too in case a
        // stale press lands mid-transition. AI calls are online-only and
        // never queue (design.md § Revised 2026-07-03 › Mobile flow).
        if (!online) return;
        if (aiGate.allowed) {
          openSnap("breakfast");
          return;
        }
        aiGate.gateProps.onUpgrade();
      }}
      onSearch={() => openQuickAdd("breakfast")}
      onRecipes={() => router.push("/(app)/fuel/recipes")}
      onAddToSlot={(slot: MealSlot) => openQuickAdd(slot)}
      onSetWater={onSetWater}
      onDeleteEntry={onDeleteEntry}
      onLog={() => openQuickAdd("breakfast")}
    />
  );
}
