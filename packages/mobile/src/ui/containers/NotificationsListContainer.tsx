import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";

import type { Notification } from "@/domain/models/notification";
import {
  getNotificationsQuery,
  refreshNotifications,
} from "@/application/notifications/queries/list-notifications.query";
import { groupNotificationsByDate } from "@/application/notifications/grouping";
import { resolveNotificationRoute } from "@/application/notifications/deep-link";
import { markNotificationReadCommand } from "@/application/notifications/commands/mark-read.command";
import { markAllNotificationsReadCommand } from "@/application/notifications/commands/mark-all-read.command";
import { NotificationsListPresenter } from "@/ui/presenters/NotificationsListPresenter";
import { useAdapters } from "@/ui/hooks/useAdapters";

/**
 * <NotificationsListContainer> — offline-first list wiring.
 *
 * Reads the SQLite cache synchronously (cache-first render), then triggers
 * a background refresh. Mark-read + mark-all-read are optimistic (cache +
 * enqueue); the global sync worker flushes the queue. Tap marks the row
 * read and routes to its deep link (09.6 hardens the redirect/fallback).
 *
 * Spec: specs/09-notifications-social/design.md § NotificationsListPresenter
 *       requirements.md STORY-002
 */

export function NotificationsListContainer() {
  const { api, storage } = useAdapters();
  const router = useRouter();

  // Cache-read version tick — bumping it re-derives the list from storage
  // after a refresh / optimistic mutation.
  const [version, setVersion] = useState(0);
  const reread = useCallback(() => setVersion((v) => v + 1), []);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const nextCursorRef = useRef<string | null>(null);

  const { notifications, unreadCount } = useMemo(() => {
    void version;
    return getNotificationsQuery(storage);
  }, [storage, version]);

  const groups = useMemo(
    () => groupNotificationsByDate(notifications),
    [notifications],
  );

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    setError(null);
    try {
      const result = await refreshNotifications(api, storage);
      if (result.ok) {
        nextCursorRef.current = result.value.nextCursor;
      } else {
        setError(new Error(result.error.message));
      }
    } finally {
      setIsRefreshing(false);
      setIsLoading(false);
      reread();
    }
  }, [api, storage, reread]);

  // One-shot background refresh on mount (cache-first render already
  // happened synchronously above).
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadMore = useCallback(async () => {
    const cursor = nextCursorRef.current;
    if (!cursor) return;
    const result = await refreshNotifications(api, storage, { cursor });
    if (result.ok) {
      nextCursorRef.current = result.value.nextCursor;
      reread();
    }
  }, [api, storage, reread]);

  const markAllRead = useCallback(() => {
    markAllNotificationsReadCommand(storage);
    reread();
  }, [storage, reread]);

  const onTap = useCallback(
    (notification: Notification) => {
      markNotificationReadCommand(storage, notification.id);
      reread();
      // Resolve the deep link (legacy remap + Home fallback for
      // unknown/absent links) via the shared 09.6 resolver.
      router.push(resolveNotificationRoute(notification.deepLink) as never);
    },
    [storage, reread, router],
  );

  const onBack = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <NotificationsListPresenter
      groups={groups}
      unreadCount={unreadCount}
      isRefreshing={isRefreshing}
      isLoading={isLoading}
      error={error}
      onTap={onTap}
      onMarkAllRead={markAllRead}
      onRefresh={refresh}
      onLoadMore={loadMore}
      onBack={onBack}
    />
  );
}
