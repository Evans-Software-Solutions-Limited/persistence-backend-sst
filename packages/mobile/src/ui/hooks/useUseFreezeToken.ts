import { useCallback, useState } from "react";
import type { Streak } from "@/domain/models/streak";
import type { ApiError, Result } from "@/shared/errors";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * Manual freeze-token spend (06-progress-goals, Phase 06.7; STORY-003 AC 3.2 —
 * the "Use" button). Online action; on success it merges the updated streak
 * back into `cached_streaks` so the StreakHero token count drops immediately.
 */
export function useUseFreezeToken(): {
  mutate: (streakId: string) => Promise<Result<Streak, ApiError>>;
  isPending: boolean;
} {
  const { api, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const [isPending, setIsPending] = useState(false);

  const mutate = useCallback(
    async (streakId: string) => {
      setIsPending(true);
      try {
        const result = await api.useFreezeToken(streakId);
        if (result.ok && userId) {
          const updated = result.value;
          const merged = storage
            .getCachedStreaks(userId)
            .map((s) => (s.id === updated.id ? updated : s));
          storage.cacheStreaks(userId, merged);
        }
        return result;
      } finally {
        setIsPending(false);
      }
    },
    [api, storage, userId],
  );

  return { mutate, isPending };
}
