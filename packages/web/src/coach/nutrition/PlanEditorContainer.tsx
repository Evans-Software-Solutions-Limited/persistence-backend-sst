import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { applyServerErrors, messageAt } from "@/lib/form";
import { isCoachApiError, newIdempotencyKey } from "../api/coachApi";
import type { LibraryPlan } from "../api/types";
import {
  COACH_NETWORK_MODE,
  coachKeys,
  useCoachApi,
  useOnline,
  refreshMealPlans,
  useRoster,
} from "../hooks/coachQueries";
import {
  EDITED_ELSEWHERE,
  editorValues,
  emptyPlanValues,
  foodItem,
  kcalText,
  newMeal,
  planTotals,
  planVsTarget,
  recipeItem,
  recipePortion,
  samePlan,
  savedMealItem,
  sentWords,
  stepPortion,
  toPlanInput,
  type EditorItem,
  type PlanEditorValues,
} from "../lib/mealPlans";
import {
  PLAN_SERVER_ERRORS,
  PLAN_SERVER_FIELDS,
  planEditorResolver,
} from "../lib/planForm";
import { LoadError, Loading } from "../ui/parts";
import { AddToMealDialog, type AddRow, type AddTab } from "./AddToMealDialog";
import { PlanEditor } from "./PlanEditor";

/** Wait this long after typing before searching foods. */
const SEARCH_DELAY_MS = 300;

/**
 * C3 Edit a plan (`/coach/library/meal-plans/new`, `/:planId/edit`). With
 * `?client=` the plan is measured against that client's own target and Save
 * returns to their Nutrition tab; a new plan built there opens Send next.
 * Saves are a full replace with `expectedRevision` (409 → the server's copy,
 * "changed somewhere else"). Offline, the edits stay on screen and Save waits.
 */
export function PlanEditorContainer() {
  const api = useCoachApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const online = useOnline();
  const { planId } = useParams();
  const [search] = useSearchParams();
  const clientId = search.get("client");
  const isNew = !planId;

  const plans = useQuery({
    queryKey: coachKeys.libraryPlans,
    queryFn: () => api.libraryPlans(),
    networkMode: COACH_NETWORK_MODE,
    enabled: !isNew,
  });
  const roster = useRoster();
  const clientPlans = useQuery({
    queryKey: coachKeys.clientMealPlans(clientId ?? ""),
    queryFn: () => api.clientMealPlans(clientId!),
    networkMode: COACH_NETWORK_MODE,
    enabled: !!clientId,
  });
  const client =
    roster.data?.data.find((c) => c.id === clientId && c.status === "active") ??
    null;
  const target = clientPlans.data?.target ?? null;
  const assignment =
    clientPlans.data?.assignments.find((a) => a.planId === planId) ?? null;

  const saved = plans.data?.find((p) => p.id === planId) ?? null;
  const [base, setBase] = useState<LibraryPlan | null>(null);
  if (!isNew && saved && base === null) setBase(saved);
  const baseValues = useMemo(() => (base ? editorValues(base) : null), [base]);

  const form = useForm<PlanEditorValues>({
    resolver: planEditorResolver,
    mode: "onChange",
    defaultValues: emptyPlanValues(),
    values: baseValues ?? undefined,
  });
  const values = form.watch();
  useEffect(() => {
    if (baseValues) void form.trigger();
  }, [baseValues, form]);

  const [openMeal, setOpenMeal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newIdempotencyKey());

  // C4 Add to a meal.
  const [addTo, setAddTo] = useState<number | null>(null);
  const [addTab, setAddTab] = useState<AddTab>("foods");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    const t = window.setTimeout(
      () => setDebounced(query.trim()),
      SEARCH_DELAY_MS,
    );
    return () => window.clearTimeout(t);
  }, [query]);
  const foods = useQuery({
    queryKey: coachKeys.foodSearch(debounced),
    queryFn: () => api.searchFoods(debounced),
    enabled: addTo !== null && addTab === "foods" && debounced.length >= 2,
    networkMode: COACH_NETWORK_MODE,
    staleTime: 60_000,
  });
  const recipes = useQuery({
    queryKey: coachKeys.recipes,
    queryFn: () => api.recipes(),
    enabled: addTo !== null,
    networkMode: COACH_NETWORK_MODE,
  });
  const meals = useQuery({
    queryKey: coachKeys.savedMeals,
    queryFn: () => api.savedMeals(),
    enabled: addTo !== null,
    networkMode: COACH_NETWORK_MODE,
  });

  if (!isNew) {
    if (plans.isPending) return <Loading />;
    if (!saved && !base) {
      return (
        <LoadError
          message={
            plans.data
              ? "This plan isn’t in your library."
              : online
                ? "We couldn’t load this plan."
                : "You’re offline. This plan loads when you’re back online."
          }
          onRetry={() => void plans.refetch()}
        />
      );
    }
  }

  const backTo = clientId
    ? `/coach/clients/${clientId}/nutrition`
    : "/coach/library/meal-plans";
  const backLabel = client ? client.name : "Meal plans";
  const totals = planTotals(values);
  const view = planVsTarget(totals, target);
  const dirty = isNew
    ? values.name.trim().length > 0 ||
      values.meals.some((m) => m.items.length > 0)
    : !!baseValues && !samePlan(values, baseValues);

  const errors = form.formState.errors;
  const mealErrors: Record<number, string> = {};
  values.meals.forEach((_, i) => {
    const m = messageAt(errors, `meals.${i}.name`);
    if (m) mealErrors[i] = m;
  });
  const itemErrors: Record<string, string> = {};
  values.meals.forEach((m, i) =>
    m.items.forEach((_, j) => {
      const e = messageAt(errors, `meals.${i}.items.${j}.servings`);
      if (e) itemErrors[`${i}.${j}`] = e;
    }),
  );
  const formError =
    messageAt(errors, "meals") ??
    values.meals
      .map((_, i) => messageAt(errors, `meals.${i}.items`))
      .find(Boolean) ??
    Object.values(itemErrors)[0] ??
    null;

  function setMeals(next: PlanEditorValues["meals"]) {
    form.setValue("meals", next, { shouldDirty: true, shouldValidate: true });
  }

  async function save(valid: PlanEditorValues) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const input = toPlanInput(valid);
    try {
      if (isNew) {
        const created = await api.createPlan(input, key.current);
        await refreshMealPlans(queryClient);
        void navigate(
          clientId
            ? `/coach/clients/${clientId}/nutrition?send=${created.id}`
            : "/coach/library/meal-plans",
        );
        return;
      }
      const updated = await api.replacePlan(planId!, input, base!.revision);
      queryClient.setQueryData<LibraryPlan[]>(coachKeys.libraryPlans, (old) =>
        (old ?? []).map((p) => (p.id === updated.id ? updated : p)),
      );
      await refreshMealPlans(queryClient);
      setBase(updated);
      void navigate(backTo);
    } catch (e) {
      if (isCoachApiError(e) && e.code === "revision_conflict") {
        const current = e.body?.current as LibraryPlan | undefined;
        if (current) {
          queryClient.setQueryData<LibraryPlan[]>(
            coachKeys.libraryPlans,
            (old) =>
              (old ?? []).map((p) => (p.id === current.id ? current : p)),
          );
          setBase(current);
        } else {
          setBase(null);
          void plans.refetch();
        }
        setNotice(EDITED_ELSEWHERE);
        return;
      }
      const mapped =
        isCoachApiError(e) && e.code ? PLAN_SERVER_ERRORS[e.code] : undefined;
      if (mapped) {
        form.setError(mapped.field, {
          type: "server",
          message: mapped.message,
        });
        return;
      }
      if (applyServerErrors(e, form.setError, PLAN_SERVER_FIELDS)) return;
      setError(
        isCoachApiError(e) && e.offline
          ? "You’re offline. Your changes are still here; save when you’re back online."
          : isCoachApiError(e) && e.code === "manual_meal_plans"
            ? "Your account can’t create meal plans."
            : isCoachApiError(e) && e.status === 404
              ? "This plan isn’t in your library any more."
              : isCoachApiError(e)
                ? e.message
                : "We couldn’t save this plan. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  // C4 rows for the open tab, filtered by the search text.
  const q = query.trim().toLowerCase();
  const match = (name: string) => !q || name.toLowerCase().includes(q);
  let rows: AddRow[] | null;
  let empty: string;
  if (addTab === "foods") {
    rows =
      debounced.length < 2
        ? []
        : foods.data
          ? foods.data.map((f) => ({
              id: f.id,
              name: f.brand ? `${f.name} · ${f.brand}` : f.name,
              sub: `Per ${f.servingSize} ${f.servingUnit}`,
              kcal: kcalText(f.kcal),
            }))
          : foods.isError
            ? []
            : null;
    empty =
      debounced.length < 2
        ? "Type at least 2 letters to search foods."
        : "No foods match.";
  } else if (addTab === "recipes") {
    rows = recipes.data
      ? recipes.data
          .filter((r) => match(r.name))
          .map((r) => ({
            id: r.id,
            name: r.name,
            sub: "Your recipe · per portion",
            kcal: kcalText(recipePortion(r).kcal),
          }))
      : recipes.isError
        ? []
        : null;
    empty = q ? "No recipes match." : "No recipes yet.";
  } else {
    rows = meals.data
      ? meals.data
          .filter((m) => match(m.name))
          .map((m) => ({
            id: m.id,
            name: m.name,
            sub: "Saved meal",
            kcal: kcalText(m.totalKcal),
          }))
      : meals.isError
        ? []
        : null;
    empty = q ? "No saved meals match." : "No saved meals yet.";
  }

  function addPicked() {
    if (addTo === null) return;
    const items: EditorItem[] = [];
    for (const k of picked) {
      const [tab, id] = k.split(":") as [AddTab, string];
      if (tab === "foods") {
        const f = foods.data?.find((x) => x.id === id);
        if (f) items.push(foodItem(f));
      } else if (tab === "recipes") {
        const r = recipes.data?.find((x) => x.id === id);
        if (r) items.push(recipeItem(r));
      } else {
        const m = meals.data?.find((x) => x.id === id);
        if (m) items.push(savedMealItem(m));
      }
    }
    setMeals(
      values.meals.map((m, i) =>
        i === addTo ? { ...m, items: [...m.items, ...items] } : m,
      ),
    );
    setOpenMeal(addTo);
    setAddTo(null);
    setPicked(new Set());
    setQuery("");
  }

  return (
    <>
      <PlanEditor
        isNew={isNew}
        backTo={backTo}
        backLabel={backLabel}
        clientName={client?.name ?? null}
        sentWords={assignment ? sentWords(assignment.sentAt) : null}
        values={values}
        view={view}
        targetKcal={target ? kcalText(target.dailyKcal) : null}
        plannedKcal={kcalText(totals.kcal)}
        openMeal={openMeal}
        nameError={messageAt(errors, "name") ?? null}
        mealErrors={mealErrors}
        itemErrors={itemErrors}
        formError={formError}
        dirty={dirty}
        busy={busy}
        offline={!online}
        notice={notice}
        error={error}
        onName={(name) =>
          form.setValue("name", name, {
            shouldDirty: true,
            shouldValidate: true,
          })
        }
        onMealName={(mi, name) =>
          setMeals(values.meals.map((m, i) => (i === mi ? { ...m, name } : m)))
        }
        onToggleMeal={(mi) => setOpenMeal(openMeal === mi ? -1 : mi)}
        onPortion={(mi, ii, by) =>
          setMeals(
            values.meals.map((m, i) =>
              i !== mi
                ? m
                : {
                    ...m,
                    items: m.items.map((it, j) =>
                      j === ii
                        ? { ...it, servings: stepPortion(it.servings, by) }
                        : it,
                    ),
                  },
            ),
          )
        }
        onRemoveItem={(mi, ii) =>
          setMeals(
            values.meals.map((m, i) =>
              i === mi
                ? { ...m, items: m.items.filter((_, j) => j !== ii) }
                : m,
            ),
          )
        }
        onRemoveMeal={(mi) => {
          setMeals(values.meals.filter((_, i) => i !== mi));
          setOpenMeal(-1);
        }}
        onAddMeal={() => {
          setMeals([...values.meals, newMeal(values.meals)]);
          setOpenMeal(values.meals.length);
        }}
        onAddTo={(mi) => {
          setAddTo(mi);
          setPicked(new Set());
        }}
        onSave={() => void form.handleSubmit(save)()}
      />
      {addTo !== null && values.meals[addTo] && (
        <AddToMealDialog
          planName={values.name.trim() || "New plan"}
          mealName={values.meals[addTo]!.name || `Meal ${addTo + 1}`}
          tab={addTab}
          query={query}
          rows={rows}
          empty={empty}
          selected={picked}
          offline={!online}
          error={null}
          onTab={setAddTab}
          onQuery={setQuery}
          onToggle={(k) => {
            const next = new Set(picked);
            if (next.has(k)) next.delete(k);
            else next.add(k);
            setPicked(next);
          }}
          onAdd={addPicked}
          onClose={() => {
            setAddTo(null);
            setPicked(new Set());
          }}
        />
      )}
    </>
  );
}
