import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";

import type { Notification } from "@/domain/models/notification";
import {
  getNotificationsQuery,
  refreshNotifications,
} from "@/application/notifications/queries/list-notifications.query";
import { groupNotificationsByDate } from "@/application/notifications/grouping";
import { resolveNotificationRoute } from "@/application/notifications/deep-link";
import { markNotificationReadCommand } from "@/application/notifications/commands/mark-read.command";
import { markAllNotificationsReadCommand } from "@/application/notifications/commands/mark-all-read.command";
import type { StoragePort } from "@/domain/ports/storage.port";
import { NotificationsListPresenter } from "@/ui/presenters/NotificationsListPresenter";
import { useAdapters } from "@/ui/hooks/useAdapters";

/**
 * <NotificationsListContainer> — offline-first list wiring.
 *
 * The SQLite cache is a bounded (100-row LRU) offline fallback; it seeds
 * the first paint, but the VISIBLE list lives in component state and grows
 * with cursor pagination (re-deriving from the cache would cap the view at
 * 100 — Inspector Brad #1).
 *
 * Optimistic-read reconciliation (Inspector Brad #5): a `GET` can race
 * un-flushed mark-read mutations and return rows still unread. Rather than
 * pay the latency of draining the queue before every fetch (the dashboard
 * trade-off), we re-apply locally-pending read state onto every fetched
 * page via `applyPendingReads`, so an optimistic read never flickers back.
 *
 * Liveness (Inspector Brad #6): the list refreshes on screen focus AND on a
 * foreground push receipt, so notifications that arrive while the screen is
 * open (or after navigating away and back) reconcile into the visible list.
 *
 * Spec: specs/09-notifications-social/design.md § NotificationsListPresenter
 *       requirements.md STORY-002
 */

/** Pending mark-read state from the sync queue (un-flushed optimistic reads). */
function pendingReadState(storage: StoragePort): {
  allRead: boolean;
  ids: Set<string>;
} {
  const pending = storage
    .getPendingMutations()
    .filter((m) => m.entityType === "notification");
  const allRead = pending.some((m) => m.endpoint === "/notifications/all");
  const ids = new Set<string>();
  for (const m of pending) {
    if (m.entityId) ids.add(m.entityId);
  }
  return { allRead, ids };
}

/**
 * Re-apply un-flushed optimistic reads onto a freshly-fetched page so the
 * server's (older) read state doesn't clobber them.
 */
function applyPendingReads(
  items: Notification[],
  storage: StoragePort,
  now: string,
): Notification[] {
  const { allRead, ids } = pendingReadState(storage);
  return items.map((n) =>
    n.readAt === null && (allRead || ids.has(n.id)) ? { ...n, readAt: now } : n,
  );
}

/**
 * The server-authoritative unread total minus the reads the user has made
 * optimistically but not yet flushed — across ALL loaded pages, not just
 * the fetched page. Using the full `pendingReadState().ids` (and the
 * mark-all short-circuit) keeps the badge consistent with the visible read
 * state even for rows on pages beyond page 1 (Inspector Brad: a page-2
 * mark-read must not bounce the count back up on the next focus/push).
 */
function optimisticUnread(serverUnread: number, storage: StoragePort): number {
  const { allRead, ids } = pendingReadState(storage);
  return allRead ? 0 : Math.max(0, serverUnread - ids.size);
}

export function NotificationsListContainer() {
  const { api, storage, notifications } = useAdapters();
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

  const initialLoadedRef = useRef(false);

  /**
   * Fetch page 1.
   * - `reset` (explicit pull-to-refresh / first load): replace the visible
   *   list with the freshest page and re-anchor the pagination cursor.
   * - `merge` (auto-refresh on focus / push): prepend only genuinely-new
   *   rows (ids not already shown), leaving the already-loaded older pages,
   *   the cursor and the user's scroll position intact. A background event
   *   must not collapse pagination (Inspector Brad #7).
   */
  const loadPageOne = useCallback(
    async (mode: "reset" | "merge") => {
      if (mode === "reset") setIsRefreshing(true);
      setError(null);
      try {
        const result = await refreshNotifications(api, storage);
        if (!result.ok) {
          setError(new Error(result.error.message));
          return;
        }
        const page = applyPendingReads(
          result.value.notifications,
          storage,
          new Date().toISOString(),
        );
        if (mode === "reset") {
          nextCursorRef.current = result.value.nextCursor;
          setItems(page);
        } else {
          setItems((prev) => {
            const seen = new Set(prev.map((n) => n.id));
            const fresh = page.filter((n) => !seen.has(n.id));
            return fresh.length === 0 ? prev : [...fresh, ...prev];
          });
        }
        // Count from the server total minus ALL un-flushed optimistic reads
        // (every page), so a page-2+ mark-read isn't overwritten here.
        setUnreadCount(optimisticUnread(result.value.unreadCount, storage));
      } finally {
        if (mode === "reset") setIsRefreshing(false);
        setIsLoading(false);
      }
    },
    [api, storage],
  );

  // Explicit pull-to-refresh → full reset to page 1 (expected for a manual
  // gesture). Returns a promise so the RefreshControl can await it.
  const refresh = useCallback(() => loadPageOne("reset"), [loadPageOne]);

  // First focus loads + anchors the cursor; subsequent focuses only merge
  // new rows in, so returning to the screen never resets a paginated list.
  useFocusEffect(
    useCallback(() => {
      if (initialLoadedRef.current) {
        void loadPageOne("merge");
      } else {
        initialLoadedRef.current = true;
        void loadPageOne("reset");
      }
    }, [loadPageOne]),
  );

  // A push while the screen is open merges new rows in (never a reset).
  useEffect(() => {
    const unsubscribe = notifications.addNotificationReceivedListener(() => {
      void loadPageOne("merge");
    });
    return unsubscribe;
  }, [notifications, loadPageOne]);

  const loadMore = useCallback(async () => {
    const cursor = nextCursorRef.current;
    if (!cursor) return;
    // Claim the cursor synchronously BEFORE awaiting. `onEndReached` fires
    // repeatedly across RN versions (threshold cross, content settle, re-
    // scroll); without this guard each repeat fire would re-request the
    // same cursor and append the same page, producing duplicate rows + key
    // collisions (Inspector Brad). Nulling the cursor makes a repeat fire a
    // no-op until the response lands; restore it on failure so a retry can
    // resume.
    nextCursorRef.current = null;
    // Fetch the next (older) page straight from the API and APPEND to the
    // visible list. NOT written through the cache (older rows would be
    // pruned by the newest-100 LRU). Re-apply pending reads here too.
    const result = await api.getNotifications({ cursor });
    if (result.ok) {
      nextCursorRef.current = result.value.nextCursor;
      const merged = applyPendingReads(
        result.value.notifications,
        storage,
        new Date().toISOString(),
      );
      setItems((prev) => [...prev, ...merged]);
    } else {
      nextCursorRef.current = cursor;
    }
  }, [api, storage]);

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
