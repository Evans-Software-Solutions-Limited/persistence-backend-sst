import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isCoachApiError } from "../api/coachApi";
import { useRoster } from "../hooks/coachQueries";
import { LoadError, Loading } from "../ui/parts";
import { useNotificationsApi } from "./api";
import {
  clock,
  describeToday,
  filterToday,
  longDate,
  scheduleRows,
  shortTime,
  stripCells,
  todayFilterCounts,
  whoHref,
  whoOf,
  withoutItem,
  type TodayFilterId,
} from "./lib";
import { notificationKeys, useToday } from "./queries";
import type { TodayPayload } from "./types";
import { TodayView, type TodayRow } from "./TodayView";
import "./notifications.css";

/**
 * Container for C2a Today (PER-131). Reads `GET /trainers/me/today` and the
 * roster (active count). Acting on a row marks it done on the server
 * (`POST /trainers/me/today/:eventId/actioned`, idempotent) and drops it from
 * the queue straight away.
 */
export function TodayContainer({
  now = () => new Date(),
}: {
  now?: () => Date;
}) {
  const api = useNotificationsApi();
  const queryClient = useQueryClient();
  const today = useToday();
  const roster = useRoster();
  const [filter, setFilter] = useState<TodayFilterId>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const at = now();
  const data = today.data;

  /** Remove an item from the cached queue and its counts. */
  function dropLocally(eventId: string) {
    queryClient.setQueryData<TodayPayload>(
      notificationKeys.today,
      (old) => old && withoutItem(old, eventId),
    );
  }

  async function markDone(eventId: string): Promise<boolean> {
    try {
      await api.actioned(eventId);
      dropLocally(eventId);
      void queryClient.invalidateQueries({ queryKey: notificationKeys.feed });
      return true;
    } catch (e) {
      setError(
        isCoachApiError(e) && e.offline
          ? "You're offline. Try again when you're back online."
          : isCoachApiError(e) && e.status === 404
            ? "That item is no longer in your queue."
            : "We couldn't mark that done.",
      );
      if (isCoachApiError(e) && e.status === 404) dropLocally(eventId);
      return false;
    }
  }

  if (today.isPending) return <Loading />;
  if (!data) {
    return (
      <LoadError
        message={
          isCoachApiError(today.error) && today.error.offline
            ? "You're offline. Connect to load Today."
            : "We couldn't load Today."
        }
        onRetry={() => void today.refetch()}
      />
    );
  }

  const rows: TodayRow[] = filterToday(data.queue, filter).map((item) => {
    const who = whoOf(item.client, item.facts);
    return {
      ...describeToday(item),
      eventId: item.eventId,
      name: who.name,
      initials: who.initials,
      href: whoHref(who),
      time: shortTime(item.occurredAt, at),
      unread: !item.readAt,
    };
  });
  const active = roster.data
    ? roster.data.data.filter((c) => c.status === "active").length
    : null;
  const offlineAsOf =
    isCoachApiError(today.error) && today.error.offline
      ? clock(new Date(today.dataUpdatedAt))
      : null;

  return (
    <TodayView
      dateLabel={longDate(at)}
      cells={stripCells(data.counts.total, active, data.strip)}
      filters={todayFilterCounts(data.counts.byKind, data.counts.total)}
      filter={filter}
      rows={rows}
      schedule={scheduleRows(data.schedule, at)}
      busyId={busyId}
      offlineAsOf={offlineAsOf}
      error={error}
      onFilter={setFilter}
      onFollow={(eventId) => {
        // The link opens the place to act; marking done goes alongside.
        void markDone(eventId);
      }}
      onDone={(eventId) => {
        setError(null);
        setBusyId(eventId);
        void markDone(eventId).finally(() => setBusyId(null));
      }}
    />
  );
}
