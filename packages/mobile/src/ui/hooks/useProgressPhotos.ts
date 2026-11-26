import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PENDING_PROGRESS_PHOTO_TABLES,
  PROGRESS_PHOTO_TABLES,
} from "@/adapters/storage/tables";
import {
  progressPhotosFromResponse,
  reconcileProgressPhotosRead,
} from "@/application/commands/progressPhotos.command";
import type {
  PendingProgressPhotoSet,
  ProgressPhotosCache,
} from "@/domain/models/progressPhotos";
import {
  gallerySets,
  type GallerySet,
} from "@/domain/services/progressPhotos.service";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

export type ProgressPhotosState = CachedResourceState<ProgressPhotosCache> & {
  /** Uploaded sets and sets still on the phone, newest first. */
  sets: GallerySet[];
  pending: PendingProgressPhotoSet[];
  /** Re-read the cache and the phone's unsent sets, with no network. */
  reloadAll(): void;
};

const NO_PENDING: PendingProgressPhotoSet[] = [];

/**
 * PER-137 (APP-F1): the athlete's progress photos, cache-first. The gallery
 * (`cached_progress_photos`) refreshes from `GET /users/me/progress-photos`
 * (always a full read: its view links last 15 minutes), and sets still
 * waiting to upload (`pending_progress_photos`) are merged in from the phone.
 */
export function useProgressPhotos(opts?: {
  enabled?: boolean;
}): ProgressPhotosState {
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const res = useCachedResource<ProgressPhotosCache>({
    read: (s, uid) => ({
      value: s.getCachedProgressPhotos(uid),
      isStale: true,
    }),
    fetcher: async (api) => {
      const result = await api.getProgressPhotos();
      return result.ok
        ? { ok: true as const, value: progressPhotosFromResponse(result.value) }
        : result;
    },
    write: (s, uid, value) => s.cacheProgressPhotos(uid, value),
    reconcile: reconcileProgressPhotosRead,
    tables: PROGRESS_PHOTO_TABLES,
    enabled: opts?.enabled,
  });

  const readPending = useCallback(
    () => (userId ? storage.getPendingProgressPhotoSets(userId) : NO_PENDING),
    [storage, userId],
  );
  const [pending, setPending] = useState(readPending);
  const reloadPending = useCallback(
    () => setPending(readPending()),
    [readPending],
  );
  useEffect(() => {
    reloadPending();
    return storage.subscribe(PENDING_PROGRESS_PHOTO_TABLES, reloadPending);
  }, [storage, reloadPending]);

  const reload = res.reload;
  const reloadAll = useCallback(() => {
    reload();
    reloadPending();
  }, [reload, reloadPending]);

  const sets = useMemo(
    () => gallerySets(res.data, pending),
    [res.data, pending],
  );
  return { ...res, sets, pending, reloadAll };
}
