import { useEffect, useRef } from "react";
import type { ClientFormEntry } from "../api/types";
import { RuleFields } from "../forms/RuleFields";
import { clientTriggers, statusPill } from "../lib/forms";
import type { EffectiveRule } from "../lib/schedule";
import { IconX } from "../ui/icons";
import { Notice } from "../ui/parts";

/**
 * C10j on the web: the same fields in a side panel. This client only: when,
 * day, time, due, reminders; Pause (or Resume), Stop, Save.
 */
export function ClientFormPanel({
  clientFirst,
  entry,
  rule,
  confirmStop,
  busy,
  error,
  onRule,
  onClose,
  onSave,
  onPause,
  onResume,
  onAskStop,
  onKeep,
  onStop,
}: {
  clientFirst: string;
  entry: ClientFormEntry;
  rule: EffectiveRule;
  confirmStop: boolean;
  busy: boolean;
  error: string | null;
  onRule: (rule: EffectiveRule) => void;
  onClose: () => void;
  onSave: () => void;
  onPause: () => void;
  onResume: () => void;
  onAskStop: () => void;
  onKeep: () => void;
  onStop: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const pill = statusPill(entry.state, entry.lastDoneAt);
  const paused = entry.state === "paused";
  return (
    <aside
      ref={ref}
      className="side"
      role="dialog"
      aria-modal="false"
      aria-label={`${entry.form.title}, for ${clientFirst} only`}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <span className="eb">For {clientFirst} only</span>
          <h2 className="h2" style={{ fontSize: 22, lineHeight: "28px" }}>
            {entry.form.title}
          </h2>
          <span className="sub">{pill.text}</span>
        </div>
        <button
          type="button"
          className="ibtn"
          aria-label="Close"
          onClick={onClose}
        >
          <IconX size={16} />
        </button>
      </div>
      {entry.rule ? (
        <RuleFields
          rule={rule}
          onRule={onRule}
          triggers={clientTriggers(entry.rule)}
          disabled={busy}
        />
      ) : (
        <p className="sub">
          This form has no live send rule, so there's nothing to set up.
        </p>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {confirmStop ? (
        <div className="banner error" role="alert" style={{ flexWrap: "wrap" }}>
          <span style={{ flex: 1 }}>
            Stop sending {entry.form.title} to {clientFirst}? Anything still
            open is cancelled.
          </span>
          <button
            type="button"
            className="btn xs ghost"
            disabled={busy}
            onClick={onKeep}
          >
            Keep it
          </button>
          <button
            type="button"
            className="btn xs dang"
            disabled={busy}
            onClick={onStop}
          >
            Stop
          </button>
        </div>
      ) : (
        entry.rule && (
          <div className="footer-bar" style={{ justifyContent: "flex-start" }}>
            {paused ? (
              <button
                type="button"
                className="btn sm ghost"
                disabled={busy}
                onClick={onResume}
              >
                Resume
              </button>
            ) : (
              <button
                type="button"
                className="btn sm ghost"
                disabled={busy}
                onClick={onPause}
              >
                Pause
              </button>
            )}
            <button
              type="button"
              className="btn sm ghost"
              style={{ color: "#fca5a5" }}
              disabled={busy}
              onClick={onAskStop}
            >
              Stop
            </button>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className="btn v sm"
              disabled={busy}
              onClick={onSave}
            >
              Save
            </button>
          </div>
        )
      )}
    </aside>
  );
}
