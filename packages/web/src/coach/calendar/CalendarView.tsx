import { Link } from "react-router";
import { IconBack, IconChevron, IconPlus } from "../ui/icons";
import { LoadError, Loading, OfflineBanner, Toast } from "../ui/parts";
import {
  KIND_TONE,
  LEGEND,
  addDays,
  clientsLabel,
  dayHead,
  groupFormsDue,
  hourRange,
  placeDay,
  sameDay,
  sessionSubtitle,
  sessionTitle,
  weekTitle,
  type FormsDueGroup,
} from "./lib";
import type { CalendarRange, CoachSession } from "./types";
import "./calendar.css";

/** Pixels per hour on the grid (C4a: 88 px per two hours). */
export const HOUR_PX = 44;

type Block =
  | { type: "session"; session: CoachSession }
  | { type: "forms"; group: FormsDueGroup };

/**
 * C4a · Web · Calendar (PER-144): Today → Calendar, a week of sessions and
 * forms due. A pure presenter; the container owns the week, the data and the
 * dialogs.
 */
export function CalendarView({
  weekStart,
  now,
  data,
  loading,
  failed,
  offlineAsOf,
  toast,
  onPrev,
  onNext,
  onThisWeek,
  onRetry,
  onSchedule,
  onOpenSession,
  onOpenForms,
}: {
  weekStart: Date;
  now: Date;
  data: CalendarRange | undefined;
  loading: boolean;
  failed: string | null;
  offlineAsOf: string | null;
  toast: string | null;
  onPrev: () => void;
  onNext: () => void;
  onThisWeek: () => void;
  onRetry: () => void;
  onSchedule: () => void;
  onOpenSession: (s: CoachSession) => void;
  onOpenForms: (g: FormsDueGroup) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const thisWeek = days.some((d) => sameDay(d, now));

  return (
    <section className="cal" aria-label="Calendar">
      <header className="cal-head">
        <div>
          <p className="eb">{weekTitle(weekStart)}</p>
          <div className="cal-tabs" role="tablist" aria-label="Today">
            <Link role="tab" aria-selected="false" to="/coach/today">
              Queue
            </Link>
            <span role="tab" aria-selected="true">
              Calendar
            </span>
          </div>
        </div>
        <ul className="cal-legend" aria-label="Key">
          {LEGEND.map((l) => (
            <li key={l.key}>
              <span style={{ background: KIND_TONE[l.key] }} />
              {l.label}
            </li>
          ))}
        </ul>
        <button type="button" className="btn v sm" onClick={onSchedule}>
          <IconPlus size={16} />
          Schedule
        </button>
      </header>

      <div className="cal-nav">
        <button
          type="button"
          className="ibtn"
          aria-label="Previous week"
          onClick={onPrev}
        >
          <IconBack size={16} />
        </button>
        <button
          type="button"
          className="btn ghost xs"
          disabled={thisWeek}
          onClick={onThisWeek}
        >
          This week
        </button>
        <button
          type="button"
          className="ibtn"
          aria-label="Next week"
          onClick={onNext}
        >
          <IconChevron size={16} />
        </button>
      </div>

      {offlineAsOf !== null && (
        <OfflineBanner subject="your calendar" asOf={offlineAsOf || null} />
      )}

      {loading ? (
        <Loading />
      ) : failed && !data ? (
        <LoadError message={failed} onRetry={onRetry} />
      ) : (
        <WeekGrid
          days={days}
          now={now}
          data={data}
          onOpenSession={onOpenSession}
          onOpenForms={onOpenForms}
        />
      )}
      {toast && <Toast text={toast} />}
    </section>
  );
}

function WeekGrid({
  days,
  now,
  data,
  onOpenSession,
  onOpenForms,
}: {
  days: Date[];
  now: Date;
  data: CalendarRange | undefined;
  onOpenSession: (s: CoachSession) => void;
  onOpenForms: (g: FormsDueGroup) => void;
}) {
  const sessions = data?.sessions ?? [];
  const groups = groupFormsDue(data?.formsDue ?? []);
  const timed = [
    ...sessions.map((s) => ({
      block: { type: "session", session: s } as Block,
      start: new Date(s.startsAt),
      end: new Date(s.endsAt),
    })),
    ...groups.map((g) => ({
      block: { type: "forms", group: g } as Block,
      start: g.dueAt,
      end: new Date(g.dueAt.getTime() + 30 * 60_000),
    })),
  ];
  const { first, last } = hourRange(timed);
  const height = (last - first) * HOUR_PX;
  const hours = Array.from(
    { length: Math.floor((last - first) / 2) + 1 },
    (_, i) => first + i * 2,
  ).filter((h) => h <= last);
  const empty = timed.length === 0;
  const nowTop =
    ((now.getHours() - first) * 60 + now.getMinutes()) * (HOUR_PX / 60);

  return (
    <div className="cal-grid">
      <div className="cal-days" aria-hidden="true">
        <span />
        {days.map((d) => (
          <span key={d.toISOString()} className={sameDay(d, now) ? "on" : ""}>
            {dayHead(d)}
            {sameDay(d, now) ? " · today" : ""}
          </span>
        ))}
      </div>
      <div className="cal-body" style={{ height }}>
        {hours.map((h) => (
          <div
            key={h}
            className="cal-hour"
            style={{ top: (h - first) * HOUR_PX }}
            aria-hidden="true"
          >
            <span>{`${String(h).padStart(2, "0")}:00`}</span>
          </div>
        ))}
        {days.map((d, i) => {
          const dayItems = timed.filter((t) => sameDay(t.start, d));
          const placed = placeDay(
            dayItems.map((t) => ({
              item: t.block,
              start: t.start,
              end: t.end,
            })),
            first,
          );
          return (
            <ol
              key={d.toISOString()}
              className="cal-col"
              style={{ left: `calc(50px + (100% - 50px) * ${i} / 7)` }}
              aria-label={dayHead(d)}
            >
              {placed.map((p) => {
                const top = p.top * (HOUR_PX / 60);
                const h = Math.min(p.height * (HOUR_PX / 60), height - top);
                const style = {
                  top,
                  height: Math.max(h, 22),
                  left: `calc(${(100 * p.lane) / p.lanes}% + 3px)`,
                  width: `calc(${100 / p.lanes}% - 6px)`,
                };
                if (p.item.type === "forms") {
                  const g = p.item.group;
                  return (
                    <li key={g.key} style={style} className="cal-block forms">
                      <button
                        type="button"
                        onClick={() => onOpenForms(g)}
                        style={{ borderLeftColor: KIND_TONE.forms }}
                      >
                        <b>{g.formTitle} due</b>
                        <span>{clientsLabel(g.items.length)}</span>
                      </button>
                    </li>
                  );
                }
                const s = p.item.session;
                return (
                  <li
                    key={s.id}
                    style={style}
                    className={`cal-block ${s.kind}${s.cancelledAt ? " cancelled" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => onOpenSession(s)}
                      style={{ borderLeftColor: KIND_TONE[s.kind] }}
                    >
                      <b>{sessionTitle(s)}</b>
                      <span>{sessionSubtitle(s)}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          );
        })}
        {days.some((d) => sameDay(d, now)) &&
          nowTop >= 0 &&
          nowTop <= height && (
            <div
              className="cal-now"
              aria-hidden="true"
              style={{
                top: nowTop,
                left: `calc(50px + (100% - 50px) * ${days.findIndex((d) => sameDay(d, now))} / 7)`,
              }}
            />
          )}
      </div>
      {empty && (
        <p className="sub cal-empty">
          Nothing booked this week. Sessions you schedule land here and in
          Today.
        </p>
      )}
    </div>
  );
}
