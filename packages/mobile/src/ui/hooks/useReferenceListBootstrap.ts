import { useEffect, useRef } from "react";

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
 * Cheap and idempotent: cache-first with a 24h staleness window, one attempt per
 * mount per user, and failures are swallowed (the catalogue is not required for
 * anything to render — the drain simply waits).
 */
export function useReferenceListBootstrap(): void {
  const { api, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const bootstrappedForUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) {
      bootstrappedForUserRef.current = null;
      return;
    }
    if (bootstrappedForUserRef.current === userId) return;
    bootstrappedForUserRef.current = userId;

    let cancelled = false;
    void (async () => {
      for (const kind of BOOTSTRAP_KINDS) {
        if (cancelled) return;
        // Cache-first: a warm cache inside the staleness window costs nothing.
        if (!getReferenceListQuery(storage, kind).isStale) continue;
        try {
          await refreshReferenceList(api, storage, kind);
        } catch {
          // Offline or a failing GET. Nothing to surface: no screen is waiting
          // on this, and the drain defers any exercise that needs it.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, storage, userId]);
}
