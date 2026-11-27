import type {
  ClientPlanAssignment,
  ClientTarget,
  LibraryPlan,
} from "../api/types";
import {
  assignmentStatus,
  kcalText,
  macroLine,
  planDetailLine,
  planVsTarget,
  targetSetBy,
} from "../lib/mealPlans";
import { IconPlus } from "../ui/icons";
import { Dialog, Notice, OfflineBanner } from "../ui/parts";
import { PlanWheel } from "./PlanWheel";

export interface NutritionTabProps {
  clientFirst: string;
  clientId: string;
  /** The signed-in coach, to say who set the target. */
  coachId: string | null;
  assignments: ClientPlanAssignment[] | null;
  target: ClientTarget | null;
  /** "5 of 7 days on target · 1 not logged" (PER-114), when tracked. */
  calories: string | null;
  loggedThisWeek: number;
  selectedId: string | null;
  menuFor: ClientPlanAssignment | null;
  confirmRemove: ClientPlanAssignment | null;
  removing: boolean;
  offlineAsOf: string | null;
  error: string | null;
  now?: number;
  onSelect: (assignmentId: string) => void;
  onAdd: () => void;
  onShareRecipe: () => void;
  onMenu: (assignmentId: string | null) => void;
  onEditPlan: (planId: string) => void;
  onChangeNote: (assignmentId: string) => void;
  onAskRemove: (assignmentId: string) => void;
  onCancelRemove: () => void;
  onConfirmRemove: () => void;
}

const TONE: Record<"ok" | "warn" | "idle", string> = {
  ok: "pl ok",
  warn: "pl warn",
  idle: "pl idle",
};

/** C3.2 Nutrition tab: the client's target, their meal plans, adherence. */
export function NutritionTab(p: NutritionTabProps) {
  const offline = p.offlineAsOf !== null;
  const selected =
    p.assignments?.find((a) => a.id === p.selectedId) ??
    p.assignments?.[0] ??
    null;
  return (
    <>
      {offline && (
        <OfflineBanner
          subject={`${p.clientFirst}’s nutrition`}
          asOf={p.offlineAsOf}
        />
      )}
      {p.error && <Notice tone="error">{p.error}</Notice>}
      <div className="checkins-grid">
        <div
          style={{
            minWidth: 0,
            display: "grid",
            gap: 16,
            alignContent: "start",
          }}
        >
          <section aria-label="Target" className="sec-block">
            <span className="st">Target</span>
            {p.target ? (
              <div style={{ marginTop: 6 }}>
                <b className="mono">{kcalText(p.target.dailyKcal)} kcal</b>
                <span className="mono">
                  {" "}
                  · {macroLine({ ...p.target, kcal: p.target.dailyKcal })}
                </span>
                <div className="hint">
                  {targetSetBy(
                    p.target.setByUserId,
                    p.coachId,
                    p.clientId,
                    p.clientFirst,
                  )}
                  {" · plans are measured against it"}
                </div>
              </div>
            ) : (
              <p className="hint" style={{ margin: "6px 0 0" }}>
                {p.clientFirst} has no calorie target yet. Plans show what’s
                planned until there is one.
              </p>
            )}
          </section>

          <section aria-label="Meal plans">
            <div className="grp">
              <span className="st">
                Meal plans{p.assignments ? ` · ${p.assignments.length}` : ""}
              </span>
              <button
                type="button"
                className="lk"
                style={{ minHeight: 0 }}
                onClick={p.onAdd}
                disabled={offline}
              >
                <IconPlus size={14} /> Add
              </button>
            </div>
            {p.assignments === null ? (
              <p className="sub">Loading…</p>
            ) : p.assignments.length === 0 ? (
              <p className="hint">
                No meal plans. Add one from your library or build one for{" "}
                {p.clientFirst}.
              </p>
            ) : (
              p.assignments.map((a) => {
                const st = assignmentStatus(a, p.clientFirst, p.now);
                const on = selected?.id === a.id;
                return (
                  <div key={a.id} className="row">
                    <button
                      type="button"
                      className="tx lk quiet"
                      style={{ textAlign: "left", flex: 1 }}
                      aria-current={on ? "true" : undefined}
                      onClick={() => p.onSelect(a.id)}
                    >
                      <span className="n">{a.plan.name}</span>
                      <span className="s">{planDetailLine(a.plan)}</span>
                      <span className={TONE[st.tone]}>{st.text}</span>
                    </button>
                    <button
                      type="button"
                      className="ibtn"
                      aria-label={`${a.plan.name} options`}
                      onClick={() => p.onMenu(a.id)}
                    >
                      ⋯
                    </button>
                  </div>
                );
              })
            )}
            {p.assignments && p.assignments.length > 0 && (
              <p className="hint" style={{ margin: "8px 0 0" }}>
                Plan meals logged this week: {p.loggedThisWeek}
              </p>
            )}
            <button
              type="button"
              className="lk"
              style={{ marginTop: 8 }}
              onClick={p.onShareRecipe}
              disabled={offline}
            >
              Share a recipe with {p.clientFirst}
            </button>
          </section>

          {p.calories && (
            <section aria-label="Adherence" className="sec-block">
              <span className="st">Calories · last 7 days</span>
              <p style={{ margin: "6px 0 0" }}>{p.calories}</p>
            </section>
          )}
        </div>

        <aside className="side" aria-label="Meal plan">
          {selected ? (
            <PlanPanel
              plan={selected.plan}
              target={p.target}
              clientFirst={p.clientFirst}
              onEdit={() => p.onEditPlan(selected.plan.id)}
              offline={offline}
            />
          ) : (
            <p className="hint">Pick a plan to see its meals.</p>
          )}
        </aside>
      </div>

      {p.menuFor && (
        <Dialog title={p.menuFor.plan.name} onClose={() => p.onMenu(null)}>
          <div style={{ display: "grid", gap: 6 }}>
            <button
              type="button"
              className="row"
              disabled={offline}
              onClick={() => p.onEditPlan(p.menuFor!.plan.id)}
            >
              <span className="tx">
                <span className="n">Edit plan</span>
                <span className="s">
                  Changes reach {p.clientFirst} automatically
                </span>
              </span>
            </button>
            <button
              type="button"
              className="row"
              disabled={offline}
              onClick={() => p.onChangeNote(p.menuFor!.id)}
            >
              <span className="tx">
                <span className="n">Change the note</span>
                <span className="s">
                  What {p.clientFirst} reads with the plan
                </span>
              </span>
            </button>
            <button
              type="button"
              className="row"
              disabled={offline}
              onClick={() => p.onAskRemove(p.menuFor!.id)}
            >
              <span className="tx">
                <span className="n" style={{ color: "#f87171" }}>
                  Remove from {p.clientFirst}
                </span>
              </span>
            </button>
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => p.onMenu(null)}
            >
              Cancel
            </button>
          </div>
        </Dialog>
      )}

      {p.confirmRemove && (
        <Dialog
          title={`Remove ${p.confirmRemove.plan.name}?`}
          onClose={p.onCancelRemove}
        >
          <p className="sub">
            {p.clientFirst} stops seeing it in their plans. Food they have
            already logged stays in their diary. It stays in your library.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn ghost sm"
              onClick={p.onCancelRemove}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn dang sm"
              disabled={p.removing}
              onClick={p.onConfirmRemove}
            >
              {p.removing ? "Removing…" : "Remove"}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

/** C3.2a right side: the opened plan against the client's target. */
export function PlanPanel({
  plan,
  target,
  clientFirst,
  offline,
  onEdit,
}: {
  plan: LibraryPlan;
  target: ClientTarget | null;
  clientFirst: string;
  offline: boolean;
  onEdit: () => void;
}) {
  const view = planVsTarget(plan.totals, target);
  const meals = [...plan.meals].sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <span className="eb">Meal plan</span>
          <h2 className="h2" style={{ fontSize: 20 }}>
            {plan.name}
          </h2>
        </div>
        <button
          type="button"
          className="btn xs ghost"
          onClick={onEdit}
          disabled={offline}
        >
          Edit plan
        </button>
      </div>
      <span className="st">
        {target ? `Against ${clientFirst}’s target` : "Planned"}
      </span>
      <PlanWheel view={view} size={112} />
      <span className="st">Meals · {meals.length}</span>
      <div style={{ display: "grid", gap: 4 }}>
        {meals.map((m) => (
          <div key={m.id} className="row">
            <div className="tx">
              <span className="n">{m.name}</span>
              <span className="s">
                {m.items.map((i) => i.name).join(" · ") || "Nothing yet"}
              </span>
            </div>
            <span className="mono">{kcalText(m.totals.kcal)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
