import type { ClientDetail } from "@/domain/models/clientDetail";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/** Cache is considered stale after 5 minutes (matches the dashboard TTL). */
export const CLIENT_DETAIL_STALE_AFTER_MS = 5 * 60 * 1000;

export function isClientDetailStale(
  syncedAt: string | null,
  now: number,
): boolean {
  if (syncedAt === null) return true;
  const ts = new Date(syncedAt).getTime();
  if (Number.isNaN(ts)) return true;
  return now - ts > CLIENT_DETAIL_STALE_AFTER_MS;
}

/**
 * Client Detail aggregate (M8 Coach Phase 5). Cache-first from
 * `cached_client_detail` keyed `(trainer userId, clientId)`, refreshed from
 * `GET /trainers/me/clients/:clientId`. Mirrors `useGetCoachOverview` — renders
 * the cached snapshot instantly (offline-friendly) then background-refreshes
 * when stale.
 *
 * `clientId` is folded into the `read`/`write` closures so the per-client cache
 * slot is addressed by BOTH ids even though `useCachedResource` only threads
 * the authed userId.
 */
export function useGetClientDetail(
  clientId: string | undefined,
): CachedResourceState<ClientDetail> {
  return useCachedResource<ClientDetail>({
    read: (storage, userId) => {
      if (!clientId) return { value: null, isStale: true };
      return {
        value: storage.getCachedClientDetail(userId, clientId),
        isStale: isClientDetailStale(
          storage.getClientDetailAge(userId, clientId),
          Date.now(),
        ),
      };
    },
    fetcher: (api) => api.getClientDetail(clientId ?? ""),
    write: (storage, userId, value) => {
      if (!clientId) return;
      storage.cacheClientDetail(userId, clientId, value);
    },
  });
}
