import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { RosterClient } from "../api/types";
import { IconClock } from "../ui/icons";
import { dayKey, weekStart } from "./lib";
import { ScheduleContainer } from "./ScheduleContainer";

const NOTICE_MS = 6_000;

/**
 * Client Detail's header calendar button (C4c, PER-144): opens "Schedule
 * with Sam" for this client. Once booked, a notice links to that week on
 * the calendar.
 */
export function ScheduleFromClient({ client }: { client: RosterClient }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<{ text: string; week: string } | null>(
    null,
  );

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [saved]);

  return (
    <>
      <button
        type="button"
        className="btn ghost sm"
        onClick={() => {
          setSaved(null);
          setOpen(true);
        }}
      >
        <IconClock size={16} />
        Schedule
      </button>
      {saved && (
        <div className="toast" role="status">
          {saved.text} ·{" "}
          <Link to={`/coach/today/calendar?week=${saved.week}`}>
            See calendar
          </Link>
        </div>
      )}
      {open && (
        <ScheduleContainer
          target={{
            mode: "create",
            client: { id: client.id, name: client.name },
          }}
          onClose={() => setOpen(false)}
          onSaved={(text, first) => {
            setOpen(false);
            setSaved({
              text,
              week: dayKey(weekStart(new Date(first.startsAt))),
            });
          }}
        />
      )}
    </>
  );
}
