/**
 * Exposes the user's unread-notification count for IN-APP UI — the small badge
 * on the header notification bell (Brad's request, 2026-06-30). This is the
 * UI-facing sibling of {@link useNotificationBadge}, which keeps the OS
 * app-icon (springboard) badge in sync; the two share the same count
 * derivation so the bell and the springboard never disagree.
 *
 * Seeds synchronously from the SQLite cache (offline-first first paint), then
 * reconciles against the server on:
 *  - mount,
 *  - screen focus (so returning from the list — which marks all read — clears
 *    the bell),
 *  - return to the foreground (picks up pushes received while backgrounded),
 *  - a push received while foregrounded.
 *
 * Count derivation mirrors the list header / OS-badge exactly: fetch the
 * unread page, re-apply locally-pending reads, then `optimisticUnread` so a
 * pending mark-all (or per-row read) isn't undercounted/overcounted while the
 * sync queue drains.
 *
 * Self-gates on a signed-in user; all reads are best-effort (never throw).
 */

import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";

import {
  applyPendingReads,
  optimisticUnread,
} from "@/application/notifications/pending-reads";
import { getNotificationsQuery } from "@/application/notifications/queries/list-notifications.query";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

export function useUnreadNotificationCount(): number {
  const { api, storage, notifications } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  // First paint from the cache: apply pending reads to the cached page so a
  // just-viewed list doesn't flash a stale count before the server sync lands.
  // Gated on a signed-in user — without this, a previous user's still-cached
  // notifications (signed out / mid account-switch) would flash their count on
  // the bell for a frame before the userId-gated `sync` reconciles.
  const [count, setCount] = useState(() => {
    if (!userId) return 0;
    const cached = getNotificationsQuery(storage);
    const now = new Date().toISOString();
    const page = applyPendingReads(cached.notifications, storage, now);
    return optimisticUnread(cached.unreadCount, page, storage);
  });

  const sync = useCallback(async () => {
    const result = await api.getNotifications({ unreadOnly: true });
    if (!result.ok) return;
    const page = applyPendingReads(
      result.value.notifications,
      storage,
      new Date().toISOString(),
    );
    setCount(optimisticUnread(result.value.unreadCount, page, storage));
  }, [api, storage]);

  // Mount + return-to-foreground.
  useEffect(() => {
    if (!userId) return;
    void sync();
    const appSub = AppState.addEventListener("change", (state) => {
      if (state === "active") void sync();
    });
    return () => appSub?.remove?.();
  }, [userId, sync]);

  // Push received while foregrounded.
  useEffect(() => {
    if (!userId) return;
    const unsubscribe = notifications.addNotificationReceivedListener(() => {
      void sync();
    });
    return unsubscribe;
  }, [userId, notifications, sync]);

  // Re-sync on focus — returning from the list (which marks all read) must
  // clear the bell without waiting for a foreground transition.
  useFocusEffect(
    useCallback(() => {
      if (userId) void sync();
    }, [userId, sync]),
  );

  return count;
}
