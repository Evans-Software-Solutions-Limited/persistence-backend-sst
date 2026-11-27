import { useState } from "react";

import type { Recipe } from "@/domain/models/nutrition";
import type { TrainerClient } from "@/domain/models/trainerClient";
import { firstName, kcalText } from "@/domain/services/coachMealPlans.service";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import { PickerSheetPresenter } from "@/ui/presenters/coachMealPlans/CoachPlanSheets";

/**
 * Share a recipe with a client (Design D: coach → client only, a copy with
 * attribution; sharing it again changes nothing). From the library the
 * recipe is known and a client is picked; from a client's Nutrition tab the
 * client is known and a recipe is picked. Needs a connection.
 */
export function CoachRecipeShareContainer(p: {
  recipe: Recipe | null;
  recipes?: readonly Recipe[] | null;
  client: { id: string; name: string } | null;
  clients?: readonly TrainerClient[];
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const { api } = useAdapters();
  const online = useOnlineStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function share(recipe: Recipe, client: { id: string; name: string }) {
    setBusy(true);
    setError(null);
    const result = await api.shareCoachRecipe(client.id, recipe.id);
    setBusy(false);
    if (result.ok) {
      const first = firstName(client.name);
      p.onDone(
        result.value.created
          ? `${recipe.name} shared with ${first}`
          : `${first} already has ${recipe.name}`,
      );
      return;
    }
    setError(
      result.error.status === 404
        ? "This recipe or client isn’t available any more."
        : "We couldn’t share that recipe. Try again.",
    );
  }

  const pickClient = !p.client;
  const options = pickClient
    ? (p.clients ?? [])
        .filter((c) => c.status === "active")
        .map((c) => ({ id: c.id, title: c.name, disabled: busy || !online }))
    : ((p.recipes ?? null)?.map((r) => ({
        id: r.id,
        title: r.name,
        right: `${kcalText((r.totalKcal ?? 0) / (r.servings > 0 ? r.servings : 1))}`,
        subtitle: "kcal a portion",
        disabled: busy || !online,
      })) ?? null);

  const title = pickClient
    ? `Share ${p.recipe?.name ?? "a recipe"}`
    : `Share a recipe with ${firstName(p.client!.name)}`;
  const empty = !online
    ? "You’re offline. Sharing needs a connection."
    : pickClient
      ? "No active clients yet."
      : "No recipes yet.";

  return (
    <PickerSheetPresenter
      visible
      title={title}
      error={error}
      options={!online ? [] : options}
      empty={empty}
      onPick={(id) => {
        if (pickClient) {
          const c = (p.clients ?? []).find((x) => x.id === id);
          if (c && p.recipe) void share(p.recipe, { id: c.id, name: c.name });
        } else {
          const r = (p.recipes ?? []).find((x) => x.id === id);
          if (r) void share(r, p.client!);
        }
      }}
      onClose={p.onClose}
      testID="share-recipe-sheet"
    />
  );
}
