import { Link } from "react-router";
import { Avatar, Notice, OfflineBanner } from "../ui/parts";
import type { EventView, FeedTone, FeedTypeId } from "./lib";

/**
 * C10e · Notifications (web): what clients finished or still owe, filtered by
 * type and client, grouped by client so the coach reviews one person at a
 * time. Clients with nothing new collapse into one line.
 */

export interface NoteRow extends EventView {
  id: string;
  unread: boolean;
}

export interface NoteGroup {
  key: string;
  name: string;
  initials: string;
  summary: string;
  href: string | null;
  unread: number;
  rows: NoteRow[];
}

export interface LatestRow extends NoteRow {
  name: string;
  initials: string;
}

export interface NotificationsViewProps {
  types: { id: FeedTypeId; label: string; count: number }[];
  type: FeedTypeId;
  people: { key: string; name: string }[];
  who: string | null;
  mode: "client" | "latest";
  groups: NoteGroup[];
  quiet: NoteGroup[];
  showQuiet: boolean;
  latest: LatestRow[];
  unreadTotal: number;
  busy: string | null;
  offlineAsOf: string | null;
  error: string | null;
  onType: (id: FeedTypeId) => void;
  onWho: (key: string | null) => void;
  onMode: (mode: "client" | "latest") => void;
  onShowQuiet: () => void;
  onMarkAll: () => void;
  onMarkGroup: (key: string) => void;
}

const PILL: Record<FeedTone, string> = {
  done: "pl ok",
  trained: "pl plC",
  outstanding: "pl warn",
  record: "pl nt-gold",
  info: "pl idle",
};

function EventRow({ row, name }: { row: NoteRow; name?: string }) {
  return (
    <li className={`nt-erow${row.unread ? " unread" : ""}`}>
      <span className="nt-qtx">
        <span className="nt-qtop">
          {name && <b className="nt-name">{name}</b>}
          <span className="nt-etitle">{row.title}</span>
          {row.unread && <span className="sr-only">(new)</span>}
        </span>
        {row.detail && <span className="nt-facts">{row.detail}</span>}
      </span>
      {row.pill && <span className={PILL[row.tone]}>{row.pill}</span>}
      {row.action && (
        <Link to={row.action.href} className="act">
          {row.action.label}
        </Link>
      )}
    </li>
  );
}

function Group({
  g,
  disabled,
  onMark,
}: {
  g: NoteGroup;
  disabled: boolean;
  onMark?: () => void;
}) {
  return (
    <section className="nt-group" aria-label={g.name}>
      <div className="nt-ghead">
        <Avatar initials={g.initials} size={36} seed={g.name} />
        <span className="nt-qtx">
          <b className="nt-name">{g.name}</b>
          <span className="nt-facts">{g.summary}</span>
        </span>
        {g.href && (
          <Link to={g.href} className="lk quiet">
            Open client
          </Link>
        )}
        {g.unread > 0 && onMark && (
          <button
            type="button"
            className="lk"
            disabled={disabled}
            onClick={onMark}
            aria-label={`Mark ${g.name} read`}
          >
            Mark read
          </button>
        )}
      </div>
      <ul className="nt-list">
        {g.rows.map((r) => (
          <EventRow key={r.id} row={r} />
        ))}
      </ul>
    </section>
  );
}

export function NotificationsView(p: NotificationsViewProps) {
  const offline = p.offlineAsOf !== null;
  const nothing =
    p.mode === "client"
      ? p.groups.length === 0 && p.quiet.length === 0
      : p.latest.length === 0;
  return (
    <>
      <header className="nt-head">
        <div style={{ flex: 1 }}>
          <h1 className="h1">Notifications</h1>
          <span className="sub">
            What your clients finished or still owe you, one client at a time.
          </span>
        </div>
        <Link to="/coach/notifications/settings" className="btn ghost xs">
          Notification settings
        </Link>
        <button
          type="button"
          className="btn ghost xs"
          disabled={offline || p.unreadTotal === 0 || p.busy !== null}
          onClick={p.onMarkAll}
        >
          Mark all read
        </button>
      </header>
      {offline && (
        <OfflineBanner subject="notifications" asOf={p.offlineAsOf} />
      )}
      {p.error && <Notice tone="error">{p.error}</Notice>}

      <div className="nt-filters">
        <div className="nt-chips" role="group" aria-label="Type">
          {p.types.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`chip${p.type === t.id ? " on" : ""}`}
              aria-pressed={p.type === t.id}
              onClick={() => p.onType(t.id)}
            >
              {t.label} <b className="mono">{t.count}</b>
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="nt-who">
          Client
        </label>
        <select
          id="nt-who"
          className="fld nt-select"
          value={p.who ?? ""}
          onChange={(e) => p.onWho(e.target.value || null)}
        >
          <option value="">All clients</option>
          {p.people.map((w) => (
            <option key={w.key} value={w.key}>
              {w.name}
            </option>
          ))}
        </select>
        <div className="seg" role="group" aria-label="Order">
          <button
            type="button"
            aria-pressed={p.mode === "client"}
            onClick={() => p.onMode("client")}
          >
            By client
          </button>
          <button
            type="button"
            aria-pressed={p.mode === "latest"}
            onClick={() => p.onMode("latest")}
          >
            Latest
          </button>
        </div>
      </div>

      {nothing && (
        <div className="nt-empty" role="status">
          <b>No notifications</b>
          <span>
            When clients finish workouts, check-ins and forms, they show here.
          </span>
        </div>
      )}

      {p.mode === "client" ? (
        <>
          {p.groups.map((g) => (
            <Group
              key={g.key}
              g={g}
              disabled={offline || p.busy !== null}
              onMark={() => p.onMarkGroup(g.key)}
            />
          ))}
          {p.quiet.length > 0 &&
            (p.showQuiet ? (
              p.quiet.map((g) => <Group key={g.key} g={g} disabled />)
            ) : (
              <button type="button" className="more" onClick={p.onShowQuiet}>
                Show {p.quiet.length}{" "}
                {p.quiet.length === 1 ? "client" : "clients"} with nothing new
              </button>
            ))}
        </>
      ) : (
        <ul className="nt-list">
          {p.latest.map((r) => (
            <EventRow key={r.id} row={r} name={r.name} />
          ))}
        </ul>
      )}
    </>
  );
}
