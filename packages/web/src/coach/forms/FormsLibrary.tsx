import { Link } from "react-router";
import type {
  CoachForm,
  FormStats,
  FormStatsClient,
  RosterClient,
} from "../api/types";
import {
  GROUP_TITLES,
  doneLabel,
  dueWords,
  questionCount,
  reminderWords,
  rowLine,
  ruleOf,
  sendSentence,
  sentLabel,
  whoLabel,
  type LibraryGroup,
  type LibraryRow,
} from "../lib/forms";
import { dayTime } from "../lib/forms";
import type { EffectiveRule } from "../lib/schedule";
import { initials as initialsOf } from "../lib/people";
import {
  IconCheck,
  IconChevron,
  IconClock,
  IconEye,
  IconForm,
  IconPlus,
  IconSend,
  IconX,
} from "../ui/icons";
import { Avatar, Dialog, Notice, OfflineBanner } from "../ui/parts";
import { RuleFields } from "./RuleFields";

/** Library sections built on the web, by tab label (C10a). */
const LIVE_LIBRARY_TABS: Record<string, string> = {
  "Meal plans": "/coach/library/meal-plans", // PER-135 (C1)
};

/** The Library sub-nav (C10a). Tabs not on the web yet are shown but inert. */
export function LibraryTabs({ current = "Forms" }: { current?: string }) {
  const later = ["Workouts", "Programmes", "Meal plans", "Resources"];
  return (
    <div className="tabs" role="tablist" aria-label="Library">
      {later.map((t) =>
        LIVE_LIBRARY_TABS[t] ? (
          <Link
            key={t}
            role="tab"
            aria-selected={current === t}
            to={LIVE_LIBRARY_TABS[t]}
          >
            {t}
          </Link>
        ) : (
          <span
            key={t}
            role="tab"
            aria-selected={false}
            aria-disabled="true"
            aria-label={`${t}, not on the web yet`}
            title="Not on the web yet"
          >
            {t}
          </span>
        ),
      )}
      <Link
        role="tab"
        aria-selected={current === "Forms"}
        to="/coach/library/forms"
      >
        Forms
      </Link>
    </div>
  );
}

const ORDER: LibraryGroup[] = [
  "on_join",
  "repeating",
  "once",
  "on_end",
  "none",
];

export interface FormsLibraryProps {
  groups: Record<LibraryGroup, LibraryRow[]>;
  stats: Map<string, FormStats["forms"][number]>;
  totals: FormStats["totals"] | null;
  selected: LibraryRow | null;
  templates: CoachForm[] | null;
  showTemplates: boolean;
  showAllOutstanding: boolean;
  offlineAsOf: string | null;
  notice: string | null;
  error: string | null;
  onSelect: (formId: string) => void;
  onNew: (when?: string) => void;
  onEdit: (formId: string) => void;
  onSend: (formId: string) => void;
  onChange: (formId: string) => void;
  onPreview: (formId: string) => void;
  onToggleTemplates: () => void;
  onUseTemplate: (templateKey: string) => void;
  onToggleOutstanding: () => void;
}

function pct(rate: number | null): string {
  return rate === null ? "—" : String(Math.round(rate * 100));
}

export function FormsLibrary(p: FormsLibraryProps) {
  const add = (group: LibraryGroup) =>
    group === "on_join"
      ? "on_join"
      : group === "repeating"
        ? "weekly"
        : group === "once"
          ? "once"
          : group === "on_end"
            ? "on_end"
            : undefined;
  return (
    <>
      <LibraryTabs />
      <header style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 className="h1">Forms</h1>
          <span className="sub">
            Send forms when a client joins, once, on repeat, or when coaching
            ends.
          </span>
        </div>
        <button type="button" className="btn v sm" onClick={() => p.onNew()}>
          <IconPlus size={16} />
          New form
        </button>
      </header>
      {p.offlineAsOf !== null && (
        <OfflineBanner subject="your forms" asOf={p.offlineAsOf} />
      )}
      {p.notice && <Notice tone="info">{p.notice}</Notice>}
      {p.error && <Notice tone="error">{p.error}</Notice>}
      <div className="forms-grid">
        <div style={{ minWidth: 0 }}>
          <div className="strip" aria-label="Your forms at a glance">
            <div>
              <b className="mono">{p.totals?.forms ?? "—"}</b>
              <span>Forms</span>
            </div>
            <div>
              <b className="mono">{p.totals?.repeating ?? "—"}</b>
              <span>Repeating</span>
            </div>
            <div>
              <b className="mono">{p.totals?.outstanding ?? "—"}</b>
              <span>Outstanding</span>
            </div>
            <div>
              <b className="mono">
                {pct(p.totals?.onTimeRate ?? null)}
                {p.totals?.onTimeRate !== null &&
                  p.totals?.onTimeRate !== undefined && <i>%</i>}
              </b>
              <span>On time · 4 wks</span>
            </div>
          </div>
          {ORDER.map((group) => {
            const rows = p.groups[group];
            if (group === "none" && rows.length === 0) return null;
            const when = add(group);
            return (
              <section key={group} aria-label={GROUP_TITLES[group]}>
                <div className="grp">
                  <span className="st">{GROUP_TITLES[group]}</span>
                  {group === "on_join" && (
                    <span className="hint">
                      Sent to every new client when they join, in this order.
                    </span>
                  )}
                  {group === "on_join" ? (
                    <button
                      type="button"
                      className="lk"
                      style={{ minHeight: 0 }}
                      onClick={p.onToggleTemplates}
                    >
                      + Add from templates
                    </button>
                  ) : when ? (
                    <button
                      type="button"
                      className="lk"
                      style={{ minHeight: 0 }}
                      aria-label={`Add a form: ${GROUP_TITLES[group]}`}
                      onClick={() => p.onNew(when)}
                    >
                      + Add
                    </button>
                  ) : null}
                </div>
                {rows.length === 0 && (
                  <p className="hint" style={{ margin: "8px 0 0" }}>
                    None yet.
                  </p>
                )}
                {rows.map((row) => {
                  const stat = p.stats.get(row.form.id);
                  const lastSent = stat?.clients[0]?.sentAt ?? null;
                  const on = p.selected?.form.id === row.form.id;
                  const label = doneLabel(row, stat);
                  return (
                    <button
                      key={row.form.id}
                      type="button"
                      className="row"
                      aria-current={on ? "true" : undefined}
                      onClick={() => p.onSelect(row.form.id)}
                      style={
                        on
                          ? {
                              background: "rgba(167,139,250,.08)",
                              borderRadius: 12,
                              paddingLeft: 10,
                              paddingRight: 10,
                              borderBottomColor: "transparent",
                            }
                          : undefined
                      }
                    >
                      <IconForm size={20} />
                      <span className="tx">
                        <span className="n">{row.form.title}</span>
                        <span className="s">{rowLine(row, lastSent)}</span>
                      </span>
                      <span
                        className="mono"
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: label === "—" ? "var(--faint)" : "var(--ink)",
                          flex: "none",
                        }}
                      >
                        {label}
                      </span>
                      <IconChevron size={16} />
                    </button>
                  );
                })}
              </section>
            );
          })}
          <button
            type="button"
            className="more"
            aria-expanded={p.showTemplates}
            onClick={p.onToggleTemplates}
          >
            {p.templates && p.templates.length > 0
              ? `Templates · start from one of ${p.templates.length}`
              : "Templates"}
          </button>
          {p.showTemplates && (
            <div aria-label="Templates" role="region">
              {p.templates === null ? (
                <p className="hint">Loading templates…</p>
              ) : p.templates.length === 0 ? (
                <p className="hint">
                  No templates yet. When templates are added, you can start a
                  form from one here.
                </p>
              ) : (
                p.templates.map((t) => (
                  <div key={t.id} className="row">
                    <IconForm size={20} />
                    <span className="tx">
                      <span className="n">{t.title}</span>
                      <span className="s">{questionCount(t)} questions</span>
                    </span>
                    <button
                      type="button"
                      className="btn xs ghost"
                      onClick={() =>
                        t.templateKey && p.onUseTemplate(t.templateKey)
                      }
                    >
                      Use
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        {p.selected ? (
          <SelectedForm
            row={p.selected}
            stat={p.stats.get(p.selected.form.id)}
            showAll={p.showAllOutstanding}
            onEdit={() => p.onEdit(p.selected!.form.id)}
            onSend={() => p.onSend(p.selected!.form.id)}
            onChange={() => p.onChange(p.selected!.form.id)}
            onPreview={() => p.onPreview(p.selected!.form.id)}
            onToggleAll={p.onToggleOutstanding}
          />
        ) : (
          <div className="sub">
            No forms yet. Make one with New form, then send it to your clients.
          </div>
        )}
      </div>
    </>
  );
}

function headline(
  row: LibraryRow,
  stat: FormStats["forms"][number] | undefined,
) {
  const s = row.schedules[0];
  if (!stat || stat.reached === 0) return null;
  const period =
    s?.trigger === "weekly"
      ? "done this week"
      : s?.trigger === "daily"
        ? "done today"
        : "done";
  const due = s ? dueWords(ruleOf(s)) : null;
  const tail =
    stat.outstanding > 0
      ? ` · ${stat.outstanding} outstanding${due && s && (s.trigger === "weekly" || s.trigger === "daily") ? `, due ${due}` : ""}`
      : "";
  return { done: stat.done, of: stat.reached, line: `${period}${tail}` };
}

function clientLine(c: FormStatsClient): string {
  if (c.status === "done")
    return c.completedAt ? dayTime(c.completedAt) : "Done";
  if (c.lastReminderAt) return `Reminder sent ${dayTime(c.lastReminderAt)}`;
  return `Sent ${dayTime(c.sentAt)}`;
}

function SelectedForm({
  row,
  stat,
  showAll,
  onEdit,
  onSend,
  onChange,
  onPreview,
  onToggleAll,
}: {
  row: LibraryRow;
  stat: FormStats["forms"][number] | undefined;
  showAll: boolean;
  onEdit: () => void;
  onSend: () => void;
  onChange: () => void;
  onPreview: () => void;
  onToggleAll: () => void;
}) {
  const s = row.schedules[0];
  const rule = s ? ruleOf(s) : null;
  const head = headline(row, stat);
  const outstanding = stat?.clients.filter((c) => c.status !== "done") ?? [];
  const list = showAll
    ? (stat?.clients ?? [])
    : (stat?.clients ?? []).slice(0, 4);
  return (
    <section
      aria-label={row.form.title}
      style={{ minWidth: 0, display: "flex", flexDirection: "column" }}
    >
      <span style={{ font: "600 13px var(--font)", color: "var(--violet)" }}>
        {row.form.title}
      </span>
      {head ? (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              marginTop: 10,
            }}
          >
            <b
              className="mono"
              style={{ font: "700 76px/1 var(--mono)", letterSpacing: -3 }}
            >
              {head.done}
            </b>
            <span
              className="mono"
              style={{ font: "500 22px var(--mono)", color: "var(--muted)" }}
            >
              of {head.of}
            </span>
          </div>
          <span
            style={{
              font: "400 13.5px var(--font)",
              color: "var(--ink-2)",
              marginTop: 6,
            }}
          >
            {head.line}
          </span>
        </>
      ) : (
        <span className="sub" style={{ marginTop: 10 }}>
          {s ? "Not sent to anyone yet." : "Not sent yet."}{" "}
          {questionCount(row.form)} questions.
        </span>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        <button type="button" className="btn v sm" onClick={onSend}>
          <IconSend size={16} />
          Send to clients
        </button>
        <button type="button" className="btn sm ghost" onClick={onEdit}>
          Edit questions
        </button>
        <button
          type="button"
          className="btn sm ghost"
          style={{ width: 44, padding: 0 }}
          aria-label="Preview as a client"
          onClick={onPreview}
        >
          <IconEye size={16} />
        </button>
      </div>
      {s && rule && (
        <>
          <div className="grp" style={{ marginTop: 22 }}>
            <span className="st">Schedule</span>
            <button
              type="button"
              className="lk"
              style={{ minHeight: 0 }}
              onClick={onChange}
            >
              Change
            </button>
          </div>
          <div className="kv">
            <span>Sent</span>
            <b>{sentLabel(s)}</b>
          </div>
          <div className="kv">
            <span>Due</span>
            <b>{dueWords(rule) ?? "No due date"}</b>
          </div>
          <div className="kv">
            <span>Reminders</span>
            <b>
              {rule.reminders.length
                ? rule.reminders
                    .map((r) => reminderWords(rule, r.afterHours))
                    .join(" · ")
                : "None"}
            </b>
          </div>
          <div className="kv">
            <span>Who</span>
            <b>{whoLabel(s)}</b>
          </div>
          {s.status === "paused" && (
            <div className="kv">
              <span>Status</span>
              <b>Paused</b>
            </div>
          )}
        </>
      )}
      {stat && stat.clients.length > 0 && (
        <>
          <div className="grp" style={{ marginTop: 22 }}>
            <span className="st">Outstanding</span>
            {stat.clients.length > 4 && (
              <button
                type="button"
                className="lk"
                style={{ minHeight: 0 }}
                onClick={onToggleAll}
              >
                {showAll ? "Show fewer" : `See all ${stat.clients.length}`}
              </button>
            )}
          </div>
          {outstanding.length === 0 && (
            <p className="hint">Everyone has done it.</p>
          )}
          {list.map((c) => {
            const name = c.name ?? "Client";
            return (
              <div
                key={c.requestId}
                className="row"
                style={{ padding: "9px 0" }}
              >
                <Avatar
                  initials={initialsOf(name)}
                  seed={c.clientId}
                  size={32}
                />
                <span className="tx">
                  <span className="n" style={{ fontSize: 14 }}>
                    {name}
                  </span>
                  <span className="s">{clientLine(c)}</span>
                </span>
                <span
                  className={`pl ${c.status === "done" ? "ok" : "warn"}`}
                  style={{ flex: "none" }}
                >
                  {c.status === "done" ? (
                    <IconCheck size={14} />
                  ) : (
                    <IconClock size={14} />
                  )}
                  {c.status === "done"
                    ? c.late
                      ? "Done late"
                      : "Done"
                    : c.status === "missed"
                      ? "Missed"
                      : "Not done"}
                </span>
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}

// ─── C10c send dialog ────────────────────────────────────────────────────────

export interface SendDialogProps {
  form: CoachForm;
  /** Editing an existing rule (Change) rather than sending a new one. */
  editing: boolean;
  rule: EffectiveRule;
  all: boolean;
  selected: RosterClient[];
  candidates: RosterClient[];
  busy: boolean;
  error: string | null;
  onRule: (rule: EffectiveRule) => void;
  onAll: (all: boolean) => void;
  onAdd: (clientId: string) => void;
  onRemove: (clientId: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export function SendDialog(p: SendDialogProps) {
  const joinOnly = p.rule.trigger === "on_join";
  const count = p.selected.length;
  const sendable = p.all || joinOnly || count > 0;
  return (
    <Dialog
      title={`${p.editing ? "Change" : "Send"} ${p.form.title}`}
      onClose={p.onCancel}
    >
      <span className="sub" style={{ marginTop: -8 }}>
        {questionCount(p.form)} questions
      </span>
      <button
        type="button"
        className="ibtn"
        aria-label="Close"
        onClick={p.onCancel}
        style={{ position: "absolute", top: 16, right: 16 }}
      >
        <IconX size={16} />
      </button>
      <div>
        <span className="fl">Who</span>
        <div className="seg" role="group" aria-label="Who">
          <button
            type="button"
            aria-pressed={!p.all && !joinOnly}
            disabled={joinOnly || p.busy}
            onClick={() => p.onAll(false)}
          >
            Select clients
          </button>
          <button
            type="button"
            aria-pressed={p.all || joinOnly}
            disabled={p.busy}
            onClick={() => p.onAll(true)}
          >
            All clients
          </button>
        </div>
        {joinOnly && (
          <span className="hint">
            Forms for when they join go to every new client.
          </span>
        )}
      </div>
      {!p.all && !joinOnly && (
        <div>
          <select
            className="fld"
            aria-label="Add clients"
            value=""
            disabled={p.busy || p.candidates.length === 0}
            onChange={(e) => e.target.value && p.onAdd(e.target.value)}
          >
            <option value="">
              {p.candidates.length === 0 ? "Everyone is added" : "Add clients"}
            </option>
            {p.candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <div
            style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}
          >
            {p.selected.map((c) => (
              <button
                key={c.id}
                type="button"
                className="chip on"
                aria-label={`Remove ${c.name}`}
                disabled={p.busy}
                onClick={() => p.onRemove(c.id)}
              >
                <Avatar
                  initials={c.initials || initialsOf(c.name)}
                  seed={c.id}
                  size={22}
                />
                {c.name}
                <IconX size={14} />
              </button>
            ))}
          </div>
        </div>
      )}
      <RuleFields
        rule={p.rule}
        onRule={p.onRule}
        triggers={
          p.editing
            ? [p.rule.trigger]
            : ["on_join", "once", "weekly", "daily", "on_end"]
        }
        disabled={p.busy}
      />
      <p className="sub" style={{ margin: 0 }}>
        {sendSentence(p.rule, { all: p.all || joinOnly, count })}
      </p>
      {p.error && <Notice tone="error">{p.error}</Notice>}
      <div className="footer-bar">
        <button
          type="button"
          className="btn sm ghost"
          onClick={p.onCancel}
          disabled={p.busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn v sm"
          disabled={p.busy || !sendable}
          onClick={p.onSubmit}
        >
          {p.editing
            ? "Save changes"
            : p.all || joinOnly
              ? "Send to all clients"
              : `Send to ${count} ${count === 1 ? "client" : "clients"}`}
        </button>
      </div>
    </Dialog>
  );
}

// ─── Preview (C10a eye, C10b Preview) ────────────────────────────────────────

export function FormPreview({
  form,
  onClose,
}: {
  form: Pick<CoachForm, "title" | "version">;
  onClose: () => void;
}) {
  const qs = form.version?.questions ?? [];
  return (
    <Dialog title={`Preview · ${form.title}`} onClose={onClose}>
      <span className="sub" style={{ marginTop: -8 }}>
        What your client sees. Nothing here is sent.
      </span>
      <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 12 }}>
        {qs.map((q) => (
          <li key={q.id}>
            <span className="st">
              {q.prompt}
              {q.required ? " *" : ""}
            </span>
            {q.help && <span className="hint">{q.help}</span>}
            {q.options && <span className="hint">{q.options.join(" · ")}</span>}
          </li>
        ))}
      </ol>
      <div className="footer-bar">
        <button type="button" className="btn sm ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
