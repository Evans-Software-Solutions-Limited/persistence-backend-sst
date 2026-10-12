import type { ApiPort } from "@/domain/ports/api.port";
import type { StoragePort } from "@/domain/ports/storage.port";
import { applyPendingReads, optimisticUnread } from "./pending-reads";

const inFlight = new WeakMap<ApiPort, Promise<number | null>>();

/**
 * Fetches the server's unread count once for every caller that asks while a
 * request is in flight. The OS badge hook and the Home count hook both sync on
 * mount, on foreground and on each push; without this they sent the same
 * request two or three times per event.
 *
 * Resolves `null` when the request fails so callers keep their last value.
 */
export function fetchUnreadCount(
  api: ApiPort,
  storage: StoragePort,
): Promise<number | null> {
  const existing = inFlight.get(api);
  if (existing) return existing;
  const request = (async () => {
    const result = await api.getNotifications({ unreadOnly: true });
    if (!result.ok) return null;
    const page = applyPendingReads(
      result.value.notifications,
      storage,
      new Date().toISOString(),
    );
    return optimisticUnread(result.value.unreadCount, page, storage);
  })().finally(() => {
    if (inFlight.get(api) === request) inFlight.delete(api);
  });
  inFlight.set(api, request);
  return request;
}
