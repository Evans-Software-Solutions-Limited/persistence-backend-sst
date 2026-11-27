import { Link } from "react-router";
import { Dialog, Notice } from "../ui/parts";
import {
  KIND_LABEL,
  STATUS_LABEL,
  clientsLabel,
  clock,
  lengthLabel,
  longDay,
  reminderLabel,
  sessionTitle,
  type FormsDueGroup,
} from "./lib";
import type { CoachSession, SessionScope } from "./types";

/**
 * A session's details on the calendar (C4a): when, where, who and how
 * they answered, with Edit and Cancel. A repeating session asks whether to
 * cancel just this one or this and the later ones.
 */
export function SessionDialog({
  session,
  now,
  confirmCancel,
  busy,
  error,
  onEdit,
  onAskCancel,
  onKeep,
  onCancel,
  onClose,
}: {
  session: CoachSession;
  now: Date;
  confirmCancel: boolean;
  busy: boolean;
  error: string | null;
  onEdit: () => void;
  onAskCancel: () => void;
  onKeep: () => void;
  onCancel: (scope: SessionScope) => void;
  onClose: () => void;
}) {
  const start = new Date(session.startsAt);
  const end = new Date(session.endsAt);
  const cancelled = !!session.cancelledAt;
  const started = start.getTime() <= now.getTime();
  return (
    <Dialog title={sessionTitle(session)} onClose={onClose}>
      <dl className="cal-facts">
        <Fact label="Kind" value={KIND_LABEL[session.kind]} />
        <Fact
          label="When"
          value={`${longDay(start)} · ${clock(start)}–${clock(end)} (${lengthLabel(session.durationMin)})`}
        />
        {session.location && <Fact label="Where" value={session.location} />}
        {session.videoUrl && (
          <div>
            <dt>Video link</dt>
            <dd>
              <a href={session.videoUrl} target="_blank" rel="noreferrer">
                {session.videoUrl}
              </a>
            </dd>
          </div>
        )}
        {session.workout && (
          <Fact label="Workout" value={session.workout.name} />
        )}
        {session.seriesId && <Fact label="Repeats" value="Weekly" />}
        {session.kind !== "own_training" && (
          <Fact
            label="Reminder"
            value={
              session.reminderMinutes
                ? `${reminderLabel(session.reminderMinutes)} before`
                : "None"
            }
          />
        )}
        {session.notes && <Fact label="Notes" value={session.notes} />}
      </dl>
      {session.attendees.length > 0 && (
        <ul className="cal-people" aria-label="Booked">
          {session.attendees.map((a) => (
            <li key={a.relationshipId}>
              <Link to={`/coach/clients/${a.clientId}/check-ins`}>
                {a.name}
              </Link>
              <span className={`cal-status ${a.status}`}>
                {STATUS_LABEL[a.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
      {cancelled && <Notice tone="info">This session was cancelled.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {!cancelled && !started && !confirmCancel && (
        <div className="cal-actions">
          <button type="button" className="btn v sm" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="btn ghost sm" onClick={onAskCancel}>
            Cancel session
          </button>
        </div>
      )}
      {!cancelled && !started && confirmCancel && (
        <div className="cal-confirm" role="group" aria-label="Cancel session">
          <p className="sub">
            {session.attendees.length > 0
              ? "Booked clients are told it's cancelled."
              : "It comes off your calendar."}
          </p>
          <div className="cal-actions">
            <button
              type="button"
              className="btn dang sm"
              disabled={busy}
              onClick={() => onCancel("this")}
            >
              {session.seriesId ? "Cancel this one" : "Cancel session"}
            </button>
            {session.seriesId && (
              <button
                type="button"
                className="btn dang sm"
                disabled={busy}
                onClick={() => onCancel("series")}
              >
                Cancel this and later
              </button>
            )}
            <button
              type="button"
              className="btn ghost sm"
              disabled={busy}
              onClick={onKeep}
            >
              Keep it
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** Who a form is due from on one day; each opens their Check-ins tab. */
export function FormsDueDialog({
  group,
  onClose,
}: {
  group: FormsDueGroup;
  onClose: () => void;
}) {
  return (
    <Dialog title={`${group.formTitle} due`} onClose={onClose}>
      <p className="sub">
        {longDay(group.dueAt)} · {clientsLabel(group.items.length)}
        {group.late > 0 ? ` · ${group.late} late` : ""}
      </p>
      <ul className="cal-people" aria-label="Due from">
        {group.items.map((f) => (
          <li key={f.requestId}>
            <Link to={`/coach/clients/${f.client.id}/check-ins`}>
              {f.client.name}
            </Link>
            <span className={`cal-status ${f.late ? "declined" : "invited"}`}>
              {f.late ? "Late" : `Due ${clock(new Date(f.dueAt))}`}
            </span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
