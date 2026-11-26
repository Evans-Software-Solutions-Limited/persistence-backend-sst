import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isCoachApiError } from "../api/coachApi";
import {
  COACH_NETWORK_MODE,
  coachKeys,
  useCoachApi,
  useOnline,
  refreshMealPlans,
  useRoster,
} from "../hooks/coachQueries";
import { clockTime } from "../lib/people";
import { Toast } from "../ui/parts";
import { MealPlansLibrary, type LibraryNutritionTab } from "./MealPlansLibrary";
import { SendPlanContainer } from "./SendPlanContainer";
import { ShareRecipeContainer } from "./ShareRecipeContainer";

/** C2 Library · Nutrition (`/coach/library/meal-plans`). */
export function MealPlansLibraryContainer() {
  const api = useCoachApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const online = useOnline();
  const roster = useRoster();
  const [tab, setTab] = useState<LibraryNutritionTab>("plans");
  const [sendId, setSendId] = useState<string | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const plans = useQuery({
    queryKey: coachKeys.libraryPlans,
    queryFn: () => api.libraryPlans(),
    networkMode: COACH_NETWORK_MODE,
  });
  const recipes = useQuery({
    queryKey: coachKeys.recipes,
    queryFn: () => api.recipes(),
    networkMode: COACH_NETWORK_MODE,
  });
  const meals = useQuery({
    queryKey: coachKeys.savedMeals,
    queryFn: () => api.savedMeals(),
    networkMode: COACH_NETWORK_MODE,
  });
  const active = (roster.data?.data ?? []).filter((c) => c.status === "active");
  const byId = (id: string | null) =>
    plans.data?.find((p) => p.id === id) ?? null;
  const sendPlan = byId(sendId);
  const sharing = recipes.data?.find((r) => r.id === shareId) ?? null;

  const loadError =
    plans.isError && !plans.data
      ? online
        ? "We couldn’t load your meal plans."
        : "You’re offline. Your meal plans load when you’re back online."
      : null;

  function done(message: string) {
    setSendId(null);
    setShareId(null);
    setToast(message);
    window.setTimeout(() => setToast(null), 2500);
  }

  return (
    <>
      <MealPlansLibrary
        tab={tab}
        plans={plans.data ?? (plans.isError ? [] : null)}
        recipes={recipes.data ?? (recipes.isError ? [] : null)}
        meals={meals.data ?? (meals.isError ? [] : null)}
        offlineAsOf={
          online
            ? null
            : plans.dataUpdatedAt
              ? clockTime(plans.dataUpdatedAt)
              : null
        }
        notice={null}
        error={error ?? loadError}
        confirmDelete={byId(deleteId)}
        deleting={deleting}
        onTab={setTab}
        onNew={() => void navigate("/coach/library/meal-plans/new")}
        onEdit={(id) => void navigate(`/coach/library/meal-plans/${id}/edit`)}
        onSend={setSendId}
        onAskDelete={setDeleteId}
        onCancelDelete={() => setDeleteId(null)}
        onConfirmDelete={async () => {
          if (!deleteId) return;
          setDeleting(true);
          setError(null);
          try {
            await api.archivePlan(deleteId);
            await refreshMealPlans(queryClient);
            setDeleteId(null);
          } catch (e) {
            setDeleteId(null);
            setError(
              isCoachApiError(e) && e.offline
                ? "You’re offline. Deleting a plan needs a connection."
                : "We couldn’t delete that plan. Try again.",
            );
          } finally {
            setDeleting(false);
          }
        }}
        onShareRecipe={setShareId}
      />
      {sendPlan && (
        <SendPlanContainer
          mode="send"
          plan={sendPlan}
          client={null}
          clients={active}
          onDone={done}
          onClose={() => setSendId(null)}
        />
      )}
      {sharing && (
        <ShareRecipeContainer
          recipe={sharing}
          client={null}
          clients={active}
          onDone={done}
          onClose={() => setShareId(null)}
        />
      )}
      {toast && <Toast text={toast} />}
    </>
  );
}
