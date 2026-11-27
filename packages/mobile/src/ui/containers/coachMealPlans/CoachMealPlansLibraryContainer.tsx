import { useState } from "react";
import { router } from "expo-router";

import {
  kcalText,
  librarySubline,
} from "@/domain/services/coachMealPlans.service";
import { visibleMyPlans } from "@/domain/services/nutritionPlans.service";
import { useGetMeals } from "@/ui/hooks/useGetMeals";
import { useGetRecipes } from "@/ui/hooks/useGetRecipes";
import { useGetTrainerClients } from "@/ui/hooks/useGetTrainerClients";
import { useNutritionPlans } from "@/ui/hooks/useNutritionPlans";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import {
  CoachMealPlansLibraryPresenter,
  type MealsLibraryTab,
} from "@/ui/presenters/coachMealPlans/CoachMealPlansLibraryPresenter";
import {
  ActionsSheetPresenter,
  ConfirmSheetPresenter,
} from "@/ui/presenters/coachMealPlans/CoachPlanSheets";
import { Note } from "@/ui/presenters/coachForms/kit";
import { CoachPlanSendContainer } from "./CoachPlanSendContainer";
import { CoachRecipeShareContainer } from "./CoachRecipeShareContainer";

const portionKcal = (total: number | null, servings: number) =>
  kcalText((total ?? 0) / (servings > 0 ? servings : 1));

/**
 * C2 Library · Meals (iPhone, PER-135). The coach's plans are their own
 * plans on this phone (PER-133 cache and queue), so they show and edit
 * offline; Delete queues too. Send and recipe share need a connection.
 */
export function CoachMealPlansLibraryContainer() {
  const online = useOnlineStatus();
  const plans = useNutritionPlans();
  const recipes = useGetRecipes();
  const meals = useGetMeals();
  const clients = useGetTrainerClients();
  const [tab, setTab] = useState<MealsLibraryTab>("plans");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [sendId, setSendId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const mine = visibleMyPlans(plans.cache);
  const byId = (id: string | null) => mine.find((p) => p.id === id) ?? null;
  const menuPlan = byId(menuId);
  const sendPlan = byId(sendId);
  const deletePlan = byId(deleteId);
  const sharing = (recipes.data ?? []).find((r) => r.id === shareId) ?? null;
  const conflictId = plans.cache.conflictPlanIds[0] ?? null;

  return (
    <>
      <CoachMealPlansLibraryPresenter
        tab={tab}
        plans={
          plans.isLoading && mine.length === 0
            ? null
            : mine.map((p) => ({
                id: p.id,
                title: p.name,
                subtitle: librarySubline(p),
                kcal: kcalText(p.totals.kcal),
              }))
        }
        recipes={
          recipes.data
            ? recipes.data.map((r) => ({
                id: r.id,
                title: r.name,
                subtitle: `${r.sourceUrl ? "Imported from a link" : "Recipe"} · ${r.servings} ${r.servings === 1 ? "portion" : "portions"}`,
                kcal: portionKcal(r.totalKcal, r.servings),
              }))
            : null
        }
        meals={
          meals.data
            ? meals.data.map((m) => ({
                id: m.id,
                title: m.name,
                subtitle: "Saved meal",
                kcal: kcalText(m.totalKcal),
              }))
            : null
        }
        online={online}
        conflict={!!conflictId}
        onTab={setTab}
        onNew={() => router.push("/(app)/coach-meal-plans/edit" as never)}
        onPlan={setMenuId}
        onRecipe={setShareId}
        onDismissConflict={() => conflictId && plans.clearConflict(conflictId)}
      />
      {toast ? (
        <Note onDismiss={() => setToast(null)} testID="coach-meals-toast">
          {toast}
        </Note>
      ) : null}
      <ActionsSheetPresenter
        visible={!!menuPlan}
        title={menuPlan?.name ?? ""}
        actions={[
          { key: "edit", title: "Edit plan" },
          {
            key: "send",
            title: "Send to a client",
            subtitle: online ? "With a note, no days" : "Needs a connection",
            disabled: !online,
          },
          { key: "delete", title: "Delete", danger: true },
        ]}
        onAction={(key) => {
          const id = menuId;
          setMenuId(null);
          if (key === "edit") {
            router.push(`/(app)/coach-meal-plans/edit?id=${id}` as never);
          } else if (key === "send") setSendId(id);
          else setDeleteId(id);
        }}
        onClose={() => setMenuId(null)}
      />
      <ConfirmSheetPresenter
        visible={!!deletePlan}
        title={deletePlan ? `Delete ${deletePlan.name}?` : ""}
        body="It leaves your library, and clients you sent it to stop seeing it. Food they have already logged stays in their diary."
        confirmLabel="Delete"
        busy={false}
        onConfirm={() => {
          const id = deleteId;
          setDeleteId(null);
          if (id) void plans.remove(id);
        }}
        onClose={() => setDeleteId(null)}
      />
      {sendPlan ? (
        <CoachPlanSendContainer
          mode="send"
          plan={sendPlan}
          client={null}
          clients={clients.data ?? []}
          onDone={(m) => {
            setSendId(null);
            setToast(m);
          }}
          onClose={() => setSendId(null)}
        />
      ) : null}
      {sharing ? (
        <CoachRecipeShareContainer
          recipe={sharing}
          client={null}
          clients={clients.data ?? []}
          onDone={(m) => {
            setShareId(null);
            setToast(m);
          }}
          onClose={() => setShareId(null)}
        />
      ) : null}
    </>
  );
}
