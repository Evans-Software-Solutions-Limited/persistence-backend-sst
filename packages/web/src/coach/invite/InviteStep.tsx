import {
  IconCheck,
  IconCopy,
  IconDownload,
  IconEye,
  IconMail,
} from "../ui/icons";
import { BackLink, Notice, OfflineBanner, Steps } from "../ui/parts";
import type { InviteState } from "../lib/setup";

/** Add client · 3 Invite (C11c): a personal code, link and QR for this profile. */
export interface InviteStepViewProps {
  clientFirst: string;
  backTo: { to: string; label: string };
  code: string | null;
  qrDataUrl: string | null;
  state: InviteState;
  daysLeft: number | null;
  email: string | null;
  mailtoHref: string | null;
  ready: string[];
  copied: boolean;
  busy: boolean;
  offline: boolean;
  error: string | null;
  onCopyLink: () => void;
  onIssue: () => void;
  onPreview: () => void;
  onBack: () => void;
  onDone: () => void;
}

export function InviteStepView(p: InviteStepViewProps) {
  const live = p.state === "active" && p.code;
  return (
    <>
      <BackLink to={p.backTo.to} label={p.backTo.label} />
      <header>
        <h1 className="h1">Invite {p.clientFirst}</h1>
        <span className="sub">Almost done.</span>
      </header>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <Steps current={3} />
        <span style={{ flex: 1 }} />
        <button type="button" className="btn sm ghost" onClick={p.onPreview}>
          <IconEye size={16} />
          Preview as {p.clientFirst}
        </button>
      </div>
      {p.offline && <OfflineBanner subject={p.clientFirst} asOf={null} />}
      {p.error && <Notice tone="error">{p.error}</Notice>}
      <div className="divider grid-2" style={{ flex: 1 }}>
        <div>
          <span className="st">Send {p.clientFirst} their invite</span>
          {live ? (
            <>
              <div
                style={{
                  display: "flex",
                  gap: 28,
                  alignItems: "center",
                  marginTop: 14,
                  flexWrap: "wrap",
                }}
              >
                <div
                  className="qr"
                  role="img"
                  aria-label={`QR code for ${p.clientFirst}'s invite`}
                >
                  {p.qrDataUrl && <img src={p.qrDataUrl} alt="" />}
                </div>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <span className="fl" style={{ margin: 0 }}>
                    {p.clientFirst}'s code
                  </span>
                  <span
                    className="code"
                    aria-label={`Code ${p.code!.split("").join(" ")}`}
                  >
                    {p.code}
                  </span>
                  <span
                    style={{
                      fontSize: 12.5,
                      color: "var(--muted)",
                      maxWidth: 260,
                    }}
                  >
                    Just for {p.clientFirst} · links to the profile you made ·
                    expires in{" "}
                    {p.daysLeft === 1 ? "1 day" : `${p.daysLeft ?? 7} days`}
                  </span>
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginTop: 18,
                  flexWrap: "wrap",
                }}
              >
                {p.mailtoHref && (
                  <a className="btn v sm" href={p.mailtoHref}>
                    <IconMail size={16} />
                    Email {p.clientFirst}
                  </a>
                )}
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={p.onCopyLink}
                >
                  {p.copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  {p.copied ? "Copied" : "Copy link"}
                </button>
                {p.qrDataUrl && (
                  <a
                    className="btn sm ghost"
                    href={p.qrDataUrl}
                    download={`persistence-invite-${p.code}.png`}
                  >
                    <IconDownload size={16} />
                    Download QR
                  </a>
                )}
              </div>
              <p className="hint" style={{ marginTop: 10 }}>
                {p.email ? `Email goes to ${p.email}. ` : ""}Your general code
                still works for anyone else.
              </p>
            </>
          ) : (
            <div
              style={{
                marginTop: 14,
                display: "flex",
                flexDirection: "column",
                gap: 12,
                alignItems: "flex-start",
              }}
            >
              <p className="sub" style={{ margin: 0 }}>
                {p.busy
                  ? "Making the code…"
                  : p.state === "expired"
                    ? `${p.clientFirst}'s code has expired. Send a new one.`
                    : `${p.clientFirst} doesn't have a code yet.`}
              </p>
              {!p.busy && (
                <button
                  type="button"
                  className="btn v sm"
                  onClick={p.onIssue}
                  disabled={p.offline}
                >
                  {p.state === "expired" ? "Resend invite" : "Send invite"}
                </button>
              )}
            </div>
          )}
        </div>
        <div>
          <span className="st">When {p.clientFirst} accepts, they get</span>
          <div style={{ marginTop: 8 }}>
            {p.ready.length === 0 ? (
              <p className="sub">
                Nothing set up yet. You can add it before or after they accept.
              </p>
            ) : (
              p.ready.map((line) => (
                <div className="row" key={line}>
                  <span className="check done" aria-hidden="true">
                    <IconCheck size={14} />
                  </span>
                  <span className="tx">
                    <span className="n" style={{ fontSize: 14 }}>
                      {line}
                    </span>
                  </span>
                </div>
              ))
            )}
          </div>
          <p className="hint">
            {p.clientFirst} picks what you can see before anything is shared.
          </p>
        </div>
      </div>
      <div className="footer-bar">
        <button type="button" className="btn sm ghost" onClick={p.onBack}>
          Back
        </button>
        <button type="button" className="btn v sm" onClick={p.onDone}>
          Done
        </button>
      </div>
    </>
  );
}
