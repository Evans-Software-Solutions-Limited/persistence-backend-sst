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

import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";

import {
  applyPendingReads,
  optimisticUnread,
} from "@/application/notifications/pending-reads";
import { getNotificationsQuery } from "@/application/notifications/queries/list-notifications.query";
import { bootstrapSettled } from "@/application/bootstrap/gate";
import { fetchUnreadCount } from "@/application/notifications/unread-count";
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

  const sync = useCallback(
    async (options?: { preferBootstrapFor?: string | null }) => {
      const next = await fetchUnreadCount(api, storage, options);
      if (next !== null) setCount(next);
    },
    [api, storage],
  );

  // Mount + return-to-foreground. The mount sync waits for the cold-start
  // bootstrap and serves its count; foreground and push always fetch.
  useEffect(() => {
    if (!userId) return;
    void bootstrapSettled(userId).then(() =>
      sync({ preferBootstrapFor: userId }),
    );
    // Only a true return from the background re-syncs. iOS launches apps
    // inactive and flips them active a moment later; the mount sync above
    // already covers that, and it waits for the cold-start bootstrap.
    let previous = AppState.currentState;
    const appSub = AppState.addEventListener("change", (state) => {
      const resumed = previous === "background" && state === "active";
      previous = state;
      if (resumed) void sync();
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
  // The mount effect above already synced; the first focus fires in the same
  // commit, so only refocuses (returning from another screen) sync again.
  // The first focus for a user is the mount (already synced above). The
  // callback changes when the session resolves, which re-runs this effect,
  // so the latch is per user rather than per instance.
  const focusedForUserRef = useRef<string | null | undefined>(undefined);
  useFocusEffect(
    useCallback(() => {
      if (focusedForUserRef.current !== userId) {
        focusedForUserRef.current = userId;
        return;
      }
      if (userId) void sync();
    }, [userId, sync]),
  );

  return count;
}
