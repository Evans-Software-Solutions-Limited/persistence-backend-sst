import { useState } from "react";
import {
  DECLARATION_CONFIRM_LABEL,
  DECLARATION_FOOTNOTE,
  DECLARATION_INTRO,
  DECLARATION_POINTS,
  DECLARATION_TITLE,
} from "../lib/declaration";
import { Dialog, Notice } from "../ui/parts";

/** The coach declaration prompt shown before the first invite (D6b). */
export function DeclarationDialog({
  busy,
  error,
  onConfirm,
  onClose,
}: {
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [ticked, setTicked] = useState(false);
  return (
    <Dialog title={DECLARATION_TITLE} onClose={onClose}>
      <p className="sub" style={{ margin: 0, color: "var(--ink-2)" }}>
        {DECLARATION_INTRO}
      </p>
      <ul
        style={{
          margin: 0,
          paddingLeft: 18,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          fontSize: 14,
          lineHeight: "20px",
        }}
      >
        {DECLARATION_POINTS.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <p className="hint" style={{ margin: 0 }}>
        {DECLARATION_FOOTNOTE}
      </p>
      <label
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          fontSize: 14,
          minHeight: 44,
        }}
      >
        <input
          type="checkbox"
          checked={ticked}
          onChange={(e) => setTicked(e.target.checked)}
          style={{ width: 20, height: 20, accentColor: "var(--violet)" }}
        />
        {DECLARATION_CONFIRM_LABEL}
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="footer-bar">
        <button type="button" className="btn sm ghost" onClick={onClose}>
          Not now
        </button>
        <button
          type="button"
          className="btn v sm"
          disabled={!ticked || busy}
          onClick={onConfirm}
        >
          {busy ? "Confirming…" : "Confirm and continue"}
        </button>
      </div>
    </Dialog>
  );
}
