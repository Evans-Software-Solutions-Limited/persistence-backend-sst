import type { ClientFormEntry, CoachForm, FormResponse } from "../api/types";
import {
  compareRows,
  entryLine,
  responseLine,
  responseTitle,
  shortDate,
  statusPill,
  clientRule,
} from "../lib/forms";
import {
  IconCheck,
  IconChevron,
  IconClock,
  IconForm,
  IconX,
} from "../ui/icons";
import { Dialog, Notice, OfflineBanner } from "../ui/parts";

/**
 * Client → Check-ins (C3.3a): "Sent to {name}" with last-done pills,
 * History, and the selected check-in compared with any earlier one.
 */
export interface CheckinsTabProps {
  clientFirst: string;
  entries: ClientFormEntry[];
  history: FormResponse[];
  selectedFormId: string | null;
  shown: FormResponse | null;
  compareWith: FormResponse | null;
  earlier: FormResponse[];
  replyOpen: boolean;
  reply: string;
  busy: boolean;
  offlineAsOf: string | null;
  notice: string | null;
  error: string | null;
  onOpenForm: (formId: string) => void;
  onShow: (responseId: string) => void;
  onCompare: (responseId: string) => void;
  onAddForm: () => void;
  onReplyOpen: (open: boolean) => void;
  onReply: (text: string) => void;
  onSendReply: () => void;
  onMarkReviewed: () => void;
}

function Pill({
  state,
  lastDoneAt,
}: Pick<ClientFormEntry, "state" | "lastDoneAt">) {
  const pill = statusPill(state, lastDoneAt);
  return (
    <span
      className={`pl ${pill.tone === "done" ? "ok" : pill.tone === "todo" ? "warn" : "idle"}`}
      style={{ flex: "none" }}
    >
      {pill.tone === "done" ? <IconCheck size={14} /> : <IconClock size={14} />}
      {pill.text}
    </span>
  );
}

const selectedRow = {
  background: "rgba(167,139,250,.10)",
  borderRadius: 12,
  paddingLeft: 10,
  paddingRight: 10,
  borderBottomColor: "transparent",
} as const;

export function CheckinsTab(p: CheckinsTabProps) {
  return (
    <>
      {p.offlineAsOf !== null && (
        <OfflineBanner
          subject={`${p.clientFirst}'s check-ins`}
          asOf={p.offlineAsOf}
        />
      )}
      {p.notice && <Notice tone="info">{p.notice}</Notice>}
      {p.error && <Notice tone="error">{p.error}</Notice>}
      <div className="checkins-grid">
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <span className="eb" style={{ flex: 1 }}>
              Sent to {p.clientFirst}
            </span>
            <button
              type="button"
              className="lk"
              style={{ minHeight: 0, fontSize: 12.5 }}
              onClick={p.onAddForm}
            >
              + Add form
            </button>
          </div>
          {p.entries.length === 0 && (
            <p className="hint">
              No forms sent to {p.clientFirst} yet. Add one from your library.
            </p>
          )}
          {p.entries.map((e) => {
            const on = e.form.id === p.selectedFormId;
            const rule = e.rule ? clientRule(e.rule) : null;
            return (
              <button
                key={e.form.id}
                type="button"
                className="row"
                aria-current={on ? "true" : undefined}
                aria-label={`${e.form.title}: set up for ${p.clientFirst}`}
                style={on ? selectedRow : undefined}
                onClick={() => p.onOpenForm(e.form.id)}
              >
                <IconForm size={20} />
                <span className="tx">
                  <span className="n">{e.form.title}</span>
                  <span className="s">{entryLine(rule, e.lastSentAt)}</span>
                </span>
                <Pill state={e.state} lastDoneAt={e.lastDoneAt} />
                <IconChevron size={16} />
              </button>
            );
          })}
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <span className="eb" style={{ flex: 1 }}>
                History
              </span>
            </div>
            {p.history.length === 0 && (
              <p className="hint">Nothing answered yet.</p>
            )}
            {p.history.map((r) => (
              <button
                key={r.id}
                type="button"
                className="row"
                aria-current={p.shown?.id === r.id ? "true" : undefined}
                onClick={() => p.onShow(r.id)}
              >
                <IconForm size={20} />
                <span className="tx">
                  <span className="n">{responseTitle(r)}</span>
                  <span className="s">{responseLine(r)}</span>
                </span>
                {!r.reviewedAt && <span className="pl plV">To review</span>}
                <IconChevron size={16} />
              </button>
            ))}
          </div>
        </div>
        <Comparison {...p} />
      </div>
    </>
  );
}

function Comparison(p: CheckinsTabProps) {
  const r = p.shown;
  if (!r) {
    const entry = p.entries.find((e) => e.form.id === p.selectedFormId);
    return (
      <div className="sub">
        {entry
          ? `${entry.form.title}: no answers from ${p.clientFirst} yet.`
          : "Pick a form or a check-in to see the answers."}
      </div>
    );
  }
  const rows = compareRows(r, p.compareWith);
  return (
    <section aria-label={r.title} style={{ minWidth: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span className="st" style={{ flex: 1 }}>
          {r.title}
        </span>
        {r.late && <span className="pl warn">Late</span>}
        <span className={`pl ${r.reviewedAt ? "ok" : "plV"}`}>
          {r.reviewedAt ? "Reviewed" : "To review"}
        </span>
      </div>
      <div className="cmp head">
        <span style={{ font: "600 12px var(--font)" }}>Question</span>
        <span style={{ font: "600 12.5px var(--font)" }}>
          {shortDate(r.submittedAt)}
          {p.history.find((h) => h.formId === r.formId)?.id === r.id
            ? " · latest"
            : ""}
        </span>
        {p.earlier.length > 0 ? (
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontWeight: 500 }}>vs</span>
            <select
              className="fld"
              aria-label="Compare with"
              style={{ height: 40, fontSize: 12.5 }}
              value={p.compareWith?.id ?? ""}
              onChange={(e) => p.onCompare(e.target.value)}
            >
              {p.earlier.map((x) => (
                <option key={x.id} value={x.id}>
                  {shortDate(x.submittedAt)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span style={{ font: "500 12.5px var(--font)" }}>No earlier one</span>
        )}
      </div>
      {rows.map(({ q, now, before, trend }) => (
        <div key={q.id} className="cmp">
          <span>{q.prompt}</span>
          <span>
            {now || <span style={{ color: "var(--faint)" }}>—</span>}
            {trend && (
              <span className={`pl ${trend === "up" ? "ok" : "warn"}`}>
                <span aria-hidden="true">{trend === "up" ? "↑" : "↓"}</span>
                <span className="sr-only">
                  {trend === "up" ? "up" : "down"} from before
                </span>
              </span>
            )}
          </span>
          <span>{before}</span>
        </div>
      ))}
      {r.replyText && (
        <div className="sec-block" style={{ marginTop: 12 }}>
          <span className="fl">Your reply</span>
          <p className="sub" style={{ margin: 0, color: "var(--ink-2)" }}>
            {r.replyText}
          </p>
        </div>
      )}
      {p.replyOpen ? (
        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          <label className="fl" htmlFor="checkin-reply">
            Reply to {p.clientFirst}
          </label>
          <textarea
            id="checkin-reply"
            className="fld"
            rows={4}
            maxLength={2000}
            style={{ height: "auto", padding: 12 }}
            value={p.reply}
            disabled={p.busy}
            onChange={(e) => p.onReply(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn v sm"
              disabled={p.busy || !p.reply.trim()}
              onClick={p.onSendReply}
            >
              Send reply and mark reviewed
            </button>
            <button
              type="button"
              className="btn sm ghost"
              disabled={p.busy}
              onClick={() => p.onReplyOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            type="button"
            className="btn v sm"
            disabled={p.busy}
            onClick={() => p.onReplyOpen(true)}
          >
            {r.replyText ? "Change reply" : "Review and reply"}
          </button>
          {!r.reviewedAt && (
            <button
              type="button"
              className="btn sm ghost"
              disabled={p.busy}
              onClick={p.onMarkReviewed}
            >
              Mark reviewed
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** "+ Add form": pick a library form to send to this client. */
export function AddFormDialog({
  clientFirst,
  forms,
  onPick,
  onClose,
}: {
  clientFirst: string;
  forms: CoachForm[];
  onPick: (formId: string) => void;
  onClose: () => void;
}) {
  return (
    <Dialog title={`Send a form to ${clientFirst}`} onClose={onClose}>
      <button
        type="button"
        className="ibtn"
        aria-label="Close"
        onClick={onClose}
        style={{ position: "absolute", top: 16, right: 16 }}
      >
        <IconX size={16} />
      </button>
      {forms.length === 0 ? (
        <p className="sub">
          Every form in your library already goes to {clientFirst}, or your
          library is empty. Make one in Library → Forms.
        </p>
      ) : (
        forms.map((f) => (
          <button
            key={f.id}
            type="button"
            className="row"
            onClick={() => onPick(f.id)}
          >
            <IconForm size={20} />
            <span className="tx">
              <span className="n">{f.title}</span>
              <span className="s">
                {f.version?.questions.length ?? 0} questions
              </span>
            </span>
            <IconChevron size={16} />
          </button>
        ))
      )}
    </Dialog>
  );
}
