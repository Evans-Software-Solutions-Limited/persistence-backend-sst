import { useCallback, useEffect, useRef } from "react";

import {
  getReferenceListQuery,
  refreshReferenceList,
} from "@/application/queries/reference-lists.query";
import type { ReferenceListKind } from "@/domain/models/reference-list";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/** The catalogues the exercise write path needs to resolve enum → uuid. */
const BOOTSTRAP_KINDS: readonly ReferenceListKind[] = [
  "muscle_groups",
  "equipment",
];

/**
 * Warm the reference-list cache once per signed-in session.
 *
 * The catalogue was previously fetched only by whichever screen happened to need
 * it — `useReferenceLists` is mounted by the exercise library, Loadout and Saved
 * Gyms. That made a WRITE path depend on a READ screen having been visited: a
 * user who went straight to "create exercise" had no catalogue, so the muscle
 * and equipment enums could not be translated into the UUIDs the API requires.
 *
 * The sync drain defers rather than fails in that case, so this hook is a
 * latency fix, not a correctness one — but "the first custom exercise of a fresh
 * install syncs on the next drain instead of this one" is worth removing.
 *
 * Cheap and idempotent: cache-first with a 24h staleness window, and failures are
 * swallowed (the catalogue is not required for anything to render — the drain simply
 * waits).
 *
 * ALSO retried on an offline→online reconnect, which is what makes the sync layer's
 * `catalogue_unavailable` deferral honest. That deferral is classified `"transport"`,
 * i.e. "a reconnect is new information about this" — but if nothing re-fetched the
 * catalogue on reconnect, the promise had no mechanism behind it: after one offline
 * sign-in the entry would oscillate (exhaust → resurrect on the next blip → exhaust
 * again having sent nothing), its /sync-failed row vanishing on each cycle. One
 * attempt per mount was never enough on its own, because the failure it needs to
 * recover from is precisely the one that happens at mount.
 */
export function useReferenceListBootstrap(): void {
  const { api, storage, netInfo } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const bootstrappedForUserRef = useRef<string | null>(null);

  const warm = useCallback(
    async (isCancelled: () => boolean) => {
      for (const kind of BOOTSTRAP_KINDS) {
        if (isCancelled()) return;
        // Cache-first: a warm cache inside the staleness window costs nothing.
        if (!getReferenceListQuery(storage, kind).isStale) continue;
        try {
          await refreshReferenceList(api, storage, kind);
        } catch {
          // Offline or a failing GET. Nothing to surface: no screen is waiting
          // on this, and the drain defers any exercise that needs it.
        }
      }
    },
    [api, storage],
  );

  useEffect(() => {
    if (!userId) {
      bootstrappedForUserRef.current = null;
      return;
    }

    let cancelled = false;
    const isCancelled = () => cancelled;

    if (bootstrappedForUserRef.current !== userId) {
      bootstrappedForUserRef.current = userId;
      void warm(isCancelled);
    }

    // Retry on a real offline→online transition. The first observation only SEEDS
    // the ref — it is not a transition — mirroring `useSyncWorker`, so a cold start
    // on an already-online device doesn't fire a redundant second fetch.
    let prevConnected: boolean | null = null;
    const unsubscribe = netInfo.subscribe((connected) => {
      const wasConnected = prevConnected;
      prevConnected = connected;
      if (wasConnected === null || wasConnected || !connected) return;
      void warm(isCancelled);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [netInfo, userId, warm]);
}
