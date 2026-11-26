import {
  kcalText,
  mealTotals,
  portionText,
  servingText,
  type PlanEditorValues,
  type PlanVsTarget,
} from "../lib/mealPlans";
import { PLAN_MEAL_NAME_MAX, PLAN_NAME_MAX } from "../lib/planForm";
import { firstName } from "../lib/people";
import { IconChevron, IconChevronDown, IconPlus, IconTrash } from "../ui/icons";
import { BackLink, Notice } from "../ui/parts";
import { PlanWheel, TargetStrip } from "./PlanWheel";

export interface PlanEditorProps {
  isNew: boolean;
  backTo: string;
  backLabel: string;
  /** The client whose target the plan is measured against, when opened from one. */
  clientName: string | null;
  /** "Sent 21 Oct", when the plan is with that client. */
  sentWords: string | null;
  values: PlanEditorValues;
  view: PlanVsTarget;
  targetKcal: string | null;
  plannedKcal: string;
  openMeal: number;
  nameError: string | null;
  mealErrors: Record<number, string>;
  formError: string | null;
  dirty: boolean;
  busy: boolean;
  offline: boolean;
  notice: string | null;
  error: string | null;
  onName: (name: string) => void;
  onMealName: (meal: number, name: string) => void;
  onToggleMeal: (meal: number) => void;
  onPortion: (meal: number, item: number, by: 1 | -1) => void;
  onRemoveItem: (meal: number, item: number) => void;
  onRemoveMeal: (meal: number) => void;
  onAddMeal: () => void;
  onAddTo: (meal: number) => void;
  onSave: () => void;
}

/** C3 Edit a plan: the macro wheel, the meals and their portions. */
export function PlanEditor(p: PlanEditorProps) {
  const first = p.clientName ? firstName(p.clientName) : null;
  const saveLabel = p.busy
    ? "Saving…"
    : first && !p.isNew
      ? `Save changes for ${first}`
      : "Save plan";
  const saveDisabled = p.busy || p.offline || !p.dirty;
  return (
    <>
      <BackLink to={p.backTo} label={p.backLabel} />
      <header style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 className="h1">{p.isNew ? "New meal plan" : "Edit meal plan"}</h1>
          {first && (
            <span className="sub">
              {[p.clientName, p.sentWords, `edits reach ${first} automatically`]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
        </div>
        <button
          type="button"
          className="btn v sm"
          onClick={p.onSave}
          disabled={saveDisabled}
        >
          Save
        </button>
      </header>
      {p.offline && (
        <Notice tone="info">
          You’re offline. Your changes stay here; save when you’re back online.
        </Notice>
      )}
      {p.notice && <Notice tone="info">{p.notice}</Notice>}
      {p.error && <Notice tone="error">{p.error}</Notice>}
      <div className="editor-grid">
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <label className="fl">
            Plan name
            <input
              className="fld"
              value={p.values.name}
              maxLength={PLAN_NAME_MAX * 2}
              placeholder="e.g. Lean bulk · Training day"
              aria-invalid={p.nameError ? "true" : undefined}
              onChange={(e) => p.onName(e.target.value)}
            />
            {p.nameError && (
              <span className="err" role="alert">
                {p.nameError}
              </span>
            )}
          </label>
          <PlanWheel view={p.view} />
          <TargetStrip
            targetKcal={p.targetKcal}
            targetLabel={first ? `${first}’s target` : "Target"}
            plannedKcal={p.plannedKcal}
            view={p.view}
          />
          {!first && (
            <p className="hint" style={{ margin: 0 }}>
              Open this plan from a client’s Nutrition tab to see it against
              their target.
            </p>
          )}
        </div>
        <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
          {p.values.meals.map((meal, mi) => {
            const open = p.openMeal === mi;
            const kcal = kcalText(mealTotals(meal).kcal);
            return (
              <section
                key={meal.key}
                className="sec-block"
                aria-label={meal.name || `Meal ${mi + 1}`}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    type="button"
                    className="ibtn"
                    aria-expanded={open}
                    aria-label={`${open ? "Collapse" : "Expand"} ${meal.name || `meal ${mi + 1}`}`}
                    onClick={() => p.onToggleMeal(mi)}
                  >
                    {open ? (
                      <IconChevronDown size={16} />
                    ) : (
                      <IconChevron size={16} />
                    )}
                  </button>
                  {open ? (
                    <input
                      className="fld"
                      style={{ flex: 1 }}
                      aria-label="Meal name"
                      value={meal.name}
                      maxLength={PLAN_MEAL_NAME_MAX * 2}
                      aria-invalid={p.mealErrors[mi] ? "true" : undefined}
                      onChange={(e) => p.onMealName(mi, e.target.value)}
                    />
                  ) : (
                    <b style={{ flex: 1 }}>{meal.name}</b>
                  )}
                  <span className="mono">{kcal} kcal</span>
                  {open && p.values.meals.length > 1 && (
                    <button
                      type="button"
                      className="ibtn danger"
                      aria-label={`Remove ${meal.name || `meal ${mi + 1}`}`}
                      onClick={() => p.onRemoveMeal(mi)}
                    >
                      <IconTrash size={16} />
                    </button>
                  )}
                </div>
                {p.mealErrors[mi] && (
                  <span className="err" role="alert">
                    {p.mealErrors[mi]}
                  </span>
                )}
                {!open && meal.items.length > 0 && (
                  <p className="hint" style={{ margin: "6px 0 0" }}>
                    {meal.items.map((i) => i.name).join(" · ")}
                  </p>
                )}
                {open && (
                  <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                    {meal.items.length === 0 && (
                      <p className="hint" style={{ margin: 0 }}>
                        Nothing in this meal yet.
                      </p>
                    )}
                    {meal.items.map((item, ii) => (
                      <div key={item.key} className="row">
                        <div className="tx">
                          <span className="n">{item.name}</span>
                          <span className="s">{servingText(item)}</span>
                        </div>
                        <div
                          role="group"
                          aria-label={`Portion of ${item.name}`}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <button
                            type="button"
                            className="btn xs ghost"
                            aria-label={`Less ${item.name}`}
                            onClick={() => p.onPortion(mi, ii, -1)}
                          >
                            −
                          </button>
                          <span
                            className="mono"
                            style={{ minWidth: 44, textAlign: "center" }}
                          >
                            {portionText(item.servings)}
                          </span>
                          <button
                            type="button"
                            className="btn xs ghost"
                            aria-label={`More ${item.name}`}
                            onClick={() => p.onPortion(mi, ii, 1)}
                          >
                            +
                          </button>
                        </div>
                        <span
                          className="mono"
                          style={{ minWidth: 48, textAlign: "right" }}
                        >
                          {kcalText(item.perServing.kcal * item.servings)}
                        </span>
                        <button
                          type="button"
                          className="ibtn danger"
                          aria-label={`Remove ${item.name}`}
                          onClick={() => p.onRemoveItem(mi, ii)}
                        >
                          <IconTrash size={14} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="lk"
                      style={{ justifySelf: "start" }}
                      aria-label={`Add to ${meal.name || `meal ${mi + 1}`}`}
                      onClick={() => p.onAddTo(mi)}
                    >
                      + Add food
                    </button>
                  </div>
                )}
              </section>
            );
          })}
          <button
            type="button"
            className="btn ghost sm"
            style={{ justifySelf: "start" }}
            onClick={p.onAddMeal}
          >
            <IconPlus size={16} />
            Add a meal
          </button>
          {p.formError && (
            <span className="err" role="alert">
              {p.formError}
            </span>
          )}
          <div className="footer-bar">
            <button
              type="button"
              className="btn v"
              onClick={p.onSave}
              disabled={saveDisabled}
            >
              {saveLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
