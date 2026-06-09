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
import {
  applyPendingReads,
  optimisticUnread,
} from "@/application/notifications/pending-reads";
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
  // Bumped on every `reset` (pull-to-refresh / re-anchor). A `loadMore`
  // captures the epoch before awaiting and discards its response if a reset
  // landed meanwhile — otherwise the stale older page would splice in after
  // the fresh page and corrupt the cursor (Inspector Brad #276).
  const loadEpochRef = useRef(0);

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
    async (mode: "reset" | "merge"): Promise<number> => {
      if (mode === "reset") setIsRefreshing(true);
      setError(null);
      try {
        const result = await refreshNotifications(api, storage);
        if (!result.ok) {
          setError(new Error(result.error.message));
          return 0;
        }
        const page = applyPendingReads(
          result.value.notifications,
          storage,
          new Date().toISOString(),
        );
        if (mode === "reset") {
          // Invalidate any in-flight loadMore so its stale older page can't
          // splice in after this fresh page (Inspector Brad #276).
          loadEpochRef.current += 1;
          nextCursorRef.current = result.value.nextCursor;
          setItems(page);
        } else {
          setItems((prev) => {
            const seen = new Set(prev.map((n) => n.id));
            const fresh = page.filter((n) => !seen.has(n.id));
            return fresh.length === 0 ? prev : [...fresh, ...prev];
          });
        }
        // Count from the (pending-read-applied) page so a page-2+ mark-read
        // isn't bounced up, and a pending mark-all leaves only post-mark-all
        // arrivals counted.
        const unread = optimisticUnread(
          result.value.unreadCount,
          page,
          storage,
        );
        setUnreadCount(unread);
        return unread;
      } finally {
        if (mode === "reset") setIsRefreshing(false);
        setIsLoading(false);
      }
    },
    [api, storage],
  );

  // Mark every notification read + clear the OS badge. Used by the header
  // "mark all" action AND by mark-all-on-view (opening the screen). Optimistic
  // on the visible list + cache + a queued PATCH /notifications/all.
  const markAllRead = useCallback(() => {
    markAllNotificationsReadCommand(storage);
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: now })));
    setUnreadCount(0);
    // Best-effort — setBadgeCountAsync rejects when notification permission
    // is denied; swallow so it doesn't surface as an unhandled rejection on
    // every list open / push (Inspector Brad).
    void notifications.setBadgeCount(0).catch(() => {});
  }, [storage, notifications]);

  // Load page 1, then — per Brad's "viewing the list marks everything read"
  // decision — mark all read if anything is unread (clears the badge).
  const loadAndAcknowledge = useCallback(
    async (mode: "reset" | "merge") => {
      const unread = await loadPageOne(mode);
      if (unread > 0) markAllRead();
    },
    [loadPageOne, markAllRead],
  );

  // Explicit pull-to-refresh → full reset to page 1 (expected for a manual
  // gesture). Returns a promise so the RefreshControl can await it.
  const refresh = useCallback(
    () => loadAndAcknowledge("reset"),
    [loadAndAcknowledge],
  );

  // First focus loads + anchors the cursor; subsequent focuses only merge
  // new rows in, so returning to the screen never resets a paginated list.
  // Either way, opening/returning marks everything read (mark-on-view).
  useFocusEffect(
    useCallback(() => {
      if (initialLoadedRef.current) {
        void loadAndAcknowledge("merge");
      } else {
        initialLoadedRef.current = true;
        void loadAndAcknowledge("reset");
      }
    }, [loadAndAcknowledge]),
  );

  // A push while the screen is open merges new rows in (never a reset) — and
  // since the screen is being viewed, marks them read too.
  useEffect(() => {
    const unsubscribe = notifications.addNotificationReceivedListener(() => {
      void loadAndAcknowledge("merge");
    });
    return unsubscribe;
  }, [notifications, loadAndAcknowledge]);

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
    const epoch = loadEpochRef.current;
    // Fetch the next (older) page straight from the API and APPEND to the
    // visible list. NOT written through the cache (older rows would be
    // pruned by the newest-100 LRU). Re-apply pending reads here too.
    const result = await api.getNotifications({ cursor });
    // A pull-to-refresh (reset) that landed mid-flight bumped the epoch and
    // re-anchored the cursor/list — discard this now-stale older page rather
    // than splicing it after the fresh page (Inspector Brad #276).
    if (loadEpochRef.current !== epoch) return;
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

  const onTap = useCallback(
    (notification: Notification) => {
      // Only enqueue a mark-read on an actual unread→read transition —
      // re-tapping an already-read row (to follow its deep link) must not
      // pile up redundant PATCHes in the sync queue (Inspector Brad #9).
      if (notification.readAt === null) {
        markNotificationReadCommand(storage, notification.id);
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
