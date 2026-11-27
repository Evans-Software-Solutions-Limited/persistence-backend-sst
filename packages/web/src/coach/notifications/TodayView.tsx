import { Link } from "react-router";
import { IconPlus } from "../ui/icons";
import { Avatar, Notice, OfflineBanner } from "../ui/parts";
import type {
  ScheduleRow,
  StripCell,
  TodayFilterId,
  TodayRowView,
} from "./lib";

/**
 * C2a · Today (web), K · Balanced pass: the strip, one queue of what needs the
 * coach with filter chips and one action per row, and today's schedule.
 */

export interface TodayRow extends TodayRowView {
  eventId: string;
  name: string;
  initials: string;
  href: string | null;
  time: string;
  unread: boolean;
}

export interface TodayViewProps {
  dateLabel: string;
  cells: StripCell[];
  filters: { id: TodayFilterId; label: string; count: number }[];
  filter: TodayFilterId;
  rows: TodayRow[];
  schedule: ScheduleRow[];
  busyId: string | null;
  offlineAsOf: string | null;
  error: string | null;
  onFilter: (id: TodayFilterId) => void;
  onFollow: (eventId: string, href: string) => void;
  onDone: (eventId: string) => void;
}

function RowAction({
  row,
  disabled,
  onFollow,
  onDone,
}: {
  row: TodayRow;
  disabled: boolean;
  onFollow: TodayViewProps["onFollow"];
  onDone: TodayViewProps["onDone"];
}) {
  const a = row.action;
  if (a.kind === "link") {
    return (
      <Link
        to={a.href}
        className="btn v xs"
        aria-label={`${a.label} ${row.name}: ${row.label}`}
        onClick={() => onFollow(row.eventId, a.href)}
      >
        {a.label}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className="act"
      disabled={disabled}
      aria-label={`Mark done: ${row.name}, ${row.label}`}
      onClick={() => onDone(row.eventId)}
    >
      {disabled ? "Saving…" : a.label}
    </button>
  );
}

export function TodayView(p: TodayViewProps) {
  const offline = p.offlineAsOf !== null;
  return (
    <>
      <header className="nt-head">
        <div style={{ flex: 1 }}>
          <span className="sub">{p.dateLabel}</span>
          <h1 className="h1">Today</h1>
        </div>
        <Link to="/coach/clients/new" className="btn v sm">
          <IconPlus size={16} />
          Invite client
        </Link>
      </header>
      {offline && <OfflineBanner subject="Today" asOf={p.offlineAsOf} />}
      {p.error && <Notice tone="error">{p.error}</Notice>}

      <div
        className="strip"
        style={{
          gridTemplateColumns: `repeat(${p.cells.length}, minmax(0, 1fr))`,
        }}
      >
        {p.cells.map((c) => (
          <div key={c.key}>
            <b>
              {c.value}
              {c.of && <i>{c.of}</i>}
            </b>
            <span>{c.label}</span>
          </div>
        ))}
      </div>

      <div className="nt-grid">
        <section className="nt-sec" aria-labelledby="needs-h">
          <div className="nt-sec-head">
            <h2 id="needs-h" className="st">
              Needs you
            </h2>
            <div className="nt-chips" role="group" aria-label="Show">
              {p.filters.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`chip${p.filter === f.id ? " on" : ""}`}
                  aria-pressed={p.filter === f.id}
                  onClick={() => p.onFilter(f.id)}
                >
                  {f.label} <b className="mono">{f.count}</b>
                </button>
              ))}
            </div>
          </div>
          {p.rows.length === 0 ? (
            <div className="nt-empty" role="status">
              <b>All clear</b>
              <span>Nothing needs you right now.</span>
            </div>
          ) : (
            <ul className="nt-list" aria-label="Queue">
              {p.rows.map((r) => (
                <li key={r.eventId} className="nt-qrow">
                  <Avatar initials={r.initials} size={38} seed={r.name} />
                  <span className="nt-qtx">
                    <span className="nt-qtop">
                      {r.href ? (
                        <Link to={r.href} className="nt-name">
                          {r.name}
                        </Link>
                      ) : (
                        <b className="nt-name">{r.name}</b>
                      )}
                      <span className={`nt-kind ${r.tone}`}>{r.label}</span>
                      {r.unread && <span className="sr-only">(new)</span>}
                    </span>
                    {r.facts && <span className="nt-facts">{r.facts}</span>}
                  </span>
                  <span className="mono nt-time">{r.time}</span>
                  <RowAction
                    row={r}
                    disabled={p.busyId === r.eventId}
                    onFollow={p.onFollow}
                    onDone={p.onDone}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="nt-sec" aria-labelledby="schedule-h">
          <div className="nt-sec-head">
            <h2 id="schedule-h" className="st">
              Schedule today
            </h2>
          </div>
          {p.schedule.length === 0 ? (
            <p className="sub" style={{ margin: 0 }}>
              Nothing booked today.
            </p>
          ) : (
            <ul className="nt-list" aria-label="Schedule">
              {p.schedule.map((s) => (
                <li key={s.id} className="nt-srow">
                  <span className="mono nt-stime">{s.time}</span>
                  <span className="nt-qtx">
                    <b className={`nt-name${s.own ? " own" : ""}`}>{s.title}</b>
                    <span className="nt-facts">{s.sub}</span>
                  </span>
                  {s.state === "done" && <span className="pl idle">Done</span>}
                  {s.state === "next" && <span className="pl plV">Next</span>}
                  {s.own && s.state === null && (
                    <span className="pl plC">You</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
