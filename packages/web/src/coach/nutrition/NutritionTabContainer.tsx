import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isCoachApiError } from "../api/coachApi";
import type { LibraryPlan, RosterClient } from "../api/types";
import {
  COACH_NETWORK_MODE,
  coachKeys,
  useCoachApi,
  useCoachProfile,
  useOnline,
} from "../hooks/coachQueries";
import { calorieLine, kcalText, loggedThisWeek } from "../lib/mealPlans";
import { clockTime, firstName } from "../lib/people";
import { Dialog, Toast } from "../ui/parts";
import { NutritionTab } from "./NutritionTab";
import { SendPlanContainer } from "./SendPlanContainer";
import { ShareRecipeContainer } from "./ShareRecipeContainer";

/**
 * C3.2 Nutrition tab (`/coach/clients/:clientId/nutrition`). `?send=<planId>`
 * opens Send for that plan (a plan just built for this client).
 */
export function NutritionTabContainer({ client }: { client: RosterClient }) {
  const api = useCoachApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const online = useOnline();
  const profile = useCoachProfile();
  const [search, setSearch] = useSearchParams();
  const first = firstName(client.name);
  const key = coachKeys.clientMealPlans(client.id);

  const plans = useQuery({
    queryKey: key,
    queryFn: () => api.clientMealPlans(client.id),
    networkMode: COACH_NETWORK_MODE,
  });
  const adherence = useQuery({
    queryKey: coachKeys.clientAdherence(client.id),
    queryFn: () => api.clientAdherence(client.id),
    networkMode: COACH_NETWORK_MODE,
    retry: false,
  });
  const library = useQuery({
    queryKey: coachKeys.libraryPlans,
    queryFn: () => api.libraryPlans(),
    networkMode: COACH_NETWORK_MODE,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [sendId, setSendId] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const assignments = plans.data?.assignments ?? null;
  const find = (id: string | null) =>
    assignments?.find((a) => a.id === id) ?? null;
  const sendParam = search.get("send");
  const sendPlan: LibraryPlan | null =
    library.data?.find((p) => p.id === (sendId ?? sendParam)) ?? null;
  const noteFor = find(noteId);
  const calories = adherence.data?.calories
    ? calorieLine(adherence.data.calories)
    : null;

  function closeSend() {
    setSendId(null);
    if (sendParam) {
      search.delete("send");
      setSearch(search, { replace: true });
    }
  }

  function done(message: string) {
    closeSend();
    setNoteId(null);
    setSharing(false);
    setToast(message);
    window.setTimeout(() => setToast(null), 2500);
  }

  const loadError =
    plans.isError && !plans.data
      ? online
        ? `We couldn’t load ${first}’s meal plans.`
        : `You’re offline. ${first}’s meal plans load when you’re back online.`
      : null;

  return (
    <>
      <NutritionTab
        clientFirst={first}
        clientId={client.id}
        coachId={profile.data?.id ?? null}
        assignments={assignments ?? (plans.isError ? [] : null)}
        target={plans.data?.target ?? null}
        calories={calories}
        loggedThisWeek={assignments ? loggedThisWeek(assignments) : 0}
        selectedId={selectedId}
        menuFor={find(menuId)}
        confirmRemove={find(removeId)}
        removing={removing}
        offlineAsOf={
          online
            ? null
            : plans.dataUpdatedAt
              ? clockTime(plans.dataUpdatedAt)
              : null
        }
        error={error ?? loadError}
        onSelect={setSelectedId}
        onAdd={() => setPicking(true)}
        onShareRecipe={() => setSharing(true)}
        onMenu={setMenuId}
        onEditPlan={(planId) =>
          void navigate(
            `/coach/library/meal-plans/${planId}/edit?client=${client.id}`,
          )
        }
        onChangeNote={(id) => {
          setMenuId(null);
          setNoteId(id);
        }}
        onAskRemove={(id) => {
          setMenuId(null);
          setRemoveId(id);
        }}
        onCancelRemove={() => setRemoveId(null)}
        onConfirmRemove={async () => {
          if (!removeId) return;
          setRemoving(true);
          setError(null);
          try {
            await api.removeAssignment(client.id, removeId);
            await queryClient.invalidateQueries({ queryKey: key });
            setRemoveId(null);
          } catch (e) {
            setRemoveId(null);
            setError(
              isCoachApiError(e) && e.offline
                ? "You’re offline. Removing a plan needs a connection."
                : "We couldn’t remove that plan. Try again.",
            );
          } finally {
            setRemoving(false);
          }
        }}
      />
      {picking && (
        <PickPlanDialog
          clientFirst={first}
          plans={library.data ?? (library.isError ? [] : null)}
          sentPlanIds={new Set((assignments ?? []).map((a) => a.planId))}
          onPick={(id) => {
            setPicking(false);
            setSendId(id);
          }}
          onBuild={() =>
            void navigate(`/coach/library/meal-plans/new?client=${client.id}`)
          }
          onClose={() => setPicking(false)}
        />
      )}
      {sendPlan && (
        <SendPlanContainer
          mode="send"
          plan={sendPlan}
          client={client}
          onDone={done}
          onClose={closeSend}
        />
      )}
      {noteFor && (
        <SendPlanContainer
          mode="note"
          plan={noteFor.plan}
          client={client}
          assignmentId={noteFor.id}
          initialNote={noteFor.note}
          onDone={done}
          onClose={() => setNoteId(null)}
        />
      )}
      {sharing && (
        <ShareRecipeContainer
          recipe={null}
          client={client}
          onDone={done}
          onClose={() => setSharing(false)}
        />
      )}
      {toast && <Toast text={toast} />}
    </>
  );
}

/** "+ Add": pick a plan from the library, or build a new one for this client. */
export function PickPlanDialog({
  clientFirst,
  plans,
  sentPlanIds,
  onPick,
  onBuild,
  onClose,
}: {
  clientFirst: string;
  plans: LibraryPlan[] | null;
  sentPlanIds: Set<string>;
  onPick: (planId: string) => void;
  onBuild: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog title={`Add a meal plan for ${clientFirst}`} onClose={onClose}>
      <div style={{ display: "grid", gap: 6 }}>
        {plans === null ? (
          <p className="sub">Loading…</p>
        ) : plans.length === 0 ? (
          <p className="hint">Your library has no plans yet.</p>
        ) : (
          plans.map((p) => {
            const sent = sentPlanIds.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                className="row"
                disabled={sent}
                onClick={() => onPick(p.id)}
              >
                <span className="tx">
                  <span className="n">{p.name}</span>
                  <span className="s">
                    {sent
                      ? `Already with ${clientFirst}`
                      : `${p.meals.length} ${p.meals.length === 1 ? "meal" : "meals"}`}
                  </span>
                </span>
                <span className="mono">{kcalText(p.totals.kcal)}</span>
              </button>
            );
          })
        )}
        <button type="button" className="btn ghost sm" onClick={onBuild}>
          Build a new plan for {clientFirst}
        </button>
      </div>
    </Dialog>
  );
}
