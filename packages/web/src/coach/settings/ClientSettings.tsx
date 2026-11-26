import { CLIENT_SETTINGS_LIMITS } from "@persistence/form-limits";
import type { AlertMode, ClientSettings, FeatureKey } from "../api/types";
import { Dialog, Notice, OfflineBanner, Toggle } from "../ui/parts";

/**
 * C3.9 · Client settings (web). Features for the client, alerts and ending
 * coaching, per the board; plus what the coach tracks for adherence (tracked
 * areas and a sessions-per-week target, design B), added at Brad's request.
 * The board's "shares with you" and "Coaching" details have no API yet.
 */

const FEATURE_ROWS: { key: FeatureKey; title: string; sub: string }[] = [
  { key: "messages", title: "Messages", sub: "Chat with you" },
  { key: "checkIns", title: "Check-ins", sub: "Weekly and daily forms" },
  { key: "photos", title: "Progress photos", sub: "Front, side and back" },
  { key: "habits", title: "Habits", sub: "Steps, water, sleep, custom" },
  { key: "nutrition", title: "Nutrition", sub: "Meal plans and food logging" },
  { key: "resources", title: "Resources", sub: "Files and videos you share" },
];

const ALERTS: { mode: AlertMode; label: string }[] = [
  { mode: "default", label: "Use my defaults" },
  { mode: "mute", label: "Mute all" },
  { mode: "everything", label: "Boost: every event" },
];

const SESSIONS_MIN = CLIENT_SETTINGS_LIMITS.sessionsPerWeekMin;
const SESSIONS_MAX = CLIENT_SETTINGS_LIMITS.sessionsPerWeekMax;

export interface ClientSettingsViewProps {
  clientFirst: string;
  settings: ClientSettings;
  busy: boolean;
  offlineAsOf: string | null;
  notice: string | null;
  error: string | null;
  confirmEnd: boolean;
  ending: boolean;
  onTrackTraining: (on: boolean) => void;
  onTrackCalories: (on: boolean) => void;
  onSessions: (n: number) => void;
  onFeature: (key: FeatureKey, on: boolean) => void;
  onAlert: (mode: AlertMode) => void;
  onAskEnd: () => void;
  onConfirmEnd: () => void;
  onKeep: () => void;
}

function Eyebrow({ children }: { children: string }) {
  return (
    <h2 className="eb" style={{ marginBottom: 8 }}>
      {children}
    </h2>
  );
}

function SwitchRow({
  title,
  sub,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  sub?: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "10px 0",
        borderBottom: "1px solid var(--line-3)",
      }}
    >
      <span style={{ flex: 1 }}>
        <b style={{ display: "block", fontSize: 14, fontWeight: 600 }}>
          {title}
        </b>
        {sub && (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{sub}</span>
        )}
      </span>
      <Toggle
        checked={checked}
        label={title}
        onChange={onChange}
        disabled={disabled}
      />
    </div>
  );
}

export function ClientSettingsView(p: ClientSettingsViewProps) {
  const offline = p.offlineAsOf !== null;
  const off = offline || p.busy;
  const s = p.settings;
  const sessions = s.sessionsPerWeek ?? 3;
  return (
    <>
      {offline && (
        <OfflineBanner subject={p.clientFirst} asOf={p.offlineAsOf} />
      )}
      {p.notice && <Notice tone="info">{p.notice}</Notice>}
      {p.error && <Notice tone="error">{p.error}</Notice>}
      <div className="grid-3">
        <section aria-label={`Features for ${p.clientFirst}`}>
          <Eyebrow>{`Features for ${p.clientFirst}`}</Eyebrow>
          {FEATURE_ROWS.map((f) => (
            <SwitchRow
              key={f.key}
              title={f.title}
              sub={f.sub}
              checked={s.features[f.key] !== false}
              disabled={off}
              onChange={(v) => p.onFeature(f.key, v)}
            />
          ))}
          <span
            style={{
              fontSize: 11.5,
              lineHeight: "16px",
              color: "var(--muted)",
            }}
          >
            Off hides it from {p.clientFirst}'s app. What their membership
            includes still applies.
          </span>
        </section>

        <div>
          <section aria-label={`Tracked for ${p.clientFirst}`}>
            <Eyebrow>{`Tracked for ${p.clientFirst}`}</Eyebrow>
            <SwitchRow
              title="Training"
              sub="Sessions done vs your weekly target"
              checked={s.trackTraining}
              disabled={off}
              onChange={p.onTrackTraining}
            />
            {s.trackTraining && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 0",
                  borderBottom: "1px solid var(--line-3)",
                }}
              >
                <span
                  style={{ flex: 1, fontSize: 14, fontWeight: 500 }}
                  id="sessions-label"
                >
                  Sessions a week
                </span>
                <button
                  type="button"
                  className="day"
                  aria-label="Fewer sessions"
                  disabled={off || sessions <= SESSIONS_MIN}
                  onClick={() => p.onSessions(sessions - 1)}
                >
                  −
                </button>
                <output
                  className="mono"
                  aria-labelledby="sessions-label"
                  style={{
                    minWidth: 24,
                    textAlign: "center",
                    fontSize: 18,
                    fontWeight: 700,
                  }}
                >
                  {sessions}
                </output>
                <button
                  type="button"
                  className="day"
                  aria-label="More sessions"
                  disabled={off || sessions >= SESSIONS_MAX}
                  onClick={() => p.onSessions(sessions + 1)}
                >
                  +
                </button>
              </div>
            )}
            <SwitchRow
              title="Calories"
              sub="Days within 10% of the target"
              checked={s.trackCalories}
              disabled={off}
              onChange={p.onTrackCalories}
            />
            <span
              style={{
                fontSize: 11.5,
                lineHeight: "16px",
                color: "var(--muted)",
              }}
            >
              Adherence shows one line for each area you track.
            </span>
          </section>

          <section
            aria-label={`Alerts for ${p.clientFirst}`}
            style={{ marginTop: 16 }}
          >
            <Eyebrow>{`Alerts for ${p.clientFirst}`}</Eyebrow>
            <div role="radiogroup" aria-label={`Alerts for ${p.clientFirst}`}>
              {ALERTS.map((a) => (
                <div
                  key={a.mode}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "9px 0",
                  }}
                >
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>
                    {a.label}
                  </span>
                  <button
                    type="button"
                    className="tg"
                    role="radio"
                    aria-checked={s.alertMode === a.mode}
                    aria-label={a.label}
                    disabled={off}
                    onClick={() => s.alertMode !== a.mode && p.onAlert(a.mode)}
                  >
                    <span />
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section aria-label="End coaching">
          <Eyebrow>End coaching</Eyebrow>
          <p
            style={{
              margin: "0 0 12px",
              fontSize: 13,
              lineHeight: "19px",
              color: "var(--ink-2)",
            }}
          >
            {p.clientFirst} keeps their history. You lose access to their data
            straight away; your notes stay private to you.
          </p>
          <button
            type="button"
            className="btn sm dang"
            onClick={p.onAskEnd}
            disabled={offline}
          >
            End coaching with {p.clientFirst}
          </button>
        </section>
      </div>
      {p.confirmEnd && (
        <Dialog
          title={`End coaching with ${p.clientFirst}?`}
          onClose={p.onKeep}
        >
          <p className="sub" style={{ margin: 0 }}>
            {p.clientFirst} keeps their history. You lose access to their data
            straight away; your notes stay private to you.
          </p>
          <div className="footer-bar">
            <button type="button" className="btn sm ghost" onClick={p.onKeep}>
              Keep coaching
            </button>
            <button
              type="button"
              className="btn sm dang"
              onClick={p.onConfirmEnd}
              disabled={p.ending}
            >
              {p.ending ? "Ending…" : "End coaching"}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
