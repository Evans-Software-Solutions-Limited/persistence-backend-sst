import { useCallback, useEffect, useRef } from "react";

import { getApiBaseUrl } from "@/adapters/api";
import { processSyncQueue } from "@/application/commands/sync.command";
import {
  getExercisesQuery,
  refreshExerciseCache,
} from "@/application/queries/exercises.query";
import type { ApiPort } from "@/domain/ports/api.port";
import type { AuthPort } from "@/domain/ports/auth.port";
import type { StoragePort } from "@/domain/ports/storage.port";
import { localDayISO } from "@/shared/utils";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

type WarmOfflineDataDeps = {
  api: ApiPort;
  auth: AuthPort;
  storage: StoragePort;
  userId: string;
  date?: string;
  shouldStop?: () => boolean;
};

const FUEL_MUTATION_TYPES = new Set([
  "nutrition_entry",
  "nutrition_target",
  "water_log",
  "meal_plan_log",
]);

function hasUnreconciledFuelMutations(storage: StoragePort): boolean {
  return storage
    .getUncompletedMutations()
    .some((entry) => FUEL_MUTATION_TYPES.has(entry.entityType));
}

/**
 * Populate the read models needed by Fuel, You/Progress and Exercises.
 *
 * These calls are deliberately sequential. A first login used to leave every
 * cache cold until its owning tab was opened; firing all of those previously
 * screen-owned requests at once would fix the gap by recreating the launch
 * fan-out that has caused cold-start 503s before. Each failure is isolated so
 * one unavailable endpoint never prevents the remaining caches from warming.
 */
export async function warmOfflineData({
  api,
  auth,
  storage,
  userId,
  date = localDayISO(),
  shouldStop = () => false,
}: WarmOfflineDataDeps): Promise<void> {
  const run = async (work: () => Promise<void>) => {
    if (shouldStop()) return;
    try {
      await work();
    } catch {
      // Best-effort bootstrap. Screen-level refreshes remain the visible retry
      // path, and an offline→online transition retries this whole sequence.
    }
  };

  // Reconcile queued offline writes before snapshotting today's aggregate, or
  // a stale server GET can overwrite optimistic Fuel state in SQLite.
  let queueReconciled = false;
  await run(async () => {
    await processSyncQueue(storage, auth, getApiBaseUrl());
    queueReconciled = true;
  });

  await run(async () => {
    // Preserve optimistic Fuel state until all writes which contribute to the
    // aggregate have reached the server. A failed/backed-off/entitlement-
    // blocked mutation must not be replaced by an older server snapshot.
    if (!queueReconciled || hasUnreconciledFuelMutations(storage)) return;
    const result = await api.getFuelToday(date);
    if (!result.ok || shouldStop()) return;
    storage.cacheFuelToday(userId, date, result.value);
    if (result.value.targets) {
      storage.cacheNutritionTarget(userId, result.value.targets);
    }
  });

  // The full exercise catalogue is the other large, screen-blocking cache.
  // Prioritise it ahead of secondary labels and Progress enrichments so the
  // two primary offline tabs become usable as early in the sequence as possible.
  await run(async () => {
    if (!getExercisesQuery(storage).isStale) return;
    await refreshExerciseCache(api, storage);
  });

  // Fuel entry rows store recipe/meal ids. Warm the small lookup libraries as
  // part of the same baseline so an offline day does not degrade to generic
  // labels merely because those library screens were never opened.
  await run(async () => {
    const result = await api.getRecipes();
    if (result.ok && !shouldStop()) storage.cacheRecipes(userId, result.value);
  });

  await run(async () => {
    const result = await api.getMeals();
    if (result.ok && !shouldStop()) storage.cacheMeals(userId, result.value);
  });

  await run(async () => {
    const result = await api.getStreaks();
    if (result.ok && !shouldStop()) storage.cacheStreaks(userId, result.value);
  });

  await run(async () => {
    const result = await api.getAchievements();
    if (result.ok && !shouldStop()) {
      storage.cacheAchievements(userId, result.value);
    }
  });

  await run(async () => {
    const result = await api.getVolumeStats("month");
    if (result.ok && !shouldStop()) {
      storage.cacheVolumeStats(userId, result.value);
    }
  });

  await run(async () => {
    const result = await api.getBodyTrend("30d");
    if (result.ok && !shouldStop()) {
      storage.cacheBodyTrend(userId, result.value);
    }
  });

  await run(async () => {
    const result = await api.getRecentPRs(20);
    if (result.ok && !shouldStop()) {
      storage.cachePersonalRecords(userId, result.value);
    }
  });
}

/**
 * Warm critical offline read models once auth resolves, without requiring the
 * user to visit every tab first. A genuine offline→online transition retries
 * the sequence so a launch without connectivity self-heals on reconnect.
 */
export function useOfflineDataBootstrap(): void {
  const { api, auth, storage, netInfo } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const inFlightRef = useRef<{ userId: string; promise: Promise<void> } | null>(
    null,
  );

  const warm = useCallback(
    async (activeUserId: string, shouldStop: () => boolean) => {
      const existing = inFlightRef.current;
      if (existing?.userId === activeUserId) return existing.promise;

      const promise = (async () => {
        if (!(await netInfo.isConnected()) || shouldStop()) return;
        await warmOfflineData({
          api,
          auth,
          storage,
          userId: activeUserId,
          shouldStop,
        });
      })()
        .catch(() => {
          // Connectivity probes are best-effort. A later NetInfo transition
          // retries the bootstrap; rejected probes must never escape as an
          // unhandled promise rejection during app startup.
        })
        .finally(() => {
          if (inFlightRef.current?.userId === activeUserId) {
            inFlightRef.current = null;
          }
        });
      inFlightRef.current = { userId: activeUserId, promise };
      return promise;
    },
    [api, auth, storage, netInfo],
  );

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    const shouldStop = () => cancelled;
    let previousConnected: boolean | null = null;
    let subscribeFired = false;
    const observeConnectivity = (connected: boolean) => {
      const wasConnected = previousConnected;
      previousConnected = connected;
      // Warm on the first confirmed-online observation and on every genuine
      // reconnect. A first offline observation only seeds the transition.
      if (connected && wasConnected !== true) {
        void warm(userId, shouldStop);
      }
    };
    const unsubscribe = netInfo.subscribe((connected) => {
      subscribeFired = true;
      observeConnectivity(connected);
    });
    // InMemoryNetInfo emits only transitions while RN NetInfo may emit an
    // initial value on subscribe. The explicit probe makes both contracts
    // behave identically; `warm` dedupes if both report online.
    void netInfo
      .isConnected()
      .then((connected) => {
        // A subscription event is newer than this async snapshot. Never let a
        // stale probe overwrite it and suppress the next genuine reconnect.
        if (!cancelled && !subscribeFired) observeConnectivity(connected);
      })
      .catch(() => {
        // The subscription remains the source of truth when a probe fails.
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [netInfo, userId, warm]);
}
