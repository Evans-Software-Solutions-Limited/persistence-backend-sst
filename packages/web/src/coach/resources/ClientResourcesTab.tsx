import { useRef } from "react";
import type { ClientResource, CoachResource } from "../api/types";
import { openedLabel, resourceMeta, sharedLine } from "../lib/resources";
import {
  IconCheck,
  IconForm,
  IconImage,
  IconLink,
  IconPlus,
  IconSearch,
  IconUpload,
  IconX,
} from "../ui/icons";
import { Dialog, Notice, OfflineBanner } from "../ui/parts";

/** The row icon for a resource: link, image or document. */
export function ResourceIcon({
  resource,
}: {
  resource: Pick<CoachResource, "kind" | "mime">;
}) {
  if (resource.kind === "link") return <IconLink size={20} />;
  if (resource.mime?.startsWith("image/")) return <IconImage size={20} />;
  return <IconForm size={20} />;
}

/**
 * Client → Resources (C3.7a): what the client has, with opened / not opened,
 * and "Add resources for {name}" beside it: search the library, tick several,
 * Upload new or Link, then "Add N for {name}".
 */
export interface ClientResourcesTabProps {
  clientFirst: string;
  assigned: ClientResource[];
  /** Library resources the client doesn't have yet, after the search. */
  candidates: CoachResource[];
  libraryCount: number;
  query: string;
  selected: string[];
  /** C3.9: Resources switched off for this client (PER-150). */
  resourcesOff: boolean;
  busy: boolean;
  offlineAsOf: string | null;
  offline: boolean;
  notice: string | null;
  error: string | null;
  confirmRemove: ClientResource | null;
  onQuery: (q: string) => void;
  onToggle: (resourceId: string) => void;
  onAdd: () => void;
  onUpload: () => void;
  onLink: () => void;
  onAskRemove: (cr: ClientResource) => void;
  onCancelRemove: () => void;
  onConfirmRemove: () => void;
}

export function ClientResourcesTab(p: ClientResourcesTabProps) {
  const search = useRef<HTMLInputElement>(null);
  const n = p.selected.length;
  return (
    <>
      {p.offlineAsOf !== null && (
        <OfflineBanner
          subject={`${p.clientFirst}'s resources`}
          asOf={p.offlineAsOf}
        />
      )}
      {p.resourcesOff && (
        <Notice tone="info">
          Resources are switched off for {p.clientFirst} in Settings, so{" "}
          {p.clientFirst} can't see these and you can't share more. You can
          still remove them.
        </Notice>
      )}
      {p.notice && <Notice tone="info">{p.notice}</Notice>}
      {p.error && <Notice tone="error">{p.error}</Notice>}
      <div className="resources-grid">
        <section aria-label={`${p.clientFirst}'s resources`}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <span className="eb" style={{ flex: 1 }}>
              {p.clientFirst} has {p.assigned.length}
            </span>
            <button
              type="button"
              className="btn v sm"
              onClick={() => search.current?.focus()}
            >
              <IconPlus size={16} />
              Add resources
            </button>
          </div>
          {p.assigned.length === 0 && (
            <p className="hint">
              Nothing shared with {p.clientFirst} yet. Add something from your
              Library, or upload a file or a link.
            </p>
          )}
          {p.assigned.map((cr) => (
            <div key={cr.assignmentId} className="row">
              <ResourceIcon resource={cr.resource} />
              <span className="tx">
                <span className="n">{cr.resource.title}</span>
                <span className="s">{sharedLine(cr)}</span>
              </span>
              <span
                className={`pl ${cr.openedAt ? "ok" : "idle"}`}
                style={{ flex: "none" }}
              >
                {cr.openedAt && <IconCheck size={14} />}
                {openedLabel(cr)}
              </span>
              <button
                type="button"
                className="ibtn"
                aria-label={`Remove ${cr.resource.title} from ${p.clientFirst}`}
                disabled={p.busy}
                onClick={() => p.onAskRemove(cr)}
              >
                <IconX size={16} />
              </button>
            </div>
          ))}
        </section>

        <section
          aria-label={`Add resources for ${p.clientFirst}`}
          className="sec-block"
        >
          <p className="eb" style={{ margin: "0 0 10px" }}>
            Add resources for {p.clientFirst}
          </p>
          <label className="search-field">
            <IconSearch size={16} />
            <span className="sr-only">Search your resources</span>
            <input
              ref={search}
              type="search"
              className="fld"
              placeholder={`Search your ${p.libraryCount} resources`}
              value={p.query}
              onChange={(e) => p.onQuery(e.target.value)}
            />
          </label>
          {p.candidates.length === 0 && (
            <p className="hint">
              {p.libraryCount === 0
                ? "Your Library has no resources yet. Upload a file or add a link."
                : p.query.trim()
                  ? "Nothing matches that search."
                  : `${p.clientFirst} already has everything in your Library.`}
            </p>
          )}
          {p.candidates.map((r) => {
            const on = p.selected.includes(r.id);
            return (
              <label key={r.id} className="row" style={{ cursor: "pointer" }}>
                <ResourceIcon resource={r} />
                <span className="tx">
                  <span className="n">{r.title}</span>
                  <span className="s">{resourceMeta(r)}</span>
                </span>
                <input
                  type="checkbox"
                  className="pick"
                  checked={on}
                  disabled={p.busy}
                  onChange={() => p.onToggle(r.id)}
                />
              </label>
            );
          })}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              type="button"
              className="btn sm"
              onClick={p.onUpload}
              disabled={p.busy}
            >
              <IconUpload size={16} />
              Upload new
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={p.onLink}
              disabled={p.busy}
            >
              <IconLink size={16} />
              Link
            </button>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className="btn v sm"
              disabled={n === 0 || p.busy}
              onClick={p.onAdd}
            >
              {n === 0
                ? `Add for ${p.clientFirst}`
                : `Add ${n} for ${p.clientFirst}`}
            </button>
          </div>
          <span className="hint" style={{ display: "block", marginTop: 10 }}>
            Uploads go to your Library too, so you can share them again.
          </span>
          {p.offline && (
            <span className="hint" style={{ display: "block", marginTop: 4 }}>
              Sharing and uploads need a connection.
            </span>
          )}
        </section>
      </div>
      {p.confirmRemove && (
        <Dialog
          title={`Remove ${p.confirmRemove.resource.title}?`}
          onClose={p.onCancelRemove}
        >
          <p className="sub">
            {p.clientFirst} won't see it any more. It stays in your Library.
          </p>
          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
              marginTop: 16,
            }}
          >
            <button
              type="button"
              className="btn sm ghost"
              onClick={p.onCancelRemove}
            >
              Keep
            </button>
            <button
              type="button"
              className="btn sm"
              disabled={p.busy}
              onClick={p.onConfirmRemove}
            >
              Remove
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
