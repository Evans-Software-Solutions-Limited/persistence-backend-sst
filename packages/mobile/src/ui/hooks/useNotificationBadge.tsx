/**
 * Keeps the OS app-icon (springboard) badge in sync with the user's unread
 * notification count — the "number on the app, even when it's closed" that
 * other apps show (STORY-001, Revised 2026-06-08).
 *
 * Mounted once from `app/(app)/_layout.tsx`. Syncs on:
 *  - app launch (mount),
 *  - return to the foreground (AppState 'active') — picks up notifications
 *    that arrived via push while the app was backgrounded,
 *  - a push received while foregrounded.
 *
 * The list screen clears the badge to 0 directly on open (mark-all-on-view),
 * for immediacy; this hook reconciles against the server count thereafter.
 *
 * Self-gates on a signed-in user. Badge writes are best-effort (a failure
 * never throws / blocks).
 */

import { useCallback, useEffect } from "react";
import { AppState } from "react-native";

import {
  applyPendingReads,
  optimisticUnread,
} from "@/application/notifications/pending-reads";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

export function useNotificationBadge(enabled = true): void {
  const { api, storage, notifications } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const sync = useCallback(async () => {
    // Fetch the unread rows (not just the count) so the badge is computed the
    // SAME way as the list header — via `optimisticUnread` over a real page.
    // Trusting the cached count alone undercounts during a pending mark-all:
    // the cache shows 0 (all flipped read), so a push that lands before the
    // queue drains would paint the badge 0 and hide the new arrival until the
    // next foreground drain (Inspector Brad badge undercount). Pulling the
    // page lets `applyPendingReads` flip only the pre-mark-all rows and leave
    // post-mark-all arrivals counted. `unreadOnly` keeps the payload tight.
    const result = await api.getNotifications({ unreadOnly: true });
    if (!result.ok) return;
    const page = applyPendingReads(
      result.value.notifications,
      storage,
      new Date().toISOString(),
    );
    const count = optimisticUnread(result.value.unreadCount, page, storage);
    try {
      await notifications.setBadgeCount(count);
    } catch {
      // Best-effort — never block on a badge write.
    }
  }, [api, storage, notifications]);

  // Launch + return-to-foreground.
  useEffect(() => {
    if (!enabled || !userId) return;
    void sync();
    const appSub = AppState.addEventListener("change", (state) => {
      if (state === "active") void sync();
    });
    return () => appSub?.remove?.();
  }, [enabled, userId, sync]);

  // Push received while the app is foregrounded.
  useEffect(() => {
    if (!enabled || !userId) return;
    const unsubscribe = notifications.addNotificationReceivedListener(() => {
      void sync();
    });
    return unsubscribe;
  }, [enabled, userId, notifications, sync]);
}
