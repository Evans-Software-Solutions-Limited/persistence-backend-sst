import type { FormEvent } from "react";
import { BackLink, Notice, OfflineBanner, Steps } from "../ui/parts";

/** Add client · 1 Who (C11a). Only the name is needed. */
export interface WhoValues {
  first: string;
  last: string;
  contact: string;
  goal: string;
  notes: string;
}

export interface WhoStepViewProps {
  values: WhoValues;
  errors: Partial<Record<keyof WhoValues, string>>;
  onChange: (values: WhoValues) => void;
  onCancel: () => void;
  onNext: () => void;
  busy: boolean;
  offline: boolean;
  notice: string | null;
  error: string | null;
}

function Field({
  id,
  label,
  value,
  error,
  hint,
  onChange,
  multiline,
  maxLength,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  hint?: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  maxLength: number;
  autoComplete?: string;
}) {
  const describedBy = [error ? `${id}-err` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div>
      <label className="fl" htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          className="fld"
          rows={4}
          value={value}
          maxLength={maxLength}
          aria-invalid={!!error}
          aria-describedby={describedBy || undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          className="fld"
          value={value}
          maxLength={maxLength}
          autoComplete={autoComplete}
          aria-invalid={!!error}
          aria-describedby={describedBy || undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {error && (
        <span className="err" id={`${id}-err`}>
          {error}
        </span>
      )}
      {hint && (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
    </div>
  );
}

export function WhoStepView(p: WhoStepViewProps) {
  const set = (key: keyof WhoValues) => (v: string) =>
    p.onChange({ ...p.values, [key]: v });
  const name = p.values.first.trim();
  return (
    <form
      style={{ display: "contents" }}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        p.onNext();
      }}
    >
      <BackLink to="/coach/clients" label="Clients" />
      <header>
        <h1 className="h1">Add a client</h1>
        <span className="sub">Three short steps. Only the name is needed.</span>
      </header>
      <Steps current={1} />
      {p.offline && <OfflineBanner subject="this client" asOf={null} />}
      {p.notice && <Notice tone="info">{p.notice}</Notice>}
      {p.error && <Notice tone="error">{p.error}</Notice>}
      <div className="divider" style={{ flex: 1 }}>
        <div
          style={{
            maxWidth: 560,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
          >
            <Field
              id="who-first"
              label="First name"
              value={p.values.first}
              error={p.errors.first}
              onChange={set("first")}
              maxLength={40}
              autoComplete="off"
            />
            <Field
              id="who-last"
              label="Last name"
              value={p.values.last}
              error={p.errors.last}
              onChange={set("last")}
              maxLength={40}
              autoComplete="off"
            />
          </div>
          <Field
            id="who-contact"
            label="Email or mobile"
            value={p.values.contact}
            error={p.errors.contact}
            hint="Used to send the invite. You can also share a link or QR in step 3."
            onChange={set("contact")}
            maxLength={320}
            autoComplete="off"
          />
          <Field
            id="who-goal"
            label="Goal, optional"
            value={p.values.goal}
            error={p.errors.goal}
            onChange={set("goal")}
            maxLength={200}
          />
          <Field
            id="who-notes"
            label="Private notes, optional"
            value={p.values.notes}
            error={p.errors.notes}
            hint="Only you see these."
            onChange={set("notes")}
            multiline
            maxLength={4000}
          />
          <span
            style={{ fontSize: 13, lineHeight: "19px", color: "var(--ink-2)" }}
          >
            {name ? `${name}'s profile` : "Their profile"} is made now and shows
            as <b style={{ color: "var(--ink)" }}>Invited</b> on Clients.
            Weight, body and photos come from {name || "them"} once they accept.
          </span>
        </div>
      </div>
      <div className="footer-bar">
        <button type="button" className="btn sm ghost" onClick={p.onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn v sm"
          disabled={p.busy || p.offline}
        >
          {p.busy ? "Saving…" : "Next: set up"}
        </button>
      </div>
    </form>
  );
}
