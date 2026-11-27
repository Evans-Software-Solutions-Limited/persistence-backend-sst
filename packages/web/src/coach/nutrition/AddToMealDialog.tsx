import { rowKey } from "../lib/mealPlans";
import { IconCheck } from "../ui/icons";
import { Dialog, Notice } from "../ui/parts";

export type AddTab = "foods" | "recipes" | "meals";

export interface AddRow {
  id: string;
  name: string;
  sub: string;
  kcal: string;
}

export interface AddToMealDialogProps {
  planName: string;
  mealName: string;
  tab: AddTab;
  query: string;
  rows: AddRow[] | null;
  /** Shown instead of rows (e.g. "Type to search foods"). */
  empty: string;
  selected: Set<string>;
  offline: boolean;
  error: string | null;
  onTab: (tab: AddTab) => void;
  onQuery: (q: string) => void;
  onToggle: (key: string) => void;
  onAdd: () => void;
  onClose: () => void;
}

const TABS: [AddTab, string][] = [
  ["foods", "Foods"],
  ["recipes", "Your recipes"],
  ["meals", "Saved meals"],
];

/** C4 Add to a meal: foods, your recipes and saved meals. */
export function AddToMealDialog(p: AddToMealDialogProps) {
  const n = p.selected.size;
  return (
    <Dialog title={`Add to ${p.mealName}`} onClose={p.onClose}>
      <div style={{ display: "grid", gap: 12 }}>
        <span className="hint">Meal plan · {p.planName}</span>
        <input
          className="fld"
          type="search"
          placeholder="Search foods, your recipes and meals"
          aria-label="Search foods, your recipes and meals"
          value={p.query}
          onChange={(e) => p.onQuery(e.target.value)}
        />
        <div className="seg" role="radiogroup" aria-label="Add from">
          {TABS.map(([key, label]) => (
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
        {p.offline && p.tab === "foods" && (
          <Notice tone="info">
            You’re offline. Food search needs a connection.
          </Notice>
        )}
        {p.error && <Notice tone="error">{p.error}</Notice>}
        <div
          role="group"
          aria-label="Results"
          style={{ display: "grid", gap: 4, maxHeight: 360, overflow: "auto" }}
        >
          {p.rows === null ? (
            <p className="sub">Loading…</p>
          ) : p.rows.length === 0 ? (
            <p className="hint">{p.empty}</p>
          ) : (
            p.rows.map((r) => {
              const key = rowKey(p.tab, r.id);
              const on = p.selected.has(key);
              return (
                <button
                  key={key}
                  type="button"
                  className="row"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => p.onToggle(key)}
                >
                  <span
                    aria-hidden="true"
                    className={`check ${on ? "done" : "todo"}`}
                  >
                    {on && <IconCheck size={14} />}
                  </span>
                  <span className="tx">
                    <span className="n">{r.name}</span>
                    <span className="s">{r.sub}</span>
                  </span>
                  <span className="mono">{r.kcal}</span>
                </button>
              );
            })
          )}
        </div>
        <button
          type="button"
          className="btn v"
          disabled={n === 0}
          onClick={p.onAdd}
        >
          {n > 0
            ? `Add ${n} ${n === 1 ? "item" : "items"} to ${p.mealName}`
            : "Pick something to add"}
        </button>
      </div>
    </Dialog>
  );
}
