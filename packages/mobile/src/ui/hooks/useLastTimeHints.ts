import { useMemo } from "react";
import { RECENT_SETS_TABLES } from "@/adapters/storage/tables";
import { getProfilePageQuery } from "@/application/queries/profile-page.query";
import {
  lastTimeHint,
  latestSessionSets,
} from "@/domain/services/setTargets.service";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useCacheRevision } from "@/ui/hooks/useCacheRevision";

/**
 * Last time's weights for the set editor (PER-139): "Last time 92.5 kg × 8,
 * 6, 6, 5", keyed by library exercise id. A hint only — a workout's
 * prescription never carries a weight.
 *
 * Read from the phone's recent-sets cache, so it works offline and never
 * calls the network. Only the newest session's rows per exercise are used
 * (`latestSessionSets`): the cache keeps older sessions' higher set numbers.
 * The unit is the cached profile's weight unit (kg by default).
 *
 * `enabled: false` returns no hints: a coach building a workout for a client
 * would otherwise see the coach's own lifts, and there is no client-scoped
 * source on the phone.
 */
export function useLastTimeHints(
  exerciseIds: readonly string[],
  enabled = true,
): Record<string, string> {
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const revision = useCacheRevision(RECENT_SETS_TABLES);
  const key = [...new Set(exerciseIds)].sort().join(",");

  return useMemo(() => {
    const hints: Record<string, string> = {};
    if (!enabled || !userId || key === "") return hints;
    const ids = key.split(",");
    const unit =
      getProfilePageQuery(storage, userId).payload?.profile.weightUnit ?? "kg";
    const latest = latestSessionSets(storage.getRecentSetRows(userId, ids));
    for (const id of ids) {
      const hint = lastTimeHint(latest[id] ?? {}, unit);
      if (hint) hints[id] = hint;
    }
    return hints;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revision is the cache-change key for getRecentSetRows, not a value read inside.
  }, [enabled, storage, userId, key, revision]);
}
