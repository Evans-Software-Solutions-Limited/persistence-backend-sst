import { useState } from "react";
import { Avatar, Dialog, Notice } from "../ui/parts";

/** "Copy setup from a client" (C11b): pick an active client or invited profile. */
export interface CopySource {
  kind: "client" | "profile";
  id: string;
  name: string;
  initials: string;
  detail: string;
}

export function CopyFromDialog({
  sources,
  busy,
  error,
  clientFirst,
  onCopy,
  onClose,
}: {
  sources: CopySource[];
  busy: boolean;
  error: string | null;
  clientFirst: string;
  onCopy: (source: CopySource) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q
    ? sources.filter((s) => s.name.toLowerCase().includes(q))
    : sources;
  return (
    <Dialog title="Copy setup from a client" onClose={onClose}>
      <p className="sub" style={{ margin: 0 }}>
        Copies what you set up for them into {clientFirst}'s checklist. Anything
        already in a copied section is replaced.
      </p>
      {sources.length > 5 && (
        <input
          className="fld"
          type="search"
          placeholder="Search clients"
          aria-label="Search clients"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {sources.length === 0 ? (
        <p className="sub">No other clients to copy from yet.</p>
      ) : (
        <div role="list" aria-label="Clients">
          {shown.map((s) => (
            <div className="row" role="listitem" key={`${s.kind}-${s.id}`}>
              <Avatar initials={s.initials} size={32} seed={s.name} />
              <span className="tx">
                <span className="n">{s.name}</span>
                <span className="s">{s.detail}</span>
              </span>
              <button
                type="button"
                className="act"
                disabled={busy}
                onClick={() => onCopy(s)}
              >
                Copy
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="footer-bar">
        <button type="button" className="btn sm ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
