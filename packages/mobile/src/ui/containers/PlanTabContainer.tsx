import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router, type Href } from "expo-router";
import * as Haptics from "expo-haptics";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import {
  useNutritionPlans,
  usePlansShoppingList,
} from "@/ui/hooks/useNutritionPlans";
import { useUserMeals } from "@/ui/hooks/useUserMeals";
import { useMealprintGate } from "@/ui/hooks/useMealprintGate";
import { useManualMealPlansGate } from "@/ui/hooks/useManualMealPlansGate";
import { useFuelSheets } from "@/state/fuel-sheets";
import { usePlanSheets } from "@/state/plan-sheets";
import { localDayISO, loggedAtNoonUtc } from "@/shared/utils";
import type { NutritionTarget } from "@/domain/models/nutrition";
import type {
  NutritionPlan,
  NutritionPlansCache,
} from "@/domain/models/nutritionPlans";
import {
  compareWithTarget,
  defaultPlanId,
  findPlan,
  firstEmptyMeal,
  isPlanInShoppingList,
  macrosVsTarget,
  newCoachPlans,
  type PlanRef,
} from "@/domain/services/nutritionPlans.service";
import {
  PlanTabPresenter,
  type PlanViewVM,
} from "@/ui/presenters/fuel/PlanTabPresenter";

const SHORT_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

/** "2 Oct" — the coach's last edit (a past date, so allowed). */
export function updatedLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : SHORT_DATE.format(d);
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "Your coach";
}

/** What's in a plan meal, as one line: "Oats, banana and nut butter". */
export function mealLine(names: readonly string[]): string {
  if (names.length === 0) return "Nothing yet";
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The Plan tab's view of one plan, compared with the person's own target. */
export function planViewModel(
  ref: PlanRef,
  target: NutritionTarget | null,
  cache: NutritionPlansCache,
  inShoppingList: boolean,
  showUpdated: boolean,
): PlanViewVM {
  const plan = ref.plan;
  const comparison = compareWithTarget(plan.totals, target);
  const coach = ref.kind === "coach" ? ref.fromCoach : null;
  const coachFirst = coach ? firstName(coach.coach.name) : "";
  const updated = coach ? updatedLabel(plan.updatedAt) : "";
  return {
    id: plan.id,
    name: plan.name,
    kind: ref.kind,
    updated: showUpdated,
    ownerInitial: coach
      ? (coachFirst[0] ?? "C").toUpperCase()
      : (plan.name.trim()[0] ?? "P").toUpperCase(),
    ownerText: coach
      ? `Set by ${coachFirst}, your coach${updated ? ` · updated ${updated}` : ""}. You can log from it, not change it.`
      : "Your plan. Tap a meal to swap it or change the portion.",
    comparison,
    macroChips: macrosVsTarget(plan.totals, target).map((m) => ({
      letter: m.letter,
      text:
        m.targetG === null
          ? `${m.plannedG}g ${m.letter}`
          : `${m.plannedG} / ${m.targetG}g ${m.letter}`,
    })),
    meals: plan.meals
      .filter((m) => m.items.length > 0)
      .map((m) => ({
        id: m.id,
        slot: m.name,
        kcal: Math.round(m.totals.kcal).toLocaleString("en-GB"),
        name: mealLine(m.items.map((i) => i.name)),
        carbsG: Math.round(m.totals.carbsG),
        fatG: Math.round(m.totals.fatG),
        proteinG: Math.round(m.totals.proteinG),
      })),
    gapMeal: firstEmptyMeal(plan)?.name ?? null,
    inShoppingList,
    conflict: cache.conflictPlanIds.includes(plan.id),
  };
}

/**
 * <PlanTabContainer> — Fuel → Plan (PER-133). Picks the plan to show (the
 * one chosen in "Your plans", else the default), compares it with the
 * person's own target, and wires adding a meal or the whole plan to today
 * (offline, through PER-132's batch logging), Duplicate, Edit, the shopping
 * list and the Mealprint entry points. A coach plan waiting for an answer
 * opens the C6 sheet once.
 */
export function PlanTabContainer({ active }: { active: boolean }) {
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const plans = useNutritionPlans(active);
  const shopping = usePlansShoppingList(active);
  const userMeals = useUserMeals(active);
  const mealprintGate = useMealprintGate();
  const manualGate = useManualMealPlansGate();
  const notifyMutated = useFuelSheets((s) => s.notifyMutated);
  const selectedPlanId = usePlanSheets((s) => s.selectedPlanId);
  const select = usePlanSheets((s) => s.select);
  const openSwitch = usePlanSheets((s) => s.openSwitch);
  const openCoachPlan = usePlanSheets((s) => s.openCoachPlan);
  const autoShown = usePlanSheets((s) => s.autoShown);
  const [notice, setNotice] = useState<string | null>(null);

  const cache = plans.cache;
  const ref = useMemo(() => {
    const picked = selectedPlanId ? findPlan(cache, selectedPlanId) : null;
    if (picked) return picked;
    const id = defaultPlanId(cache);
    return id ? findPlan(cache, id) : null;
  }, [cache, selectedPlanId]);

  // A coach plan that's waiting for an answer opens C6 once per session.
  useEffect(() => {
    if (!active) return;
    const waiting = newCoachPlans(cache).find(
      (c) => !autoShown.includes(c.plan.id),
    );
    if (waiting) openCoachPlan(waiting.plan.id, true);
  }, [active, cache, autoShown, openCoachPlan]);

  // Opening a coach plan clears its "updated" marker on the server; the
  // marker stays on screen for this visit.
  const shownUpdated = useRef(new Set<string>());
  const coachRef = ref?.kind === "coach" ? ref : null;
  const isUpdated = coachRef?.fromCoach.updatedSinceSeen ?? false;
  if (coachRef && isUpdated) shownUpdated.current.add(coachRef.plan.id);
  const markSeen = plans.markSeen;
  useEffect(() => {
    if (active && coachRef && isUpdated) void markSeen(coachRef.plan.id);
  }, [active, coachRef, isUpdated, markSeen]);

  useEffect(() => setNotice(null), [ref?.plan.id]);

  const target = userId ? storage.getCachedNutritionTarget(userId) : null;
  const vm = useMemo(
    () =>
      ref
        ? planViewModel(
            ref,
            target,
            cache,
            isPlanInShoppingList(shopping.value.list, ref.plan.id),
            shownUpdated.current.has(ref.plan.id),
          )
        : null,
    [ref, target, cache, shopping.value.list],
  );

  const addToToday = useCallback(
    async (plan: NutritionPlan, mealId: string | null) => {
      const entries = await plans.addToDay(
        plan,
        mealId,
        userMeals.meals,
        loggedAtNoonUtc(localDayISO()),
      );
      if (entries.length === 0) return;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      notifyMutated();
      const meal = mealId ? plan.meals.find((m) => m.id === mealId) : null;
      setNotice(
        meal
          ? `Added ${meal.name} to today's log.`
          : `Added ${plan.name} to today's log.`,
      );
    },
    [plans, userMeals.meals, notifyMutated],
  );

  const openMealprintFor = useCallback(
    (open: () => void) => {
      if (!mealprintGate.isResolved) return;
      if (mealprintGate.allowed) open();
      else useFuelSheets.getState().openSuggestLocked();
    },
    [mealprintGate],
  );

  const onBuildOwn = useCallback(
    (query = "") => {
      if (!manualGate.isResolved) return;
      if (!manualGate.allowed) {
        manualGate.onUpgrade();
        return;
      }
      router.push(`/(app)/fuel/plan-new${query}` as Href);
    },
    [manualGate],
  );

  const state = plans.isLoading ? "loading" : vm ? "plan" : "empty";

  return (
    <PlanTabPresenter
      state={state}
      plan={vm}
      notice={notice}
      onOpenSwitch={openSwitch}
      onOwnerAction={() => {
        if (!ref) return;
        if (ref.kind === "mine") {
          router.push(
            `/(app)/fuel/plan-edit?id=${encodeURIComponent(ref.plan.id)}` as Href,
          );
          return;
        }
        void plans.duplicate(ref.plan).then((copy) => {
          if (!copy) return;
          select(copy.id);
          setNotice(`Duplicated into your plans as ${copy.name}.`);
        });
      }}
      onOpenMeal={() => {
        if (ref?.kind !== "mine") return;
        router.push(
          `/(app)/fuel/plan-edit?id=${encodeURIComponent(ref.plan.id)}` as Href,
        );
      }}
      onLogMeal={(mealId) => {
        if (ref) void addToToday(ref.plan, mealId);
      }}
      onLogAll={() => {
        if (ref) void addToToday(ref.plan, null);
      }}
      onAddFood={() => {
        if (ref?.kind !== "mine") return;
        router.push(
          `/(app)/fuel/plan-edit?id=${encodeURIComponent(ref.plan.id)}` as Href,
        );
      }}
      onFillWithMealprint={() => {
        const gap = ref ? firstEmptyMeal(ref.plan) : null;
        openMealprintFor(() =>
          useFuelSheets.getState().openMealprintSuggest(gap?.logSlot),
        );
      }}
      onShoppingList={() => {
        if (!ref) return;
        if (!isPlanInShoppingList(shopping.value.list, ref.plan.id)) {
          void shopping.setPlanIncluded(ref.plan.id, true);
        }
        router.push("/(app)/fuel/plans-shopping" as Href);
      }}
      onDismissConflict={() => {
        if (ref) plans.clearConflict(ref.plan.id);
      }}
      onBuildOwn={() => onBuildOwn()}
      onStartFromDay={() => onBuildOwn("?from=day")}
      onMealprintBuild={() =>
        openMealprintFor(() => useFuelSheets.getState().openMealprintPlan())
      }
    />
  );
}
