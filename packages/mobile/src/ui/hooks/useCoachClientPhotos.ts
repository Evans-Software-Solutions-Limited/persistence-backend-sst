import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CoachPhotosDenial,
  CoachProgressPhotos,
} from "@/domain/models/coachProgressPhotos";
import type { ProgressPhotoSet } from "@/domain/models/progressPhotos";
import { coachSetsNewestFirst } from "@/domain/services/coachProgressPhotos.service";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/** Under the coach's 5-minute view links, so a link is fresh when it loads. */
export const COACH_PHOTOS_REFRESH_MS = 4 * 60_000;

export type CoachClientPhotosState = {
  /** Ready sets, newest first (empty before the first read). */
  sets: ProgressPhotoSet[];
  /** True once a read (cached or live) has answered with sets. */
  hasData: boolean;
  /** Why the server refused; nothing is shown then, cached or not. */
  denial: CoachPhotosDenial | null;
  /** The last read's failure (offline, server), with any cached sets kept. */
  error: ApiError | null;
  isRefreshing: boolean;
  refresh(): Promise<void>;
};

const NO_SETS: ProgressPhotoSet[] = [];

/**
 * PER-138 (APP-F2): a client's progress photos for their coach (C3.4). Shows
 * the last read at once (offline too), then reads again on every open and
 * every 4 minutes, so the 5-minute view links are fresh; images are cached
 * on disk by photo id (`PhotoImage`), so already-viewed ones show offline.
 * The server has the final say: a refusal (switch off, not shared, coaching
 * ended) drops the cached list, and nothing is shown.
 */
export function useCoachClientPhotos(
  clientId: string,
  opts: { refreshKey?: number } = {},
): CoachClientPhotosState {
  const { api, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const readCache = useCallback(
    () =>
      userId && clientId
        ? storage.getCachedCoachClientPhotos(userId, clientId)
        : null,
    [storage, userId, clientId],
  );
  const [data, setData] = useState<CoachProgressPhotos | null>(readCache);
  const [denial, setDenial] = useState<CoachPhotosDenial | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [isRefreshing, setRefreshing] = useState(false);
  const current = useRef({ userId, clientId, mounted: true });
  const inflight = useRef<string | null>(null);

  useEffect(() => {
    current.current = { userId, clientId, mounted: true };
    setData(readCache());
    setDenial(null);
    setError(null);
    return () => {
      current.current.mounted = false;
    };
  }, [readCache, userId, clientId]);

  const refresh = useCallback(async () => {
    const key = `${userId}|${clientId}`;
    if (!userId || !clientId || inflight.current === key) return;
    inflight.current = key;
    setRefreshing(true);
    const result = await api.getCoachClientProgressPhotos(clientId);
    if (inflight.current === key) inflight.current = null;
    const now = current.current;
    // A late answer for another coach or client, or after leaving, is dropped.
    if (!now.mounted || now.userId !== userId || now.clientId !== clientId) {
      return;
    }
    setRefreshing(false);
    if (result.ok) {
      storage.cacheCoachClientPhotos(userId, clientId, result.value);
      setData(result.value);
      setDenial(null);
      setError(null);
    } else if (result.error.denial) {
      storage.clearCachedCoachClientPhotos(userId, clientId);
      setData(null);
      setDenial(result.error.denial);
      setError(null);
    } else {
      setError(result.error);
    }
  }, [api, storage, userId, clientId]);

  useEffect(() => {
    void refresh();
  }, [refresh, opts.refreshKey]);

  useEffect(() => {
    const timer = setInterval(() => void refresh(), COACH_PHOTOS_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const sets = useMemo(
    () => (data && !denial ? coachSetsNewestFirst(data.sets) : NO_SETS),
    [data, denial],
  );

  return {
    sets,
    hasData: data !== null && denial === null,
    denial,
    error,
    isRefreshing,
    refresh,
  };
}
