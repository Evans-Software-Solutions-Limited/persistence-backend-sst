import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isCoachApiError } from "../api/coachApi";
import type { CoachRecipe, RosterClient } from "../api/types";
import {
  COACH_NETWORK_MODE,
  coachKeys,
  useCoachApi,
  useOnline,
} from "../hooks/coachQueries";
import { kcalText, recipePortion } from "../lib/mealPlans";
import { firstName } from "../lib/people";
import { Dialog, Notice } from "../ui/parts";

/**
 * Share a recipe with a client (Design D: coach → client only). The client
 * gets their own copy with attribution; sharing the same recipe again is a
 * no-op on the server. Needs a connection.
 */
export function ShareRecipeContainer({
  recipe,
  client,
  clients,
  onDone,
  onClose,
}: {
  /** Library: the recipe is chosen, pick a client. */
  recipe: CoachRecipe | null;
  /** Client tab: the client is known, pick a recipe. */
  client: RosterClient | null;
  clients?: RosterClient[];
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const api = useCoachApi();
  const online = useOnline();
  const recipes = useQuery({
    queryKey: coachKeys.recipes,
    queryFn: () => api.recipes(),
    enabled: !recipe,
    networkMode: COACH_NETWORK_MODE,
  });
  const [clientId, setClientId] = useState<string | null>(client?.id ?? null);
  const [recipeId, setRecipeId] = useState<string | null>(recipe?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosenClient =
    client ?? clients?.find((c) => c.id === clientId) ?? null;
  const chosenRecipe =
    recipe ?? recipes.data?.find((r) => r.id === recipeId) ?? null;

  return (
    <ShareRecipeDialog
      recipe={recipe}
      recipes={recipe ? null : (recipes.data ?? null)}
      recipeId={recipeId}
      clientName={client?.name ?? null}
      clients={client ? null : (clients ?? [])}
      clientId={clientId}
      busy={busy}
      offline={!online}
      error={error}
      onRecipe={setRecipeId}
      onClient={setClientId}
      onClose={onClose}
      onShare={async () => {
        if (!chosenClient || !chosenRecipe) return;
        setBusy(true);
        setError(null);
        try {
          const shared = await api.shareRecipe(
            chosenClient.id,
            chosenRecipe.id,
          );
          const first = firstName(chosenClient.name);
          onDone(
            shared.created
              ? `${chosenRecipe.name} shared with ${first}`
              : `${first} already has ${chosenRecipe.name}`,
          );
        } catch (e) {
          setError(
            isCoachApiError(e) && e.offline
              ? "You’re offline. Try again when you’re back online."
              : isCoachApiError(e) && e.status === 404
                ? "This recipe or client isn’t available any more."
                : isCoachApiError(e)
                  ? e.message
                  : "We couldn’t share that recipe. Try again.",
          );
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

export function ShareRecipeDialog(p: {
  recipe: CoachRecipe | null;
  recipes: CoachRecipe[] | null;
  recipeId: string | null;
  clientName: string | null;
  clients: RosterClient[] | null;
  clientId: string | null;
  busy: boolean;
  offline: boolean;
  error: string | null;
  onRecipe: (id: string) => void;
  onClient: (id: string) => void;
  onShare: () => void;
  onClose: () => void;
}) {
  const first = p.clientName ? firstName(p.clientName) : null;
  return (
    <Dialog
      title={first ? `Share a recipe with ${first}` : "Share a recipe"}
      onClose={p.onClose}
    >
      <div style={{ display: "grid", gap: 14 }}>
        {p.recipe && (
          <div>
            <b>{p.recipe.name}</b>
            <div className="hint">
              {kcalText(recipePortion(p.recipe).kcal)} kcal a portion
            </div>
          </div>
        )}
        {p.recipes && (
          <label className="fl">
            Recipe
            <select
              className="fld"
              value={p.recipeId ?? ""}
              onChange={(e) => p.onRecipe(e.target.value)}
            >
              <option value="" disabled>
                {p.recipes.length === 0 ? "No recipes yet" : "Choose a recipe"}
              </option>
              {p.recipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {p.clients && (
          <label className="fl">
            Share with
            <select
              className="fld"
              value={p.clientId ?? ""}
              onChange={(e) => p.onClient(e.target.value)}
            >
              <option value="" disabled>
                Choose a client
              </option>
              {p.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="hint" style={{ margin: 0 }}>
          {first ?? "Your client"} gets their own copy in their recipes. Changes
          you make later stay in yours.
        </p>
        {p.offline && (
          <Notice tone="info">
            You’re offline. Sharing needs a connection.
          </Notice>
        )}
        {p.error && <Notice tone="error">{p.error}</Notice>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn ghost sm" onClick={p.onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn v sm"
            disabled={
              p.busy ||
              p.offline ||
              !(p.recipe || p.recipeId) ||
              !(p.clientName || p.clientId)
            }
            onClick={p.onShare}
          >
            {p.busy ? "Sharing…" : "Share"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
