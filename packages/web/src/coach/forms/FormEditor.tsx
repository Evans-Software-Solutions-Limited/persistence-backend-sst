import type { FormQuestion, PrefillSource, QuestionType } from "../api/types";
import {
  MAX_OPTIONS,
  MAX_QUESTIONS,
  MAX_TITLE,
  PREFILL,
  QUESTION_TYPES,
  prefillFor,
  questionLine,
} from "../lib/forms";
import {
  IconCopy,
  IconChevronDown,
  IconEye,
  IconGrip,
  IconPlus,
  IconTrash,
  IconUp,
  IconX,
} from "../ui/icons";
import { BackLink, Notice, OfflineBanner, Toggle } from "../ui/parts";

export interface FormEditorProps {
  isNew: boolean;
  title: string;
  subtitle: string | null;
  banner: { clients: number; nextSend: string | null } | null;
  questions: FormQuestion[];
  selected: number;
  problems: Map<number, string>;
  dirty: boolean;
  busy: boolean;
  offline: boolean;
  notice: string | null;
  error: string | null;
  onTitle: (title: string) => void;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onChange: (index: number, q: FormQuestion) => void;
  onType: (index: number, type: QuestionType) => void;
  onDuplicate: (index: number) => void;
  onDelete: (index: number) => void;
  onMove: (index: number, by: -1 | 1) => void;
  onPreview: () => void;
  onSave: () => void;
}

export function FormEditor(p: FormEditorProps) {
  const q = p.questions[p.selected];
  const canSave =
    p.dirty &&
    !p.busy &&
    p.title.trim().length > 0 &&
    p.questions.length > 0 &&
    p.problems.size === 0;
  return (
    <>
      <BackLink to="/coach/library/forms" label="Forms" />
      <header
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 260 }}>
          <label className="sr-only" htmlFor="form-title">
            Form name
          </label>
          <input
            id="form-title"
            className="h1"
            style={{
              background: "none",
              border: 0,
              color: "var(--ink)",
              padding: 0,
              width: "100%",
            }}
            placeholder="Name this form"
            maxLength={MAX_TITLE}
            value={p.title}
            disabled={p.busy}
            onChange={(e) => p.onTitle(e.target.value)}
          />
          {p.subtitle && <span className="sub">{p.subtitle}</span>}
        </div>
        <button
          type="button"
          className="btn sm ghost"
          onClick={p.onPreview}
          disabled={p.questions.length === 0}
        >
          <IconEye size={16} />
          Preview
        </button>
        <button
          type="button"
          className="btn v sm"
          disabled={!canSave}
          onClick={p.onSave}
        >
          {p.busy ? "Saving…" : p.isNew ? "Save form" : "Save changes"}
        </button>
      </header>
      {p.offline && <OfflineBanner subject="this form" asOf={null} />}
      {p.notice && <Notice tone="info">{p.notice}</Notice>}
      {p.error && <Notice tone="error">{p.error}</Notice>}
      {p.banner && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 0",
            borderTop: "1px solid var(--line-2)",
            borderBottom: "1px solid var(--line-2)",
          }}
        >
          <span
            style={{
              font: "400 13.5px/19px var(--font)",
              color: "var(--ink-2)",
              flex: 1,
            }}
          >
            <b style={{ color: "var(--ink)", fontWeight: 600 }}>
              {p.banner.clients}{" "}
              {p.banner.clients === 1 ? "client gets" : "clients get"} this
              form.
            </b>{" "}
            Your changes apply from the next one
            {p.banner.nextSend ? `, on ${p.banner.nextSend}` : ""}. Answers
            already sent keep the questions they were asked.
          </span>
        </div>
      )}
      <div className="editor-grid">
        <div>
          {p.questions.length === 0 && (
            <p className="sub">No questions yet. Add the first one.</p>
          )}
          {p.questions.map((x, i) => {
            const on = i === p.selected;
            return (
              <button
                key={x.id}
                type="button"
                className="row"
                aria-current={on ? "true" : undefined}
                aria-label={`Question ${i + 1}: ${x.prompt || "untitled"}`}
                onClick={() => p.onSelect(i)}
                style={{
                  padding: "8px 0",
                  ...(on
                    ? {
                        background: "rgba(167,139,250,.10)",
                        borderRadius: 12,
                        paddingLeft: 10,
                        paddingRight: 10,
                        borderBottomColor: "transparent",
                      }
                    : {}),
                }}
              >
                <IconGrip size={16} />
                <span
                  className="mono"
                  style={{
                    width: 20,
                    fontSize: 13,
                    color: on ? "var(--violet)" : "var(--muted)",
                  }}
                >
                  {i + 1}
                </span>
                <span className="tx">
                  <span className="n" style={{ fontSize: 14 }}>
                    {x.prompt || "Untitled question"}
                  </span>
                  <span className="s">
                    {p.problems.get(i) ?? questionLine(x)}
                  </span>
                </span>
                {x.prefill && <span className="pl plC">Filled for them</span>}
              </button>
            );
          })}
          <button
            type="button"
            className="btn sm ghost"
            style={{ marginTop: 10, width: "100%" }}
            disabled={p.busy || p.questions.length >= MAX_QUESTIONS}
            onClick={p.onAdd}
          >
            <IconPlus size={16} />
            Add question
          </button>
        </div>
        <div>
          {q ? (
            <QuestionPanel
              index={p.selected}
              count={p.questions.length}
              q={q}
              problem={p.problems.get(p.selected) ?? null}
              busy={p.busy}
              onChange={(next) => p.onChange(p.selected, next)}
              onType={(t) => p.onType(p.selected, t)}
              onDuplicate={() => p.onDuplicate(p.selected)}
              onDelete={() => p.onDelete(p.selected)}
              onMove={(by) => p.onMove(p.selected, by)}
            />
          ) : (
            <p className="sub">Pick a question to edit it.</p>
          )}
          <span
            style={{
              font: "400 12.5px/18px var(--font)",
              color: "var(--muted)",
              marginTop: 6,
            }}
          >
            Questions marked “Filled for them” come from what the client already
            logs. They can still change the answer before sending.
          </span>
        </div>
      </div>
    </>
  );
}

function QuestionPanel({
  index,
  count,
  q,
  problem,
  busy,
  onChange,
  onType,
  onDuplicate,
  onDelete,
  onMove,
}: {
  index: number;
  count: number;
  q: FormQuestion;
  problem: string | null;
  busy: boolean;
  onChange: (q: FormQuestion) => void;
  onType: (t: QuestionType) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (by: -1 | 1) => void;
}) {
  const choice = q.type === "single_choice" || q.type === "multiple_choice";
  const sources = prefillFor(q.type);
  const num = (raw: string) => (raw === "" ? undefined : Number(raw));
  return (
    <>
      <span style={{ font: "600 13px var(--font)", color: "var(--violet)" }}>
        Question {index + 1}
      </span>
      <div>
        <label className="fl" htmlFor="q-prompt">
          Question
        </label>
        <input
          id="q-prompt"
          className="fld"
          value={q.prompt}
          maxLength={300}
          disabled={busy}
          onChange={(e) => onChange({ ...q, prompt: e.target.value })}
        />
        {problem && <span className="err">{problem}</span>}
      </div>
      <div>
        <label className="fl" htmlFor="q-help">
          Help text, optional
        </label>
        <input
          id="q-help"
          className="fld"
          value={q.help ?? ""}
          maxLength={300}
          disabled={busy}
          onChange={(e) => onChange({ ...q, help: e.target.value })}
        />
      </div>
      <div>
        <span className="fl">Answer type</span>
        <div className="qtypes" role="radiogroup" aria-label="Answer type">
          {QUESTION_TYPES.map((t) => (
            <button
              key={t.type}
              type="button"
              role="radio"
              aria-checked={q.type === t.type}
              disabled={busy}
              onClick={() => onType(t.type)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {choice && (
        <div>
          <span className="fl">Options</span>
          {(q.options ?? []).map((o, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <input
                className="fld"
                aria-label={`Option ${i + 1}`}
                value={o}
                maxLength={100}
                disabled={busy}
                onChange={(e) =>
                  onChange({
                    ...q,
                    options: (q.options ?? []).map((x, j) =>
                      j === i ? e.target.value : x,
                    ),
                  })
                }
              />
              <button
                type="button"
                className="ibtn danger"
                aria-label={`Remove option ${i + 1}`}
                disabled={busy || (q.options ?? []).length <= 2}
                onClick={() =>
                  onChange({
                    ...q,
                    options: (q.options ?? []).filter((_, j) => j !== i),
                  })
                }
              >
                <IconX size={16} />
              </button>
            </div>
          ))}
          {(q.options ?? []).length < MAX_OPTIONS && (
            <button
              type="button"
              className="lk"
              disabled={busy}
              onClick={() =>
                onChange({
                  ...q,
                  options: [
                    ...(q.options ?? []),
                    `Option ${(q.options ?? []).length + 1}`,
                  ],
                })
              }
            >
              + Add option
            </button>
          )}
        </div>
      )}
      {q.type === "number" && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <label>
            <span className="fl">Lowest, optional</span>
            <input
              className="fld"
              type="number"
              style={{ width: 120 }}
              value={q.min ?? ""}
              disabled={busy}
              onChange={(e) => onChange({ ...q, min: num(e.target.value) })}
            />
          </label>
          <label>
            <span className="fl">Highest, optional</span>
            <input
              className="fld"
              type="number"
              style={{ width: 120 }}
              value={q.max ?? ""}
              disabled={busy}
              onChange={(e) => onChange({ ...q, max: num(e.target.value) })}
            />
          </label>
          <label>
            <span className="fl">Unit, optional</span>
            <input
              className="fld"
              style={{ width: 120 }}
              value={q.unit ?? ""}
              maxLength={20}
              placeholder="kg, hours…"
              disabled={busy}
              onChange={(e) => onChange({ ...q, unit: e.target.value })}
            />
          </label>
        </div>
      )}
      <div style={{ marginTop: 2 }}>
        <div className="row">
          <span className="tx">
            <span className="n" style={{ fontSize: 14 }}>
              Required
            </span>
            <span className="s">They can’t send the form without it.</span>
          </span>
          <Toggle
            label="Required"
            checked={q.required}
            disabled={busy}
            onChange={(on) => onChange({ ...q, required: on })}
          />
        </div>
        {q.type === "yes_no" && (
          <div className="row">
            <span className="tx">
              <span className="n" style={{ fontSize: 14 }}>
                Ask for details if yes
              </span>
              <span className="s">Shows a text box when they answer yes.</span>
            </span>
            <Toggle
              label="Ask for details if yes"
              checked={!!q.detailsIfYes}
              disabled={busy}
              onChange={(on) => onChange({ ...q, detailsIfYes: on })}
            />
          </div>
        )}
        {sources.length > 0 && (
          <div className="row">
            <span className="tx">
              <span className="n" style={{ fontSize: 14 }}>
                Filled for them
              </span>
              <span className="s">From what they already log.</span>
            </span>
            <select
              className="fld"
              aria-label="Filled for them"
              style={{ width: "auto" }}
              value={q.prefill ?? ""}
              disabled={busy}
              onChange={(e) =>
                onChange({
                  ...q,
                  prefill: (e.target.value || undefined) as
                    | PrefillSource
                    | undefined,
                })
              }
            >
              <option value="">No</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {PREFILL[s].label} · from {PREFILL[s].from}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn sm ghost"
          disabled={busy || count >= MAX_QUESTIONS}
          onClick={onDuplicate}
        >
          <IconCopy size={16} />
          Duplicate
        </button>
        <button
          type="button"
          className="btn sm ghost"
          style={{ color: "#fca5a5" }}
          disabled={busy}
          onClick={onDelete}
        >
          <IconTrash size={16} />
          Delete
        </button>
        <button
          type="button"
          className="ibtn"
          aria-label="Move up"
          disabled={busy || index === 0}
          onClick={() => onMove(-1)}
        >
          <IconUp size={16} />
        </button>
        <button
          type="button"
          className="ibtn"
          aria-label="Move down"
          disabled={busy || index === count - 1}
          onClick={() => onMove(1)}
        >
          <IconChevronDown size={16} />
        </button>
      </div>
    </>
  );
}
