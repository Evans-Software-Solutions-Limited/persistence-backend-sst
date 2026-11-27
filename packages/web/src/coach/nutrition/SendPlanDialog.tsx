import type { RosterClient } from "../api/types";
import { firstName } from "../lib/people";
import { PLAN_NOTE_MAX } from "../lib/planForm";
import { Dialog, Notice } from "../ui/parts";

export interface SendPlanDialogProps {
  mode: "send" | "note";
  planName: string;
  /** "2,476 / 2,500", or null when the client has no target or isn't chosen. */
  versusTarget: string | null;
  /** The client, once known; null while the coach picks one (library send). */
  clientName: string | null;
  /** Library send: the active clients to pick from. */
  clients: RosterClient[] | null;
  clientId: string | null;
  note: string;
  noteError: string | null;
  busy: boolean;
  offline: boolean;
  error: string | null;
  onClient: (clientId: string) => void;
  onNote: (text: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

/**
 * C5 Send a plan with a note (no days), and C1b "Change the note". Sending
 * and note changes need a connection.
 */
export function SendPlanDialog(p: SendPlanDialogProps) {
  const first = p.clientName ? firstName(p.clientName) : null;
  const send = p.mode === "send";
  return (
    <Dialog
      title={send ? "Send meal plan" : "Change the note"}
      onClose={p.onClose}
    >
      <div style={{ display: "grid", gap: 14 }}>
        <div>
          <b>{p.planName}</b>
          {send && first && p.versusTarget && (
            <div className="hint">
              Plan vs {first}’s target{" "}
              <span className="mono">{p.versusTarget}</span>
            </div>
          )}
        </div>
        {p.clients && (
          <label className="fl">
            Send to
            <select
              className="fld"
              value={p.clientId ?? ""}
              onChange={(e) => p.onClient(e.target.value)}
            >
              <option value="" disabled>
                Choose a client
              </option>
              {p.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="fl">
          {first ? `Note for ${first}` : "Note"}
          <textarea
            className="fld"
            rows={4}
            value={p.note}
            maxLength={PLAN_NOTE_MAX * 2}
            aria-invalid={p.noteError ? "true" : undefined}
            onChange={(e) => p.onNote(e.target.value)}
          />
          {p.noteError && (
            <span className="err" role="alert">
              {p.noteError}
            </span>
          )}
        </label>
        {send && (
          <p className="hint" style={{ margin: 0 }}>
            {first
              ? `It goes into ${first}’s plans with your note. ${first} chooses when to follow it, and nothing is logged for them. Your later edits reach ${first} automatically.`
              : "It goes into your client’s plans with your note. They choose when to follow it, and nothing is logged for them. Your later edits reach them automatically."}
          </p>
        )}
        {p.offline && (
          <Notice tone="info">
            {send
              ? `You’re offline. Sending needs a connection, so Send${first ? ` to ${first}` : ""} waits until you’re back.`
              : "You’re offline. Changing the note needs a connection."}
          </Notice>
        )}
        {p.error && <Notice tone="error">{p.error}</Notice>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn ghost sm" onClick={p.onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn v sm"
            onClick={p.onSubmit}
            disabled={
              p.busy || p.offline || (send && !p.clientId) || !!p.noteError
            }
          >
            {send
              ? p.busy
                ? "Sending…"
                : first
                  ? `Send to ${first}`
                  : "Send"
              : p.busy
                ? "Saving…"
                : "Save note"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
