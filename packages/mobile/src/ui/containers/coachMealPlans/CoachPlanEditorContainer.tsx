import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { router, useLocalSearchParams } from "expo-router";

import { localIdFactory } from "@/application/commands/localId";
import type { MealSlot } from "@/domain/models/nutrition";
import type { NutritionPlan } from "@/domain/models/nutritionPlans";
import {
  asNutritionTarget,
  daysAgo,
  firstName,
  kcalText,
} from "@/domain/services/coachMealPlans.service";
import {
  compareWithTarget,
  emptyPlanMeal,
  findPlan,
  macrosVsTarget,
  newDraftPlan,
  recomputePlan,
  updateMeal,
  withServings,
} from "@/domain/services/nutritionPlans.service";
import { messageAt } from "@/shared/form";
import { usePlanDraft } from "@/state/plan-draft";
import {
  coachPlanResolver,
  type CoachPlanValues,
} from "@/ui/forms/coachPlanForms";
import { useAuth } from "@/ui/hooks/useAuth";
import { useCoachClientMealPlans } from "@/ui/hooks/useCoachClientMealPlans";
import { useNutritionPlans } from "@/ui/hooks/useNutritionPlans";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import {
  CoachPlanEditorPresenter,
  type EditorMealView,
} from "@/ui/presenters/coachMealPlans/CoachPlanEditorPresenter";

/** Portions step by a quarter (canvas C3), between these. */
export const PORTION_STEP = 0.25;
const PORTION_MIN = 0.25;
const PORTION_MAX = 100;
const SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

export function stepPortion(servings: number, by: 1 | -1): number {
  const next = Math.round((servings + by * PORTION_STEP) * 100) / 100;
  return Math.min(PORTION_MAX, Math.max(PORTION_MIN, next));
}

/** "80 g × 1.25", or the serving alone at one portion. */
export function servingLabel(
  item: NutritionPlan["meals"][number]["items"][number],
) {
  const base = item.food
    ? `${item.food.servingSize} ${item.food.servingUnit}`
    : item.recipe
      ? "1 portion"
      : "1 serving";
  return item.servings === 1 ? base : `${base} × ${item.servings}`;
}

export const SAVE_FAILED = "Couldn’t save the plan. Try again.";

/**
 * C3 Edit a plan (iPhone) — `/(app)/coach-meal-plans/edit[?id=][&client=]`.
 *
 * The coach's library is the coach's own plans, so this edits the same
 * `usePlanDraft` and saves through `useNutritionPlans` (PER-133): offline
 * edits queue with the plan's revision, and a 409 keeps the server copy and
 * says so. With `?client=` the plan is measured against that client's own
 * target; otherwise against none. Add food reuses the plan Add to a meal
 * page (`fuel/plan-add`, C4).
 */
export function CoachPlanEditorContainer() {
  const params = useLocalSearchParams<{
    id?: string;
    client?: string;
    clientName?: string;
  }>();
  const id = typeof params.id === "string" ? params.id : "";
  const clientId = typeof params.client === "string" ? params.client : "";
  const clientName =
    typeof params.clientName === "string" ? params.clientName : "";
  const isNew = !id;

  const { session } = useAuth();
  const online = useOnlineStatus();
  const plans = useNutritionPlans();
  const client = useCoachClientMealPlans(clientId, !!clientId);
  const draft = usePlanDraft((s) => s.draft);
  const start = usePlanDraft((s) => s.start);
  const setDraft = usePlanDraft((s) => s.setDraft);
  const clear = usePlanDraft((s) => s.clear);
  const started = useRef(false);
  const [openMeal, setOpenMeal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const ref = isNew ? null : findPlan(plans.cache, id);
  const mine = ref?.kind === "mine" ? ref.plan : null;

  useEffect(() => {
    if (started.current) return;
    if (isNew) {
      started.current = true;
      const now = new Date().toISOString();
      const mealId = `local-${localIdFactory()}`;
      start(
        "new",
        newDraftPlan({
          id: `local-${localIdFactory()}`,
          ownerId: session?.userId ?? "",
          name: "",
          meals: [emptyPlanMeal(mealId, "Meal 1", "breakfast", 0)],
          now,
        }),
      );
      setOpenMeal(mealId);
    } else if (mine) {
      started.current = true;
      start("edit", mine);
      setOpenMeal(mine.meals[0]?.id ?? null);
    } else if (!plans.isLoading) {
      started.current = true;
      router.back();
    }
  }, [isNew, mine, plans.isLoading, start, session?.userId]);

  const form = useForm<CoachPlanValues>({
    resolver: coachPlanResolver,
    mode: "onChange",
    defaultValues: { name: "", meals: [] },
  });
  const values = form.watch();

  // Keep the form's meal list in step with the draft's meals.
  const mealKey = draft ? draft.meals.map((m) => m.id).join("|") : "";
  const draftId = draft?.id ?? null;
  const seeded = useRef<string | null>(null);
  useEffect(() => {
    if (!draft) return;
    const current = form.getValues();
    const names = new Map(current.meals.map((m) => [m.id, m.name]));
    const first = seeded.current !== draft.id;
    seeded.current = draft.id;
    form.reset(
      {
        name: first ? draft.name : current.name,
        meals: draft.meals.map((m) => ({
          id: m.id,
          name: names.get(m.id) ?? m.name,
        })),
      },
      { keepDirty: !first },
    );
    if (!first) void form.trigger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, mealKey]);

  const target = asNutritionTarget(client.data?.target ?? null, clientId);
  const assignment =
    client.data?.assignments.find((a) => a.planId === id) ?? null;
  const conflict = !isNew && plans.cache.conflictPlanIds.includes(id);
  const first = clientName ? firstName(clientName) : null;

  const meals: EditorMealView[] = useMemo(
    () =>
      (draft?.meals ?? []).map((m, i) => ({
        id: m.id,
        name: values.meals.find((x) => x.id === m.id)?.name ?? m.name,
        kcal: `${kcalText(m.totals.kcal)} kcal`,
        summary: m.items.map((it) => it.name).join(" · "),
        open: openMeal === m.id,
        error: messageAt(form.formState.errors, `meals.${i}.name`) ?? null,
        items: m.items.map((it) => ({
          id: it.id,
          name: it.name,
          serving: servingLabel(it),
          portion: `×${it.servings}`,
          kcal: kcalText(it.kcal),
        })),
      })),
    [draft, values.meals, openMeal, form.formState.errors],
  );

  if (!draft) return null;

  const dirty =
    isNew ||
    form.formState.isDirty ||
    !mine ||
    JSON.stringify(mine.meals) !== JSON.stringify(draft.meals);

  function leave() {
    clear();
    router.back();
  }

  async function save(valid: CoachPlanValues) {
    if (!draft) return;
    setSaving(true);
    setError(null);
    const names = new Map(valid.meals.map((m) => [m.id, m.name.trim()]));
    const plan = recomputePlan({
      ...draft,
      name: valid.name.trim(),
      meals: draft.meals.map((m, i) => ({
        ...m,
        name: names.get(m.id) ?? m.name,
        sortOrder: i,
      })),
    });
    const saved = isNew ? await plans.create(plan) : await plans.save(plan);
    setSaving(false);
    if (!saved) {
      setError(SAVE_FAILED);
      return;
    }
    clear();
    if (isNew && clientId) {
      router.replace({
        pathname: "/(app)/clients/[id]",
        params: { id: clientId, tab: "nutrition", send: saved.id },
      } as never);
    } else {
      router.back();
    }
  }

  return (
    <CoachPlanEditorPresenter
      isNew={isNew}
      backLabel={clientName || "Library"}
      clientLine={
        first
          ? [
              clientName,
              assignment
                ? `Sent ${daysAgo(assignment.sentAt, Date.now())}`
                : null,
              `edits reach ${first} automatically`,
            ]
              .filter(Boolean)
              .join(" · ")
          : null
      }
      name={values.name}
      nameError={messageAt(form.formState.errors, "name") ?? null}
      comparison={compareWithTarget(draft.totals, target)}
      planned={draft.totals}
      macros={macrosVsTarget(draft.totals, target)}
      meals={meals}
      saveLabel={
        saving
          ? "Saving…"
          : first && !isNew
            ? `Save changes for ${first}`
            : "Save plan"
      }
      canSave={!saving && dirty}
      online={online}
      conflict={conflict}
      error={error}
      onBack={leave}
      onName={(name) =>
        form.setValue("name", name, { shouldDirty: true, shouldValidate: true })
      }
      onMealName={(mealId, name) => {
        const i = values.meals.findIndex((m) => m.id === mealId);
        if (i < 0) return;
        form.setValue(`meals.${i}.name`, name, {
          shouldDirty: true,
          shouldValidate: true,
        });
      }}
      onToggleMeal={(mealId) =>
        setOpenMeal(openMeal === mealId ? null : mealId)
      }
      onPortion={(mealId, itemId, by) =>
        setDraft(
          updateMeal(draft, mealId, (m) => ({
            ...m,
            items: m.items.map((it) =>
              it.id === itemId
                ? withServings(it, stepPortion(it.servings, by))
                : it,
            ),
          })),
        )
      }
      onRemoveItem={(mealId, itemId) =>
        setDraft(
          updateMeal(draft, mealId, (m) => ({
            ...m,
            items: m.items.filter((it) => it.id !== itemId),
          })),
        )
      }
      onRemoveMeal={(mealId) => {
        setDraft({
          ...draft,
          meals: draft.meals.filter((m) => m.id !== mealId),
        });
        setOpenMeal(null);
      }}
      onAddTo={(mealId) =>
        router.push(`/(app)/fuel/plan-add?meal=${mealId}` as never)
      }
      onAddMeal={() => {
        const n = draft.meals.length;
        const mealId = `local-${localIdFactory()}`;
        setDraft({
          ...draft,
          meals: [
            ...draft.meals,
            emptyPlanMeal(mealId, `Meal ${n + 1}`, SLOTS[n % SLOTS.length]!, n),
          ],
        });
        setOpenMeal(mealId);
      }}
      onSave={() => void form.handleSubmit(save)()}
      onDismissConflict={() => plans.clearConflict(id)}
    />
  );
}
