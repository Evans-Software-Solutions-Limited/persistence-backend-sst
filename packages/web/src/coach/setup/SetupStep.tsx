import type { ReactNode } from "react";
import type { SetupSection } from "../api/types";
import { IconCheck, IconChevron, IconCopy, IconEye } from "../ui/icons";
import { BackLink, Notice, OfflineBanner, Steps, Toast } from "../ui/parts";

/**
 * Add client · 2 Set up (C11b): checklist on the left, the chosen section on
 * the right. Moving on saves; Cancel drops this section's changes.
 */
export interface ChecklistRow {
  section: SetupSection;
  title: string;
  summary: string;
  done: boolean;
}

export interface SetupStepViewProps {
  clientFirst: string;
  backTo: { to: string; label: string };
  /** Opened from the invited client page: no steps row, Back returns there. */
  editing: boolean;
  rows: ChecklistRow[];
  current: SetupSection;
  count: { done: number; total: number };
  offlineAsOf: string | null;
  notice: string | null;
  error: string | null;
  toast: string | null;
  saving: boolean;
  dirty: boolean;
  onSelect: (section: SetupSection) => void;
  onCopyFrom: () => void;
  onPreview: () => void;
  onCancel: () => void;
  onBack: () => void;
  onSkip: () => void;
  onNext: () => void;
  children: ReactNode;
}

export function SetupStepView(p: SetupStepViewProps) {
  const offline = p.offlineAsOf !== null;
  const blocked = p.saving || (offline && p.dirty);
  return (
    <>
      <BackLink to={p.backTo.to} label={p.backTo.label} />
      <header>
        <h1 className="h1">Set up {p.clientFirst}</h1>
        <span className="sub">
          Nothing reaches {p.clientFirst} until they accept.
        </span>
      </header>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        {!p.editing && <Steps current={2} />}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="btn sm ghost"
          onClick={p.onPreview}
          disabled={blocked}
        >
          <IconEye size={16} />
          Preview as {p.clientFirst}
        </button>
      </div>
      {offline && (
        <OfflineBanner subject={p.clientFirst} asOf={p.offlineAsOf} />
      )}
      {p.notice && <Notice tone="info">{p.notice}</Notice>}
      {p.error && <Notice tone="error">{p.error}</Notice>}
      <div className="divider setup" style={{ flex: 1 }}>
        <nav aria-label="Set up checklist">
          <div
            style={{ display: "flex", alignItems: "baseline", marginBottom: 6 }}
          >
            <span className="st" style={{ flex: 1 }}>
              Checklist
            </span>
            <span
              className="mono"
              style={{ fontSize: 12.5, color: "var(--muted)" }}
            >
              {p.count.done} of {p.count.total}
            </span>
          </div>
          {p.rows.map((r) => (
            <button
              key={r.section}
              type="button"
              className="row"
              aria-current={r.section === p.current}
              disabled={blocked && r.section !== p.current}
              onClick={() => r.section !== p.current && p.onSelect(r.section)}
            >
              {r.done ? (
                <span className="check done" aria-label="Added">
                  <IconCheck size={14} />
                </span>
              ) : (
                <span className="check todo" aria-label="Not added" />
              )}
              <span className="tx">
                <span className="n" style={{ fontSize: 14 }}>
                  {r.title}
                </span>
                <span className="s">{r.summary}</span>
              </span>
              <IconChevron size={16} />
            </button>
          ))}
          <button
            type="button"
            className="lk"
            style={{ marginTop: 6 }}
            onClick={p.onCopyFrom}
            disabled={offline || p.saving}
          >
            <IconCopy size={16} />
            Copy setup from a client
          </button>
        </nav>
        <div className="pane">
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              marginBottom: 4,
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 12.5, color: "var(--muted)", flex: 1 }}>
              Changes save when you move on. Cancel drops them.
            </span>
            <button
              type="button"
              className="btn sm ghost"
              style={{ height: 40 }}
              disabled={!p.dirty || p.saving}
              onClick={p.onCancel}
            >
              Cancel
            </button>
          </div>
          <div className="pane-body">{p.children}</div>
        </div>
      </div>
      <div className="footer-bar">
        <button
          type="button"
          className="btn sm ghost"
          onClick={p.onBack}
          disabled={blocked}
        >
          Back
        </button>
        {!p.editing && (
          <>
            <button
              type="button"
              className="btn sm ghost"
              onClick={p.onSkip}
              disabled={blocked}
            >
              Skip, set up later
            </button>
            <button
              type="button"
              className="btn v sm"
              onClick={p.onNext}
              disabled={blocked}
            >
              {p.saving ? "Saving…" : "Next: invite"}
            </button>
          </>
        )}
      </div>
      {p.toast && <Toast text={p.toast} />}
    </>
  );
}
