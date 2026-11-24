import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { localIdFactory } from "@/application/commands/localId";
import type { FuelToday } from "@/domain/models/nutrition";
import {
  PLAN_MEALS_MAX,
  type NutritionPlan,
  type PlanMeal,
} from "@/domain/models/nutritionPlans";
import type { UserMeal } from "@/domain/models/userMeals";
import { entryDisplayLabel } from "@/domain/services";
import {
  cleanPlanName,
  copyPlanMeals,
  newDraftPlan,
  planMealsFromDay,
  visibleMyPlans,
  resolvePlanId,
  tooManyMealsWithFood,
  withPlanMeals,
} from "@/domain/services/nutritionPlans.service";
import { addDaysISO, localDayISO } from "@/shared/utils";
import { useFuelSheets } from "@/state/fuel-sheets";
import { usePlanDraft } from "@/state/plan-draft";
import { usePlanSheets } from "@/state/plan-sheets";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useGetMeals } from "@/ui/hooks/useGetMeals";
import { useGetNutritionTarget } from "@/ui/hooks/useGetNutritionTarget";
import { useGetRecipes } from "@/ui/hooks/useGetRecipes";
import { useManualMealPlansGate } from "@/ui/hooks/useManualMealPlansGate";
import { useMealprintGate } from "@/ui/hooks/useMealprintGate";
import {
  useNutritionPlans,
  usePlansShoppingList,
} from "@/ui/hooks/useNutritionPlans";
import { useUserMeals } from "@/ui/hooks/useUserMeals";
import {
  NewPlanPresenter,
  type StartFrom,
  type StartOptionVM,
} from "@/ui/presenters/fuel/plans/NewPlanPresenter";
import { PlanSavedPresenter } from "@/ui/presenters/fuel/plans/PlanSavedPresenter";
import { PlanBuilderContainer } from "./PlanBuilderContainer";
import { PlanMealsSheetContainer } from "./PlanMealsSheetContainer";
import { fmt } from "./planViewModels";

const DAY_LABEL = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** "Wed 18 Nov". */
export function pastDayLabel(iso: string): string {
  return DAY_LABEL.format(new Date(`${iso}T12:00:00`)).replace(",", "");
}

export const DAY_NOT_ON_PHONE =
  "That day isn't saved on this phone. Pick another day.";

export const DAY_TOO_MANY_MEALS = `A plan holds up to ${PLAN_MEALS_MAX} meals and that day has more with food. Untick some meals or pick another day.`;

function startFromParam(v: unknown): StartFrom {
  return v === "day" || v === "plan" ? v : "empty";
}

type Step = "start" | "build" | "saved";

/**
 * <NewPlanContainer> — `fuel/plan-new` (PER-133): N28 New plan → N29/N32
 * Build → N33 Saved, in one route. Making your own plan needs Premium,
 * Premium+ or a coach tier: anyone else is sent to the paywall.
 *
 * `?from=day|plan|empty` preselects a Start from option (the Plan tab's
 * "Start from a past day" row).
 */
export function NewPlanContainer() {
  const params = useLocalSearchParams<{ from?: string }>();
  const gate = useManualMealPlansGate();
  const mealprintGate = useMealprintGate();
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const target = useGetNutritionTarget().data ?? null;
  const userMeals = useUserMeals();
  const plans = useNutritionPlans();
  const shopping = usePlansShoppingList(false);
  const savedMeals = useGetMeals();
  const recipes = useGetRecipes();
  const startDraft = usePlanDraft((s) => s.start);
  const clearDraft = usePlanDraft((s) => s.clear);

  const initialFrom = startFromParam(params.from);
  const [step, setStep] = useState<Step>("start");
  const [name, setName] = useState("");
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const [from, setFrom] = useState<StartFrom>(initialFrom);
  const [day, setDay] = useState<string | null>(null);
  const [sourcePlanId, setSourcePlanId] = useState<string | null>(null);
  const [calendar, setCalendar] = useState(initialFrom === "day");
  const [picker, setPicker] = useState(initialFrom === "plan");
  const [mealsSheet, setMealsSheet] = useState(false);
  const [saved, setSaved] = useState<NutritionPlan | null>(null);
  const [addingToList, setAddingToList] = useState(false);

  // Free: no New plan. Send them to the paywall once, from the Plan tab.
  const sentToPaywall = useRef(false);
  useEffect(() => {
    if (gate.isResolved && !gate.allowed && !sentToPaywall.current) {
      sentToPaywall.current = true;
      router.back();
      gate.onUpgrade();
    }
  }, [gate]);

  const myPlans = visibleMyPlans(plans.cache);
  // Follow the pick through a synced local id (Inspector Brad, #554).
  const sourceId = sourcePlanId
    ? resolvePlanId(plans.cache, sourcePlanId)
    : null;
  const sourcePlan = myPlans.find((p) => p.id === sourceId) ?? null;
  const ticked = userMeals.meals.filter((m) => !unticked.has(m.id));
  const dayFuel: FuelToday | null =
    day && userId ? storage.getCachedFuelToday(userId, day) : null;

  const nameFor = useMemo(
    () => ({
      food: (id: string) => storage.getCachedFoodById(id)?.name,
      recipe: (id: string) => recipes.data?.find((r) => r.id === id)?.name,
      meal: (id: string) => savedMeals.data?.find((m) => m.id === id)?.name,
    }),
    [storage, recipes.data, savedMeals.data],
  );

  // A day with food in more meals than a plan holds can't be copied whole;
  // say so rather than drop meals (Inspector Brad, #554).
  const dayTooBig = useMemo(() => {
    if (from !== "day" || !dayFuel || !userId) return false;
    let n = 0;
    const probeId = () => `probe-${n++}`;
    const dayPlan = newDraftPlan({
      id: "probe",
      ownerId: userId,
      name: "probe",
      meals: planMealsFromDay(dayFuel, userMeals.meals, probeId),
      now: new Date(0).toISOString(),
    });
    return tooManyMealsWithFood(dayPlan, ticked, userMeals.meals);
  }, [from, dayFuel, userId, userMeals.meals, ticked]);

  const cleanName = cleanPlanName(name);
  const canContinue =
    from === "mealprint" ||
    (cleanName !== null &&
      ticked.length > 0 &&
      (from !== "day" || (dayFuel !== null && !dayTooBig)) &&
      (from !== "plan" || sourcePlan !== null));

  const onContinue = useCallback(() => {
    if (from === "mealprint") {
      if (mealprintGate.allowed) {
        useFuelSheets.getState().openMealprintPlan();
        router.back();
      } else {
        useFuelSheets.getState().openSuggestLocked();
      }
      return;
    }
    if (!cleanName || !userId || (from === "day" && dayTooBig)) return;
    let base: PlanMeal[] = [];
    if (from === "day" && dayFuel) {
      base = planMealsFromDay(dayFuel, userMeals.meals, localIdFactory, (e) =>
        entryDisplayLabel(e, nameFor),
      );
    } else if (from === "plan" && sourcePlan) {
      base = copyPlanMeals(sourcePlan, localIdFactory);
    }
    const draft = newDraftPlan({
      id: `local-${localIdFactory()}`,
      ownerId: userId,
      name: cleanName,
      meals: base,
      now: new Date().toISOString(),
    });
    startDraft(
      "new",
      withPlanMeals(draft, ticked, localIdFactory, userMeals.meals),
    );
    setStep("build");
  }, [
    from,
    mealprintGate.allowed,
    cleanName,
    userId,
    dayTooBig,
    dayFuel,
    userMeals.meals,
    nameFor,
    sourcePlan,
    startDraft,
    ticked,
  ]);

  const leave = useCallback(() => {
    clearDraft();
    router.back();
  }, [clearDraft]);

  if (!gate.isResolved || !gate.allowed) return null;

  if (step === "saved" && saved) {
    return (
      <PlanSavedPresenter
        name={saved.name}
        mealCount={saved.meals.length}
        kcal={saved.totals.kcal}
        proteinG={saved.totals.proteinG}
        onClose={leave}
        onViewInPlan={() => {
          // Show the plan just saved, not the tab's earlier pick
          // (Inspector Brad, #554). findPlan follows its id once synced.
          usePlanSheets.getState().select(saved.id);
          leave();
        }}
        addingToList={addingToList}
        onShoppingList={() => {
          setAddingToList(true);
          void shopping.setPlanIncluded(saved.id, true).then(() => {
            setAddingToList(false);
            clearDraft();
            router.push("/(app)/fuel/plans-shopping" as Href);
          });
        }}
      />
    );
  }

  if (step === "build") {
    return (
      <PlanBuilderContainer
        mode="new"
        onBack={() => setStep("start")}
        onCreated={(plan) => {
          setSaved(plan);
          setStep("saved");
        }}
      />
    );
  }

  const daySub = !day
    ? "Copies what you ate, then edit"
    : !dayFuel
      ? DAY_NOT_ON_PHONE
      : dayTooBig
        ? DAY_TOO_MANY_MEALS
        : `${pastDayLabel(day)} · copies what you ate, then edit`;
  const planSub = sourcePlan
    ? `Duplicate ${sourcePlan.name} and change it`
    : myPlans.length > 0
      ? "Duplicate one of your plans and change it"
      : "You have no plans of your own yet";

  const options: StartOptionVM[] = (
    [
      ["empty", "Empty meals", "Fill each meal yourself"],
      ["day", "A day you logged", daySub],
      ["plan", "One of your plans", planSub],
      [
        "mealprint",
        "Let Mealprint fill it",
        "Every meal, then swap what you don't like",
      ],
    ] as const
  ).map(([key, label, sub]) => ({
    key,
    label,
    sub,
    selected: from === key,
    gold: key === "mealprint",
  }));

  const today = localDayISO();
  const isTicked = (m: UserMeal) => !unticked.has(m.id);

  return (
    <>
      <NewPlanPresenter
        onBack={leave}
        name={name}
        onName={setName}
        targetValue={
          target && target.dailyKcal > 0
            ? `${fmt(target.dailyKcal)} kcal`
            : "Set a target"
        }
        onTarget={() => router.push("/(app)/fuel/targets" as Href)}
        mealsText={ticked.map((m) => m.name).join(", ")}
        onEditMeals={() => setMealsSheet(true)}
        options={options}
        onOption={(key) => {
          setFrom(key);
          if (key === "day") setCalendar(true);
          if (key === "plan" && myPlans.length > 0) setPicker(true);
        }}
        ctaLabel={
          from === "mealprint" ? "Continue in Mealprint" : "Start building"
        }
        canContinue={canContinue}
        onContinue={onContinue}
        calendarVisible={calendar}
        calendarDay={day ?? addDaysISO(today, -1)}
        maxDay={today}
        onPickDay={(iso) => {
          setDay(iso);
          setCalendar(false);
        }}
        onCloseCalendar={() => setCalendar(false)}
        planPickerVisible={picker}
        plans={myPlans.map((p) => ({
          id: p.id,
          name: p.name,
          sub: `${p.meals.length} ${p.meals.length === 1 ? "meal" : "meals"} · ${fmt(p.totals.kcal)} kcal`,
        }))}
        onPickPlan={(id) => {
          setSourcePlanId(id);
          setPicker(false);
        }}
        onClosePlanPicker={() => setPicker(false)}
      />
      <PlanMealsSheetContainer
        visible={mealsSheet}
        onClose={() => setMealsSheet(false)}
        isTicked={isTicked}
        onToggle={(meal) =>
          setUnticked((prev) => {
            const next = new Set(prev);
            if (next.has(meal.id)) next.delete(meal.id);
            else next.add(meal.id);
            return next;
          })
        }
      />
    </>
  );
}
