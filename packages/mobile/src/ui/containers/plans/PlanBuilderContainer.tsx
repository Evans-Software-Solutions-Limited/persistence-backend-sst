import { useCallback, useMemo, useState } from "react";
import { router, type Href } from "expo-router";
import { localIdFactory } from "@/application/commands/localId";
import type { NutritionPlan } from "@/domain/models/nutritionPlans";
import type { UserMeal } from "@/domain/models/userMeals";
import { entryDisplayLabel } from "@/domain/services";
import {
  cleanPlanName,
  compareWithTarget,
  findPlan,
  macrosVsTarget,
  planMealsFromDay,
  withPlanMeals,
  withServings,
} from "@/domain/services/nutritionPlans.service";
import { localDayISO } from "@/shared/utils";
import { usePlanDraft } from "@/state/plan-draft";
import { DateCalendarModal } from "@/ui/components/DatePickerField";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useGetMeals } from "@/ui/hooks/useGetMeals";
import { useGetNutritionTarget } from "@/ui/hooks/useGetNutritionTarget";
import { useGetRecipes } from "@/ui/hooks/useGetRecipes";
import { useNutritionPlans } from "@/ui/hooks/useNutritionPlans";
import { useUserMeals } from "@/ui/hooks/useUserMeals";
import { PlanBuilderPresenter } from "@/ui/presenters/fuel/plans/PlanBuilderPresenter";
import { PlanItemAmountSheetPresenter } from "@/ui/presenters/fuel/plans/PlanItemAmountSheetPresenter";
import {
  PlanOptionsSheetPresenter,
  type PlanOptionsView,
} from "@/ui/presenters/fuel/plans/PlanOptionsSheetPresenter";
import { PlanMealsSheetContainer } from "./PlanMealsSheetContainer";
import {
  amountText,
  fmt,
  itemRow,
  itemSub,
  macroShares,
  macrosAt,
  parseAmount,
  planIsEmpty,
  planSubtitle,
  servingSizeLabel,
} from "./planViewModels";

export const AMOUNT_CHIPS: readonly { value: number; label: string }[] = [
  { value: 0.5, label: "½" },
  { value: 0.75, label: "¾" },
  { value: 1, label: "1" },
  { value: 1.5, label: "1½" },
];

export const NOT_ON_PHONE =
  "That day isn't saved on this phone. Open it in Log once, then try again.";
export const SAVE_FAILED = "Couldn't save the plan. Try again.";

const sameName = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

type AmountState = {
  mealId: string;
  itemId: string;
  text: string;
  toMealId: string;
};

export type PlanBuilderContainerProps = {
  mode: "new" | "edit";
  onBack: () => void;
  /** New plans: called with the saved plan (N33 Saved). */
  onCreated?: (plan: NutritionPlan) => void;
};

/**
 * <PlanBuilderContainer> — N29/N32 Build and N34 Edit (PER-133). Works on
 * the plan in `usePlanDraft`; Save sends it through `useNutritionPlans`.
 * Nothing here logs food.
 */
export function PlanBuilderContainer({
  mode,
  onBack,
  onCreated,
}: PlanBuilderContainerProps) {
  const draft = usePlanDraft((s) => s.draft);
  const setDraft = usePlanDraft((s) => s.setDraft);
  const rename = usePlanDraft((s) => s.rename);
  const addItems = usePlanDraft((s) => s.addItems);
  const moveItem = usePlanDraft((s) => s.moveItem);
  const removeDraftItem = usePlanDraft((s) => s.removeItem);
  const clear = usePlanDraft((s) => s.clear);

  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const target = useGetNutritionTarget().data ?? null;
  const plans = useNutritionPlans();
  const userMeals = useUserMeals();
  const savedMeals = useGetMeals();
  const recipes = useGetRecipes();

  const [mealsSheet, setMealsSheet] = useState(false);
  const [options, setOptions] = useState<PlanOptionsView>(null);
  const [amount, setAmount] = useState<AmountState | null>(null);
  const [pastDayMeal, setPastDayMeal] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const lookups = useMemo(
    () => ({
      food: (id: string) => storage.getCachedFoodById(id)?.name,
      recipe: (id: string) => recipes.data?.find((r) => r.id === id)?.name,
      meal: (id: string) => savedMeals.data?.find((m) => m.id === id)?.name,
    }),
    [storage, recipes.data, savedMeals.data],
  );

  const isTicked = useCallback(
    (m: UserMeal) => !!draft?.meals.some((pm) => sameName(pm.name, m.name)),
    [draft],
  );

  const applyTicks = useCallback(
    (ticked: readonly UserMeal[], all: readonly UserMeal[]) => {
      if (draft) setDraft(withPlanMeals(draft, ticked, localIdFactory, all));
    },
    [draft, setDraft],
  );

  const onSave = useCallback(async () => {
    if (!draft || saving) return;
    setSaving(true);
    setNotice(null);
    const named = { ...draft, name: cleanPlanName(draft.name) ?? draft.name };
    const saved =
      mode === "new" ? await plans.create(named) : await plans.save(named);
    setSaving(false);
    if (!saved) {
      setNotice(SAVE_FAILED);
      return;
    }
    if (mode === "new") onCreated?.(saved);
    else {
      clear();
      router.back();
    }
  }, [draft, saving, mode, plans, onCreated, clear]);

  const onPickPastDay = useCallback(
    (iso: string) => {
      const mealId = pastDayMeal;
      setPastDayMeal(null);
      const meal = draft?.meals.find((m) => m.id === mealId);
      if (!meal || !userId) return;
      const fuel = storage.getCachedFuelToday(userId, iso);
      if (!fuel) {
        setNotice(NOT_ON_PHONE);
        return;
      }
      const dayMeals = planMealsFromDay(
        fuel,
        userMeals.meals,
        localIdFactory,
        (e) => entryDisplayLabel(e, lookups),
      );
      const items =
        dayMeals.find((m) => sameName(m.name, meal.name))?.items ?? [];
      if (items.length === 0) {
        setNotice(`Nothing was logged in ${meal.name} that day.`);
        return;
      }
      setNotice(null);
      addItems(meal.id, items);
    },
    [pastDayMeal, draft, userId, storage, userMeals.meals, lookups, addItems],
  );

  if (!draft) return null;

  const comparison = compareWithTarget(draft.totals, target);
  const mealsText = draft.meals.map((m) => m.name).join(", ");
  const empty = planIsEmpty(draft);

  const amountMeal = amount
    ? draft.meals.find((m) => m.id === amount.mealId)
    : undefined;
  const amountItem = amountMeal?.items.find((i) => i.id === amount?.itemId);
  const typed = amount ? parseAmount(amount.text) : null;
  const previewServings = typed ?? amountItem?.servings ?? 1;
  const preview = amountItem ? macrosAt(amountItem, previewServings) : null;
  const toMeal = amount
    ? draft.meals.find((m) => m.id === amount.toMealId)
    : undefined;

  const original = findPlan(plans.cache, draft.id);

  return (
    <>
      <PlanBuilderPresenter
        mode={mode}
        onBack={onBack}
        onOptions={() => setOptions("menu")}
        name={draft.name}
        subtitle={planSubtitle(comparison.targetKcal)}
        summary={{
          comparison,
          planned: draft.totals,
          macros: macrosVsTarget(draft.totals, target),
        }}
        meals={draft.meals.map((m) => ({
          id: m.id,
          name: m.name,
          kcalText: m.items.length > 0 ? `${fmt(m.totals.kcal)} kcal` : "",
          items: m.items.map(itemRow),
        }))}
        onAddToMeal={(mealId) =>
          router.push(`/(app)/fuel/plan-add?meal=${mealId}` as Href)
        }
        onFromPastDay={(mealId) => setPastDayMeal(mealId)}
        onItem={(mealId, itemId) => {
          const it = draft.meals
            .find((m) => m.id === mealId)
            ?.items.find((i) => i.id === itemId);
          if (it)
            setAmount({
              mealId,
              itemId,
              text: amountText(it.servings),
              toMealId: mealId,
            });
        }}
        onAddMeal={() => setMealsSheet(true)}
        notice={notice}
        ctaLabel={
          mode === "edit"
            ? "Save changes"
            : empty
              ? "Add something to save"
              : "Save plan"
        }
        canSave={mode === "edit" || !empty}
        saving={saving}
        onSave={() => void onSave()}
      />

      <PlanMealsSheetContainer
        visible={mealsSheet}
        onClose={() => setMealsSheet(false)}
        isTicked={isTicked}
        onToggle={(meal, all) =>
          applyTicks(
            all.filter((m) => (m.id === meal.id ? !isTicked(m) : isTicked(m))),
            all,
          )
        }
        onMealsChanged={(next, change) => {
          if (change.kind === "rename") {
            setDraft({
              ...draft,
              meals: draft.meals.map((m) =>
                sameName(m.name, change.from) ? { ...m, name: change.to } : m,
              ),
            });
          } else if (change.kind === "add") {
            applyTicks(
              next.filter((m) => m.id === change.meal.id || isTicked(m)),
              next,
            );
          } else {
            applyTicks(next.filter(isTicked), next);
          }
        }}
      />

      <PlanItemAmountSheetPresenter
        visible={!!amountItem}
        onClose={() => setAmount(null)}
        mode="edit"
        name={amountItem?.name ?? ""}
        sub={amountItem ? itemSub(amountItem) : ""}
        servingSize={amountItem ? servingSizeLabel(amountItem) : ""}
        amount={amount?.text ?? ""}
        onAmount={(text) => amount && setAmount({ ...amount, text })}
        chips={AMOUNT_CHIPS.map((c) => ({
          ...c,
          selected: typed === c.value,
        }))}
        onChip={(value) =>
          amount && setAmount({ ...amount, text: amountText(value) })
        }
        mealName={toMeal?.name ?? ""}
        meals={draft.meals.map((m) => ({ id: m.id, name: m.name }))}
        onMeal={(id) => amount && setAmount({ ...amount, toMealId: id })}
        kcal={preview?.kcal ?? 0}
        macros={preview ? macroShares(preview) : []}
        canSave={typed !== null}
        onSave={() => {
          if (!amount || !amountItem || typed === null) return;
          moveItem(
            amount.mealId,
            amount.toMealId,
            withServings(amountItem, typed),
          );
          setAmount(null);
        }}
        onRemove={() => {
          if (!amount) return;
          removeDraftItem(amount.mealId, amount.itemId);
          setAmount(null);
        }}
      />

      <DateCalendarModal
        visible={pastDayMeal !== null}
        selectedDate={localDayISO()}
        maximumDate={localDayISO()}
        onSelectDate={onPickPastDay}
        onClose={() => setPastDayMeal(null)}
        label="From a past day"
        testID="plan-builder-calendar"
      />

      {mode === "edit" ? (
        <PlanOptionsSheetPresenter
          view={options}
          onClose={() => setOptions(null)}
          planName={draft.name}
          targetValue={
            comparison.targetKcal === null ? "—" : fmt(comparison.targetKcal)
          }
          mealsText={mealsText}
          onStartRename={() => setOptions("rename")}
          onRename={(name) => {
            rename(name);
            setOptions(null);
          }}
          onTarget={() => {
            setOptions(null);
            router.push("/(app)/fuel/targets" as Href);
          }}
          onMeals={() => {
            setOptions(null);
            setMealsSheet(true);
          }}
          onDuplicate={() => {
            setOptions(null);
            void plans.duplicate(original?.plan ?? draft).then((copy) => {
              if (copy)
                router.replace(`/(app)/fuel/plan-edit?id=${copy.id}` as Href);
            });
          }}
          onAskDelete={() => setOptions("delete")}
          onDelete={() => {
            setOptions(null);
            void plans.remove(draft.id).then(() => {
              clear();
              router.back();
            });
          }}
        />
      ) : null}
    </>
  );
}
