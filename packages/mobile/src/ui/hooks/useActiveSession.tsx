/**
 * useActiveSession — owns the SQLite-mirrored active session for the
 * mobile session screen. (M3, Stories 002 + 005 + 008.)
 *
 * - Cache-first: reads `storage.getActiveSession(userId)` synchronously
 *   on mount; no network until session-complete (BACKEND_BRIEF § 7).
 * - Snapshot is cache-version-driven: `rereadCache` ticks the version
 *   to force a fresh read after a command writes (M2 learning #4).
 * - Focus reread: containers wire `useFocusEffect(rereadCache)` so a
 *   substitution / add-exercise mutation made inside a picker modal
 *   surfaces when control returns (M2 learning #5).
 * - Hands the storage / auth / id-factory plumbing back so commands
 *   can run from the container without re-fetching adapters.
 *
 * Spec: specs/05-active-session/design.md § State Management
 *       specs/milestones/M3-active-session/EXECUTION_PLAN.md § 2 Commit 7
 */

import { useCallback, useMemo, useState } from "react";
import type { WorkoutSession } from "@/domain/models/session";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

export type UseActiveSession = {
  session: WorkoutSession | null;
  userId: string | null;
  rereadCache: () => void;
};

export function useActiveSession(): UseActiveSession {
  const { storage } = useAdapters();
  const { session: authSession } = useAuth();
  const userId = authSession?.userId ?? null;

  const [cacheVersion, setCacheVersion] = useState(0);

  const session = useMemo(() => {
    void cacheVersion;
    if (!userId) return null;
    return storage.getActiveSession(userId);
  }, [storage, userId, cacheVersion]);

  const rereadCache = useCallback(() => {
    setCacheVersion((v) => v + 1);
  }, []);

  return { session, userId, rereadCache };
}
