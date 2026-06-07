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
 * The SQLite cache is a bounded (100-row LRU) offline fallback; it seeds
 * the first paint, but the VISIBLE list lives in component state and grows
 * with cursor pagination. We deliberately do NOT re-derive the visible list
 * from the cache after the first paint — older pages fetched by load-more
 * are, by definition, outside the newest-100 the LRU keeps, so re-reading
 * the cache would cap the view at 100 and freeze pagination (Inspector
 * Brad #1). Mark-read / mark-all are optimistic on BOTH the visible list
 * and the cache (+ enqueue); the global sync worker flushes the queue.
 *
 * Spec: specs/09-notifications-social/design.md § NotificationsListPresenter
 *       requirements.md STORY-002
 */

export function NotificationsListContainer() {
  const { api, storage } = useAdapters();
  const router = useRouter();

  // First paint seeds from the cache (offline-first). `useState` only reads
  // the initializer once — after mount, `items` is owned by state.
  const initial = useMemo(() => getNotificationsQuery(storage), [storage]);
  const [items, setItems] = useState<Notification[]>(initial.notifications);
  const [unreadCount, setUnreadCount] = useState(initial.unreadCount);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const nextCursorRef = useRef<string | null>(null);

  const groups = useMemo(() => groupNotificationsByDate(items), [items]);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    setError(null);
    try {
      // Page 1. `refreshNotifications` writes through to the cache, keeping
      // it as the newest-100 offline fallback; the visible list is reset to
      // this freshest page.
      const result = await refreshNotifications(api, storage);
      if (result.ok) {
        nextCursorRef.current = result.value.nextCursor;
        setItems(result.value.notifications);
        setUnreadCount(result.value.unreadCount);
      } else {
        setError(new Error(result.error.message));
      }
    } finally {
      setIsRefreshing(false);
      setIsLoading(false);
    }
  }, [api, storage]);

  // One-shot background refresh on mount (the cache-seeded first paint
  // already happened synchronously above).
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadMore = useCallback(async () => {
    const cursor = nextCursorRef.current;
    if (!cursor) return;
    // Fetch the next (older) page straight from the API and APPEND to the
    // visible list. NOT written through the cache: older rows would be
    // pruned right back out by the newest-100 LRU.
    const result = await api.getNotifications({ cursor });
    if (result.ok) {
      nextCursorRef.current = result.value.nextCursor;
      setItems((prev) => [...prev, ...result.value.notifications]);
    }
  }, [api]);

  const markAllRead = useCallback(() => {
    markAllNotificationsReadCommand(storage);
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: now })));
    setUnreadCount(0);
  }, [storage]);

  const onTap = useCallback(
    (notification: Notification) => {
      markNotificationReadCommand(storage, notification.id);
      if (notification.readAt === null) {
        const now = new Date().toISOString();
        setItems((prev) =>
          prev.map((n) =>
            n.id === notification.id && n.readAt === null
              ? { ...n, readAt: now }
              : n,
          ),
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      }
      // Resolve the deep link (legacy remap + Home fallback for
      // unknown/absent links) via the shared 09.6 resolver.
      router.push(resolveNotificationRoute(notification.deepLink) as never);
    },
    [storage, router],
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
