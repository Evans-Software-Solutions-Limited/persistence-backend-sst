import type { CoachRecipe, CoachSavedMeal, LibraryPlan } from "../api/types";
import { LibraryTabs } from "../forms/FormsLibrary";
import {
  kcalText,
  planSubline,
  recipePortion,
  recipeSubline,
} from "../lib/mealPlans";
import { IconPlus, IconSend, IconTrash } from "../ui/icons";
import { Dialog, Notice, OfflineBanner } from "../ui/parts";

export type LibraryNutritionTab = "plans" | "recipes" | "meals";

export interface MealPlansLibraryProps {
  tab: LibraryNutritionTab;
  plans: LibraryPlan[] | null;
  recipes: CoachRecipe[] | null;
  meals: CoachSavedMeal[] | null;
  offlineAsOf: string | null;
  notice: string | null;
  error: string | null;
  confirmDelete: LibraryPlan | null;
  deleting: boolean;
  onTab: (tab: LibraryNutritionTab) => void;
  onNew: () => void;
  onEdit: (planId: string) => void;
  onSend: (planId: string) => void;
  onAskDelete: (planId: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onShareRecipe: (recipeId: string) => void;
}

const count = (list: unknown[] | null) => (list ? ` · ${list.length}` : "");

/** C2 Library · Nutrition: your plans, recipes and saved meals. */
export function MealPlansLibrary(p: MealPlansLibraryProps) {
  const tabs: [LibraryNutritionTab, string][] = [
    ["plans", `Plans${count(p.plans)}`],
    ["recipes", `Recipes${count(p.recipes)}`],
    ["meals", `Meals${count(p.meals)}`],
  ];
  return (
    <>
      <LibraryTabs current="Meal plans" />
      <header style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 className="h1">Meal plans</h1>
          <span className="sub">Your plans, recipes and meals.</span>
        </div>
        <button
          type="button"
          className="btn v sm"
          onClick={p.onNew}
          disabled={p.offlineAsOf !== null}
        >
          <IconPlus size={16} />
          New plan
        </button>
      </header>
      {p.offlineAsOf !== null && (
        <OfflineBanner subject="your library" asOf={p.offlineAsOf} />
      )}
      {p.notice && <Notice tone="info">{p.notice}</Notice>}
      {p.error && <Notice tone="error">{p.error}</Notice>}
      <div className="seg" role="radiogroup" aria-label="Show">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={p.tab === key}
            onClick={() => p.onTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {p.tab === "plans" && <PlansList {...p} />}
      {p.tab === "recipes" && (
        <section aria-label="Recipes">
          {p.recipes === null ? (
            <p className="sub">Loading…</p>
          ) : p.recipes.length === 0 ? (
            <p className="hint">
              No recipes yet. Recipes you save in the app show here.
            </p>
          ) : (
            p.recipes.map((r) => (
              <div key={r.id} className="row">
                <div className="tx">
                  <span className="n">{r.name}</span>
                  <span className="s">{recipeSubline(r)}</span>
                </div>
                <span className="mono">{kcalText(recipePortion(r).kcal)}</span>
                <button
                  type="button"
                  className="btn xs ghost"
                  onClick={() => p.onShareRecipe(r.id)}
                  disabled={p.offlineAsOf !== null}
                >
                  Share with a client
                </button>
              </div>
            ))
          )}
        </section>
      )}
      {p.tab === "meals" && (
        <section aria-label="Meals">
          {p.meals === null ? (
            <p className="sub">Loading…</p>
          ) : p.meals.length === 0 ? (
            <p className="hint">
              No saved meals yet. Meals you save in the app show here.
            </p>
          ) : (
            p.meals.map((m) => (
              <div key={m.id} className="row">
                <div className="tx">
                  <span className="n">{m.name}</span>
                  <span className="s">Saved meal</span>
                </div>
                <span className="mono">{kcalText(m.totalKcal)}</span>
              </div>
            ))
          )}
        </section>
      )}
      {p.confirmDelete && (
        <Dialog
          title={`Delete ${p.confirmDelete.name}?`}
          onClose={p.onCancelDelete}
        >
          <p className="sub">
            It leaves your library, and clients you sent it to stop seeing it.
            Food they have already logged stays in their diary.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn ghost sm"
              onClick={p.onCancelDelete}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn dang sm"
              onClick={p.onConfirmDelete}
              disabled={p.deleting}
            >
              {p.deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function PlansList(p: MealPlansLibraryProps) {
  if (p.plans === null) return <p className="sub">Loading…</p>;
  if (p.plans.length === 0) {
    return (
      <p className="hint">
        No plans yet. Build one, then send it to a client with a note.
      </p>
    );
  }
  const offline = p.offlineAsOf !== null;
  return (
    <section aria-label="Plans">
      {p.plans.map((plan) => (
        <div key={plan.id} className="row">
          <button
            type="button"
            className="tx lk quiet"
            style={{ textAlign: "left", flex: 1 }}
            onClick={() => p.onEdit(plan.id)}
            aria-label={`Edit ${plan.name}`}
          >
            <span className="n">{plan.name}</span>
            <span className="s">{planSubline(plan)}</span>
          </button>
          <span className="mono">{kcalText(plan.totals.kcal)}</span>
          <button
            type="button"
            className="ibtn"
            aria-label={`Send ${plan.name} to a client`}
            onClick={() => p.onSend(plan.id)}
            disabled={offline}
          >
            <IconSend size={16} />
          </button>
          <button
            type="button"
            className="ibtn danger"
            aria-label={`Delete ${plan.name}`}
            onClick={() => p.onAskDelete(plan.id)}
            disabled={offline}
          >
            <IconTrash size={16} />
          </button>
        </div>
      ))}
    </section>
  );
}
