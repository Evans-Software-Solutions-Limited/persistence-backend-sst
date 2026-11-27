import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isCoachApiError } from "../api/coachApi";
import { LoadError, Loading } from "../ui/parts";
import { useNotificationsApi } from "./api";
import {
  FEED_TYPES,
  clock,
  describeEvent,
  feedPeople,
  filterFeed,
  groupByClient,
  groupSummary,
  unreadByType,
  whoHref,
  whoOf,
  type FeedTypeId,
} from "./lib";
import {
  NotificationsView,
  type LatestRow,
  type NoteGroup,
} from "./NotificationsView";
import { notificationKeys, useFeed } from "./queries";
import type { CoachEvent, FeedPage } from "./types";
import "./notifications.css";

/**
 * Container for C10e Notifications (PER-131). Loads the latest 200 events
 * (`GET /trainers/me/notifications`); type and client filters work on them
 * in the browser. Read marks go to `POST /trainers/me/notifications/read`
 * (idempotent) and show at once.
 */
export function NotificationsContainer({
  now = () => new Date(),
}: {
  now?: () => Date;
}) {
  const api = useNotificationsApi();
  const queryClient = useQueryClient();
  const feed = useFeed();
  const [type, setType] = useState<FeedTypeId>("all");
  const [who, setWho] = useState<string | null>(null);
  const [mode, setMode] = useState<"client" | "latest">("client");
  const [showQuiet, setShowQuiet] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (feed.isPending) return <Loading />;
  if (!feed.data) {
    return (
      <LoadError
        message={
          isCoachApiError(feed.error) && feed.error.offline
            ? "You're offline. Connect to load your notifications."
            : "We couldn't load your notifications."
        }
        onRetry={() => void feed.refetch()}
      />
    );
  }

  const at = now();
  const events = feed.data.data;
  const shown = filterFeed(events, { type, who });
  const counts = unreadByType(events);
  const rowOf = (e: CoachEvent) => ({
    ...describeEvent(e, at),
    id: e.id,
    unread: !e.readAt,
  });
  const allGroups: NoteGroup[] = groupByClient(shown).map((g) => ({
    key: g.who.key,
    name: g.who.name,
    initials: g.who.initials,
    summary: groupSummary(g),
    href: whoHref(g.who),
    unread: g.unread,
    rows: g.events.map(rowOf),
  }));
  const latest: LatestRow[] = shown.map((e) => {
    const w = whoOf(e.client, e.payload);
    return { ...rowOf(e), name: w.name, initials: w.initials };
  });

  async function markRead(ids: string[] | "all", key: string) {
    setError(null);
    setBusy(key);
    try {
      await api.markRead(ids);
      const stamp = new Date().toISOString();
      queryClient.setQueryData<FeedPage>(notificationKeys.feed, (old) => {
        if (!old) return old;
        let changed = 0;
        const data = old.data.map((e) => {
          if (e.readAt || (ids !== "all" && !ids.includes(e.id))) return e;
          changed += 1;
          return { ...e, readAt: stamp };
        });
        return {
          ...old,
          data,
          unreadCount:
            ids === "all" ? 0 : Math.max(0, old.unreadCount - changed),
        };
      });
      void queryClient.invalidateQueries({ queryKey: notificationKeys.today });
    } catch (e) {
      setError(
        isCoachApiError(e) && e.offline
          ? "You're offline. Try again when you're back online."
          : "We couldn't mark those read.",
      );
    } finally {
      setBusy(null);
    }
  }

  const offlineAsOf =
    isCoachApiError(feed.error) && feed.error.offline
      ? clock(new Date(feed.dataUpdatedAt))
      : null;

  return (
    <NotificationsView
      types={[
        { id: "all", label: "All", count: counts.all },
        ...FEED_TYPES.map((t) => ({
          id: t.id,
          label: t.label,
          count: counts[t.id],
        })),
      ]}
      type={type}
      people={feedPeople(events).map((w) => ({ key: w.key, name: w.name }))}
      who={who}
      mode={mode}
      groups={allGroups.filter((g) => g.unread > 0)}
      quiet={allGroups.filter((g) => g.unread === 0)}
      showQuiet={showQuiet}
      latest={latest}
      unreadTotal={feed.data.unreadCount}
      busy={busy}
      offlineAsOf={offlineAsOf}
      error={error}
      onType={setType}
      onWho={setWho}
      onMode={setMode}
      onShowQuiet={() => setShowQuiet(true)}
      onMarkAll={() => void markRead("all", "all")}
      onMarkGroup={(key) => {
        const ids = shown
          .filter((e) => !e.readAt && whoOf(e.client, e.payload).key === key)
          .map((e) => e.id);
        if (ids.length > 0) void markRead(ids, key);
      }}
    />
  );
}
