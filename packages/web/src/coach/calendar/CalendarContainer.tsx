import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { isCoachApiError } from "../api/coachApi";
import { useOnline, useRoster } from "../hooks/coachQueries";
import { clockTime } from "../lib/people";
import { useCalendarApi } from "./api";
import { CalendarView } from "./CalendarView";
import {
  addDays,
  dayKey,
  parseDay,
  weekStart,
  type FormsDueGroup,
} from "./lib";
import { refreshSchedule, useCalendarRange } from "./queries";
import { ScheduleContainer, type ScheduleTarget } from "./ScheduleContainer";
import { FormsDueDialog, SessionDialog } from "./SessionDialogs";
import type { CoachSession, SessionScope } from "./types";

const TOAST_MS = 3_000;
const CLOCK_MS = 60_000;

/**
 * Today → Calendar on the web (C4a, PER-144), at `/coach/today/calendar`.
 * The week comes from `?week=YYYY-MM-DD` (its Monday), so Back and a shared
 * link keep it. Owns the week's query, the session and forms-due dialogs,
 * the schedule sheet, and cancelling.
 */
export function CalendarContainer({ now: fixedNow }: { now?: Date }) {
  // The clock moves on each minute, so Edit and Cancel leave a session once
  // it starts. Tests pass a fixed start.
  const [now, setNow] = useState(() => fixedNow ?? new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), CLOCK_MS);
    return () => clearInterval(t);
  }, []);
  const [params, setParams] = useSearchParams();
  const start = weekStart(parseDay(params.get("week")) ?? now);
  const from = start.toISOString();
  const to = addDays(start, 7).toISOString();
  const range = useCalendarRange(from, to);
  const roster = useRoster();
  const online = useOnline();
  const api = useCalendarApi();
  const queryClient = useQueryClient();

  const [openId, setOpenId] = useState<string | null>(null);
  const [forms, setForms] = useState<FormsDueGroup | null>(null);
  const [schedule, setSchedule] = useState<ScheduleTarget | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const open: CoachSession | null =
    range.data?.sessions.find((s) => s.id === openId) ?? null;
  const clients = (roster.data?.data ?? [])
    .filter((c) => c.status === "active")
    .map((c) => ({ id: c.id, name: c.name }));

  const goWeek = (d: Date) => {
    const next = new URLSearchParams(params);
    next.set("week", dayKey(weekStart(d)));
    setParams(next);
  };

  const closeSession = () => {
    setOpenId(null);
    setConfirmCancel(false);
    setError(null);
  };

  async function cancel(session: CoachSession, scope: SessionScope) {
    setBusy(true);
    setError(null);
    try {
      await api.cancel(session.id, scope);
      await refreshSchedule(queryClient);
      closeSession();
      setToast(scope === "series" ? "Sessions cancelled" : "Session cancelled");
    } catch (e) {
      setConfirmCancel(false);
      setError(
        isCoachApiError(e) && e.offline
          ? "You're offline. Cancelling needs a connection."
          : "We couldn't cancel this session. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <CalendarView
        weekStart={start}
        now={now}
        data={range.data}
        loading={range.isPending}
        failed={
          range.isError
            ? online
              ? "We couldn't load your calendar."
              : "You're offline. Your calendar loads when you're back online."
            : null
        }
        offlineAsOf={
          online ? null : range.data ? clockTime(range.dataUpdatedAt) : ""
        }
        toast={toast}
        onPrev={() => goWeek(addDays(start, -7))}
        onNext={() => goWeek(addDays(start, 7))}
        onThisWeek={() => goWeek(now)}
        onRetry={() => void range.refetch()}
        onSchedule={() => setSchedule({ mode: "create" })}
        onOpenSession={(s) => {
          setOpenId(s.id);
          setConfirmCancel(false);
          setError(null);
        }}
        onOpenForms={setForms}
      />
      {open && !schedule && (
        <SessionDialog
          session={open}
          now={now}
          confirmCancel={confirmCancel}
          busy={busy}
          error={error}
          onEdit={() => setSchedule({ mode: "edit", session: open })}
          onAskCancel={() => setConfirmCancel(true)}
          onKeep={() => setConfirmCancel(false)}
          onCancel={(scope) => void cancel(open, scope)}
          onClose={closeSession}
        />
      )}
      {forms && <FormsDueDialog group={forms} onClose={() => setForms(null)} />}
      {schedule && (
        <ScheduleContainer
          target={schedule}
          clients={clients}
          onClose={() => setSchedule(null)}
          onSaved={(message, first) => {
            setSchedule(null);
            closeSession();
            setToast(message);
            const day = new Date(first.startsAt);
            if (weekStart(day).getTime() !== start.getTime()) goWeek(day);
          }}
        />
      )}
    </>
  );
}
