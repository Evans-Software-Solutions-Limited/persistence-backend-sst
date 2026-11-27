import type { CoachResource, RosterClient } from "../api/types";
import { LibraryTabs } from "../forms/FormsLibrary";
import {
  dayMonth,
  hostOf,
  resourceMeta,
  typeLabel,
  type ResourceFilter,
} from "../lib/resources";
import { initials } from "../lib/people";
import {
  IconCheck,
  IconLink,
  IconSearch,
  IconTrash,
  IconUpload,
  IconX,
} from "../ui/icons";
import { Avatar, Dialog, Notice, OfflineBanner } from "../ui/parts";
import { ResourceIcon } from "./ClientResourcesTab";

const FILTERS: { key: ResourceFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "file", label: "Files" },
  { key: "link", label: "Links" },
];

/**
 * Library → Resources (C5b): search, All · Files · Links, the list, and the
 * selected resource beside it with Share (bulk, to any clients) and Delete
 * (removes it from every client, Brad 26 Nov).
 */
export interface ResourcesLibraryProps {
  rows: CoachResource[];
  counts: Record<ResourceFilter, number>;
  filter: ResourceFilter;
  query: string;
  selected: CoachResource | null;
  busy: boolean;
  offlineAsOf: string | null;
  offline: boolean;
  notice: string | null;
  error: string | null;
  confirmDelete: boolean;
  onQuery: (q: string) => void;
  onFilter: (f: ResourceFilter) => void;
  onSelect: (id: string) => void;
  onAddLink: () => void;
  onUpload: () => void;
  onShare: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

export function ResourcesLibrary(p: ResourcesLibraryProps) {
  return (
    <>
      <LibraryTabs current="resources" />
      <header
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 200 }}>
          <p className="eb" style={{ margin: 0 }}>
            Library
          </p>
          <h1 className="h1">Resources</h1>
        </div>
        <label
          className="search-field"
          style={{ width: 280, maxWidth: "100%" }}
        >
          <IconSearch size={16} />
          <span className="sr-only">Search resources</span>
          <input
            type="search"
            className="fld"
            placeholder="Search resources"
            value={p.query}
            onChange={(e) => p.onQuery(e.target.value)}
          />
        </label>
        <button type="button" className="btn sm" onClick={p.onAddLink}>
          <IconLink size={16} />
          Add link
        </button>
        <button type="button" className="btn v sm" onClick={p.onUpload}>
          <IconUpload size={16} />
          Upload
        </button>
      </header>
      {p.offlineAsOf !== null && (
        <OfflineBanner subject="your resources" asOf={p.offlineAsOf} />
      )}
      {p.notice && <Notice tone="info">{p.notice}</Notice>}
      {p.error && <Notice tone="error">{p.error}</Notice>}
      <div className="chips" role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`chip${p.filter === f.key ? " on" : ""}`}
            aria-pressed={p.filter === f.key}
            onClick={() => p.onFilter(f.key)}
          >
            {f.label} <b className="mono">{p.counts[f.key]}</b>
          </button>
        ))}
      </div>
      <div className="resources-lib">
        <div style={{ minWidth: 0 }}>
          <div className="res-head" aria-hidden="true">
            <span />
            <span className="eb">Name</span>
            <span className="eb">Type</span>
            <span className="eb">Added</span>
          </div>
          {p.rows.length === 0 && (
            <p className="hint">
              {p.counts.all === 0
                ? "No resources yet. Upload a PDF or image, or add a link, then share it with your clients."
                : "Nothing matches."}
            </p>
          )}
          {p.rows.map((r) => (
            <button
              key={r.id}
              type="button"
              className="res-row"
              aria-current={p.selected?.id === r.id ? "true" : undefined}
              onClick={() => p.onSelect(r.id)}
            >
              <ResourceIcon resource={r} />
              <b>{r.title}</b>
              <span>{resourceMeta(r)}</span>
              <span>{dayMonth(r.createdAt)}</span>
            </button>
          ))}
        </div>
        {p.selected ? (
          <section aria-label={p.selected.title} className="sec-block">
            <span className="pl idle">{typeLabel(p.selected)}</span>
            <h2 className="h2" style={{ fontSize: 20, margin: "10px 0 12px" }}>
              {p.selected.title}
            </h2>
            <div className="kv">
              <span>Type</span>
              <b className="mono">{resourceMeta(p.selected)}</b>
            </div>
            {p.selected.url && (
              <div className="kv">
                <span>Link</span>
                <a href={p.selected.url} target="_blank" rel="noreferrer">
                  {hostOf(p.selected.url)}
                </a>
              </div>
            )}
            <div className="kv">
              <span>Added</span>
              <b className="mono">{dayMonth(p.selected.createdAt)}</b>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button
                type="button"
                className="btn v sm"
                disabled={p.busy}
                onClick={p.onShare}
              >
                Share
              </button>
              <button
                type="button"
                className="btn sm ghost"
                disabled={p.busy}
                onClick={p.onAskDelete}
              >
                <IconTrash size={16} />
                Delete
              </button>
            </div>
            {p.offline && (
              <span className="hint" style={{ display: "block", marginTop: 8 }}>
                Sharing and deleting need a connection.
              </span>
            )}
          </section>
        ) : (
          <p className="sub">Pick a resource to share it or see its details.</p>
        )}
      </div>
      {p.confirmDelete && p.selected && (
        <Dialog
          title={`Delete ${p.selected.title}?`}
          onClose={p.onCancelDelete}
        >
          <p className="sub">
            It's removed from your Library and from every client who has it.
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
              onClick={p.onCancelDelete}
            >
              Keep
            </button>
            <button
              type="button"
              className="btn sm"
              disabled={p.busy}
              onClick={p.onConfirmDelete}
            >
              Delete
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

/** Share one resource with several clients at once (C5b bulk sharing). */
export function ShareDialog({
  title,
  clients,
  query,
  picked,
  busy,
  error,
  onQuery,
  onToggle,
  onShare,
  onClose,
}: {
  title: string;
  clients: RosterClient[];
  query: string;
  picked: string[];
  busy: boolean;
  error: string | null;
  onQuery: (q: string) => void;
  onToggle: (clientId: string) => void;
  onShare: () => void;
  onClose: () => void;
}) {
  const shown = clients.filter((c) =>
    c.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const n = picked.length;
  return (
    <Dialog title={`Share ${title}`} onClose={onClose}>
      <button
        type="button"
        className="ibtn"
        aria-label="Close"
        onClick={onClose}
        style={{ position: "absolute", top: 16, right: 16 }}
      >
        <IconX size={16} />
      </button>
      {error && <Notice tone="error">{error}</Notice>}
      <label className="search-field" style={{ margin: "12px 0 4px" }}>
        <IconSearch size={16} />
        <span className="sr-only">Search clients</span>
        <input
          type="search"
          className="fld"
          placeholder="Search clients"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </label>
      {clients.length === 0 && (
        <p className="hint">You have no active clients to share with yet.</p>
      )}
      {shown.map((c) => (
        <label key={c.id} className="row" style={{ cursor: "pointer" }}>
          <Avatar initials={c.initials || initials(c.name)} seed={c.id} />
          <span className="tx">
            <span className="n">{c.name}</span>
          </span>
          <input
            type="checkbox"
            className="pick"
            checked={picked.includes(c.id)}
            disabled={busy}
            onChange={() => onToggle(c.id)}
          />
        </label>
      ))}
      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
          marginTop: 16,
        }}
      >
        <button type="button" className="btn sm ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn v sm"
          disabled={n === 0 || busy}
          onClick={onShare}
        >
          {busy ? (
            "Sharing…"
          ) : n === 0 ? (
            "Share"
          ) : (
            <>
              <IconCheck size={16} />
              {`Share with ${n === 1 ? "1 client" : `${n} clients`}`}
            </>
          )}
        </button>
      </div>
    </Dialog>
  );
}
