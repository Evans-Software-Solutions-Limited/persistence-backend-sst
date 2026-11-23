import { useCallback, useMemo } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import { USER_MEAL_TABLES } from "@/adapters/storage/tables";
import { processSyncQueue } from "@/application/commands/sync.command";
import {
  USER_MEALS_ENTITY,
  saveUserMealsCommand,
} from "@/application/commands/userMeals.command";
import type { UserMeal } from "@/domain/models/userMeals";
import { isAutoResolvableSyncEntry } from "@/domain/ports/sync.types";
import type { StoragePort, SyncQueueEntry } from "@/domain/ports/storage.port";
import {
  activeUserMeals,
  syntheticDefaultUserMeals,
} from "@/domain/services/userMeals.service";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";
import { useCachedResource } from "./useCachedResource";

export type UserMealsState = {
  /** Active meals in display order (the four defaults until first fetched). */
  meals: UserMeal[];
  /** True while showing placeholders: the real list has never been fetched. */
  isPlaceholder: boolean;
  /** Save an edited list (rename, reorder, add): cached, queued, drained. */
  save: (meals: readonly UserMeal[]) => Promise<boolean>;
  reload: () => void;
};

/**
 * Your meals (PER-132, N1b) — cache-first, refreshed online. Edits are
 * offline-first through `saveUserMealsCommand`. A server read never replaces
 * a list whose edit is still queued (the queued PUT is newer).
 */
/** Your meals edits that can still reach the server on their own. */
export function liveUserMealEdits(
  storage: StoragePort,
  userId: string,
): SyncQueueEntry[] {
  return storage
    .getUncompletedMutations()
    .filter(
      (e) =>
        e.entityType === USER_MEALS_ENTITY &&
        e.entityId === userId &&
        isAutoResolvableSyncEntry(e),
    );
}

export function useUserMeals(enabled = true): UserMealsState {
  const { auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const resource = useCachedResource<UserMeal[]>({
    read: (s, uid) => ({ value: s.getCachedUserMeals(uid), isStale: true }),
    fetcher: async (api) => {
      const result = await api.getUserMeals();
      return result.ok ? { ok: true, value: result.value.meals } : result;
    },
    // A live edit (in flight or retryable) is newer than any read: keep the
    // local list on screen and in the cache. A dead one (permanently failed,
    // retries used up) doesn't hold reads back (Inspector Brad, #550).
    reconcile: (s, uid, value) =>
      liveUserMealEdits(s, uid).length > 0
        ? (s.getCachedUserMeals(uid) ?? value)
        : value,
    // An edit saved — and even acknowledged — while a read was in flight
    // beats that read's older answer.
    preserveConcurrentCacheWrites: true,
    pendingWrites: liveUserMealEdits,
    write: (s, uid, value) => s.cacheUserMeals(uid, value),
    tables: USER_MEAL_TABLES,
    enabled,
  });

  const cached = resource.data;
  const meals = useMemo(
    () =>
      cached && activeUserMeals(cached).length > 0
        ? activeUserMeals(cached)
        : syntheticDefaultUserMeals(),
    [cached],
  );
  const isPlaceholder = !cached || activeUserMeals(cached).length === 0;

  const { reload } = resource;
  const save = useCallback(
    async (next: readonly UserMeal[]) => {
      if (!userId) return false;
      const saved = saveUserMealsCommand({ storage, userId }, next);
      if (saved === null) return false;
      reload();
      try {
        await processSyncQueue(storage, auth, getApiBaseUrl());
      } catch (err) {
        console.error("[useUserMeals] queue flush failed:", err);
      }
      reload();
      return true;
    },
    [auth, storage, userId, reload],
  );

  return { meals, isPlaceholder, save, reload };
}
