import type { SetupSection } from "../api/types";
import { ClientTabs } from "../clients/ClientTabs";
import { InviteStatePill } from "../clients/ClientsList";
import type { InviteState } from "../lib/setup";
import { IconCheck, IconChevron, IconCopy, IconSend } from "../ui/icons";
import {
  Avatar,
  BackLink,
  Dialog,
  Notice,
  OfflineBanner,
  Toast,
} from "../ui/parts";

/**
 * Invited client (C11d): their client page with only Overview open. Overview
 * lists what's ready (each row opens its section) and the private notes;
 * Resend, Copy link and Cancel invite.
 */
export interface ReadyRow {
  section: SetupSection;
  title: string;
  summary: string;
  empty: boolean;
}

export interface InvitedClientViewProps {
  name: string;
  clientFirst: string;
  initials: string;
  goal: string | null;
  state: InviteState;
  rows: ReadyRow[];
  notes: string | null;
  notesDraft: string | null;
  notesBusy: boolean;
  copied: boolean;
  resendBusy: boolean;
  cancelling: boolean;
  confirmCancel: boolean;
  offlineAsOf: string | null;
  notice: string | null;
  error: string | null;
  toast: string | null;
  onOpen: (section: SetupSection) => void;
  onEditNotes: () => void;
  onNotesChange: (v: string) => void;
  onSaveNotes: () => void;
  onCancelNotes: () => void;
  onCopyLink: () => void;
  onResend: () => void;
  onAskCancel: () => void;
  onConfirmCancel: () => void;
  onKeepInvite: () => void;
}

export function InvitedClientView(p: InvitedClientViewProps) {
  const offline = p.offlineAsOf !== null;
  return (
    <>
      <BackLink to="/coach/clients" label="Clients" />
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <Avatar initials={p.initials} size={48} seed={p.name} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1
              className="h1"
              style={{ fontSize: 24, lineHeight: "30px", letterSpacing: -0.5 }}
            >
              {p.name}
            </h1>
            <InviteStatePill state={p.state} />
          </div>
          {p.goal && (
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
              {p.goal}
            </span>
          )}
        </div>
        <button
          type="button"
          className="btn sm ghost"
          onClick={p.onCopyLink}
          disabled={p.state !== "active"}
        >
          {p.copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
          {p.copied ? "Copied" : "Copy link"}
        </button>
        <button
          type="button"
          className="btn v sm"
          onClick={p.onResend}
          disabled={offline || p.resendBusy}
        >
          <IconSend size={16} />
          {p.resendBusy
            ? "Sending…"
            : p.state === "none"
              ? "Send invite"
              : "Resend invite"}
        </button>
      </header>
      <ClientTabs
        selected="Overview"
        open={["Overview"]}
        locked
        lockedReason={`opens when ${p.clientFirst} accepts`}
        hrefFor={() => "#"}
      />
      {offline && (
        <OfflineBanner subject={p.clientFirst} asOf={p.offlineAsOf} />
      )}
      {p.notice && <Notice tone="info">{p.notice}</Notice>}
      {p.error && <Notice tone="error">{p.error}</Notice>}
      <div className="grid-2">
        <div>
          <div
            className="divider"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              paddingTop: 14,
              marginTop: 4,
            }}
          >
            <span className="st" style={{ flex: "none" }}>
              Ready when {p.clientFirst} accepts
            </span>
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
              Open any to review or change
            </span>
          </div>
          {p.rows.map((r) => (
            <button
              key={r.section}
              type="button"
              className="row"
              style={{
                padding: "12px 0",
                borderRadius: 0,
                borderBottomColor: "var(--line-3)",
              }}
              aria-label={`Open ${r.title}`}
              onClick={() => p.onOpen(r.section)}
            >
              <span className="tx">
                <span className="n">{r.title}</span>
                <span className="s">{r.summary}</span>
              </span>
              {r.empty ? (
                <span
                  className="lk"
                  style={{ minHeight: 0 }}
                  aria-hidden="true"
                >
                  + Add
                </span>
              ) : (
                <IconChevron size={16} />
              )}
            </button>
          ))}
        </div>
        <div style={{ borderLeft: "1px solid var(--line)", paddingLeft: 32 }}>
          <div
            className="divider"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              paddingTop: 14,
              marginTop: 4,
            }}
          >
            <span className="st" style={{ flex: "none" }}>
              Private notes
            </span>
            {p.notesDraft === null && (
              <button
                type="button"
                className="lk"
                style={{ minHeight: 0 }}
                onClick={p.onEditNotes}
                disabled={offline}
              >
                Edit
              </button>
            )}
          </div>
          {p.notesDraft === null ? (
            <p
              style={{
                margin: "8px 0 0",
                fontSize: 13.5,
                lineHeight: "20px",
                color: "var(--ink-2)",
                whiteSpace: "pre-wrap",
              }}
            >
              {p.notes || "No notes yet. Only you see these."}
            </p>
          ) : (
            <div
              style={{
                marginTop: 8,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <label className="sr-only" htmlFor="invited-notes">
                Private notes
              </label>
              <textarea
                id="invited-notes"
                className="fld"
                rows={5}
                maxLength={4000}
                value={p.notesDraft}
                onChange={(e) => p.onNotesChange(e.target.value)}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="btn xs ghost"
                  onClick={p.onCancelNotes}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn xs v"
                  onClick={p.onSaveNotes}
                  disabled={p.notesBusy}
                >
                  {p.notesBusy ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          )}
          <span
            style={{
              display: "block",
              fontSize: 13,
              lineHeight: "19px",
              color: "var(--muted)",
              marginTop: 22,
            }}
          >
            The other tabs open once {p.clientFirst} accepts.
          </span>
          <button
            type="button"
            className="lk danger"
            onClick={p.onAskCancel}
            disabled={offline || p.cancelling}
          >
            Cancel invite
          </button>
        </div>
      </div>
      {p.confirmCancel && (
        <Dialog
          title={`Cancel ${p.clientFirst}'s invite?`}
          onClose={p.onKeepInvite}
        >
          <p className="sub" style={{ margin: 0 }}>
            Their code stops working and {p.clientFirst} leaves your Invited
            list. You can add them again at any time.
          </p>
          <div className="footer-bar">
            <button
              type="button"
              className="btn sm ghost"
              onClick={p.onKeepInvite}
            >
              Keep invite
            </button>
            <button
              type="button"
              className="btn sm dang"
              onClick={p.onConfirmCancel}
              disabled={p.cancelling}
            >
              {p.cancelling ? "Cancelling…" : "Cancel invite"}
            </button>
          </div>
        </Dialog>
      )}
      {p.toast && <Toast text={p.toast} />}
    </>
  );
}
