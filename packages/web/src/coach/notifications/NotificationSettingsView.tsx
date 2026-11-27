import { Link } from "react-router";
import { BackLink, Notice, OfflineBanner, Toggle } from "../ui/parts";
import type { Channel } from "./types";

/**
 * C6b · Notification settings (web): one dropdown per client event, quiet
 * hours, and a pointer to per-client mute in each client's Settings tab.
 */

export interface ChannelRow {
  kind: string;
  label: string;
  value: Channel;
  options: { value: Channel; label: string }[];
}

export interface NotificationSettingsViewProps {
  rows: ChannelRow[];
  quietEnabled: boolean;
  quietFrom: string;
  quietUntil: string;
  errors: { quietFrom?: string; quietUntil?: string };
  timeZone: string;
  emailAvailable: boolean;
  busy: boolean;
  offlineAsOf: string | null;
  notice: string | null;
  error: string | null;
  onChannel: (kind: string, channel: Channel) => void;
  onQuietEnabled: (on: boolean) => void;
  /** Typing in a time field: updates the form, saves nothing. */
  onQuietTime: (field: "quietFrom" | "quietUntil", value: string) => void;
  /** Entering a time field (the coach is typing in it). */
  onQuietTimeFocus: (field: "quietFrom" | "quietUntil") => void;
  /** Leaving a time field: checks and saves it (Inspector Brad, #578). */
  onQuietTimeDone: () => void;
}

function TimeField({
  id,
  label,
  value,
  error,
  disabled,
  onChange,
  onFocus,
  onBlur,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  disabled: boolean;
  onChange: (v: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  return (
    <div>
      <label className="fl" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="time"
        className="fld nt-time-input mono"
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      {error && (
        <span id={`${id}-err`} className="err">
          {error}
        </span>
      )}
    </div>
  );
}

export function NotificationSettingsView(p: NotificationSettingsViewProps) {
  const offline = p.offlineAsOf !== null;
  const off = offline || p.busy;
  return (
    <>
      <BackLink to="/coach/notifications" label="Notifications" />
      <header>
        <h1 className="h1">Notifications</h1>
        <span className="sub">Choose how each client event reaches you.</span>
      </header>
      {offline && (
        <OfflineBanner subject="your settings" asOf={p.offlineAsOf} />
      )}
      {p.notice && <Notice tone="info">{p.notice}</Notice>}
      {p.error && <Notice tone="error">{p.error}</Notice>}

      <div className="nt-settings">
        <section aria-labelledby="events-h">
          <h2 id="events-h" className="eb" style={{ marginBottom: 8 }}>
            Client events
          </h2>
          {p.rows.map((r) => (
            <div className="nt-setrow" key={r.kind}>
              <label htmlFor={`ch-${r.kind}`} className="nt-setlabel">
                {r.label}
              </label>
              <select
                id={`ch-${r.kind}`}
                className="fld nt-select"
                value={r.value}
                disabled={off}
                onChange={(e) => p.onChannel(r.kind, e.target.value as Channel)}
              >
                {r.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </section>

        <div>
          <section aria-labelledby="quiet-h">
            <h2 id="quiet-h" className="eb" style={{ marginBottom: 8 }}>
              Quiet hours
            </h2>
            <p className="sub" style={{ margin: "0 0 8px" }}>
              Notifications wait until quiet hours end.
              {p.emailAvailable ? " Emails still arrive." : ""}
            </p>
            <div className="nt-setrow">
              <span className="nt-setlabel" id="quiet-use">
                Use quiet hours
              </span>
              <Toggle
                checked={p.quietEnabled}
                label="Use quiet hours"
                disabled={off}
                onChange={p.onQuietEnabled}
              />
            </div>
            {p.quietEnabled && (
              <div className="nt-times">
                <TimeField
                  id="quiet-from"
                  label="From"
                  value={p.quietFrom}
                  error={p.errors.quietFrom}
                  disabled={offline}
                  onChange={(v) => p.onQuietTime("quietFrom", v)}
                  onFocus={() => p.onQuietTimeFocus("quietFrom")}
                  onBlur={p.onQuietTimeDone}
                />
                <TimeField
                  id="quiet-until"
                  label="Until"
                  value={p.quietUntil}
                  error={p.errors.quietUntil}
                  disabled={offline}
                  onChange={(v) => p.onQuietTime("quietUntil", v)}
                  onFocus={() => p.onQuietTimeFocus("quietUntil")}
                  onBlur={p.onQuietTimeDone}
                />
              </div>
            )}
            <span className="hint">In your time zone ({p.timeZone}).</span>
          </section>

          <section aria-labelledby="per-client-h" className="divider">
            <h2 id="per-client-h" className="eb" style={{ marginBottom: 8 }}>
              Per client
            </h2>
            <p className="sub" style={{ margin: 0 }}>
              Mute a client, or get everything for one, from their Settings tab.{" "}
              <Link to="/coach/clients" className="lk">
                Clients
              </Link>
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
