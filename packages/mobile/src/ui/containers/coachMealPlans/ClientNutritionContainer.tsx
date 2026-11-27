import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";

import {
  asNutritionTarget,
  assignmentStatus,
  calorieLine,
  firstName,
  kcalText,
  loggedThisWeek,
  macroLine,
  plannedLine,
  targetSetBy,
} from "@/domain/services/coachMealPlans.service";
import {
  resolvePlanId,
  visibleMyPlans,
} from "@/domain/services/nutritionPlans.service";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useCoachClientMealPlans } from "@/ui/hooks/useCoachClientMealPlans";
import { useGetRecipes } from "@/ui/hooks/useGetRecipes";
import { useNutritionPlans } from "@/ui/hooks/useNutritionPlans";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import { ClientNutritionTabPresenter } from "@/ui/presenters/coachMealPlans/ClientNutritionTabPresenter";
import {
  ActionsSheetPresenter,
  ConfirmSheetPresenter,
  PickerSheetPresenter,
} from "@/ui/presenters/coachMealPlans/CoachPlanSheets";
import { Note } from "@/ui/presenters/coachForms/kit";
import { PlanOpenedSheetPresenter } from "@/ui/presenters/coachMealPlans/PlanOpenedSheetPresenter";
import { CoachPlanSendContainer } from "./CoachPlanSendContainer";
import { CoachRecipeShareContainer } from "./CoachRecipeShareContainer";

export const WAITING_TO_SYNC = "Waiting to sync";
export const SEND_WAITING =
  "This plan is waiting to sync. Send opens once it's saved.";
const isLocalPlanId = (id: string) => id.startsWith("local-");

const clock = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/**
 * C3.2b iPhone · Nutrition (PER-135): the client's own target, this coach's
 * plans for them with status and usage, calorie adherence (PER-114), and the
 * C1b actions: Edit plan, Change the note, Remove. `?send=<planId>` (a plan
 * just built for this client) opens Send. Sending, notes, removing and
 * recipe share need a connection; the last read stays on screen offline.
 */
export function ClientNutritionContainer(p: {
  clientId: string;
  clientName: string | null;
}) {
  const { api } = useAdapters();
  const { session } = useAuth();
  const online = useOnlineStatus();
  const params = useLocalSearchParams<{ send?: string }>();
  const state = useCoachClientMealPlans(p.clientId);
  const library = useNutritionPlans();
  const recipes = useGetRecipes();
  const name = p.clientName ?? "";
  const first = firstName(name);
  const client = { id: p.clientId, name };

  const [openId, setOpenId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [sendId, setSendId] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // `?send=` is handled once, then cleared, so a remount doesn't reopen Send.
  useEffect(() => {
    if (typeof params.send === "string" && params.send) {
      setSendId(params.send);
      router.setParams({ send: "" } as never);
    }
  }, [params.send]);

  const assignments = state.data?.assignments ?? null;
  const find = (id: string | null) =>
    assignments?.find((a) => a.id === id) ?? null;
  const mine = visibleMyPlans(library.cache);
  // A plan built on this phone keeps its local id until its create syncs:
  // follow the alias to the server id, and wait while it's still local.
  const resolvedSend = sendId ? resolvePlanId(library.cache, sendId) : null;
  const sendWaiting = !!resolvedSend && isLocalPlanId(resolvedSend);
  const sendPlan =
    resolvedSend && !sendWaiting
      ? (mine.find((x) => x.id === resolvedSend) ?? null)
      : null;
  const target = state.data?.target ?? null;
  const opened = find(openId);
  const menu = find(menuId);
  const noteFor = find(noteId);
  const removeFor = find(removeId);
  const now = Date.now();

  function done(message: string) {
    setSendId(null);
    setNoteId(null);
    setSharing(false);
    setToast(message);
    void state.reload();
  }

  const editPlan = (planId: string) =>
    router.push(
      `/(app)/coach-meal-plans/edit?id=${encodeURIComponent(planId)}&client=${encodeURIComponent(p.clientId)}&clientName=${encodeURIComponent(name)}` as never,
    );

  const loadError =
    state.error && !state.data
      ? online
        ? `We couldn’t load ${first}’s meal plans. Tap to try again.`
        : `You’re offline. ${first}’s meal plans load when you’re back online.`
      : null;

  return (
    <>
      <ClientNutritionTabPresenter
        clientFirst={first}
        target={
          target
            ? `${kcalText(target.dailyKcal)} kcal · ${macroLine(target)}`
            : null
        }
        targetBy={
          target
            ? targetSetBy(
                target.setByUserId,
                session?.userId ?? null,
                p.clientId,
                first,
              )
            : null
        }
        rows={
          assignments
            ? assignments.map((a) => {
                const st = assignmentStatus(a, first, now);
                return {
                  assignmentId: a.id,
                  name: a.plan.name,
                  planned: plannedLine(a.plan),
                  status: st.text,
                  tone: st.tone,
                };
              })
            : state.isLoading
              ? null
              : []
        }
        loggedThisWeek={
          assignments && assignments.length > 0
            ? `Plan meals logged this week: ${loggedThisWeek(assignments)}`
            : null
        }
        calories={calorieLine(state.calories)}
        online={online}
        offlineLine={
          !online && state.readAt
            ? `Offline · showing ${first} as of ${clock(state.readAt)}`
            : null
        }
        error={error ?? loadError}
        onAdd={() => setPicking(true)}
        onOpen={setOpenId}
        onMore={setMenuId}
        onShareRecipe={() => setSharing(true)}
        onRetry={() => {
          setError(null);
          void state.reload();
        }}
      />
      {sendWaiting ? (
        <Note
          onDismiss={() => setSendId(null)}
          testID="client-nutrition-send-waiting"
        >
          {SEND_WAITING}
        </Note>
      ) : null}
      {toast ? (
        <ClientNutritionToast text={toast} onDone={() => setToast(null)} />
      ) : null}
      <PlanOpenedSheetPresenter
        visible={!!opened}
        plan={opened?.plan ?? null}
        target={asNutritionTarget(target, p.clientId)}
        clientFirst={first}
        online={online}
        onEdit={() => {
          const planId = opened?.planId;
          setOpenId(null);
          if (planId) editPlan(planId);
        }}
        onClose={() => setOpenId(null)}
      />
      <ActionsSheetPresenter
        visible={!!menu}
        title={menu?.plan.name ?? ""}
        actions={[
          {
            key: "edit",
            title: "Edit plan",
            subtitle: `Changes reach ${first} automatically`,
          },
          {
            key: "note",
            title: "Change the note",
            subtitle: `What ${first} reads with the plan`,
            disabled: !online,
          },
          {
            key: "remove",
            title: `Remove from ${first}`,
            danger: true,
            disabled: !online,
          },
        ]}
        onAction={(key) => {
          const a = menu;
          setMenuId(null);
          if (!a) return;
          if (key === "edit") editPlan(a.planId);
          else if (key === "note") setNoteId(a.id);
          else setRemoveId(a.id);
        }}
        onClose={() => setMenuId(null)}
      />
      <ConfirmSheetPresenter
        visible={!!removeFor}
        title={removeFor ? `Remove ${removeFor.plan.name}?` : ""}
        body={`${first} stops seeing it in their plans. Food they have already logged stays in their diary. It stays in your library.`}
        confirmLabel="Remove"
        busy={removing}
        onConfirm={async () => {
          if (!removeFor) return;
          setRemoving(true);
          const result = await api.removeCoachPlanAssignment(
            p.clientId,
            removeFor.id,
          );
          setRemoving(false);
          setRemoveId(null);
          if (result.ok) void state.reload();
          else setError("We couldn’t remove that plan. Try again.");
        }}
        onClose={() => setRemoveId(null)}
      />
      <PickerSheetPresenter
        visible={picking}
        title={`Add a meal plan for ${first}`}
        options={mine.map((x) => {
          const sent = (assignments ?? []).some((a) => a.planId === x.id);
          return {
            id: x.id,
            title: x.name,
            subtitle: sent
              ? `Already with ${first}`
              : `${x.meals.length} ${x.meals.length === 1 ? "meal" : "meals"}`,
            right: kcalText(x.totals.kcal),
            ...(isLocalPlanId(x.id) && !sent
              ? { subtitle: WAITING_TO_SYNC }
              : {}),
            disabled: sent || isLocalPlanId(x.id),
          };
        })}
        empty="Your library has no plans yet."
        footerLabel={`Build a new plan for ${first}`}
        onFooter={() => {
          setPicking(false);
          router.push(
            `/(app)/coach-meal-plans/edit?client=${encodeURIComponent(p.clientId)}&clientName=${encodeURIComponent(name)}` as never,
          );
        }}
        onPick={(id) => {
          setPicking(false);
          setSendId(id);
        }}
        onClose={() => setPicking(false)}
        testID="client-plan-picker"
      />
      {sendPlan ? (
        <CoachPlanSendContainer
          mode="send"
          plan={sendPlan}
          client={client}
          target={target}
          onDone={done}
          onClose={() => setSendId(null)}
        />
      ) : null}
      {noteFor ? (
        <CoachPlanSendContainer
          mode="note"
          plan={noteFor.plan}
          client={client}
          assignmentId={noteFor.id}
          initialNote={noteFor.note}
          onDone={done}
          onClose={() => setNoteId(null)}
        />
      ) : null}
      {sharing ? (
        <CoachRecipeShareContainer
          recipe={null}
          recipes={recipes.data}
          client={client}
          onDone={done}
          onClose={() => setSharing(false)}
        />
      ) : null}
    </>
  );
}

function ClientNutritionToast(p: { text: string; onDone: () => void }) {
  return (
    <Note onDismiss={p.onDone} testID="client-nutrition-toast">
      {p.text}
    </Note>
  );
}
